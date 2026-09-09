/**
 * Журнал событий производства (калибровка, параметризация, S/N) — локальная БД.
 */
(function () {
    'use strict';

    const EVENT = {
        SERIAL_CORRECTOR: 'serial_corrector',
        SERIAL_COMPLEX: 'serial_complex',
        NAMEPLATE_PRINT: 'nameplate_print',
        PARAM_START: 'parametrization_start',
        PARAM_VERIFY: 'parametrization_verify',
        PARAM_DONE: 'parametrization_done',
        PASSPORT_GENERATE: 'passport_generate',
        CALIB_START: 'calibration_start',
        CALIB_DONE: 'calibration_done',
        CALIB_PHASE: 'calibration_phase',
        OPERATOR_LOGIN: 'operator_login',
        WORKSTATION_REGISTER: 'workstation_register',
        ORDER_SESSION_OPEN: 'order_session_open',
        ORDER_SESSION_CLOSE: 'order_session_close',
        ASSEMBLY_CONFIRM: 'assembly_confirm',
    };

    const FP_KEY = 'tm07_workstation_fp_v1';
    const WS_CODE_KEY = 'tm07_workstation_code_v1'; // legacy
    const SENSELOCK_AGENT_URLS = [
        'http://127.0.0.1:18779',
        'http://localhost:18779',
        '/senselock-agent',
    ];
    const SENSELOCK_BIND_KEY = 'tm07_senselock_bind_v1';
    const REGISTER_INTERVAL_MS = 5 * 60 * 1000;
    const REFRESH_MIN_INTERVAL_MS = 3000;

    let lastRegisterAt = 0;
    let lastRefreshAt = 0;
    let registerPromise = null;
    let lastStatusData = null;
    let lastRegisteredCode = '';
    /** @type {object|null} */
    let lastSenselockAgent = null;
    let senselockBound = false;
    let senselockBindPromise = null;

    /** @type {{ login?: string, displayName?: string, lastName?: string, firstName?: string, workstationCode?: string, workstationName?: string, activeSession?: object|null, orderNumber?: string|null }|null} */
    let cachedContext = null;

    async function fetchJson(url, options) {
        const res = await fetch(url, Object.assign({ credentials: 'same-origin' }, options || {}));
        const text = await res.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch (_e) {
            throw new Error('Ответ не JSON: ' + text.slice(0, 120));
        }
        if (!res.ok || !data || data.ok === false) {
            throw new Error((data && data.error) || 'HTTP ' + res.status);
        }
        return data;
    }

    function normalizeWorkstationCode(raw) {
        return String(raw || '')
            .trim()
            .replace(/\s+/g, '-')
            .replace(/[^A-Za-z0-9_-]/g, '')
            .toUpperCase()
            .slice(0, 64);
    }

    /** Legacy no-op: ?ws= больше не прокидываем в ссылки. */
    function withWorkstationQuery(url) {
        return url;
    }

    function emitSenselockAgentEvent() {
        try {
            window.dispatchEvent(
                new CustomEvent('tm07-senselock-agent', { detail: lastSenselockAgent })
            );
        } catch (_e) {}
    }

    function getSenselockAgentStatus() {
        return lastSenselockAgent;
    }

    function loadSenselockBind() {
        try {
            const raw = sessionStorage.getItem(SENSELOCK_BIND_KEY);
            if (!raw) return null;
            const data = JSON.parse(raw);
            if (!data || !data.present || !data.workstationCode) return null;
            return data;
        } catch (_e) {
            return null;
        }
    }

    function saveSenselockBind(status) {
        if (!status || !status.present || !status.workstationCode) return;
        try {
            sessionStorage.setItem(
                SENSELOCK_BIND_KEY,
                JSON.stringify({
                    ok: true,
                    offline: false,
                    present: true,
                    workstationCode: status.workstationCode,
                    source: status.source || null,
                    hostname: status.hostname || null,
                    note: status.note || '',
                    boundAt: status.boundAt || new Date().toISOString(),
                    via: status.via || null,
                    version: status.version || null,
                })
            );
        } catch (_e) {}
        senselockBound = true;
    }

    function clearSenselockBind() {
        senselockBound = false;
        try {
            sessionStorage.removeItem(SENSELOCK_BIND_KEY);
        } catch (_e) {}
    }

    async function refreshSenselockAgent(opts) {
        const forceRefresh = !!(opts && opts.forceRefresh);
        const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = ctrl
            ? setTimeout(function () {
                  try {
                      ctrl.abort();
                  } catch (_e) {}
              }, 3500)
            : null;
        let lastErr = null;
        try {
            for (let i = 0; i < SENSELOCK_AGENT_URLS.length; i += 1) {
                const base = SENSELOCK_AGENT_URLS[i];
                try {
                    const statusPath = forceRefresh ? '/status?refresh=1' : '/status';
                    const res = await fetch(base + statusPath, {
                        method: 'GET',
                        mode: base.charAt(0) === '/' ? 'same-origin' : 'cors',
                        cache: 'no-store',
                        signal: ctrl ? ctrl.signal : undefined,
                    });
                    const data = await res.json();
                    if (!res.ok || !data || data.ok === false) {
                        throw new Error((data && data.error) || 'HTTP ' + res.status);
                    }
                    lastSenselockAgent = Object.assign({ offline: false, via: base }, data);
                    try {
                        localStorage.removeItem(WS_CODE_KEY);
                    } catch (_e) {}
                    return lastSenselockAgent;
                } catch (e) {
                    lastErr = e;
                }
            }
            throw lastErr || new Error('agent offline');
        } catch (_e) {
            if (senselockBound && lastSenselockAgent && lastSenselockAgent.present) {
                return lastSenselockAgent;
            }
            lastSenselockAgent = {
                ok: false,
                offline: true,
                present: false,
                workstationCode: null,
                note: 'Агент Senselock не отвечает (127.0.0.1:18779). Запустите TM07-Senselock-Agent.cmd',
            };
            return lastSenselockAgent;
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    /**
     * Одно считывание свистка + регистрация места.
     * Без force повторно использует sessionStorage / кэш.
     */
    async function bindWorkstationOnce(opts) {
        const force = !!(opts && opts.force);
        if (senselockBindPromise) return senselockBindPromise;
        senselockBindPromise = (async function () {
            if (!force && senselockBound && lastSenselockAgent && lastSenselockAgent.present) {
                emitSenselockAgentEvent();
                return lastSenselockAgent;
            }
            if (!force) {
                const restored = loadSenselockBind();
                if (restored) {
                    lastSenselockAgent = Object.assign({ offline: false }, restored);
                    senselockBound = true;
                    emitSenselockAgentEvent();
                    return lastSenselockAgent;
                }
            }
            await refreshSenselockAgent({ forceRefresh: force });
            if (lastSenselockAgent && lastSenselockAgent.present && lastSenselockAgent.workstationCode) {
                lastSenselockAgent = Object.assign({}, lastSenselockAgent, {
                    boundAt: new Date().toISOString(),
                });
                saveSenselockBind(lastSenselockAgent);
                lastRegisterAt = 0;
                try {
                    await registerWorkstation();
                } catch (_e) {}
            }
            emitSenselockAgentEvent();
            return lastSenselockAgent;
        })().finally(function () {
            senselockBindPromise = null;
        });
        return senselockBindPromise;
    }

    function collectClientConfig() {
        return {
            userAgent: navigator.userAgent,
            platform: navigator.platform,
            language: navigator.language,
            languages: navigator.languages ? Array.prototype.slice.call(navigator.languages, 0, 5) : [],
            screen: {
                width: screen.width,
                height: screen.height,
                colorDepth: screen.colorDepth,
            },
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            hardwareConcurrency: navigator.hardwareConcurrency || null,
            deviceMemory: navigator.deviceMemory || null,
            pageUrl: String(location.href.split('#')[0]),
            collectedAt: new Date().toISOString(),
            senselockAgent: lastSenselockAgent
                ? {
                      present: !!lastSenselockAgent.present,
                      workstationCode: lastSenselockAgent.workstationCode || null,
                      source: lastSenselockAgent.source || null,
                      hostname: lastSenselockAgent.hostname || null,
                      offline: !!lastSenselockAgent.offline,
                      version: lastSenselockAgent.version || null,
                  }
                : null,
        };
    }

    function workstationFingerprint() {
        try {
            let fp = localStorage.getItem(FP_KEY);
            if (fp) {
                return fp;
            }
            const blob = JSON.stringify(collectClientConfig());
            let h = 0;
            for (let i = 0; i < blob.length; i += 1) {
                h = ((h << 5) - h + blob.charCodeAt(i)) | 0;
            }
            fp = 'WS' + Math.abs(h).toString(36).toUpperCase().padStart(8, '0').slice(0, 8);
            localStorage.setItem(FP_KEY, fp);
            return fp;
        } catch (_e) {
            return 'WSLOCAL';
        }
    }

    /** Код места: SL-… из агента Senselock, иначе fingerprint. */
    function workstationCode() {
        if (lastSenselockAgent && lastSenselockAgent.present && lastSenselockAgent.workstationCode) {
            return normalizeWorkstationCode(lastSenselockAgent.workstationCode);
        }
        return normalizeWorkstationCode(workstationFingerprint());
    }


    function applyContextFromStatus(data) {
        cachedContext = {
            login: data.operator && data.operator.login,
            displayName: data.operator && data.operator.displayName,
            lastName: data.operator && data.operator.lastName,
            firstName: data.operator && data.operator.firstName,
            workstationId: data.workstation && data.workstation.id,
            workstationCode: data.workstation && data.workstation.code,
            workstationName: data.workstation && data.workstation.name,
            workstationFingerprint: data.workstation && data.workstation.fingerprint,
            workstationConfig: data.workstation && data.workstation.clientConfig,
            activeSession: data.activeSession || null,
            orderNumber: data.activeSession && data.activeSession.orderNumber,
            sessionId: data.activeSession && data.activeSession.id,
        };
        return cachedContext;
    }

    function workstationPayload(extra) {
        const code = workstationCode();
        const base = {
            fingerprint: workstationFingerprint(),
            clientConfig: collectClientConfig(),
        };
        if (code) {
            base.workstationCode = code;
            base.code = code;
        }
        return Object.assign(base, extra || {});
    }

    function statusQueryParams() {
        const q = {
            action: 'status',
            fingerprint: workstationFingerprint(),
        };
        const code = workstationCode();
        if (code) {
            q.workstationCode = code;
            q.ws = code.toLowerCase();
        }
        return q;
    }

    async function registerWorkstation() {
        const now = Date.now();
        const code = workstationCode();
        if (registerPromise) {
            return registerPromise;
        }
        if (
            code &&
            lastRegisteredCode &&
            code !== lastRegisteredCode
        ) {
            lastRegisterAt = 0;
        }
        if (now - lastRegisterAt < REGISTER_INTERVAL_MS && cachedContext && cachedContext.workstationId) {
            if (!code || cachedContext.workstationCode === code) {
                return { ok: true, skipped: true };
            }
        }
        registerPromise = fetchJson('/api/bench-db-status.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(
                Object.assign({ action: 'registerWorkstation' }, workstationPayload())
            ),
        })
            .then(function (data) {
                if (data && data.workstation) {
                    applyContextFromStatus(data);
                    lastRegisteredCode = code || (data.workstation.code || '');
                }
                return data;
            })
            .finally(function () {
                registerPromise = null;
                lastRegisterAt = Date.now();
            });
        return registerPromise;
    }

    /** Сохранить VID/PID/S/N адаптера КАО в карточку текущего рабочего места. */
    async function reportKaoUsb(kaoUsb) {
        if (!kaoUsb || typeof kaoUsb !== 'object') {
            return null;
        }
        const data = await fetchJson('/api/bench-db-status.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(
                Object.assign({ action: 'registerWorkstation', kaoUsb: kaoUsb }, workstationPayload())
            ),
        });
        if (data && data.workstation) {
            applyContextFromStatus(data);
            lastRegisterAt = Date.now();
        }
        return data;
    }

    async function refreshContext(force) {
        const now = Date.now();
        if (!force && now - lastRefreshAt < REFRESH_MIN_INTERVAL_MS && cachedContext) {
            return cachedContext;
        }
        try {
            const q = new URLSearchParams(statusQueryParams());
            const data = await fetchJson('/api/bench-db-status.php?' + q.toString());
            lastRefreshAt = Date.now();
            lastStatusData = data;
            applyContextFromStatus(data);
            return cachedContext;
        } catch (_e) {
            return cachedContext;
        }
    }

    function contextPayload(extra) {
        const c = cachedContext || {};
        const code = workstationCode() || c.workstationCode || '';
        const base = {
            userLogin: c.login || null,
            userDisplayName: c.displayName || null,
            userLastName: c.lastName || null,
            userFirstName: c.firstName || null,
            workstationCode: code || workstationFingerprint(),
            fingerprint: workstationFingerprint(),
            clientConfig: collectClientConfig(),
            orderNumber: c.orderNumber || (c.activeSession && c.activeSession.orderNumber) || null,
        };
        if (code) {
            base.code = code;
        }
        // sessionId в кэше НЕ подмешиваем автоматически — иначе selectOrder
        // всегда реактивирует старую сессию вместо создания новой / смены заказа.
        return Object.assign(base, extra || {});
    }

    async function selectOperator(loginOrOpts, opts) {
        let o = opts || {};
        if (loginOrOpts && typeof loginOrOpts === 'object') {
            o = loginOrOpts;
        } else if (typeof loginOrOpts === 'string' && loginOrOpts.trim()) {
            o.login = loginOrOpts.trim();
        }
        const lastName = o.lastName || o.last_name || '';
        const firstName = o.firstName || o.first_name || '';
        const displayName = o.displayName || o.display_name || '';
        const pin = o.pin != null ? String(o.pin) : '';
        const payload = {
            action: 'selectOperator',
            lastName: lastName,
            firstName: firstName,
            displayName: displayName,
            pin: pin,
        };
        if (o.login) {
            payload.login = o.login;
        }
        const data = await fetchJson('/api/bench-db-status.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(contextPayload(payload)),
        });
        // Всегда берём актуальный status с сервера (сессия заказа могла закрыться при смене оператора).
        lastStatusData = null;
        lastRefreshAt = 0;
        try {
            await bindWorkstationOnce({ force: true });
        } catch (_e) {}
        try {
            await registerWorkstation();
        } catch (_e) {}
        await refreshContext(true);
        if (!hasOperator() && data && data.operator) {
            applyContextFromStatus({
                operator: data.operator,
                workstation: data.workstation,
                activeSession: data.activeSession || null,
            });
        }
        try {
            window.dispatchEvent(new CustomEvent('tm07-operator-changed', { detail: { operator: data.operator } }));
            window.dispatchEvent(
                new CustomEvent('tm07-order-session-changed', {
                    detail: { session: (cachedContext && cachedContext.activeSession) || null },
                })
            );
        } catch (_e) {}
        return data;
    }

    async function clearOperator() {
        await fetchJson('/api/bench-db-status.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'clearOperator' }),
        });
        clearSenselockBind();
        lastSenselockAgent = null;
        emitSenselockAgentEvent();
        const wsKeep = cachedContext
            ? {
                  workstationId: cachedContext.workstationId,
                  workstationCode: cachedContext.workstationCode,
                  workstationName: cachedContext.workstationName,
                  workstationFingerprint: cachedContext.workstationFingerprint,
                  workstationConfig: cachedContext.workstationConfig,
              }
            : null;
        cachedContext = wsKeep;
        lastStatusData = null;
        lastRefreshAt = 0;
        try {
            window.dispatchEvent(new CustomEvent('tm07-operator-changed', { detail: { operator: null } }));
            window.dispatchEvent(new CustomEvent('tm07-order-session-changed', { detail: { session: null } }));
        } catch (_e) {}
    }

    function hasOperator() {
        return !!(cachedContext && (cachedContext.lastName || cachedContext.login));
    }

    async function ensureOperator() {
        await refreshContext(true);
        if (hasOperator()) {
            return cachedContext;
        }
        if (window.TM07_OPERATOR_AUTH && typeof window.TM07_OPERATOR_AUTH.open === 'function') {
            const pinRequired = !!(lastStatusData && lastStatusData.operatorPinRequired);
            await window.TM07_OPERATOR_AUTH.open(
                Object.assign({}, cachedContext || {}, {
                    operatorPinRequired: pinRequired,
                    status: lastStatusData,
                })
            );
            await refreshContext(true);
            if (!hasOperator()) {
                throw new Error('Требуется вход оператора (фамилия и имя)');
            }
            return cachedContext;
        }
        throw new Error('Требуется вход оператора (фамилия и имя)');
    }

    function hasActiveOrder() {
        return !!(cachedContext && cachedContext.activeSession && cachedContext.activeSession.orderNumber);
    }

    function getActiveOrderNumber() {
        if (!cachedContext || !cachedContext.activeSession) {
            return null;
        }
        return cachedContext.activeSession.orderNumber || null;
    }

    async function selectOrder(orderNumber, opts) {
        const o = opts || {};
        await ensureOperator();
        const payload = contextPayload({
            action: 'selectOrder',
            orderNumber: orderNumber || null,
            orderStatus: o.orderStatus || null,
            orderPayload: o.orderPayload || null,
        });
        // Явный resume только через sessionId; иначе сервер ищет последнюю сессию по заказу.
        if (o.sessionId != null && o.sessionId !== '') {
            const sid = parseInt(String(o.sessionId), 10);
            if (sid > 0) {
                payload.sessionId = sid;
            }
        } else {
            delete payload.sessionId;
        }
        if (o.forceNewSession) {
            payload.forceNewSession = true;
        }
        const data = await fetchJson('/api/bench-db-status.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (cachedContext) {
            cachedContext.activeSession = data.session;
            cachedContext.orderNumber = data.session.orderNumber;
            cachedContext.sessionId = data.session.id;
        } else {
            cachedContext = {
                activeSession: data.session,
                orderNumber: data.session.orderNumber,
                sessionId: data.session.id,
            };
        }
        try {
            window.dispatchEvent(
                new CustomEvent('tm07-order-session-changed', { detail: { session: data.session } })
            );
        } catch (_e) {}
        return data;
    }

    async function reopenOrderSession(sessionId, opts) {
        const o = opts || {};
        await ensureOperator();
        const id = parseInt(String(sessionId), 10);
        if (!id) {
            throw new Error('sessionId обязателен');
        }
        return selectOrder(o.orderNumber || null, {
            sessionId: id,
            orderStatus: o.orderStatus || null,
            orderPayload: o.orderPayload || null,
        });
    }

    async function clearOrder(reason) {
        await fetchJson('/api/bench-db-status.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'clearOrder', reason: reason || 'manual' }),
        });
        if (cachedContext) {
            cachedContext.activeSession = null;
            cachedContext.orderNumber = null;
            cachedContext.sessionId = null;
        }
        lastRefreshAt = 0;
        try {
            window.dispatchEvent(new CustomEvent('tm07-order-session-changed', { detail: { session: null } }));
        } catch (_e) {}
    }

    async function ensureOrderSession(expectedOrderNumber) {
        await refreshContext(true);
        if (!hasOperator()) {
            await ensureOperator();
            await refreshContext(true);
        }
        const active = getActiveOrderNumber();
        if (active) {
            if (expectedOrderNumber && active !== expectedOrderNumber) {
                throw new Error(
                    'Открыта сессия заказа ' + active + '. Завершите её или смените заказ.'
                );
            }
            return cachedContext;
        }
        if (expectedOrderNumber) {
            throw new Error(
                'Откройте сессию заказа ' +
                    expectedOrderNumber +
                    ' (кнопка «Войти в заказ» или дождитесь загрузки из 1С).'
            );
        }
        throw new Error('Сначала откройте сессию заказа — введите номер и загрузите данные из 1С.');
    }

    function getActiveSession() {
        if (!cachedContext || !cachedContext.activeSession) {
            return null;
        }
        return cachedContext.activeSession;
    }

    function getSessionStage() {
        const s = getActiveSession();
        if (!s) {
            return null;
        }
        if (s.sessionStage) {
            return s.sessionStage;
        }
        const param = s.parametrization || {};
        if (param.status === 'done') {
            return 'completed';
        }
        if (param.status === 'in_progress') {
            return 'parametrization';
        }
        return 'assembly';
    }

    /** Запись параметров — только на этапе parametrization. */
    function canAccessParametrization() {
        return getSessionStage() === 'parametrization';
    }

    /** Опрос/сверка корректора — на parametrization и после completed. */
    function canInspectCorrector() {
        const stage = getSessionStage();
        return stage === 'parametrization' || stage === 'completed';
    }

    async function confirmAssembly(opts) {
        const o = opts || {};
        await ensureOperator();
        const data = await fetchJson('/api/bench-db-status.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(
                contextPayload({
                    action: 'confirmAssembly',
                    serialCorrector: o.serialCorrector || null,
                })
            ),
        });
        if (cachedContext) {
            cachedContext.activeSession = data.session;
            cachedContext.orderNumber = data.session.orderNumber;
            cachedContext.sessionId = data.session.id;
        }
        try {
            window.dispatchEvent(
                new CustomEvent('tm07-order-session-changed', { detail: { session: data.session } })
            );
        } catch (_e) {}
        return data;
    }

    async function listOrderSessions(query) {
        const q = new URLSearchParams(Object.assign({ action: 'sessions' }, query || {}));
        const data = await fetchJson('/api/bench-db-status.php?' + q.toString());
        return data.sessions || [];
    }

    async function deleteOrderSession(sessionId) {
        const id = parseInt(String(sessionId), 10);
        if (!id) {
            throw new Error('sessionId обязателен');
        }
        return fetchJson('/api/bench-db-status.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'deleteSession', sessionId: id }),
        });
    }

    async function deleteAllOrderSessions() {
        return fetchJson('/api/bench-db-status.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'deleteAllSessions' }),
        });
    }

    async function deleteOperator(operatorId) {
        const id = parseInt(String(operatorId), 10);
        if (!id) {
            throw new Error('operatorId обязателен');
        }
        return fetchJson('/api/bench-db-status.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'deleteOperator', operatorId: id }),
        });
    }

    async function isAdminLoggedIn() {
        try {
            const res = await fetch('/api/auth.php?action=status', { credentials: 'same-origin' });
            const data = await res.json();
            return !!(data && data.success && data.loggedIn);
        } catch (_e) {
            return false;
        }
    }

    function getContext() {
        return cachedContext;
    }

    async function logEvent(eventType, opts) {
        const o = opts || {};
        await ensureOperator();
        const extra = {
            action: 'log',
            eventType: eventType,
            eventState: o.eventState || 'done',
            stage: o.stage || null,
            serialCorrector: o.serialCorrector || null,
            serialComplex: o.serialComplex || null,
            payload: o.payload || null,
        };
        // Для журнала явно передаём текущую сессию (не для selectOrder).
        const sid = (cachedContext && cachedContext.sessionId) ||
            (cachedContext && cachedContext.activeSession && cachedContext.activeSession.id) ||
            null;
        if (sid) {
            extra.sessionId = sid;
        }
        if (cachedContext && cachedContext.orderNumber) {
            extra.orderNumber = cachedContext.orderNumber;
        }
        return fetchJson('/api/bench-events.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(contextPayload(extra)),
        });
    }

    async function getLastEvents(query) {
        const q = new URLSearchParams(Object.assign({ action: 'last' }, query || {}));
        const data = await fetchJson('/api/bench-events.php?' + q.toString());
        return data.events || [];
    }

    async function eventsExist(types, query) {
        const q = new URLSearchParams(Object.assign({ action: 'exists', types: types.join(',') }, query || {}));
        return fetchJson('/api/bench-events.php?' + q.toString());
    }

    async function initBackend() {
        const restored = loadSenselockBind();
        if (restored) {
            lastSenselockAgent = Object.assign({ offline: false }, restored);
            senselockBound = true;
            emitSenselockAgentEvent();
        }
        try {
            await bindWorkstationOnce({ force: !senselockBound });
        } catch (_e) {}
        try {
            await registerWorkstation();
        } catch (_e) {}
        try {
            await refreshContext(true);
            if (lastStatusData && lastStatusData.ok !== false && window.TM07_SERIAL_REGISTRY) {
                window.TM07_SERIAL_REGISTRY.setBackend('firebird');
            }
            return cachedContext;
        } catch (_e) {
            return null;
        }
    }

    async function logStage(stage, state, opts) {
        const map = {
            parametrization: {
                start: EVENT.PARAM_START,
                done: EVENT.PARAM_DONE,
            },
            calibration: {
                start: EVENT.CALIB_START,
                done: EVENT.CALIB_DONE,
                phase: EVENT.CALIB_PHASE,
            },
        };
        const code = map[stage] && map[stage][state];
        if (!code) {
            throw new Error('Unknown stage/state: ' + stage + '/' + state);
        }
        return logEvent(
            code,
            Object.assign(
                { stage: stage, eventState: state === 'phase' ? (opts && opts.eventState) || 'done' : state },
                opts || {}
            )
        );
    }

    window.TM07_BENCH_EVENTS = {
        EVENT: EVENT,
        initBackend: initBackend,
        refreshContext: refreshContext,
        registerWorkstation: registerWorkstation,
        selectOperator: selectOperator,
        clearOperator: clearOperator,
        hasOperator: hasOperator,
        ensureOperator: ensureOperator,
        selectOrder: selectOrder,
        reopenOrderSession: reopenOrderSession,
        clearOrder: clearOrder,
        hasActiveOrder: hasActiveOrder,
        getActiveOrderNumber: getActiveOrderNumber,
        ensureOrderSession: ensureOrderSession,
        getActiveSession: getActiveSession,
        getSessionStage: getSessionStage,
        canAccessParametrization: canAccessParametrization,
        canInspectCorrector: canInspectCorrector,
        confirmAssembly: confirmAssembly,
        listOrderSessions: listOrderSessions,
        deleteOrderSession: deleteOrderSession,
        deleteAllOrderSessions: deleteAllOrderSessions,
        deleteOperator: deleteOperator,
        isAdminLoggedIn: isAdminLoggedIn,
        getContext: getContext,
        collectClientConfig: collectClientConfig,
        workstationFingerprint: workstationFingerprint,
        workstationCode: workstationCode,
        withWorkstationQuery: withWorkstationQuery,
        statusQueryParams: statusQueryParams,
        reportKaoUsb: reportKaoUsb,
        refreshSenselockAgent: refreshSenselockAgent,
        bindWorkstationOnce: bindWorkstationOnce,
        getSenselockAgentStatus: getSenselockAgentStatus,
        logEvent: logEvent,
        logStage: logStage,
        getLastEvents: getLastEvents,
        eventsExist: eventsExist,
        contextPayload: contextPayload,
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            initBackend();
        });
    } else {
        initBackend();
    }
})();
