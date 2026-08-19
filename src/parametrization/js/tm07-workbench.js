/**
 * Рабочее место параметризации ТМ-07 (tm07-workbench.html).
 * Автоматизация: КАО + номер заказа → одна кнопка «Параметризовать».
 */
(function () {
    'use strict';

    let lastPreparedOrder = '';
    /** sessionId из URL (?sessionId=) — открыть существующую закрытую сессию, не создавать новую. */
    let pendingResumeSessionId = null;
    /** После открытия существующей сессии — запустить полный опрос для сверки. */
    let pendingVerifyAfterOpen = false;
    let orderLoadTimer = null;
    let autoRunning = false;
    let resumeSurveyRunning = false;
    let resumeSurveyPendingOrder = '';
    let resumeSurveyScheduledFor = '';

    const CRITICAL_VERIFY_STEPS = ['3', '6', '7', '200', '201', '57', '61', '64', '68'];
    /** Поля перепада — сверять только если в заказе есть ППД. */
    const VERIFY_PPD_STEPS = {
        '8': 1,
        '9': 1,
        '10': 1,
        '11': 1,
        '46': 1,
        '47': 1,
        '48': 1,
        '49': 1,
        '62': 1,
    };
    /** Поля TT (ПТТП) — сверять только если в заказе есть ПТТП. */
    const VERIFY_PTTP_STEPS = {
        '12': 1,
        '13': 1,
        '50': 1,
        '51': 1,
        '52': 1,
        '53': 1,
    };
    /** Допуск сверки даты/времени корректора (п.20), сек. */
    const VERIFY_DATETIME_TOLERANCE_SEC = 120;

    const SESSION_STAGE_LABELS = {
        assembly: 'Сборка',
        parametrization: 'Параметризация',
        completed: 'Завершена',
    };

    function sessionStageLabel(stage) {
        return SESSION_STAGE_LABELS[stage] || stage || '—';
    }

    function getSessionStage() {
        const events = window.TM07_BENCH_EVENTS;
        if (events && typeof events.getSessionStage === 'function') {
            return events.getSessionStage();
        }
        return null;
    }

    function correctorSerialValue() {
        const val3 = $('val_3');
        const fromVal = val3 ? String(val3.value || '').trim() : '';
        if (fromVal) {
            return fromVal;
        }
        const display = $('wbCorrectorSerialDisplay');
        const fromDisplay = display ? String(display.value || '').trim() : '';
        if (fromDisplay) {
            return fromDisplay;
        }
        return String(window.__wbAssemblyCorrectorSerial || '').trim();
    }

    function syncCorrectorSerialDisplay() {
        const display = $('wbCorrectorSerialDisplay');
        const serial = correctorSerialValue();
        if (display) {
            display.value = serial || '';
            display.placeholder = serial ? '' : '—';
        }
    }

    function syncAssemblySerialToVal3() {
        const serial = correctorSerialValue();
        if (!serial) {
            return;
        }
        const inp = $('val_3');
        if (inp && !String(inp.value || '').trim()) {
            inp.value = window.TM07_param_formatStepValue
                ? window.TM07_param_formatStepValue(3, serial)
                : serial;
        }
        window.__wbAssemblyCorrectorSerial = serial;
        syncCorrectorSerialDisplay();
    }

    function setParamSectionLocked(locked) {
        const section = $('wbParamSection');
        const writeBtn = $('paramWriteAll');
        const readBtn = $('paramReadAll');
        const banner = $('wbParamLockBanner');
        const stage = getSessionStage();
        if (section) {
            section.classList.toggle('wb-param-locked', !!locked);
            // Проверка опросом доступна и после завершения параметризации.
            section.classList.toggle('wb-param-verify-mode', stage === 'completed');
        }
        if (banner) {
            if (stage === 'completed') {
                banner.innerHTML =
                    '<i class="bi bi-eye me-1"></i>Параметризация завершена. Можно «Проверить корректор». ' +
                    'Если счётчик ещё не был — введите S/N и даты на карточке «Счётчик» и нажмите «Записать счётчик».';
                banner.className = 'alert alert-success py-2 px-3 mb-3 wb-param-lock-banner';
            } else if (locked) {
                banner.innerHTML =
                    '<i class="bi bi-lock me-1"></i>Параметризация будет доступна после подтверждения сборки корректора.';
                banner.className = 'alert alert-info py-2 px-3 mb-3 wb-param-lock-banner';
            }
        }
        if (writeBtn) {
            writeBtn.disabled = !!locked || stage === 'completed' || autoRunning;
            if (stage === 'completed') {
                writeBtn.title = 'Запись недоступна — сессия завершена. Используйте «Проверить корректор».';
            } else {
                writeBtn.removeAttribute('title');
            }
        }
        if (readBtn) {
            // Опрос/проверка — на этапе параметризации и после завершения.
            const canRead = stage === 'parametrization' || stage === 'completed';
            readBtn.disabled = autoRunning || resumeSurveyRunning || !canRead;
            if (stage === 'completed') {
                readBtn.innerHTML = '<i class="bi bi-eye me-1"></i>Проверить корректор';
                readBtn.className = 'btn btn-success btn-sm';
                readBtn.title = 'Полный опрос корректора и сверка с данными заказа';
            } else {
                readBtn.innerHTML = '<i class="bi bi-eye"></i>';
                readBtn.className = 'btn btn-outline-success btn-sm';
                readBtn.title = 'Опционально: полный опрос и сверка с заказом';
            }
        }
    }

    function paintAssemblyCard() {
        const events = window.TM07_BENCH_EVENTS;
        const active = events && events.hasActiveOrder && events.hasActiveOrder();
        const stage = active ? getSessionStage() : null;
        const stageBadge = $('wbSessionStageBadge');
        const genBtn = $('wbCorrectorSerialGenerate');
        const printBtn = $('wbCorrectorNameplatePrint');
        const confirmBtn = $('wbAssemblyConfirm');
        const statusEl = $('wbAssemblyStatus');
        const card = $('wbCorrectorCard');
        const serial = correctorSerialValue();

        syncCorrectorSerialDisplay();

        if (stageBadge) {
            if (!active) {
                stageBadge.textContent = '—';
                stageBadge.className = 'badge rounded-pill text-bg-secondary ms-auto';
            } else {
                stageBadge.textContent = sessionStageLabel(stage);
                stageBadge.className =
                    'badge rounded-pill ms-auto stage-' + (stage || 'assembly');
            }
        }

        if (card) {
            card.classList.toggle('wb-assembly-done', stage === 'parametrization' || stage === 'completed');
        }

        const assemblyPhase = stage === 'assembly';
        if (genBtn) {
            genBtn.disabled = !active || !assemblyPhase;
        }
        if (printBtn) {
            printBtn.disabled = !active || !/^300\d{7}$/.test(serial);
        }
        if (confirmBtn) {
            confirmBtn.disabled = !active || !assemblyPhase || !/^300\d{7}$/.test(serial);
        }
        if (statusEl) {
            if (!active) {
                statusEl.textContent = 'Откройте сессию заказа.';
                statusEl.className = 'small mb-0 text-body-secondary';
            } else if (stage === 'assembly') {
                statusEl.textContent = serial
                    ? 'S/N готов — распечатайте шильдик и подтвердите сборку.'
                    : 'Сгенерируйте S/N корректора для шильда.';
                statusEl.className = 'small mb-0 text-body-secondary';
            } else if (stage === 'parametrization') {
                statusEl.textContent = 'Сборка подтверждена — доступна параметризация.';
                statusEl.className = 'small mb-0 text-success';
            } else if (stage === 'completed') {
                statusEl.textContent = 'Параметризация завершена — можно проверить опросом корректора.';
                statusEl.className = 'small mb-0 text-success';
            }
        }

        // Запись только на этапе parametrization; опрос/КАО — также после completed.
        const canInspect = !!(active && (stage === 'parametrization' || stage === 'completed'));
        setParamSectionLocked(!canInspect);
        if (active && stage === 'parametrization') {
            syncAssemblySerialToVal3();
        }
    }

    function applyActiveSessionToUI() {
        const events = window.TM07_BENCH_EVENTS;
        const session = events && events.getActiveSession ? events.getActiveSession() : null;
        if (session && session.orderNumber) {
            const numEl = $('paramOrder1cNumber');
            if (numEl && !String(numEl.value || '').trim()) {
                numEl.value = session.orderNumber;
            }
            lastPreparedOrder = normalizeOrder(session.orderNumber) || lastPreparedOrder;
            window.__tm07PreparedOrder = lastPreparedOrder;
        }
        const serial =
            (session && session.serialCorrector) ||
            (session && session.parametrization && session.parametrization.serialCorrector) ||
            '';
        if (serial) {
            const inp = $('val_3');
            if (inp) {
                inp.value = serial;
            }
            const disp = $('wbCorrectorSerialDisplay');
            if (disp) {
                disp.value = serial;
            }
            window.__wbAssemblyCorrectorSerial = serial;
        }
        paintAssemblyCard();
        paintSessionBadge();
    }

    function cleanWorkbenchUrlQuery(keep) {
        try {
            const url = new URL(window.location.href);
            const k = keep || {};
            ['order', 'orderNumber', 'sessionId', 'session', 'newSession', 'new', 'verify'].forEach(
                function (key) {
                    if (!k[key]) {
                        url.searchParams.delete(key);
                    }
                }
            );
            if (k.order) {
                url.searchParams.set('order', k.order);
            }
            if (k.sessionId) {
                url.searchParams.set('sessionId', String(k.sessionId));
            }
            if (k.verify) {
                url.searchParams.set('verify', '1');
            }
            window.history.replaceState({}, '', url.pathname + (url.search || '') + url.hash);
        } catch (_e) {}
    }

    function isResumingExistingSession() {
        if (pendingResumeSessionId) {
            return true;
        }
        if (isNewSessionUrl()) {
            return false;
        }
        const sp = new URLSearchParams(window.location.search);
        if (sp.get('sessionId') || sp.get('session')) {
            return true;
        }
        const events = window.TM07_BENCH_EVENTS;
        const session = events && events.getActiveSession ? events.getActiveSession() : null;
        // Уже открытая сессия с S/N / этапом дальше сборки — не выдаём новый номер.
        if (session && (session.serialCorrector || (session.sessionStage && session.sessionStage !== 'assembly'))) {
            return true;
        }
        return false;
    }

    async function printCorrectorNameplate(serial) {
        const sn = serial || correctorSerialValue();
        if (!/^300\d{7}$/.test(String(sn || '').trim())) {
            throw new Error('Сначала сгенерируйте S/N корректора (300…).');
        }
        const Nameplate = window.TM07_NAMEPLATE;
        if (!Nameplate || typeof Nameplate.printCorrector !== 'function') {
            throw new Error('Модуль печати шильдика недоступен.');
        }
        setWbStatus('Печать шильдика ' + sn + '…', false);
        try {
            const result = await Nameplate.printCorrector(sn, {
                orderNumber: currentOrderNumberForSerials() || undefined,
            });
            const msg =
                (result && result.userMessage) ||
                (result && result.printed
                    ? 'Шильдик отправлен на принтер (S/N ' + sn + ')'
                    : 'Шильдик сформирован (S/N ' + sn + ')');
            plog(msg);
            setWbStatus(msg, false);
            await logOpsEvent(
                (window.TM07_BENCH_EVENTS && window.TM07_BENCH_EVENTS.EVENT.NAMEPLATE_PRINT) ||
                    'nameplate_print',
                'done',
                {
                    stage: 'assembly',
                    serialCorrector: sn,
                    payload: { orderNumber: currentOrderNumberForSerials() || null },
                }
            );
            return result;
        } catch (e) {
            const msg = e.message || String(e);
            await logOpsEvent(
                (window.TM07_BENCH_EVENTS && window.TM07_BENCH_EVENTS.EVENT.NAMEPLATE_PRINT) ||
                    'nameplate_print',
                'fail',
                {
                    stage: 'assembly',
                    serialCorrector: sn,
                    payload: { error: msg, orderNumber: currentOrderNumberForSerials() || null },
                }
            );
            throw e;
        }
    }

    async function generateCorrectorSerial() {
        const ui = window.TM07_SERIAL_REGISTRY_UI;
        if (!ui || typeof ui.allocateCorrectorSerial !== 'function') {
            throw new Error('Модуль реестра S/N недоступен.');
        }
        const orderNumber = currentOrderNumberForSerials();
        const result = await ui.allocateCorrectorSerial({ force: true, orderNumber: orderNumber || null });
        if (!result || !result.serial) {
            throw new Error('Не удалось выдать S/N корректора.');
        }
        plog('S/N корректора: ' + result.serial);
        syncCorrectorSerialDisplay();
        paintAssemblyCard();
        return result.serial;
    }

    async function confirmAssemblyStep() {
        const events = window.TM07_BENCH_EVENTS;
        if (!events || typeof events.confirmAssembly !== 'function') {
            throw new Error('Подтверждение сборки недоступно.');
        }
        const serial = correctorSerialValue();
        if (!/^300\d{7}$/.test(serial)) {
            throw new Error('Сначала сгенерируйте S/N корректора (300…).');
        }
        setWbStatus('Подтверждение сборки…', false);
        await events.confirmAssembly({ serialCorrector: serial });
        plog('Сборка подтверждена. S/N ' + serial + ' — этап параметризации.');
        setWbStatus('Сборка подтверждена — подключите КАО и параметризуйте.', false);
        paintSessionBadge();
        paintAssemblyCard();
        const Ops = window.TM07_WORKBENCH_OPS;
        if (Ops && typeof Ops.paintWorkflowSteps === 'function') {
            Ops.paintWorkflowSteps();
        }
    }

    function $(id) {
        return document.getElementById(id);
    }

    function plog(msg) {
        const le = $('paramLog');
        if (!le) return;
        const t = new Date().toLocaleTimeString();
        le.innerHTML += '[' + t + '] [WB] ' + msg + '<br>';
        le.scrollTop = le.scrollHeight;
        try {
            if (window.TM07_SITE_LOG && typeof window.TM07_SITE_LOG.log === 'function') {
                window.TM07_SITE_LOG.log('workbench', String(msg).slice(0, 300));
            }
        } catch (_e) {}
    }

    function paintConnBadge() {
        const st = $('paramConnStatus');
        if (!st) return;
        const t = (st.textContent || '').toLowerCase();
        st.className =
            'badge rounded-pill ' +
            (t.indexOf('подключ') >= 0 && t.indexOf('отключ') < 0
                ? 'text-bg-success'
                : t.indexOf('ошиб') >= 0
                  ? 'text-bg-danger'
                  : 'text-bg-secondary');
    }

    function paintWriteResumeButton() {
        const btn = $('paramWriteAll');
        if (!btn) {
            return;
        }
        const K = window.TM07_PARAM_KAO;
        const abort = K && typeof K.getLastWriteAbort === 'function' ? K.getLastWriteAbort() : null;
        if (abort && abort.stepId != null) {
            btn.innerHTML =
                '<i class="bi bi-arrow-repeat me-1"></i>Продолжить с п.' + abort.stepId;
            btn.classList.add('btn-danger');
            btn.classList.remove('btn-warning');
            btn.dataset.resume = '1';
            btn.title =
                'Продолжить запись с п.' +
                abort.stepId +
                ' — шаги с отметкой ok пропускаются';
        } else {
            btn.innerHTML = '<i class="bi bi-lightning-charge me-1"></i>Параметризовать';
            btn.classList.add('btn-warning');
            btn.classList.remove('btn-danger');
            delete btn.dataset.resume;
            btn.title = '';
        }
    }

    let printAgentPollTimer = null;

    async function refreshPrintAgentStatus() {
        const badge = $('wbPrintAgentStatus');
        if (!badge) {
            return;
        }
        const Nameplate = window.TM07_NAMEPLATE;
        if (!Nameplate || typeof Nameplate.checkPrintAgentHealth !== 'function') {
            badge.textContent = 'агент —';
            badge.className = 'badge rounded-pill text-bg-secondary';
            badge.title = 'Модуль печати ещё не загружен';
            return;
        }
        try {
            const config =
                typeof Nameplate.loadConfig === 'function' ? await Nameplate.loadConfig(false) : null;
            const pa = (config && config.printAgent) || {};
            const url = String(pa.agentUrl || 'http://127.0.0.1:18778').replace(/\/$/, '');
            if (pa.enabled === false) {
                badge.textContent = 'агент выкл';
                badge.className = 'badge rounded-pill text-bg-secondary';
                badge.title = 'printAgent.enabled=false в nameplate-config';
                return;
            }
            await Nameplate.checkPrintAgentHealth(url);
            badge.textContent = 'агент ✓';
            badge.className = 'badge rounded-pill text-bg-success';
            badge.title = 'Print-агент отвечает: ' + url;
        } catch (_e) {
            badge.textContent = 'агент нет';
            badge.className = 'badge rounded-pill text-bg-danger';
            badge.title =
                (Nameplate && Nameplate.AGENT_HINT) ||
                'Запустите Windows print-агент на этом ПК (127.0.0.1:18778). Печать уйдёт в превью.';
        }
    }

    function startPrintAgentPolling() {
        void refreshPrintAgentStatus();
        if (printAgentPollTimer) {
            clearInterval(printAgentPollTimer);
        }
        printAgentPollTimer = setInterval(function () {
            void refreshPrintAgentStatus();
        }, 20000);
    }

    function paintOrderStatus() {
        const st = $('paramOrder1cStatus');
        if (!st) return;
        const t = (st.textContent || '').trim();
        st.classList.toggle('text-danger', /ошиб|не удал|нет/i.test(t));
        st.classList.toggle('text-success', !!t && !/ошиб|не удал|нет/i.test(t));
    }

    function setWbStatus(text, isError) {
        const st = $('paramWbAutoStatus');
        if (!st) return;
        st.textContent = text || '';
        st.className = 'small mt-2 mb-0 ' + (isError ? 'text-danger' : text ? 'text-success' : 'text-body-secondary');
    }

    function paintSessionBadge() {
        const badge = $('wbOrderSessionBadge');
        const openBtn = $('wbOrderSessionOpen');
        const closeBtn = $('wbOrderSessionClose');
        const st = $('wbOrderSessionStatus');
        const events = window.TM07_BENCH_EVENTS;
        const active = events && events.hasActiveOrder && events.hasActiveOrder();
        const orderNum = events && events.getActiveOrderNumber ? events.getActiveOrderNumber() : null;
        const session = events && events.getActiveSession ? events.getActiveSession() : null;
        if (badge) {
            const stage = events && events.getSessionStage ? events.getSessionStage() : null;
            if (active && orderNum) {
                badge.textContent =
                    'Сессия #' +
                    (session && session.id ? session.id + ' · ' : '') +
                    orderNum +
                    (stage ? ' · ' + sessionStageLabel(stage) : '');
                badge.className = 'badge rounded-pill text-bg-success';
            } else {
                badge.textContent = 'Сессия: не открыта';
                badge.className = 'badge rounded-pill text-bg-secondary';
            }
        }
        if (openBtn) {
            openBtn.classList.toggle('d-none', !!active);
            if (pendingResumeSessionId) {
                openBtn.innerHTML =
                    '<i class="bi bi-box-arrow-in-right me-1"></i>Открыть сессию #' + pendingResumeSessionId;
            } else {
                openBtn.innerHTML = '<i class="bi bi-box-arrow-in-right me-1"></i>Войти в заказ';
            }
        }
        if (closeBtn) {
            closeBtn.classList.toggle('d-none', !active);
        }
        if (st) {
            if (active && orderNum) {
                st.textContent =
                    'Работа привязана к заказу ' +
                    orderNum +
                    (session && session.id ? ' (сессия #' + session.id + ')' : '') +
                    '.';
                st.className = 'small mb-0 text-success';
            } else if (pendingResumeSessionId) {
                st.textContent =
                    'Будет открыта существующая сессия #' +
                    pendingResumeSessionId +
                    ' (без новой записи в списке).';
                st.className = 'small mb-0 text-body-secondary';
            } else if (events && events.hasOperator && events.hasOperator()) {
                st.textContent = 'Введите номер заказа и нажмите «Войти в заказ» или дождитесь автозагрузки из 1С.';
                st.className = 'small mb-0 text-body-secondary';
            } else {
                st.textContent = 'Сначала войдите как оператор, затем откройте заказ.';
                st.className = 'small mb-0 text-body-secondary';
            }
        }
        const wsHint = $('wbWorkstationHint');
        if (wsHint && events && typeof events.getContext === 'function') {
            const ctx = events.getContext();
            const wsName =
                (ctx && ctx.workstationName) ||
                (ctx && ctx.workstationFingerprint) ||
                (ctx && ctx.workstationCode) ||
                '';
            if (wsName) {
                wsHint.textContent = 'Рабочее место: ' + wsName;
                wsHint.classList.remove('d-none');
            } else {
                wsHint.classList.add('d-none');
            }
        }
        paintAssemblyCard();
    }

    function isNewSessionUrl() {
        const sp = new URLSearchParams(window.location.search);
        return sp.get('newSession') === '1' || sp.get('new') === '1';
    }

    function isSessionResumeFromUrl() {
        if (isNewSessionUrl()) {
            return false;
        }
        const sp = new URLSearchParams(window.location.search);
        return !!(
            sp.get('order') ||
            sp.get('orderNumber') ||
            sp.get('sessionId') ||
            sp.get('session') ||
            sp.get('verify') === '1'
        );
    }

    function isVerifyModeFromUrl() {
        const sp = new URLSearchParams(window.location.search);
        return sp.get('verify') === '1';
    }

    function getVerifyEquipmentContext() {
        const Ops = window.TM07_WORKBENCH_OPS;
        if (Ops && typeof Ops.getEquipmentFromOrder === 'function') {
            const equip = Ops.getEquipmentFromOrder() || {};
            return { hasPpd: !!equip.hasPpd, hasPttp: !!equip.hasPttp };
        }
        const C = window.TM07_CORRECTOR_EXECUTION;
        const order = window.__wbLastOrder1c || {};
        const text = String(order.fullText || order.наименование || order.Наименование || '');
        const equip =
            C && typeof C.detectEquipment === 'function'
                ? C.detectEquipment(text)
                : { hasPpd: false, hasPttp: false };
        return { hasPpd: !!equip.hasPpd, hasPttp: !!equip.hasPttp };
    }

    function shouldVerifyStep(stepId, ctx) {
        const sid = String(stepId || '');
        const c = ctx || getVerifyEquipmentContext();
        if (VERIFY_PPD_STEPS[sid] && !c.hasPpd) {
            return false;
        }
        if (VERIFY_PTTP_STEPS[sid] && !c.hasPttp) {
            return false;
        }
        return true;
    }

    function collectExpectedFieldSnapshot() {
        const out = {};
        const ctx = getVerifyEquipmentContext();
        document.querySelectorAll('input.param-val[id^="val_"]').forEach(function (inp) {
            if (inp.disabled) {
                return;
            }
            const v = String(inp.value || '').trim();
            if (!v) {
                return;
            }
            const m = /^val_(\d+)$/.exec(inp.id);
            if (!m) {
                return;
            }
            if (!shouldVerifyStep(m[1], ctx)) {
                return;
            }
            out[m[1]] = v;
        });
        return out;
    }

    function normalizeCompareValue(val) {
        const s = String(val ?? '')
            .trim()
            .replace(/\s+/g, ' ');
        if (!s) {
            return '';
        }
        if (/^0x[0-9a-f]+$/i.test(s)) {
            return String(parseInt(s, 16));
        }
        const n = Number(s.replace(',', '.'));
        if (Number.isFinite(n) && /^-?\d+([.,]\d+)?$/.test(s.replace(/\s/g, ''))) {
            return String(Number(n.toFixed(4)));
        }
        return s.toLowerCase();
    }

    function parseVerifyUnixSeconds(val) {
        const s = String(val ?? '').trim();
        if (!s) {
            return null;
        }
        if (/^\d{9,12}$/.test(s)) {
            const n = Number(s);
            return Number.isFinite(n) ? n : null;
        }
        const m = /\(unix\s+(\d+)\)/i.exec(s);
        if (m) {
            const n = Number(m[1]);
            return Number.isFinite(n) ? n : null;
        }
        const t = Date.parse(s);
        if (Number.isFinite(t)) {
            return Math.floor(t / 1000);
        }
        return null;
    }

    function valuesMatchForVerify(stepId, expected, actual) {
        if (String(stepId) === '20') {
            const a = parseVerifyUnixSeconds(expected);
            const b = parseVerifyUnixSeconds(actual);
            if (a != null && b != null) {
                return Math.abs(a - b) <= VERIFY_DATETIME_TOLERANCE_SEC;
            }
        }
        return normalizeCompareValue(expected) === normalizeCompareValue(actual);
    }

    function getDeviceReadValue(stepId) {
        const out = $('out_' + stepId);
        const t = out ? String(out.textContent || '').trim() : '';
        if (t && t !== '—' && t !== '…' && t !== 'ошибка') {
            return t;
        }
        const inp = $('val_' + stepId);
        return inp ? String(inp.value || '').trim() : '';
    }

    function compareReadbackWithExpected(expected, criticalIds) {
        const criticalSet = {};
        (criticalIds || CRITICAL_VERIFY_STEPS).forEach(function (id) {
            criticalSet[id] = true;
        });
        const ctx = getVerifyEquipmentContext();
        let match = 0;
        let mismatch = 0;
        let checked = 0;
        let criticalMatch = 0;
        let criticalMismatch = 0;
        let criticalChecked = 0;
        const mismatches = [];

        Object.keys(expected || {}).forEach(function (sid) {
            if (!shouldVerifyStep(sid, ctx)) {
                return;
            }
            const exp = expected[sid];
            const actual = getDeviceReadValue(sid);
            if (!actual || actual === 'ошибка') {
                return;
            }
            checked += 1;
            const ok = valuesMatchForVerify(sid, exp, actual);
            if (criticalSet[sid]) {
                criticalChecked += 1;
                if (ok) {
                    criticalMatch += 1;
                } else {
                    criticalMismatch += 1;
                }
            }
            if (ok) {
                match += 1;
            } else {
                mismatch += 1;
                mismatches.push({ stepId: sid, expected: exp, actual: actual });
            }
        });

        return {
            match: match,
            mismatch: mismatch,
            checked: checked,
            mismatches: mismatches,
            critical: {
                match: criticalMatch,
                mismatch: criticalMismatch,
                checked: criticalChecked,
            },
        };
    }

    function getSessionParametrizationFromContext() {
        const events = window.TM07_BENCH_EVENTS;
        if (!events || typeof events.getContext !== 'function') {
            return { status: 'none' };
        }
        const ctx = events.getContext() || {};
        const session = ctx.activeSession || {};
        return session.parametrization || { status: 'none' };
    }

    function buildParametrizationVerdict(dbParam, cmp) {
        const dbDone = dbParam && dbParam.status === 'done';
        const dbInProgress = dbParam && dbParam.status === 'in_progress';
        const critical = cmp.critical || {};
        const criticalOk = critical.checked > 0 && critical.mismatch === 0;
        const allOk = cmp.checked > 0 && cmp.mismatch === 0;

        if (dbDone && allOk) {
            return {
                text:
                    'Корректор параметризован: журнал и опрос совпадают с заказом (' +
                    cmp.match +
                    ' параметров).',
                error: false,
            };
        }
        if (dbDone && criticalOk) {
            return {
                text:
                    'Параметризация завершена (журнал); ключевые параметры совпадают (' +
                    critical.match +
                    ').',
                error: false,
            };
        }
        if (dbDone && !criticalOk && critical.checked > 0) {
            return {
                text:
                    'В журнале параметризация завершена, но корректор не совпадает с заказом (расхождений по ключевым: ' +
                    critical.mismatch +
                    ').',
                error: true,
            };
        }
        if (allOk || (criticalOk && cmp.match >= 3)) {
            return {
                text:
                    'Корректор параметризован по опросу (' +
                    cmp.match +
                    ' совпадений); запись в журнале не найдена.',
                error: false,
            };
        }
        if (dbInProgress) {
            return {
                text:
                    'Параметризация начата, но не завершена; совпадений ' +
                    cmp.match +
                    ', расхождений ' +
                    cmp.mismatch +
                    '.',
                error: true,
            };
        }
        if (cmp.checked === 0) {
            return {
                text: 'Нет заполненных параметров заказа для сравнения — загрузите заказ из 1С.',
                error: true,
            };
        }
        return {
            text:
                'Корректор не параметризован: расхождений ' +
                cmp.mismatch +
                ' из ' +
                cmp.checked +
                '.',
            error: true,
        };
    }

    async function waitForKaoReady(timeoutMs) {
        const K = window.TM07_PARAM_KAO;
        const deadline = Date.now() + (timeoutMs || 90000);
        while (Date.now() < deadline) {
            if (K && typeof K.isPortOpen === 'function' && K.isPortOpen()) {
                if (typeof K.isConnectBusy === 'function' && K.isConnectBusy()) {
                    await new Promise(function (resolve) {
                        window.setTimeout(resolve, 300);
                    });
                    continue;
                }
                const passport = K.getDevicePassport && K.getDevicePassport();
                if (passport && passport.mapVersion != null) {
                    return true;
                }
                if (K.isConnected && K.isConnected()) {
                    return true;
                }
            }
            await new Promise(function (resolve) {
                window.setTimeout(resolve, 400);
            });
        }
        return false;
    }

    async function runSessionResumeSurvey(orderNumber) {
        const order = normalizeOrder(orderNumber || ($('paramOrder1cNumber') || {}).value || '');
        if (!order || resumeSurveyRunning) {
            return;
        }
        if (autoRunning || window.__tm07ParamWriteRunning) {
            return;
        }
        if (resumeSurveyPendingOrder === order && resumeSurveyRunning) {
            return;
        }
        resumeSurveyRunning = true;
        resumeSurveyPendingOrder = order;
        window.__tm07SessionResumeSurveyCancel = false;

        try {
            plog('Возврат в сессию ' + order + ' — автоподключение КАО и опрос корректора…');
            setWbStatus('Подключение КАО…', false);

            const events = window.TM07_BENCH_EVENTS;
            if (events && typeof events.ensureOperator === 'function') {
                try {
                    await events.ensureOperator();
                } catch (e) {
                    setWbStatus(e.message || 'Требуется вход оператора', true);
                    plog('Опрос: ' + (e.message || String(e)));
                    return;
                }
            }

            if (autoRunning || window.__tm07ParamWriteRunning || window.__tm07SessionResumeSurveyCancel) {
                plog('Опрос пропущен — идёт параметризация.');
                return;
            }

            const expected = collectExpectedFieldSnapshot();
            const K = window.TM07_PARAM_KAO;
            if (!K) {
                setWbStatus('Модуль КАО недоступен.', true);
                return;
            }

            window.__tm07SessionResumeSurvey = true;
            try {
                window.dispatchEvent(
                    new CustomEvent('tm07-session-resume-survey', {
                        detail: { kaoFilterKao: window.__tm07KaoFilterKao !== false },
                    })
                );
        } catch (_e) {}

            if (!K.isPortOpen || !K.isPortOpen()) {
                await K.tryAutoReconnect(window.__tm07KaoFilterKao !== false, false, true);
            }

            if (autoRunning || window.__tm07ParamWriteRunning || window.__tm07SessionResumeSurveyCancel) {
                plog('Опрос пропущен — идёт параметризация.');
                return;
            }

            const ready = await waitForKaoReady(90000);
            if (!ready) {
                setWbStatus('КАО не подключён — подключите вручную для проверки параметризации.', true);
                plog('Автоподключение КАО не удалось — опрос параметров пропущен.');
                return;
            }

            if (autoRunning || window.__tm07ParamWriteRunning || window.__tm07SessionResumeSurveyCancel) {
                plog('Опрос пропущен — идёт параметризация.');
                return;
            }

            const passport = K.getDevicePassport && K.getDevicePassport();
            if (passport) {
                const parts = [];
                if (passport.serial) {
                    parts.push('S/N ' + passport.serial);
                }
                if (passport.fwVersion) {
                    parts.push('ПО ' + passport.fwVersion);
                }
                if (passport.mapVersion != null) {
                    parts.push('карта ' + passport.mapVersion);
                }
                if (parts.length) {
                    plog('Корректор: ' + parts.join(', '));
                }
            }
            const lock = K.getLockStatus && K.getLockStatus();
            if (lock && lock.raw != null) {
                plog('Замки: 0x' + Number(lock.raw).toString(16).toUpperCase().padStart(4, '0'));
            }

            plog('Полный опрос параметров корректора…');
            setWbStatus('Опрос корректора…', false);

            if (typeof K.readAllSections === 'function') {
                await K.readAllSections();
            } else if (typeof K.runReadAllSteps === 'function') {
                await K.runReadAllSteps(window.TM07_PARAM_DOC && window.TM07_PARAM_DOC.steps, 'основные');
            }

            if (autoRunning || window.__tm07ParamWriteRunning || window.__tm07SessionResumeSurveyCancel) {
                return;
            }

            const cmp = compareReadbackWithExpected(expected);
            if (cmp.mismatches.length) {
                cmp.mismatches.slice(0, 8).forEach(function (m) {
                    plog('Расхождение п.' + m.stepId + ': заказ «' + m.expected + '», в корректоре «' + m.actual + '»');
                });
                if (cmp.mismatches.length > 8) {
                    plog('… и ещё ' + (cmp.mismatches.length - 8) + ' расхождений.');
                }
            }

            if (events && typeof events.refreshContext === 'function') {
                try {
                    await events.refreshContext();
                } catch (_e) {}
            }
            const dbParam = getSessionParametrizationFromContext();
            const verdict = buildParametrizationVerdict(dbParam, cmp);

            plog(verdict.text);
            setWbStatus(verdict.text, verdict.error);

            if (window.TM07_WORKBENCH_STATE && typeof window.TM07_WORKBENCH_STATE.save === 'function') {
                window.TM07_WORKBENCH_STATE.save();
            }

            try {
                window.dispatchEvent(
                    new CustomEvent('tm07-session-survey-done', {
                        detail: {
                            orderNumber: order,
                            verdict: verdict,
                            compare: cmp,
                            parametrization: dbParam,
                        },
                    })
                );
            } catch (_e2) {}
        } finally {
            window.__tm07SessionResumeSurvey = false;
            window.__tm07SessionResumeSurveyCancel = false;
            resumeSurveyRunning = false;
            pendingVerifyAfterOpen = false;
        }
    }

    function scheduleSessionResumeSurvey(orderNumber, opts) {
        const o = opts || {};
        // Не запускать опрос параллельно с записью («Параметризовать»).
        if (autoRunning || window.__tm07ParamWriteRunning) {
            return;
        }
        if (!o.force && !isSessionResumeFromUrl() && !pendingVerifyAfterOpen && !pendingResumeSessionId) {
            return;
        }
        if (!o.force && isNewSessionUrl()) {
            return;
        }
        const order = normalizeOrder(orderNumber || ($('paramOrder1cNumber') || {}).value || '');
        if (!order) {
            return;
        }
        if (!o.force && (resumeSurveyScheduledFor === order || resumeSurveyRunning)) {
            return;
        }
        if (resumeSurveyRunning && !o.force) {
            return;
        }
        resumeSurveyScheduledFor = order;
        const delay = o.immediate ? 0 : 800;
        window.setTimeout(function () {
            resumeSurveyScheduledFor = '';
            if (autoRunning || window.__tm07ParamWriteRunning) {
                return;
            }
            void runSessionResumeSurvey(order);
        }, delay);
    }

    function cancelSessionResumeSurvey(why) {
        resumeSurveyScheduledFor = '';
        if (resumeSurveyRunning) {
            window.__tm07SessionResumeSurveyCancel = true;
            plog('Опрос при возврате отменён' + (why ? ': ' + why : ''));
        }
    }

    /**
     * Проверка: загрузить ожидаемые поля (если пусто) → полный опрос → сверка с заказом.
     */
    async function verifyCorrectorAgainstOrder(opts) {
        const o = opts || {};
        if (autoRunning || window.__tm07ParamWriteRunning) {
            throw new Error('Дождитесь окончания параметризации.');
        }
        if (resumeSurveyRunning) {
            throw new Error('Опрос уже выполняется.');
        }
        const order = normalizeOrder(
            o.orderNumber || ($('paramOrder1cNumber') || {}).value || lastPreparedOrder || ''
        );
        if (!order) {
            throw new Error('Сначала откройте заказ / сессию.');
        }
        cancelSessionResumeSurvey('manual_verify');
        // Если поля заказа пустые — подтянуть из 1С перед сверкой (без автоопроса).
        const snap = collectExpectedFieldSnapshot();
        if (Object.keys(snap).length < 3) {
            setWbStatus('Загрузка заказа для сверки…', false);
            await prepareOrderFromInput(true, { skipResumeSurvey: true });
        }
        await runSessionResumeSurvey(order);
    }

    async function disconnectKaoIfConnected() {
        if (!isConnected()) {
            return;
        }
        const btn = $('paramDisconnect');
        if (btn) {
            btn.click();
            await new Promise(function (resolve) {
                window.setTimeout(resolve, 300);
            });
        }
    }

    async function resetWorkbenchForNewSession(opts) {
        const o = opts || {};
        const Ops = window.TM07_WORKBENCH_OPS;

        if (o.disconnectKao) {
            await disconnectKaoIfConnected();
        }

        if (Ops && typeof Ops.resetAllForNewSession === 'function') {
            Ops.resetAllForNewSession();
        } else if (Ops) {
            if (Ops.resetScannedSensors) {
                Ops.resetScannedSensors();
            }
            if (Ops.resetMeterSerial) {
                Ops.resetMeterSerial();
            }
        }

        if (o.clearLog !== false) {
            const log = $('paramLog');
            if (log) {
                log.innerHTML = '';
            }
        }

        setWbStatus('', false);

        if (!o.keepOrderStatus) {
            const orderSt = $('paramOrder1cStatus');
            if (orderSt) {
                orderSt.textContent = '';
            }
            const badge = $('paramOrder1cOrderStatus');
            if (badge) {
                badge.textContent = 'Статус: —';
                badge.className = 'badge rounded-pill text-bg-secondary';
            }
        }

        if (o.clearOrderInput) {
            const numEl = $('paramOrder1cNumber');
            if (numEl) {
                numEl.value = '';
            }
        }

        lastPreparedOrder = o.keepPreparedOrder ? lastPreparedOrder : '';
        window.__tm07PreparedOrder = o.keepPreparedOrder ? window.__tm07PreparedOrder : '';
        window.__tm07KaoWasConnected = false;
        window.__tm07KaoFilterKao = true;

        if (window.TM07_WORKBENCH_STATE && typeof window.TM07_WORKBENCH_STATE.clear === 'function') {
            window.TM07_WORKBENCH_STATE.clear();
        }

        if (window.TM07_WORKBENCH_STATE && typeof window.TM07_WORKBENCH_STATE.save === 'function') {
            window.TM07_WORKBENCH_STATE.save();
        }

        paintSessionBadge();
        paintAssemblyCard();
        if (Ops && typeof Ops.paintWorkflowSteps === 'function') {
            Ops.paintWorkflowSteps();
        }

        try {
            window.dispatchEvent(new CustomEvent('tm07-session-reset', { detail: o }));
        } catch (_e) {}
    }

    async function startNewSessionPage() {
        const events = window.TM07_BENCH_EVENTS;
        pendingResumeSessionId = null;
        if (events && typeof events.clearOrder === 'function') {
            try {
                await events.clearOrder('new_session');
            } catch (_e) {}
        }
        await resetWorkbenchForNewSession({
            clearOrderInput: true,
            clearLog: true,
            disconnectKao: true,
        });
        cleanWorkbenchUrlQuery();
        plog('Новая сессия — введите номер заказа и нажмите «Войти в заказ».');
        paintSessionBadge();
    }

    async function openOrderSession(number, result, opts) {
        const events = window.TM07_BENCH_EVENTS;
        const o = opts || {};
        if (!events || typeof events.selectOrder !== 'function') {
            paintSessionBadge();
            return null;
        }
        try {
            await events.ensureOperator();
        } catch (e) {
            plog('Оператор: ' + (e.message || String(e)));
            paintSessionBadge();
            return null;
        }
        const row = result && result.row ? result.row : null;
        const badgeEl = $('paramOrder1cOrderStatus');
        const badgeText = badgeEl ? String(badgeEl.textContent || '') : '';
        let orderStatus = '';
        if (badgeText && /статус:/i.test(badgeText)) {
            orderStatus = badgeText.replace(/^[^:]+:\s*/i, '').trim();
        }
        let orderTextBlob = '';
        if (row) {
            const ToParam = window.TM07Order1cToParam;
            const p200 = $('val_200');
            const primary = p200 ? String(p200.value || '').trim() : '';
            if (ToParam && typeof ToParam.collectOrderTextBlob === 'function') {
                orderTextBlob = ToParam.collectOrderTextBlob(row, primary);
            }
        }
        try {
            const selectOpts = {
                orderStatus: orderStatus || undefined,
                orderPayload: row
                    ? {
                          number: number,
                          refKey: row.Ref_Key || row.ref_key || null,
                          orderStatus: orderStatus || null,
                          orderTextBlob: orderTextBlob,
                          row: {
                              НаименованиеПолное_Номенклатуры: String(
                                  row['НаименованиеПолное_Номенклатуры'] || ''
                              ).trim(),
                              НаименованиеПолное_Характеристики: String(
                                  row['НаименованиеПолное_Характеристики'] || ''
                              ).trim(),
                          },
                      }
                    : { number: number, orderTextBlob: orderTextBlob },
            };
            if (o.sessionId) {
                selectOpts.sessionId = o.sessionId;
            } else if (pendingResumeSessionId) {
                selectOpts.sessionId = pendingResumeSessionId;
            }
            const data = await events.selectOrder(number, selectOpts);
            const sid = data && data.session && data.session.id ? data.session.id : selectOpts.sessionId;
            if (pendingResumeSessionId && sid && String(sid) === String(pendingResumeSessionId)) {
                pendingResumeSessionId = null;
            }
            plog(
                'Сессия заказа: ' +
                    number +
                    (sid ? ' (#' + sid + ')' : '') +
                    (selectOpts.sessionId ? ' — открыта существующая' : '')
            );
            applyActiveSessionToUI();
            paintSessionBadge();
            return data;
        } catch (e) {
            plog('Сессия: ' + (e.message || String(e)));
            paintSessionBadge();
            throw e;
        }
    }

    function normalizeOrder(raw) {
        const O = window.Order1cOdata;
        return O && O.normalizeOrderNumber ? O.normalizeOrderNumber(raw) : String(raw || '').trim();
    }

    function isOrderInputReady(raw) {
        const s = String(raw || '').trim();
        if (!s) return false;
        if (/^\d{3,6}$/.test(s)) return true;
        const n = normalizeOrder(s);
        return /^ТМ00-\d{6}$/i.test(n);
    }

    function isConnected() {
        const K = window.TM07_PARAM_KAO;
        if (K && typeof K.isConnected === 'function') {
            return K.isConnected();
        }
        const st = ($('paramConnStatus')?.textContent || '').toLowerCase();
        return /\bподключено\b/.test(st) && st.indexOf('отключ') < 0;
    }

    async function logOpsEvent(eventType, eventState, opts) {
        const events = window.TM07_BENCH_EVENTS;
        if (!events || typeof events.logEvent !== 'function') {
            return;
        }
        try {
            await events.logEvent(
                eventType,
                Object.assign(
                    {
                        eventState: eventState || 'done',
                        stage: (opts && opts.stage) || 'parametrization',
                    },
                    opts || {}
                )
            );
        } catch (_e) {
            /* журнал не должен ломать основной сценарий */
        }
    }

    function showOrderRetryBar(message, number) {
        const bar = $('paramOrder1cRetryBar');
        if (!bar) {
            return;
        }
        const ToParam = window.TM07Order1cToParam;
        const canCache =
            ToParam && typeof ToParam.hasCachedOrder === 'function' && ToParam.hasCachedOrder(number);
        bar.classList.remove('d-none');
        bar.innerHTML =
            '<div class="d-flex flex-wrap align-items-center gap-2">' +
            '<span>' +
            (message || 'Не удалось загрузить заказ из 1С.') +
            '</span>' +
            '<button type="button" class="btn btn-sm btn-warning" id="paramOrder1cRetryNow">Повторить 1С</button>' +
            (canCache
                ? '<button type="button" class="btn btn-sm btn-outline-dark" id="paramOrder1cUseCacheNow">Работать из кэша</button>'
                : '') +
            '</div>';
        $('paramOrder1cRetryNow')?.addEventListener('click', function () {
            hideOrderRetryBar();
            prepareOrderFromInput(true).catch(function (e) {
                plog(e.message || String(e));
                showOrderRetryBar(e.message || String(e), number);
            });
        });
        $('paramOrder1cUseCacheNow')?.addEventListener('click', function () {
            hideOrderRetryBar();
            applyOrderFromCacheAndOpen(number).catch(function (e) {
                plog(e.message || String(e));
                setWbStatus(e.message || String(e), true);
                showOrderRetryBar(e.message || String(e), number);
            });
        });
    }

    function hideOrderRetryBar() {
        const bar = $('paramOrder1cRetryBar');
        if (!bar) {
            return;
        }
        bar.classList.add('d-none');
        bar.innerHTML = '';
    }

    async function applyOrderFromCacheAndOpen(preferredNumber) {
        const ToParam = window.TM07Order1cToParam;
        if (!ToParam || typeof ToParam.applyCachedOrder !== 'function') {
            throw new Error('Модуль кэша заказа недоступен.');
        }
        const result = ToParam.applyCachedOrder(preferredNumber || ($('paramOrder1cNumber') || {}).value);
        const number = normalizeOrder(result.number || '');
        if (!number) {
            throw new Error('В кэше нет номера заказа.');
        }
        lastPreparedOrder = number;
        window.__tm07PreparedOrder = number;
        plog('Заказ из кэша: ' + number + ' (' + result.apply.filled + ' полей).');
        setWbStatus('Заказ ' + number + ' из кэша браузера (' + result.apply.filled + ' полей).', false);
        const Ops = window.TM07_WORKBENCH_OPS;
        if (Ops) {
            Ops.paintSensorBadges();
            Ops.paintMeterBadge();
            Ops.paintWorkflowSteps();
            Ops.syncMeterSerialFromStep();
        }
        try {
            window.dispatchEvent(new CustomEvent('tm07-order-applied', { detail: { number: number, cached: true } }));
        } catch (_e) {}
        await openOrderSession(number, result);
        applyActiveSessionToUI();
        return result;
    }

    async function verifyDeviceAgainstOrderAfterWrite() {
        const K = window.TM07_PARAM_KAO;
        if (!K) {
            throw new Error('Модуль КАО недоступен для сверки.');
        }
        // Снимок ожидаемого ДО опроса — иначе val_* перезапишутся из прибора и сверка станет тавтологией.
        const expected = collectExpectedFieldSnapshot();
        plog('Сверка: полный опрос параметров…');
        setWbStatus('Сверка с заказом…', false);
        if (typeof K.readAllSections === 'function') {
            await K.readAllSections();
        } else if (typeof K.runReadAllSteps === 'function') {
            await K.runReadAllSteps(window.TM07_PARAM_DOC && window.TM07_PARAM_DOC.steps, 'основные');
        } else {
            throw new Error('Нет функции опроса для сверки.');
        }
        const cmp = compareReadbackWithExpected(expected);
        if (cmp.mismatches.length) {
            cmp.mismatches.slice(0, 8).forEach(function (m) {
                plog('Расхождение п.' + m.stepId + ': заказ «' + m.expected + '», в корректоре «' + m.actual + '»');
            });
            if (cmp.mismatches.length > 8) {
                plog('…ещё расхождений: ' + (cmp.mismatches.length - 8));
            }
        }
        const critical = cmp.critical || {};
        // Fail-closed: без ключевых совпадений или при любом critical mismatch — не OK.
        const ok = critical.checked > 0 && critical.mismatch === 0;
        return {
            ok: ok,
            cmp: cmp,
            message: ok
                ? 'Сверка OK: совпадений ' + cmp.match + ' из ' + cmp.checked +
                  ' (ключевых ' + critical.checked + ').'
                : critical.checked === 0
                  ? 'Сверка не выполнена: нет ключевых значений для сравнения.'
                  : 'Сверка не прошла: ключевых расхождений ' + critical.mismatch + '.',
        };
    }

    async function prepareOrderFromInput(force, opts) {
        const prepOpts = opts || {};
        const numEl = $('paramOrder1cNumber');
        const raw = (numEl && numEl.value) || '';
        if (!isOrderInputReady(raw)) {
            throw new Error('Введите номер заказа (например 539 или ТМ00-000539).');
        }
        const number = normalizeOrder(raw);
        const orderChanged = lastPreparedOrder !== '' && lastPreparedOrder !== number;

        if (orderChanged) {
            plog('Новый заказ — закрываю предыдущую сессию…');
            pendingResumeSessionId = null;
            pendingVerifyAfterOpen = false;
            const events = window.TM07_BENCH_EVENTS;
            if (events && typeof events.clearOrder === 'function' && events.hasActiveOrder && events.hasActiveOrder()) {
                try {
                    await events.clearOrder('switch_order');
                } catch (_e) {}
            }
            await resetWorkbenchForNewSession({
                keepOrderInput: true,
                clearLog: true,
                disconnectKao: true,
            });
        }

        const resuming = isResumingExistingSession();

        if (!force && lastPreparedOrder === number) {
            await openOrderSession(number, null);
            applyActiveSessionToUI();
            if (!resuming) {
                await maybeIssueSerialAndPrintForOrder(number, true);
            }
            const Ops = window.TM07_WORKBENCH_OPS;
            if (Ops) {
                Ops.paintSensorBadges();
                Ops.paintWorkflowSteps();
            }
            if (!prepOpts.skipResumeSurvey) {
                maybeScheduleVerifySurvey(number);
            }
            return { number: number, cached: true, resumed: resuming };
        }
        const ToParam = window.TM07Order1cToParam;
        if (!ToParam || typeof ToParam.loadAndApplyOrder !== 'function') {
            throw new Error('Модуль загрузки заказа 1С недоступен.');
        }
        plog('Загрузка заказа ' + number + ' из 1С…');
        setWbStatus('Загрузка заказа ' + number + '…', false);
        hideOrderRetryBar();
        let result;
        try {
            result = await ToParam.loadAndApplyOrder(number);
        } catch (loadErr) {
            const msg = loadErr.message || String(loadErr);
            plog('1С: ' + msg);
            setWbStatus(msg, true);
            showOrderRetryBar(msg, number);
            throw loadErr;
        }
        lastPreparedOrder = number;
        window.__tm07PreparedOrder = number;
        plog('Заказ подставлен: ' + result.apply.filled + ' полей.');
        let statusMsg = 'Заказ ' + number + ': подставлено ' + result.apply.filled + ' полей';
        setWbStatus(
            resuming ? statusMsg + '.' : statusMsg + '. Выдача S/N и печать шильдика…',
            false
        );
        const Ops = window.TM07_WORKBENCH_OPS;
        // Даты поверки, п.121/107, блок телеметрии п.227 — сразу после заказа, не только при записи.
        if (Ops && typeof Ops.applyVerificationAndDefaults === 'function') {
            Ops.applyVerificationAndDefaults([]);
        }
        // Снимок диапазонов/погрешностей из заказа — для сверки с QR.
        if (Ops && typeof Ops.captureOrderSensorExpectations === 'function') {
            Ops.captureOrderSensorExpectations();
            const exp = Ops.getOrderSensorExpectations && Ops.getOrderSensorExpectations();
            if (exp) {
                const bits = [];
                if (exp.DA && (exp.DA.pmin != null || exp.DA.pmax != null)) {
                    bits.push(
                        'ПАД ' +
                            (exp.DA.pmin != null ? exp.DA.pmin : '—') +
                            '…' +
                            (exp.DA.pmax != null ? exp.DA.pmax : '—') +
                            ' кПа' +
                            (exp.DA.accuracy != null ? ', δ' + exp.DA.accuracy + '%' : '')
                    );
                }
                if (exp.DD && (exp.DD.pmin != null || exp.DD.pmax != null)) {
                    bits.push(
                        'ППД ' +
                            (exp.DD.pmin != null ? exp.DD.pmin : '—') +
                            '…' +
                            (exp.DD.pmax != null ? exp.DD.pmax : '—') +
                            ' кПа' +
                            (exp.DD.accuracy != null ? ', δ' + exp.DD.accuracy + '%' : '')
                    );
                }
                if (bits.length) {
                    plog('Ожидание датчиков из заказа: ' + bits.join('; '));
                }
            }
        }
        if (Ops && typeof Ops.paintSensorBadges === 'function') {
            Ops.paintSensorBadges();
            Ops.paintMeterBadge();
            Ops.paintWorkflowSteps();
            Ops.syncMeterSerialFromStep();
            Ops.focusQrInput();
        }
        try {
            window.dispatchEvent(new CustomEvent('tm07-order-applied', { detail: { number: number } }));
        } catch (_e) {}
        await openOrderSession(number, result);
        applyActiveSessionToUI();
        if (!resuming) {
            await maybeIssueSerialAndPrintForOrder(number, !!result && result.cached);
        } else {
            setWbStatus(statusMsg + ' — открыта существующая сессия.', false);
            const activeSid =
                (window.TM07_BENCH_EVENTS &&
                    window.TM07_BENCH_EVENTS.getActiveSession &&
                    window.TM07_BENCH_EVENTS.getActiveSession() &&
                    window.TM07_BENCH_EVENTS.getActiveSession().id) ||
                pendingResumeSessionId ||
                undefined;
            const keepVerify =
                pendingVerifyAfterOpen ||
                isVerifyModeFromUrl() ||
                getSessionStage() === 'completed';
            cleanWorkbenchUrlQuery({
                order: number,
                sessionId: activeSid,
                verify: keepVerify ? 1 : undefined,
            });
        }
        if (!prepOpts.skipResumeSurvey) {
            maybeScheduleVerifySurvey(number);
        }
        return { number: number, cached: false, result: result, resumed: resuming };
    }

    function maybeScheduleVerifySurvey(orderNumber) {
        const stage = getSessionStage();
        // На этапе сборки опрос не нужен.
        if (stage === 'assembly') {
            return;
        }
        // Повторное открытие (URL/sessionId/verify) или уже завершённая сессия — полный опрос для сверки.
        if (
            pendingVerifyAfterOpen ||
            isVerifyModeFromUrl() ||
            isSessionResumeFromUrl() ||
            stage === 'completed'
        ) {
            pendingVerifyAfterOpen = true;
            scheduleSessionResumeSurvey(orderNumber, { force: true });
        }
    }

    async function maybeIssueSerialAndPrintForOrder(orderNumber, cached) {
        if (isResumingExistingSession()) {
            applyActiveSessionToUI();
            return { skipped: true, reason: 'resume' };
        }
        const Nameplate = window.TM07_NAMEPLATE;
        if (!Nameplate || typeof Nameplate.issueSerialAndPrintForOrder !== 'function') {
            return null;
        }
        if (cached && /^300\d{7}$/.test(correctorSerialValue())) {
            return { serial: correctorSerialValue(), skipped: true };
        }
        try {
            const issued = await Nameplate.issueSerialAndPrintForOrder(orderNumber);
            if (!issued || !issued.serial) {
                return null;
            }
            syncCorrectorSerialDisplay();
            paintAssemblyCard();
            const printed = !!issued.printed;
            const previewOnly = !!(issued.printResult && issued.printResult.previewFallback);
            const printErr =
                issued.printResult && issued.printResult.printError
                    ? String(issued.printResult.printError)
                    : '';
            let status =
                'Заказ ' +
                (orderNumber || '') +
                ': S/N ' +
                issued.serial;
            if (printed) {
                status += ' — шильдик отправлен на печать.';
            } else if (previewOnly) {
                status += ' — превью шильдика (агент печати не запущен).';
            } else if (printErr) {
                status += ' — печать не удалась, S/N выдан. ' + printErr;
            } else {
                status += ' — нажмите «Печать шильдика».';
            }
            plog(status);
            // Ошибка печати/агента — предупреждение, не красный блокер открытия заказа.
            setWbStatus(status, !!(printErr && !previewOnly && !printed));
            if (printErr && !previewOnly && !printed) {
                await logOpsEvent(
                    (window.TM07_BENCH_EVENTS && window.TM07_BENCH_EVENTS.EVENT.NAMEPLATE_PRINT) ||
                        'nameplate_print',
                    'fail',
                    {
                        stage: 'assembly',
                        serialCorrector: issued.serial || null,
                        payload: { orderNumber: orderNumber, error: printErr },
                    }
                );
            }
            return issued;
        } catch (e) {
            const msg = e.message || String(e);
            plog('Шильдик: ' + msg);
            setWbStatus('Заказ открыт, но выдача S/N/печать не удалась: ' + msg, true);
            await logOpsEvent(
                (window.TM07_BENCH_EVENTS && window.TM07_BENCH_EVENTS.EVENT.NAMEPLATE_PRINT) ||
                    'nameplate_print',
                'fail',
                {
                    stage: 'assembly',
                    serialCorrector: correctorSerialValue() || null,
                    payload: { orderNumber: orderNumber, error: msg },
                }
            );
            return null;
        }
    }

    function currentOrderNumberForSerials() {
        const events = window.TM07_BENCH_EVENTS;
        if (events && events.getActiveOrderNumber && events.getActiveOrderNumber()) {
            return events.getActiveOrderNumber();
        }
        return normalizeOrder(($('paramOrder1cNumber') || {}).value || '');
    }

    async function ensureComplexSerial() {
        const Ops = window.TM07_WORKBENCH_OPS;
        if (Ops && typeof Ops.isComplexOrder === 'function' && !Ops.isComplexOrder()) {
            plog('Только корректор — S/N комплекса не выдаём.');
            return null;
        }
        const ui = window.TM07_SERIAL_REGISTRY_UI;
        if (!ui || typeof ui.ensureSerialNumbersAuto !== 'function') {
            return null;
        }
        const orderNumber = currentOrderNumberForSerials();
        const sn = await ui.ensureSerialNumbersAuto({ orderNumber: orderNumber || null });
        if (sn && sn.complex) {
            plog('S/N комплекса: ' + sn.complex);
        }
        return sn;
    }

    function ensureDatetimeNow() {
        const K = window.TM07_PARAM_KAO;
        if (K && typeof K.setDatetimeNow === 'function') {
            K.setDatetimeNow(20);
        }
    }

    async function runFullParametrization() {
        if (autoRunning) {
            return;
        }
        autoRunning = true;
        window.__tm07ParamWriteRunning = true;
        cancelSessionResumeSurvey('старт параметризации');
        const btn = $('paramWriteAll');
        const Guide = window.TM07_WORKBENCH_GUIDE;
        if (btn) btn.disabled = true;

        try {
            if (!isConnected()) {
                const msg = 'Сначала подключите КАО (дождитесь «подключено»).';
                if (Guide && typeof Guide.showErrors === 'function') {
                    Guide.showErrors([msg]);
                }
                setWbStatus(msg, true);
                return;
            }

            const events = window.TM07_BENCH_EVENTS;
            if (events && typeof events.ensureOperator === 'function') {
                try {
                    await events.ensureOperator();
                } catch (e) {
                    const msg = e.message || 'Требуется вход оператора';
                    if (Guide && typeof Guide.showErrors === 'function') {
                        Guide.showErrors([msg]);
                    }
                    setWbStatus(msg, true);
                    return;
                }
            }

            const orderNum = normalizeOrder(($('paramOrder1cNumber') || {}).value || '');

            if (events && typeof events.ensureOrderSession === 'function') {
                try {
                    await events.ensureOrderSession(orderNum);
                } catch (e) {
                    const msg = e.message || 'Требуется сессия заказа';
                    if (Guide && typeof Guide.showErrors === 'function') {
                        Guide.showErrors([msg]);
                    }
                    setWbStatus(msg, true);
                    paintSessionBadge();
                    return;
                }
            }

            if (events && events.logStage) {
                void events.logStage('parametrization', 'start', {
                    payload: { orderNumber: orderNum },
                });
            }

            const Ops = window.TM07_WORKBENCH_OPS;
            if (Ops && typeof Ops.validateBeforeParametrize === 'function') {
                const v = Ops.validateBeforeParametrize();
                if (!v.ok) {
                    if (Guide && typeof Guide.showErrors === 'function') {
                        Guide.showErrors(v.errors);
                    }
                    setWbStatus(v.errors[0] || 'Проверьте данные', true);
                    return;
                }
                if (v.warnings.length) {
                    v.warnings.forEach(function (w) {
                        plog('⚠ ' + w);
                    });
                }
            }

            if (Guide && typeof Guide.setWriting === 'function') {
                Guide.setWriting(true);
            }

            setWbStatus('Подготовка данных…', false);
            await prepareOrderFromInput(true);
            await ensureComplexSerial();
            ensureDatetimeNow();

            if (Ops && typeof Ops.applyVerificationAndDefaults === 'function') {
                Ops.applyVerificationAndDefaults([]);
            }
            if (window.TM07Order1cToParam && window.TM07Order1cToParam.propagateDerivedThresholds) {
                window.TM07Order1cToParam.propagateDerivedThresholds([]);
            }

            const K = window.TM07_PARAM_KAO;
            if (!K || typeof K.writeAllSections !== 'function') {
                throw new Error('Модуль записи параметров недоступен.');
            }

            plog('DEFAULT_SETTINGS (п.2): команда 2 без LKG…');
            setWbStatus('DEFAULT_SETTINGS…', false);
            if (typeof K.writeDefaultSettings === 'function') {
                if (window.__tm07DefaultSettingsApplied) {
                    plog('DEFAULT_SETTINGS уже выполнена в этой сессии — пропуск.');
                } else {
                    const ds = await K.writeDefaultSettings({ skipPassport: !!window.__paramDevicePassport });
                    if (ds && ds.skipped) {
                        plog('DEFAULT_SETTINGS: уже применена на приборе (0x0B).');
                    }
                }
            }

            plog('Запись всех параметров (основные + счётчик + комплекс)…');
            setWbStatus('Запись в корректор…', false);
            if (!isConnected()) {
                throw new Error('КАО отключился — подключите снова и повторите.');
            }
            const writeBtn = $('paramWriteAll');
            const resume = !!(writeBtn && writeBtn.dataset.resume === '1');
            if (resume) {
                plog('Режим продолжения: шаги с отметкой ok пропускаются.');
            }
            const writeResult = await K.writeAllSections({ resume: resume });
            if (!writeResult || writeResult.ok !== true) {
                throw new Error(
                    (writeResult && writeResult.message) ||
                        'Запись параметров не подтверждена (КАО отключился или запись прервана).'
                );
            }
            if (typeof K.clearLastWriteAbort === 'function') {
                K.clearLastWriteAbort();
            }
            paintWriteResumeButton();

            const sn3 = ($('val_3') || {}).value || '';
            const sn201 = ($('val_201') || {}).value || '';
            window.__wbPostWrite = { writeOk: true, verifyOk: false, passportOk: false };

            plog('Параметризация записана — сверка с заказом…');
            setWbStatus('Запись выполнена. Сверка…', false);

            // П.6: сессию не помечаем completed автоматически после основной записи —
            // она остаётся в стадии «parametrization» (финальные параметры делаются на КАО,
            // закрытие сессии — вручную кнопкой «Завершить сессию» на стенде).
            let verifyErr = null;
            let verify = null;
            try {
                verify = await verifyDeviceAgainstOrderAfterWrite();
                window.__wbPostWrite.verifyOk = !!verify.ok;
                plog(verify.message);
                await logOpsEvent(
                    (events && events.EVENT && events.EVENT.PARAM_VERIFY) || 'parametrization_verify',
                    verify.ok ? 'done' : 'fail',
                    {
                        serialCorrector: sn3 || null,
                        serialComplex: sn201 || null,
                        payload: {
                            orderNumber: orderNum,
                            match: verify.cmp.match,
                            mismatch: verify.cmp.mismatch,
                            criticalMismatch: (verify.cmp.critical && verify.cmp.critical.mismatch) || 0,
                        },
                    }
                );
                if (!verify.ok) {
                    verifyErr = verify.message;
                }
            } catch (ve) {
                verifyErr = ve.message || String(ve);
                plog('Сверка: ' + verifyErr);
                await logOpsEvent(
                    (events && events.EVENT && events.EVENT.PARAM_VERIFY) || 'parametrization_verify',
                    'fail',
                    {
                        serialCorrector: sn3 || null,
                        serialComplex: sn201 || null,
                        payload: { orderNumber: orderNum, error: verifyErr },
                    }
                );
            }

            if (verifyErr) {
                window.__wbPostWrite.verifyOk = false;
                setWbStatus(
                    'Запись выполнена, но сверка: ' +
                        verifyErr +
                        '. Сессия остаётся активной — финальные параметры на КАО, затем «Завершить сессию».',
                    true
                );
            } else {
                setWbStatus('Запись выполнена. Сверка с заказом ок.', false);
            }

            plog('Параметризация записана.');

            const Passport = window.TM07_PASSPORT;
            let passportFiles = [];
            if (Passport && typeof Passport.generatePassports === 'function') {
                try {
                    plog('Формирование паспортов…');
                    passportFiles = (await Passport.generatePassports({ download: true })) || [];
                    if (passportFiles.length) {
                        window.__wbPostWrite.passportOk = true;
                        plog('Паспорт(а): ' + passportFiles.map(function (f) { return f.filename; }).join(', '));
                        setWbStatus('Готово. Паспорт(а) сформированы и скачаны.', false);
                        await logOpsEvent(
                            (events && events.EVENT && events.EVENT.PASSPORT_GENERATE) || 'passport_generate',
                            'done',
                            {
                                serialCorrector: sn3 || null,
                                serialComplex: sn201 || null,
                                payload: {
                                    orderNumber: orderNum,
                                    files: passportFiles.map(function (f) {
                                        return f.filename;
                                    }),
                                },
                            }
                        );
                    } else {
                        throw new Error('Паспорта не сформированы (пустой ответ API).');
                    }
                } catch (pe) {
                    const pmsg = pe.message || String(pe);
                    plog('Паспорт: ' + pmsg);
                    window.__wbPostWrite.passportOk = false;
                    await logOpsEvent(
                        (events && events.EVENT && events.EVENT.PASSPORT_GENERATE) || 'passport_generate',
                        'fail',
                        {
                            serialCorrector: sn3 || null,
                            serialComplex: sn201 || null,
                            payload: { orderNumber: orderNum, error: pmsg },
                        }
                    );
                }
            }

            if (Guide && typeof Guide.showDone === 'function') {
                Guide.showDone(passportFiles);
            }
            try {
                window.dispatchEvent(new CustomEvent('tm07-parametrization-done', { detail: { orderNumber: orderNum } }));
            } catch (_e) {}
            if (events && typeof events.refreshContext === 'function') {
                await events.refreshContext();
            }
            paintSessionBadge();
            paintAssemblyCard();
            const OpsAfter = window.TM07_WORKBENCH_OPS;
            if (OpsAfter && typeof OpsAfter.paintWorkflowSteps === 'function') {
                OpsAfter.paintWorkflowSteps();
            }
        } catch (e) {
            const msg = e.message || String(e);
            plog('Ошибка: ' + msg);
            setWbStatus(msg, true);
            paintWriteResumeButton();
            if (Guide && typeof Guide.setWriting === 'function') {
                Guide.setWriting(false);
            }
            if (Guide && typeof Guide.showErrors === 'function') {
                Guide.showErrors([msg]);
            }
            const st = $('paramOrder1cStatus');
            if (st) {
                st.textContent = msg;
                st.className = 'small mt-2 mb-0 text-danger';
            }
        } finally {
            autoRunning = false;
            window.__tm07ParamWriteRunning = false;
            const btn = $('paramWriteAll');
            if (btn) btn.disabled = false;
            paintAssemblyCard();
        }
    }

    function scheduleAutoLoadOrder() {
        if (orderLoadTimer) {
            clearTimeout(orderLoadTimer);
        }
        const numEl = $('paramOrder1cNumber');
        const raw = (numEl && numEl.value) || '';
        if (!isOrderInputReady(raw)) {
            return;
        }
        orderLoadTimer = setTimeout(function () {
            orderLoadTimer = null;
            prepareOrderFromInput(false).catch(function (e) {
                plog('Автозагрузка: ' + (e.message || String(e)));
            });
        }, 700);
    }

    async function resetSession() {
        if (orderLoadTimer) {
            clearTimeout(orderLoadTimer);
            orderLoadTimer = null;
        }
        const events = window.TM07_BENCH_EVENTS;
        if (events && typeof events.clearOrder === 'function') {
            try {
                await events.clearOrder('reset');
            } catch (_e) {}
        }
        await resetWorkbenchForNewSession({
            clearOrderInput: true,
            clearLog: true,
            disconnectKao: true,
        });
    }

    async function manualOpenOrderSession() {
        const raw = ($('paramOrder1cNumber') || {}).value || '';
        if (!isOrderInputReady(raw)) {
            setWbStatus('Введите номер заказа.', true);
            return;
        }
        try {
            setWbStatus('Загрузка заказа…', false);
            await prepareOrderFromInput(true);
        } catch (e) {
            setWbStatus(e.message || String(e), true);
        }
    }

    /**
     * Дозапись п.102–104 после основной параметризации (счётчик может прийти позже).
     */
    async function writeMeterParamsLater() {
        const Ops = window.TM07_WORKBENCH_OPS;
        const K = window.TM07_PARAM_KAO;
        const Guide = window.TM07_WORKBENCH_GUIDE;
        if (!Ops || typeof Ops.validateMeterForWrite !== 'function') {
            throw new Error('Модуль счётчика недоступен.');
        }
        if (!K || typeof K.writeStepsByIds !== 'function') {
            throw new Error('Модуль записи недоступен.');
        }
        if (typeof K.isConnected === 'function' && !K.isConnected()) {
            throw new Error('Подключите КАО.');
        }

        const snApply = Ops.applyMeterSerial(($('paramMeterSerial') || {}).value);
        if (!snApply.ok) {
            throw new Error(snApply.error || 'S/N счётчика');
        }
        if (typeof Ops.applyMeterDateFieldsToSteps === 'function') {
            Ops.applyMeterDateFieldsToSteps();
        }
        // Даты поверки — только вручную / «Даты сегодня», без автоподстановки.

        const v = Ops.validateMeterForWrite();
        if (!v.ok) {
            if (Guide && typeof Guide.showErrors === 'function') {
                Guide.showErrors(v.errors);
            }
            throw new Error(v.errors[0] || 'Проверьте данные счётчика');
        }

        const btn = $('paramMeterWrite');
        if (btn) {
            btn.disabled = true;
        }
        setWbStatus('Запись счётчика (п.102–104)…', false);
        plog('Дозапись счётчика: п.102–104…');
        try {
            await K.writeStepsByIds([102, 103, 104], { label: 'счётчик' });
            plog('Счётчик записан (п.102–104).');
            setWbStatus('Счётчик записан в корректор.', false);
            if (Ops.paintMeterBadge) {
                Ops.paintMeterBadge();
            }
            if (Ops.paintWorkflowSteps) {
                Ops.paintWorkflowSteps();
            }

            const Passport = window.TM07_PASSPORT;
            if (Passport && typeof Passport.generatePassports === 'function') {
                try {
                    const files = await Passport.generatePassports({ download: true });
                    if (files && files.length) {
                        plog(
                            'Паспорт(а) обновлены: ' +
                                files
                                    .map(function (f) {
                                        return f.filename;
                                    })
                                    .join(', ')
                        );
                    }
                } catch (pe) {
                    plog('Паспорт после счётчика: ' + (pe.message || String(pe)));
                }
            }
        } finally {
            if (btn) {
                btn.disabled = false;
            }
        }
    }

    function initWorkbench() {
        if (!document.body.classList.contains('wb-page')) {
            return;
        }

        try {
            const saved = localStorage.getItem('order1c_odataBase');
            const baseEl = $('paramOrder1cBase');
            if (saved && baseEl && !baseEl.value.trim()) {
                baseEl.value = saved;
            }
        } catch (_e) {}

        const orderInput = $('paramOrder1cNumber');
        orderInput?.addEventListener('input', scheduleAutoLoadOrder);
        orderInput?.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (orderLoadTimer) {
                    clearTimeout(orderLoadTimer);
                    orderLoadTimer = null;
                }
                prepareOrderFromInput(true).catch(function (err) {
                    plog(err.message || String(err));
                });
            }
        });

        $('paramOrder1cLoad')?.addEventListener('click', function () {
            hideOrderRetryBar();
            prepareOrderFromInput(true).catch(function (e) {
                plog(e.message || String(e));
                showOrderRetryBar(e.message || String(e), normalizeOrder(($('paramOrder1cNumber') || {}).value || ''));
            });
        });

        $('paramOrder1cFromCache')?.addEventListener('click', function () {
            hideOrderRetryBar();
            applyOrderFromCacheAndOpen(($('paramOrder1cNumber') || {}).value || '')
                .then(function () {
                    setWbStatus('Заказ подставлен из кэша.', false);
                })
                .catch(function (e) {
                    plog(e.message || String(e));
                    setWbStatus(e.message || String(e), true);
                    showOrderRetryBar(e.message || String(e), normalizeOrder(($('paramOrder1cNumber') || {}).value || ''));
                });
        });

        $('wbOrderSessionOpen')?.addEventListener('click', function () {
            void manualOpenOrderSession();
        });

        $('wbOrderSessionClose')?.addEventListener('click', function () {
            const events = window.TM07_BENCH_EVENTS;
            if (!events || typeof events.clearOrder !== 'function') {
                return;
            }
            pendingResumeSessionId = null;
            void events.clearOrder('manual').then(function () {
                void resetWorkbenchForNewSession({
                    clearOrderInput: true,
                    clearLog: false,
                    disconnectKao: true,
                }).then(function () {
                    cleanWorkbenchUrlQuery();
                    plog('Сессия заказа завершена. Для продолжения той же сессии — «Открыть» на главной; для нового корректора — введите заказ заново.');
                    setWbStatus('Сессия закрыта. Введите номер заказа или откройте сессию с главной.', false);
                });
            });
        });

        $('wbCorrectorSerialGenerate')?.addEventListener('click', function () {
            void generateCorrectorSerial().catch(function (e) {
                plog('S/N: ' + (e.message || String(e)));
                setWbStatus(e.message || String(e), true);
            });
        });

        $('wbCorrectorNameplatePrint')?.addEventListener('click', function () {
            void printCorrectorNameplate()
                .then(function () {
                    void refreshPrintAgentStatus();
                })
                .catch(function (e) {
                    plog('Шильдик: ' + (e.message || String(e)));
                    setWbStatus(e.message || String(e), true);
                    void refreshPrintAgentStatus();
                });
        });

        window.addEventListener('tm07-write-abort', function () {
            paintWriteResumeButton();
        });
        paintWriteResumeButton();
        startPrintAgentPolling();

        $('wbAssemblyConfirm')?.addEventListener('click', function () {
            void confirmAssemblyStep().catch(function (e) {
                plog('Сборка: ' + (e.message || String(e)));
                setWbStatus(e.message || String(e), true);
            });
        });

        window.addEventListener('tm07-order-session-changed', function () {
            applyActiveSessionToUI();
            paintSessionBadge();
        });
        window.addEventListener('tm07-operator-changed', function () {
            void refreshSessionFromServer();
        });

        const writeBtn = $('paramWriteAll');
        if (writeBtn) {
            writeBtn.addEventListener(
                'click',
                function (e) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    void runFullParametrization();
                },
                true
            );
        }

        $('paramMeterWrite')?.addEventListener('click', function () {
            void writeMeterParamsLater().catch(function (err) {
                plog('Счётчик: ' + (err.message || String(err)));
                setWbStatus(err.message || String(err), true);
            });
        });

        // Перехватываем «Прочитать» до kao-модуля: полный опрос + сверка с заказом.
        const readBtn = $('paramReadAll');
        if (readBtn) {
            readBtn.addEventListener(
                'click',
                function (e) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    void verifyCorrectorAgainstOrder().catch(function (err) {
                        plog('Проверка: ' + (err.message || String(err)));
                        setWbStatus(err.message || String(err), true);
                    });
                },
                true
            );
        }

        $('paramClearLog')?.addEventListener('click', function () {
            const log = $('paramLog');
            if (log) log.innerHTML = '';
        });

        const conn = $('paramConnStatus');
        if (conn) {
            paintConnBadge();
            new MutationObserver(paintConnBadge).observe(conn, {
                childList: true,
                characterData: true,
                subtree: true,
            });
        }

        const orderSt = $('paramOrder1cStatus');
        if (orderSt) {
            paintOrderStatus();
            new MutationObserver(paintOrderStatus).observe(orderSt, {
                childList: true,
                characterData: true,
                subtree: true,
            });
        }

        if (window.Order1cOdata && typeof window.Order1cOdata.bootstrapOdataConfig === 'function') {
            void window.Order1cOdata.bootstrapOdataConfig();
        }

        const Ops = window.TM07_WORKBENCH_OPS;
        if (Ops && typeof Ops.paintWorkflowSteps === 'function') {
            Ops.paintWorkflowSteps();
        }
        plog('Режим: оператор → заказ → сборка (S/N) → параметризация.');

        const sp = new URLSearchParams(window.location.search);
        const sessionFromUrl = sp.get('sessionId') || sp.get('session');
        if (sessionFromUrl && /^\d+$/.test(String(sessionFromUrl).trim())) {
            pendingResumeSessionId = parseInt(String(sessionFromUrl).trim(), 10);
            pendingVerifyAfterOpen = true;
        }
        if ((isSessionResumeFromUrl() || isVerifyModeFromUrl()) && !isNewSessionUrl()) {
            pendingVerifyAfterOpen = true;
        }
        if (isNewSessionUrl()) {
            pendingResumeSessionId = null;
            pendingVerifyAfterOpen = false;
            window.setTimeout(function () {
                void startNewSessionPage();
            }, 400);
        } else {
            const orderFromUrl = sp.get('order') || sp.get('orderNumber');
            if (orderFromUrl && orderInput) {
                orderInput.value = orderFromUrl;
                window.setTimeout(function () {
                    prepareOrderFromInput(true).catch(function (err) {
                        plog(err.message || String(err));
                    });
                }, 600);
                void refreshSessionFromServer();
            } else if (pendingResumeSessionId && window.TM07_BENCH_EVENTS) {
                // Только sessionId без order — реактивируем и подставим номер из сессии.
                window.setTimeout(function () {
                    void (async function () {
                        try {
                            const events = window.TM07_BENCH_EVENTS;
                            await events.ensureOperator();
                            const data = await events.reopenOrderSession(pendingResumeSessionId);
                            pendingResumeSessionId = null;
                            const num =
                                data && data.session && data.session.orderNumber
                                    ? data.session.orderNumber
                                    : '';
                            if (num && orderInput) {
                                orderInput.value = num;
                                await prepareOrderFromInput(true);
                            } else {
                                applyActiveSessionToUI();
                                paintSessionBadge();
                            }
                        } catch (err) {
                            plog(err.message || String(err));
                            paintSessionBadge();
                        }
                    })();
                }, 600);
            } else {
                // Рабочее место без URL: восстановить активную сессию оператора.
                window.setTimeout(function () {
                    void restoreActiveSessionOnWorkbench();
                }, 600);
            }
        }

        window.addEventListener('tm07-workbench-restored', function (e) {
            if (isNewSessionUrl()) {
                return;
            }
            const d = (e && e.detail) || {};
            if (d.preparedOrder) {
                lastPreparedOrder = d.preparedOrder;
            } else if (d.orderNumber) {
                lastPreparedOrder = normalizeOrder(d.orderNumber);
            }
            window.__tm07PreparedOrder = lastPreparedOrder;
            paintOrderStatus();
            if (lastPreparedOrder) {
                setWbStatus('Восстановлено после обновления: заказ ' + lastPreparedOrder, false);
            }
            void refreshSessionFromServer();
        });
    }

    async function refreshSessionFromServer() {
        const events = window.TM07_BENCH_EVENTS;
        if (!events) {
            paintSessionBadge();
            return;
        }
        try {
            // Только синхронизация с сервером. Не открываем заказ заново из lastPreparedOrder —
            // иначе после «Закрыть сессию» / смены оператора заказ всплывает снова.
            await events.refreshContext(true);
        } catch (_e) {}
        applyActiveSessionToUI();
        paintSessionBadge();
    }

    /**
     * Без ?order=&sessionId= — подтянуть активную сессию оператора и при completed запустить сверку.
     */
    async function restoreActiveSessionOnWorkbench() {
        const events = window.TM07_BENCH_EVENTS;
        if (!events) {
            return;
        }
        try {
            await refreshSessionFromServer();
        } catch (_e) {}
        const session = events.getActiveSession && events.getActiveSession();
        if (!session || !session.orderNumber) {
            return;
        }
        const orderInput = $('paramOrder1cNumber');
        if (orderInput && !String(orderInput.value || '').trim()) {
            orderInput.value = session.orderNumber;
        }
        applyActiveSessionToUI();
        const stage = getSessionStage();
        if (stage === 'completed' || isVerifyModeFromUrl()) {
            pendingVerifyAfterOpen = true;
        }
        if (stage !== 'assembly') {
            const snap = collectExpectedFieldSnapshot();
            if (Object.keys(snap).length < 3) {
                try {
                    await prepareOrderFromInput(true);
                } catch (err) {
                    plog(err.message || String(err));
                }
            } else if (pendingVerifyAfterOpen || stage === 'completed') {
                scheduleSessionResumeSurvey(session.orderNumber, { force: true });
            }
        }
    }

    window.TM07_WORKBENCH = {
        prepareOrderFromInput: prepareOrderFromInput,
        runFullParametrization: runFullParametrization,
        resetSession: resetSession,
        openOrderSession: openOrderSession,
        paintSessionBadge: paintSessionBadge,
        paintAssemblyCard: paintAssemblyCard,
        getSessionStage: getSessionStage,
        confirmAssemblyStep: confirmAssemblyStep,
        generateCorrectorSerial: generateCorrectorSerial,
        resetWorkbenchForNewSession: resetWorkbenchForNewSession,
        startNewSessionPage: startNewSessionPage,
        runSessionResumeSurvey: runSessionResumeSurvey,
        scheduleSessionResumeSurvey: scheduleSessionResumeSurvey,
        verifyCorrectorAgainstOrder: verifyCorrectorAgainstOrder,
        cancelSessionResumeSurvey: cancelSessionResumeSurvey,
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initWorkbench);
    } else {
        initWorkbench();
    }
})();
