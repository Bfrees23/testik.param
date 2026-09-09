/**
 * Рабочее место параметризации ТМ-07 (tm07-workbench.html).
 * Автоматизация: КАО + номер заказа → одна кнопка «Параметризовать».
 */
(function () {
    'use strict';

    let lastPreparedOrder = '';
    /** sessionId из URL (?sessionId=) — открыть существующую закрытую сессию, не создавать новую. */
    let pendingResumeSessionId = null;
    /**
     * «Новая сессия» только сбрасывает стенд (закрывает текущую active).
     * Повторный вход в уже известный номер заказа снова откроет существующую сессию.
     * Доп. сессия на тот же заказ — только через явное подтверждение (forceNewSession).
     */
    let pendingForceNewSession = false;
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
        const Ops = window.TM07_WORKBENCH_OPS;
        if (Ops && typeof Ops.syncCorrectorVerifFieldsFromSteps === 'function') {
            Ops.syncCorrectorVerifFieldsFromSteps();
        } else if (Ops && typeof Ops.paintCorrectorVerifBadge === 'function') {
            Ops.paintCorrectorVerifBadge();
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
                    '<i class="bi bi-lock me-1"></i>Откроется после подтверждения сборки в пункте 2.';
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
        const step2 = $('wbStep2Card');
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

        const assemblyDone = stage === 'parametrization' || stage === 'completed';
        if (card) {
            card.classList.toggle('wb-assembly-done', assemblyDone);
        }
        if (step2) {
            step2.classList.toggle('wb-assembly-done', assemblyDone);
        }

        const assemblyPhase = stage === 'assembly';
        if (genBtn) {
            genBtn.disabled = !active || !assemblyPhase;
        }
        if (printBtn) {
            printBtn.disabled = !active || !/^300\d{7}$/.test(serial);
        }
        if (confirmBtn) {
            const done = stage === 'parametrization' || stage === 'completed';
            confirmBtn.disabled = !active || !assemblyPhase || !/^300\d{7}$/.test(serial);
            confirmBtn.className = 'btn btn-success';
            confirmBtn.innerHTML = done
                ? '<i class="bi bi-check2-circle me-1"></i>Сборка подтверждена'
                : '<i class="bi bi-check2-circle me-1"></i>Подтвердить сборку';
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
        void maybeAutoConfirmAssembly().then(function () {
            applyActiveSessionToUI();
            paintAssemblyCard();
        });
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
        // Если QR уже отсканированы до сборки — дописать привязку теперь, когда есть 300…
        if (Ops && typeof Ops.persistSensorBindingsToServer === 'function') {
            void Ops.persistSensorBindingsToServer();
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
                st.textContent = 'Введите номер заказа и нажмите «Войти в заказ».';
                st.className = 'small mb-0 text-body-secondary';
            } else {
                st.textContent = 'Сначала войдите как оператор, затем откройте заказ.';
                st.className = 'small mb-0 text-body-secondary';
            }
        }
        const wsHint = $('wbWorkstationHint');
        if (wsHint && events && typeof events.getContext === 'function') {
            const ctx = events.getContext();
            const agent =
                typeof events.getSenselockAgentStatus === 'function'
                    ? events.getSenselockAgentStatus()
                    : null;
            const code =
                (typeof events.workstationCode === 'function' && events.workstationCode()) ||
                (ctx && ctx.workstationCode) ||
                '';
            if (agent && agent.offline && !agent.present) {
                wsHint.textContent =
                    'Рабочее место: агент Senselock офлайн (запустите .cmd на этом ПК)';
                wsHint.classList.remove('d-none');
            } else if (agent && !agent.present) {
                wsHint.textContent = 'Рабочее место: вставьте ключ Senselock (свисток)';
                wsHint.classList.remove('d-none');
            } else if (code) {
                wsHint.textContent = 'Рабочее место: ' + code;
                wsHint.classList.remove('d-none');
            } else {
                const wsName =
                    (ctx && ctx.workstationName) ||
                    (ctx && ctx.workstationFingerprint) ||
                    '';
                if (wsName) {
                    wsHint.textContent = 'Рабочее место: ' + wsName;
                    wsHint.classList.remove('d-none');
                } else {
                    wsHint.classList.add('d-none');
                }
            }
        }
        paintSenselockAgentBadge();
        paintAssemblyCard();
        paintOrderSelectLock();
    }

    function paintSenselockAgentBadge() {
        const badge = $('wbSenselockAgentStatus');
        if (!badge) {
            return;
        }
        const events = window.TM07_BENCH_EVENTS;
        const st =
            events && typeof events.getSenselockAgentStatus === 'function'
                ? events.getSenselockAgentStatus()
                : null;
        if (!st) {
            badge.textContent = 'агент —';
            badge.className = 'badge rounded-pill text-bg-secondary';
            return;
        }
        if (st.present && st.workstationCode) {
            badge.textContent = st.workstationCode;
            badge.className = 'badge rounded-pill text-bg-success';
            badge.title = st.note || '';
            return;
        }
        if (st.offline) {
            badge.textContent = 'офлайн';
            badge.className = 'badge rounded-pill text-bg-danger';
            badge.title = st.note || '';
            return;
        }
        badge.textContent = 'нет ключа';
        badge.className = 'badge rounded-pill text-bg-warning text-dark';
        badge.title = st.note || '';
    }

    /** Блокировка выбора заказа, пока открыта сессия. */
    function paintOrderSelectLock() {
        const events = window.TM07_BENCH_EVENTS;
        const active = !!(events && events.hasActiveOrder && events.hasActiveOrder());
        const orderSelect = $('paramOrder1cSelect');
        const refreshBtn = $('paramOrder1cRefreshList');
        const orderInput = $('paramOrder1cNumber');
        const openBtn = $('wbOrderSessionOpen');
        const tip = active ? 'Сначала завершите текущую сессию' : '';
        if (orderSelect) {
            orderSelect.disabled = active;
            orderSelect.title = tip;
        }
        if (refreshBtn) {
            refreshBtn.disabled = active;
            refreshBtn.title = active ? tip : 'Обновить список из 1С';
        }
        if (orderInput) {
            orderInput.disabled = active;
            orderInput.title = tip;
        }
        if (openBtn && active) {
            openBtn.disabled = true;
        } else if (openBtn) {
            openBtn.disabled = false;
        }
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
        const n = Number(sid);
        // п.59/66 — команда «запомнить» (в поле 1), справа S/N ЧЭ; не сверять с полем.
        if (n === 59 || n === 66) {
            return false;
        }
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

    function getParamStepTitle(stepId) {
        const sid = String(stepId || '');
        const docs = [
            window.TM07_PARAMETRIZATION_DOC,
            window.TM07_PARAM_DOC,
            typeof window.TM07_param_getDocForMap === 'function' ? window.TM07_param_getDocForMap() : null,
        ];
        const extra = window.TM07_PARAMETRIZATION_EXTRA;
        if (extra && Array.isArray(extra.sections)) {
            extra.sections.forEach(function (sec) {
                docs.push(sec);
            });
        }
        for (let d = 0; d < docs.length; d++) {
            const Doc = docs[d];
            const steps = Doc && Array.isArray(Doc.steps) ? Doc.steps : [];
            for (let i = 0; i < steps.length; i++) {
                if (String(steps[i].id) === sid) {
                    const t = String(steps[i].title || steps[i].name || steps[i].hint || '').trim();
                    return t || 'п.' + sid;
                }
            }
        }
        return 'п.' + sid;
    }

    /** Полный снимок значений из корректора после опроса (все out_*). */
    function collectDeviceFieldSnapshot() {
        const out = {};
        document.querySelectorAll('[id^="out_"]').forEach(function (node) {
            const id = String(node.id || '');
            let sid = '';
            if (/^out_final_(\d+)$/.test(id)) {
                sid = 'final_' + RegExp.$1;
            } else if (/^out_(\d+)$/.test(id)) {
                sid = RegExp.$1;
            } else {
                return;
            }
            const t = String(node.textContent || '').trim();
            if (!t || t === '—' || t === '…' || t === 'ошибка') {
                return;
            }
            out[sid] = t;
        });
        return out;
    }

    /** Снимок для журнала/админки: все опрошенные параметры + значения из заказа. */
    function buildParamCompareSnapshot(expected, cmp, deviceSnap) {
        const orderMap = expected || {};
        const deviceMap = deviceSnap || {};
        const ids = {};
        Object.keys(orderMap).forEach(function (sid) {
            ids[sid] = true;
        });
        Object.keys(deviceMap).forEach(function (sid) {
            ids[sid] = true;
        });
        (cmp && cmp.mismatches ? cmp.mismatches : []).forEach(function (m) {
            if (m && m.stepId != null) {
                ids[String(m.stepId)] = true;
            }
        });

        const rows = [];
        Object.keys(ids).forEach(function (sid) {
            const exp =
                orderMap[sid] != null && String(orderMap[sid]).trim() !== ''
                    ? String(orderMap[sid]).trim()
                    : '';
            let act =
                deviceMap[sid] != null && String(deviceMap[sid]).trim() !== ''
                    ? String(deviceMap[sid]).trim()
                    : '';
            if (!act) {
                act = getDeviceReadValue(sid);
                if (!act || act === 'ошибка') {
                    act = '';
                }
            }
            if (!exp && !act) {
                return;
            }
            let ok = null;
            if (exp && act) {
                ok = valuesMatchForVerify(sid, exp, act);
            }
            rows.push({
                stepId: sid,
                title: getParamStepTitle(sid).slice(0, 160),
                order: exp,
                device: act,
                ok: ok === null ? true : !!ok,
                compared: ok !== null,
            });
        });
        rows.sort(function (a, b) {
            const na = String(a.stepId).replace(/^final_/, '9000');
            const nb = String(b.stepId).replace(/^final_/, '9000');
            return Number(na) - Number(nb);
        });
        return rows;
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
        const mUnix = /\(unix\s+(\d+)\)/i.exec(s);
        if (mUnix) {
            const n = Number(mUnix[1]);
            return Number.isFinite(n) ? n : null;
        }
        const mRu = /^(\d{2})\.(\d{2})\.(\d{4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
        if (mRu) {
            const iso =
                mRu[3] +
                '-' +
                mRu[2] +
                '-' +
                mRu[1] +
                'T' +
                String(mRu[4] != null ? mRu[4] : '0').padStart(2, '0') +
                ':' +
                String(mRu[5] != null ? mRu[5] : '0').padStart(2, '0') +
                ':' +
                String(mRu[6] != null ? mRu[6] : '0').padStart(2, '0') +
                '+03:00';
            const t = Date.parse(iso);
            if (Number.isFinite(t)) {
                return Math.floor(t / 1000);
            }
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

    function paintVerifyMismatches(cmp) {
        document.querySelectorAll('tr.param-read-mismatch, tr.param-read-match').forEach(function (row) {
            row.classList.remove('param-read-mismatch', 'param-read-match');
        });
        document.querySelectorAll('.param-read-mismatch-val').forEach(function (out) {
            out.classList.remove('param-read-mismatch-val');
            out.removeAttribute('title');
        });
        (cmp && cmp.mismatches ? cmp.mismatches : []).forEach(function (m) {
            const out = $('out_' + m.stepId);
            if (!out) {
                return;
            }
            out.classList.remove('text-success', 'text-body-secondary', 'text-warning');
            out.classList.add('text-danger', 'param-read-mismatch-val');
            out.title = 'Заказ: ' + m.expected + ' · в корректоре: ' + m.actual;
            const row = out.closest('tr');
            if (row) {
                row.classList.remove('param-write-ok', 'param-read-match');
                row.classList.add('param-read-mismatch');
            }
        });
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
                await K.readAllSections({ skipFinal: true });
            } else if (typeof K.runReadAllSteps === 'function') {
                await K.runReadAllSteps(window.TM07_PARAM_DOC && window.TM07_PARAM_DOC.steps, 'основные');
            }

            if (autoRunning || window.__tm07ParamWriteRunning || window.__tm07SessionResumeSurveyCancel) {
                return;
            }

            const cmp = compareReadbackWithExpected(expected);
            paintVerifyMismatches(cmp);
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
        // Не форсируем INSERT: сброс стенда ≠ «всегда новая строка по заказу».
        pendingForceNewSession = false;
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
        plog(
            'Стенд сброшен. Введите номер заказа: если сессия уже была — откроется она; ' +
                'новая запись создастся только для заказа, которого ещё не было.'
        );
        paintSessionBadge();
    }

    function resolveResumeSessionId(explicit) {
        if (explicit != null && explicit !== '') {
            const n = parseInt(String(explicit), 10);
            if (n > 0) {
                return n;
            }
        }
        if (pendingResumeSessionId) {
            return pendingResumeSessionId;
        }
        try {
            const sp = new URLSearchParams(window.location.search);
            const raw = sp.get('sessionId') || sp.get('session');
            if (raw && /^\d+$/.test(String(raw).trim())) {
                return parseInt(String(raw).trim(), 10);
            }
        } catch (_e) {}
        return null;
    }

    function isOrderClosedStatus() {
        const parts = [];
        const badge = $('paramOrder1cOrderStatus');
        if (badge) {
            parts.push(String(badge.textContent || ''));
        }
        const events = window.TM07_BENCH_EVENTS;
        const session = events && events.getActiveSession ? events.getActiveSession() : null;
        if (session && session.orderStatus) {
            parts.push(String(session.orderStatus));
        }
        const blob = parts.join(' ').toLowerCase().replace(/ё/g, 'е');
        return /закрыт|завершен|выполнен|снят\s*с\s*производ/.test(blob);
    }

    /** Заказ закрыт / сборка уже была — не просим подтверждать повторно. */
    async function maybeAutoConfirmAssembly() {
        const stage = getSessionStage();
        if (stage === 'parametrization' || stage === 'completed') {
            return;
        }
        const serial = correctorSerialValue();
        if (!/^300\d{7}$/.test(String(serial || '').trim())) {
            return;
        }
        const events = window.TM07_BENCH_EVENTS;
        const session = events && events.getActiveSession ? events.getActiveSession() : null;
        const alreadyMarked = !!(session && session.assemblyConfirmedAt);
        const closed = isOrderClosedStatus();
        // Авто: закрытый заказ 1С, либо возврат в сессию с уже отмеченной сборкой / verify.
        if (!closed && !alreadyMarked && !(isResumingExistingSession() && isVerifyModeFromUrl())) {
            return;
        }
        try {
            await confirmAssemblyStep();
            plog('Сборка подтверждена автоматически (заказ закрыт / возврат в сессию).');
        } catch (e) {
            plog('Автоподтверждение сборки: ' + (e.message || String(e)));
        }
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
            const wantSid = resolveResumeSessionId(o.sessionId);
            if (wantSid) {
                selectOpts.sessionId = wantSid;
                pendingForceNewSession = false;
            } else if (pendingForceNewSession) {
                selectOpts.forceNewSession = true;
            } else {
                // Уже активная сессия по этому заказу в кэше — не просим сервер создавать новую.
                const active =
                    events.getActiveSession && typeof events.getActiveSession === 'function'
                        ? events.getActiveSession()
                        : null;
                if (
                    active &&
                    active.id &&
                    active.orderNumber &&
                    normalizeOrder(active.orderNumber) === normalizeOrder(number)
                ) {
                    selectOpts.sessionId = active.id;
                }
            }
            const data = await events.selectOrder(number, selectOpts);
            const sid = data && data.session && data.session.id ? data.session.id : null;
            const reused = !!(data && (data.reused || data.reopened));
            const usedExisting =
                reused ||
                (!!selectOpts.sessionId && !selectOpts.forceNewSession);
            if (selectOpts.forceNewSession) {
                pendingForceNewSession = false;
            }
            if (wantSid && sid && String(sid) !== String(wantSid)) {
                throw new Error(
                    'Открыта сессия #' +
                        sid +
                        ', ожидалась #' +
                        wantSid +
                        ' — откройте снова с главной.'
                );
            }
            if (wantSid && sid && String(sid) === String(wantSid)) {
                pendingResumeSessionId = null;
            }
            plog(
                'Сессия заказа: ' +
                    number +
                    (sid ? ' (#' + sid + ')' : '') +
                    (usedExisting
                        ? ' — продолжена существующая'
                        : selectOpts.forceNewSession
                          ? ' — новая (явно)'
                          : ' — новая')
            );
            applyActiveSessionToUI();
            paintSessionBadge();
            await maybeAutoConfirmAssembly();
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

    function sleepMs(ms) {
        return new Promise(function (resolve) {
            setTimeout(resolve, ms);
        });
    }

    function showOrderRetryStatus(message) {
        const bar = $('paramOrder1cRetryBar');
        if (!bar) {
            return;
        }
        bar.classList.remove('d-none');
        bar.innerHTML = '<span>' + (message || 'Повтор загрузки заказа из 1С…') + '</span>';
    }

    function hideOrderRetryBar() {
        const bar = $('paramOrder1cRetryBar');
        if (!bar) {
            return;
        }
        bar.classList.add('d-none');
        bar.innerHTML = '';
    }

    /**
     * Загрузка заказа из 1С с автоповтором, пока OData не отдаст данные.
     * @returns {Promise<*>}
     */
    async function loadOrderFrom1cWithRetry(number) {
        const ToParam = window.TM07Order1cToParam;
        if (!ToParam || typeof ToParam.loadAndApplyOrder !== 'function') {
            throw new Error('Модуль загрузки заказа 1С недоступен.');
        }
        let attempt = 0;
        let lastErr = null;
        while (true) {
            attempt += 1;
            try {
                if (attempt === 1) {
                    plog('Загрузка заказа ' + number + ' из 1С…');
                    setWbStatus('Загрузка заказа ' + number + '…', false);
                    hideOrderRetryBar();
                } else {
                    const msg =
                        '1С не отдала заказ ' +
                        number +
                        ' — повтор #' +
                        attempt +
                        '…';
                    plog(msg + (lastErr ? ' (' + (lastErr.message || lastErr) + ')' : ''));
                    setWbStatus(msg, false);
                    showOrderRetryStatus(msg);
                }
                const result = await ToParam.loadAndApplyOrder(number);
                hideOrderRetryBar();
                return result;
            } catch (e) {
                lastErr = e;
                // Пауза перед следующим запросом: 2с, 3с, … до 8с
                const waitMs = Math.min(8000, 1500 + attempt * 500);
                await sleepMs(waitMs);
            }
        }
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
            await K.readAllSections({ skipFinal: true });
        } else if (typeof K.runReadAllSteps === 'function') {
            await K.runReadAllSteps(window.TM07_PARAM_DOC && window.TM07_PARAM_DOC.steps, 'основные');
        } else {
            throw new Error('Нет функции опроса для сверки.');
        }
        const cmp = compareReadbackWithExpected(expected);
        const device = collectDeviceFieldSnapshot();
        paintVerifyMismatches(cmp);
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
            expected: expected,
            device: device,
            params: buildParamCompareSnapshot(expected, cmp, device),
            message: ok
                ? 'Сверка OK: совпадений ' + cmp.match + ' из ' + cmp.checked +
                  ' (ключевых ' + critical.checked + '). Опрос: ' + Object.keys(device).length + ' параметров.'
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
            await openOrderSession(number, null, { sessionId: prepOpts.sessionId });
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
        const result = await loadOrderFrom1cWithRetry(number);
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
        }
        try {
            window.dispatchEvent(new CustomEvent('tm07-order-applied', { detail: { number: number } }));
        } catch (_e) {}
        await openOrderSession(number, result, { sessionId: prepOpts.sessionId });
        applyActiveSessionToUI();
        if (!resuming) {
            await maybeIssueSerialAndPrintForOrder(number, !!result && result.cached);
        } else {
            try {
                await fillSerialsForOrder(number);
            } catch (snErr) {
                plog('S/N: ' + (snErr.message || String(snErr)));
            }
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
            try {
                await fillSerialsForOrder(orderNumber);
            } catch (snErr) {
                plog('S/N: ' + (snErr.message || String(snErr)));
                setWbStatus('Заказ открыт, но S/N не подставился: ' + (snErr.message || String(snErr)), true);
            }
            return { skipped: true, reason: 'resume' };
        }
        const Nameplate = window.TM07_NAMEPLATE;
        const ui = window.TM07_SERIAL_REGISTRY_UI;
        if (!ui || typeof ui.ensureOrderSerials !== 'function') {
            if (!Nameplate || typeof Nameplate.issueSerialAndPrintForOrder !== 'function') {
                return null;
            }
        }
        try {
            const filled = ui && typeof ui.ensureOrderSerials === 'function'
                ? await ui.ensureOrderSerials({ orderNumber: orderNumber || null })
                : null;
            const corr = filled && filled.correctorResult;
            if (filled && filled.corrector) {
                syncCorrectorSerialDisplay();
                paintAssemblyCard();
            }
            if (filled && filled.complex) {
                const Ops = window.TM07_WORKBENCH_OPS;
                if (Ops && typeof Ops.applyComplexSerial === 'function') {
                    Ops.applyComplexSerial(filled.complex);
                }
            }

            let printed = false;
            let printResult = null;
            let skippedPrint = true;
            // Печать шильда временно отключена
            if (false && corr && !corr.reused && Nameplate && typeof Nameplate.printCorrector === 'function') {
                skippedPrint = false;
                const config = await Nameplate.loadConfig(false);
                if (config.autoPrintOnOrderOpen !== false) {
                    try {
                        printResult = await Nameplate.printCorrector(corr.serial, {
                            orderNumber: orderNumber,
                        });
                        printed = !!(printResult && printResult.printed);
                    } catch (printErr) {
                        printResult = {
                            printed: false,
                            printError: printErr.message || String(printErr),
                        };
                    }
                }
            } else if (!filled && Nameplate && typeof Nameplate.issueSerialAndPrintForOrder === 'function') {
                return Nameplate.issueSerialAndPrintForOrder(orderNumber);
            }

            const printErr =
                printResult && printResult.printError ? String(printResult.printError) : '';
            const previewOnly = !!(printResult && printResult.previewFallback);
            let status = 'Заказ ' + (orderNumber || '') + ':';
            if (filled && filled.corrector) {
                status += ' корр. ' + filled.corrector;
            }
            if (filled && filled.complex) {
                status += ', компл. ' + filled.complex;
            }
            const reusedBoth =
                (corr && corr.reused) || (filled && filled.complexResult && filled.complexResult.reused);
            if (corr && corr.reused && filled && filled.complexResult && filled.complexResult.reused) {
                status += ' — номера из таблицы, новые не выдавались.';
            } else if (reusedBoth) {
                status += ' — подставлены из реестра.';
            } else if (printed) {
                status += ' — шильдик отправлен на печать.';
            } else if (previewOnly) {
                status += ' — превью шильдика (агент печати не запущен).';
            } else if (printErr) {
                status += ' — печать не удалась. ' + printErr;
            } else if (skippedPrint) {
                status += ' — серийники подставлены.';
            } else {
                status += ' — нажмите «Печать шильдика».';
            }
            plog(status);
            setWbStatus(status, !!(printErr && !previewOnly && !printed));
            return {
                serial: filled && filled.corrector,
                complex: filled && filled.complex,
                reused: !!(corr && corr.reused),
                printed: printed,
                printResult: printResult,
            };
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

    async function fillSerialsForOrder(orderNumber) {
        const ui = window.TM07_SERIAL_REGISTRY_UI;
        if (!ui || typeof ui.ensureOrderSerials !== 'function') {
            return null;
        }
        const filled = await ui.ensureOrderSerials({ orderNumber: orderNumber || null });
        if (filled && filled.corrector) {
            syncCorrectorSerialDisplay();
            paintAssemblyCard();
        }
        if (filled && filled.complex) {
            const Ops = window.TM07_WORKBENCH_OPS;
            if (Ops && typeof Ops.applyComplexSerial === 'function') {
                Ops.applyComplexSerial(filled.complex);
            }
        }
        return filled;
    }

    function currentOrderNumberForSerials() {
        const events = window.TM07_BENCH_EVENTS;
        if (events && events.getActiveOrderNumber && events.getActiveOrderNumber()) {
            return events.getActiveOrderNumber();
        }
        return normalizeOrder(($('paramOrder1cNumber') || {}).value || '');
    }

    async function ensureComplexSerial() {
        return fillSerialsForOrder(currentOrderNumberForSerials());
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

            plog('Запись всех параметров по порядку (п.2 DEFAULT_SETTINGS → п.3…): основные + счётчик + комплекс…');
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
                            criticalChecked: (verify.cmp.critical && verify.cmp.critical.checked) || 0,
                            polled: Object.keys(verify.device || {}).length,
                            params: Array.isArray(verify.params)
                                ? verify.params
                                : buildParamCompareSnapshot(
                                      verify.expected || null,
                                      verify.cmp,
                                      verify.device || null
                                  ),
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

            // Паспорта DOCX временно отключены (TM07_PASSPORT.isEnabled / PASSPORTS_ENABLED).
            const Passport = window.TM07_PASSPORT;
            let passportFiles = [];
            const passportsOn =
                Passport &&
                typeof Passport.isEnabled === 'function' &&
                Passport.isEnabled() &&
                typeof Passport.generatePassports === 'function';
            if (passportsOn) {
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
            } else {
                // Паспорта выключены — не блокируем «готово» и шаг workflow.
                window.__wbPostWrite.passportOk = true;
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
        const events = window.TM07_BENCH_EVENTS;
        if (events && events.hasActiveOrder && events.hasActiveOrder()) {
            setWbStatus(
                'Сессия уже открыта (' +
                    (events.getActiveOrderNumber ? events.getActiveOrderNumber() : '') +
                    '). Сначала завершите её.',
                true
            );
            paintOrderSelectLock();
            return;
        }
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

            // Паспорта DOCX временно отключены (см. PASSPORTS_ENABLED в tm07-passport-generate.js).
            const Passport = window.TM07_PASSPORT;
            if (
                Passport &&
                typeof Passport.isEnabled === 'function' &&
                Passport.isEnabled() &&
                typeof Passport.generatePassports === 'function'
            ) {
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

    /**
     * Дозапись дат поверки корректора п.80/81 после основной параметризации
     * (REG_SYS_LAST_VERIF_DATE 0x0024 / REG_SYS_NEXT_VERIF_DATE 0x0026).
     */
    async function writeCorrectorParamsLater() {
        const Ops = window.TM07_WORKBENCH_OPS;
        const K = window.TM07_PARAM_KAO;
        const Guide = window.TM07_WORKBENCH_GUIDE;
        if (!Ops || typeof Ops.validateCorrectorForWrite !== 'function') {
            throw new Error('Модуль параметров корректора недоступен.');
        }
        if (!K || typeof K.writeStepsByIds !== 'function') {
            throw new Error('Модуль записи недоступен.');
        }
        if (typeof K.isConnected === 'function' && !K.isConnected()) {
            throw new Error('Подключите КАО.');
        }
        const v = Ops.validateCorrectorForWrite();
        if (!v.ok) {
            if (Guide && typeof Guide.showErrors === 'function') {
                Guide.showErrors(v.errors);
            }
            throw new Error(v.errors[0] || 'Проверьте данные корректора');
        }
        const btn = $('paramCorrectorWrite');
        if (btn) {
            btn.disabled = true;
        }
        setWbStatus('Запись корректора (п.3, 80, 81)…', false);
        plog('Дозапись корректора: п.3, 80, 81…');
        try {
            await K.writeStepsByIds([3, 80, 81], { label: 'корректор' });
            plog('Корректор записан (п.3, 80, 81).');
            setWbStatus('Корректор записан.', false);
            if (Ops.paintWorkflowSteps) {
                Ops.paintWorkflowSteps();
            }
            if (Ops.syncCorrectorVerifFieldsFromSteps) {
                Ops.syncCorrectorVerifFieldsFromSteps();
            }
        } finally {
            if (btn) {
                btn.disabled = false;
            }
        }
    }

    /**
     * Дозапись данных комплекса п.201–203 после основной параметризации.
     */
    async function writeComplexParamsLater() {
        const Ops = window.TM07_WORKBENCH_OPS;
        const K = window.TM07_PARAM_KAO;
        const Guide = window.TM07_WORKBENCH_GUIDE;
        if (!Ops || typeof Ops.validateComplexForWrite !== 'function') {
            throw new Error('Модуль параметров комплекса недоступен.');
        }
        if (!K || typeof K.writeStepsByIds !== 'function') {
            throw new Error('Модуль записи недоступен.');
        }
        if (typeof K.isConnected === 'function' && !K.isConnected()) {
            throw new Error('Подключите КАО.');
        }
        const serial = Ops.applyComplexSerial(($('paramComplexSerial') || {}).value);
        if (!serial.ok) {
            throw new Error(serial.error || 'S/N комплекса');
        }
        if (typeof Ops.applyComplexVerifFieldsToSteps === 'function') {
            Ops.applyComplexVerifFieldsToSteps();
        }
        const v = Ops.validateComplexForWrite();
        if (!v.ok) {
            if (Guide && typeof Guide.showErrors === 'function') {
                Guide.showErrors(v.errors);
            }
            throw new Error(v.errors[0] || 'Проверьте данные комплекса');
        }
        const btn = $('paramComplexWrite');
        if (btn) {
            btn.disabled = true;
        }
        setWbStatus('Запись комплекса (п.201–203)…', false);
        plog('Дозапись комплекса: п.201–203…');
        try {
            await K.writeStepsByIds([201, 202, 203], { label: 'комплекс' });
            plog('Комплекс записан (п.201–203).');
            setWbStatus('Комплекс записан.', false);
            if (Ops.paintWorkflowSteps) {
                Ops.paintWorkflowSteps();
            }
            if (Ops.syncComplexVerifFieldsFromSteps) {
                Ops.syncComplexVerifFieldsFromSteps();
            }
        } finally {
            if (btn) {
                btn.disabled = false;
            }
        }
    }

    /**
     * «Настройка датчиков» (п.2): Modbus RTU через Web Serial (KorrektorDevice).
     * Сканирование адресов 1–16 (чтение 0x000A) + живой опрос измерений (0x04, регистр 0x0002).
     * Датчик — отдельное устройство на своей шине, поэтому используем собственный экземпляр KorrektorDevice.
     */
    function initSensorConfig() {
        const status = $('wbSensorConfigStatus');
        const comStatus = $('wbSensorComStatus');
        const scanResults = $('wbSensorScanResults');
        const scanBadges = $('wbSensorScanBadges');
        const pollPanel = $('wbSensorPollPanel');
        const pollAbs = $('wbSensorPollAbs');
        const pollAbsState = $('wbSensorPollAbsState');
        const pollDiff = $('wbSensorPollDiff');
        const pollDiffState = $('wbSensorPollDiffState');
        const setPanel = $('wbSensorSetPanel');
        const setLabel = $('wbSensorSetLabel');
        const setValue = $('wbSensorSetValue');
        const setApply = $('wbSensorSetApply');
        const cfgTarget = $('wbSensorCfgTarget');
        const cfgApply = $('wbSensorCfgApply');
        const cfgReadDevice = $('wbSensorCfgReadDevice');
        const cfgWriteDevice = $('wbSensorCfgWriteDevice');
        const cfgK = $('wbSensorK');
        const cfgZero = $('wbSensorZero');
        const cfgRangeUp = $('wbSensorRangeUp');
        const cfgRangeDown = $('wbSensorRangeDown');
        const cfgDFOrder = $('wbSensorDFOrder');
        const cfgFilter = $('wbSensorFilter');
        const cfgModbusAddr = $('wbSensorModbusAddr');
        const cfgBusBaud = $('wbSensorBusBaud');
        const cfgParity = $('wbSensorParity');
        const cfgMode = $('wbSensorMode');
        const cfgRangeUnit = $('wbSensorRangeUnit');
        const cfgResultUnit = $('wbSensorResultUnit');
        const cfgPFilter = $('wbSensorPFilter');
        const cfgPGain = $('wbSensorPGain');
        const cfgPMode = $('wbSensorPMode');
        const cfgTFilter = $('wbSensorTFilter');
        const cfgTGain = $('wbSensorTGain');
        const cfgTMode = $('wbSensorTMode');
        const cfgRangeCheck = $('wbSensorRangeCheck');
        const cfgWorkMode = $('wbSensorWorkMode');
        const cfgDpShift = $('wbSensorDpShift');
        const cfgWritePassword = $('wbSensorWritePassword');
        const cfgStartBtn = $('wbSensorStartMeas');
        const cfgStopBtn = $('wbSensorStopMeas');
        const regAddr = $('wbSensorRegAddr');
        const regCount = $('wbSensorRegCount');
        const regData = $('wbSensorRegData');
        const regOut = $('wbSensorRegOut');
        const regReadHoldingBtn = $('wbSensorRegReadHolding');
        const regReadInputBtn = $('wbSensorRegReadInput');
        const regWriteBtn = $('wbSensorRegWrite');
        const pollIntervalInput = $('wbSensorPollInterval');
        const vizAdcPress = $('wbSensorVizAdcPress');
        const vizAdcTerm = $('wbSensorVizAdcTerm');
        const vizPressureRaw = $('wbSensorVizPressureRaw');
        const vizPressureKpa = $('wbSensorVizPressureKpa');
        const chartCanvas = $('wbSensorChart');
        const vizTab = $('wbSensorVizTab');
        /** Параметры датчиков: addr -> {k, zero, unit, rangeUp, rangeDown, dfOrder, filter} */
        const sensorCfg = {};
        /** История для графика: [{t, abs, diff}] */
        const chartHistory = [];
        const CHART_MAX_POINTS = 120;
        let chart = null;

        const SENSOR_TYPE_REG = 0x000a; // тип/версия карты датчика
        const SENSOR_INPUT_BLOCK_REG = 0x0001; // ADCPress, ADCTerm, Pressure(float32)
        const SENSOR_MEAS_REG = 0x0002; // входной регистр измерений (float32)
        const SENSOR_INTERFACE_REG = 0x0002; // holding Interface
        const SENSOR_MUNIT_REG = 0x0007; // holding MUnit
        const SENSOR_PCH_SETUP_REG = 0x0008; // holding PChSetup
        const SENSOR_TCH_SETUP_REG = 0x0009; // holding TChSetup
        const SENSOR_DFORDER_REG = 0x000a; // holding DFOrder
        const SENSOR_RNGCHECK_REG = 0x000b; // holding RngCheck
        const SENSOR_DP_REG = 0x000d; // holding dP(float32)
        const SENSOR_WMODE_REG = 0x00f9; // holding WMode
        const SENSOR_START_REG = 0x00fa; // holding Start
        const SENSOR_PASSWORD_REG = 0x00fb; // holding Password
        const SCAN_ADDR_MIN = 1;
        const SCAN_ADDR_MAX = 16;
        const SCAN_TIMEOUT_MS = 420;
        const SCAN_FALLBACK_BAUDS = [19200, 9600, 14400, 28800, 4800, 2400, 1200];
        const POLL_INTERVAL_MS = 1000;
        const MAX_SENSOR_PRESSURE_KPA = 1000000;
        const POLL_INTERVAL_MIN_MS = 200;
        const POLL_INTERVAL_MAX_MS = 10000;
        const SENSOR_USB_VID = 0x0403; // FTDI (как у КАО)
        const SENSOR_USB_PID = 0x7523; // адаптер датчика
        const SENSOR_LINK_PROFILES = [
            { key: 'rts-high', label: 'RTS(TX=1)', rs485Rts: true, rs485RtsTxHigh: true },
            { key: 'rts-low', label: 'RTS(TX=0)', rs485Rts: true, rs485RtsTxHigh: false },
            { key: 'auto', label: 'Auto DE (без RTS)', rs485Rts: false, rs485RtsTxHigh: true }
        ];
        const BAUD_TO_INTERFACE_CODE = {
            1200: 0,
            2400: 1,
            4800: 2,
            9600: 3,
            14400: 4,
            19200: 5,
            28800: 6
        };
        const INTERFACE_CODE_TO_BAUD = {
            0: 1200,
            1: 2400,
            2: 4800,
            3: 9600,
            4: 14400,
            5: 19200,
            6: 28800
        };
        const MUNIT_RANGE_LABEL = {
            0: 'Па',
            1: 'кПа',
            2: 'МПа',
            3: 'bar',
            4: 'psi',
            5: 'кгс/см²',
            6: 'мм рт. ст.'
        };
        const MUNIT_RESULT_LABEL = {
            0: 'Па',
            1: 'кПа',
            2: 'МПа',
            3: 'bar',
            4: 'psi',
            5: 'кгс/см²',
            6: 'мм рт. ст.',
            7: '% диапазона'
        };

        /** @type {KorrektorDevice|null} */
        let sensorDev = null;
        let sensorBaud = 19200;
        let sensorLinkProfile = SENSOR_LINK_PROFILES[0];
        let pollTimer = null;
        let pollBusy = false;
        let scanBusy = false;
        let autoBusy = false;
        /** Найденные адреса: addr -> { type:number, typeHex:string, via:string } */
        const found = new Map();
        /** Последнее валидное давление по адресу для стабилизации авто-декодирования формата float. */
        const lastPressureRawByAddr = new Map();

        function setMsg(msg, isError) {
            if (!status) return;
            status.textContent = msg || '';
            status.className = 'small mb-0 ' + (isError ? 'text-danger' : msg ? 'text-success' : 'text-body-secondary');
        }

        function setComStatus(text, ok) {
            if (!comStatus) return;
            comStatus.textContent = text || 'нет связи';
            comStatus.className =
                'badge rounded-pill align-self-center ' + (ok ? 'text-bg-success' : 'text-bg-secondary');
        }

        function stopPoll() {
            if (pollTimer) {
                clearInterval(pollTimer);
                pollTimer = null;
            }
            pollBusy = false;
            if (pollPanel) pollPanel.classList.add('d-none');
            if (pollAbs) pollAbs.textContent = '—';
            if (pollAbsState) {
                pollAbsState.textContent = 'нет данных';
                pollAbsState.className = 'badge rounded-pill text-bg-secondary mt-1';
            }
            if (pollDiff) pollDiff.textContent = '—';
            if (pollDiffState) {
                pollDiffState.textContent = 'нет данных';
                pollDiffState.className = 'badge rounded-pill text-bg-secondary mt-1';
            }
            setVizRawMetrics(null);
        }

        function isConnected() {
            return !!(sensorDev && sensorDev.port);
        }

        function hex2(n) {
            return '0x' + (n & 0xffff).toString(16).toUpperCase().padStart(4, '0');
        }

        function getSelectedBaud() {
            const v = parseInt(($('wbSensorComBaud') && $('wbSensorComBaud').value) || '19200', 10);
            return Number.isFinite(v) && v > 0 ? v : 19200;
        }

        function setSelectedBaud(baud) {
            const sel = $('wbSensorComBaud');
            if (sel) sel.value = String(baud);
        }

        function errText(e) {
            return (e && e.message) || String(e || '');
        }

        function clampInt(v, min, max, fallback) {
            const n = parseInt(v, 10);
            if (!Number.isFinite(n)) return fallback;
            if (n < min) return min;
            if (n > max) return max;
            return n;
        }

        function readSelectInt(el, fallback, min, max) {
            if (!el) return fallback;
            return clampInt(el.value, min, max, fallback);
        }

        function setSelectInt(el, value) {
            if (!el) return;
            el.value = String(value);
        }

        function u16LEFromBytes(b0, b1) {
            return (b0 & 0xff) | ((b1 & 0xff) << 8);
        }

        function i16LEFromBytes(b0, b1) {
            const u = u16LEFromBytes(b0, b1);
            return u > 0x7fff ? u - 0x10000 : u;
        }

        function u16BEFromBytes(b0, b1) {
            return ((b0 & 0xff) << 8) | (b1 & 0xff);
        }

        function i16BEFromBytes(b0, b1) {
            const u = u16BEFromBytes(b0, b1);
            return u > 0x7fff ? u - 0x10000 : u;
        }

        function parseFloat32BE(data4) {
            if (!data4 || data4.length < 4) throw new Error('Нужно 4 байта float');
            const buf = new ArrayBuffer(4);
            const view = new DataView(buf);
            for (let i = 0; i < 4; i += 1) view.setUint8(i, data4[i] & 0xff);
            return view.getFloat32(0, false);
        }

        function decodePressureFromBytes(data4, prevValue) {
            if (!data4 || data4.length < 4) return null;
            const b = new Uint8Array([data4[0] & 0xff, data4[1] & 0xff, data4[2] & 0xff, data4[3] & 0xff]);
            const swapped = new Uint8Array([b[2], b[3], b[0], b[1]]);
            const variants = [
                KorrektorDevice.parseFloat32LE(b),
                parseFloat32BE(b),
                KorrektorDevice.parseFloat32LE(swapped),
                parseFloat32BE(swapped)
            ].filter(function (v) {
                return isPlausiblePressure(v);
            });
            if (variants.length === 0) return null;
            if (Number.isFinite(prevValue)) {
                variants.sort(function (a, bVal) {
                    return Math.abs(a - prevValue) - Math.abs(bVal - prevValue);
                });
                return variants[0];
            }
            variants.sort(function (a, bVal) {
                return Math.abs(a) - Math.abs(bVal);
            });
            return variants[0];
        }

        function bytesToHex(bytes) {
            return Array.from(bytes, function (b) {
                return Number(b).toString(16).toUpperCase().padStart(2, '0');
            }).join(' ');
        }

        function modbusFnLabel(frame) {
            if (!frame || frame.length < 2) return 'fn=?';
            const fn = frame[1] & 0xff;
            if (fn & 0x80) {
                const code = frame.length >= 3 ? frame[2] & 0xff : 0;
                return 'exc 0x' + code.toString(16).toUpperCase().padStart(2, '0');
            }
            const names = {
                0x03: 'read 0x03',
                0x04: 'input 0x04',
                0x06: 'write 0x06',
                0x10: 'write 0x10',
                0x11: 'ident 0x11',
                0x17: 'rw 0x17'
            };
            return names[fn] || 'fn 0x' + fn.toString(16).toUpperCase().padStart(2, '0');
        }

        function logSensorExchangeToConsole(line, details) {
            if (typeof console === 'undefined' || typeof console.log !== 'function') return;
            const prefix = '[WB:SENSOR]';
            if (details !== undefined) {
                console.log(prefix + ' ' + line, details);
            } else {
                console.log(prefix + ' ' + line);
            }
        }

        function attachSensorTrace(device) {
            if (!device) return;
            device.onFrameExchange = function (dir, frame) {
                const tag = dir === 'tx' ? 'TX' : 'RX';
                const fn = modbusFnLabel(frame);
                logSensorExchangeToConsole(tag + ' ' + fn + ' addr=' + (frame && frame.length ? frame[0] : '?') + ' hex=' + bytesToHex(frame || []));
            };
            device.onExchangeEvent = function (event, payload) {
                const p = payload || {};
                if (event === 'tx' || event === 'rx') return;
                if (event === 'attempt-start') {
                    logSensorExchangeToConsole(
                        'ATTEMPT ' +
                            p.attempt +
                            '/' +
                            p.attemptsTotal +
                            ' addr=' +
                            p.address +
                            ' ' +
                            (p.fn == null ? 'fn=?' : 'fn=0x' + Number(p.fn).toString(16).toUpperCase().padStart(2, '0')) +
                            ' timeout=' +
                            p.timeoutMs +
                            'ms baud=' +
                            p.baudRate +
                            ' rts=' +
                            (p.rs485Rts ? 'on' : 'off') +
                            ' rtsTxHigh=' +
                            (p.rs485RtsTxHigh ? '1' : '0')
                    );
                    return;
                }
                if (event === 'attempt-success') {
                    logSensorExchangeToConsole('ATTEMPT OK #' + p.attempt);
                    return;
                }
                if (event === 'attempt-error') {
                    logSensorExchangeToConsole('ATTEMPT ERROR #' + p.attempt + ': ' + (p.error || 'unknown'));
                    return;
                }
                if (event === 'attempt-retry') {
                    logSensorExchangeToConsole('RETRY ' + p.attempt + ' -> ' + p.nextAttempt);
                    return;
                }
                if (event === 'crc-ok') {
                    logSensorExchangeToConsole('CRC OK #' + p.attempt);
                    return;
                }
                if (event === 'port-opened') {
                    logSensorExchangeToConsole(
                        'PORT OPEN baud=' +
                            p.baudRate +
                            ' rts=' +
                            (p.rs485Rts ? 'on' : 'off') +
                            ' rtsTxHigh=' +
                            (p.rs485RtsTxHigh ? '1' : '0') +
                            ' turnaround=' +
                            p.turnaroundMs +
                            'ms'
                    );
                    return;
                }
                if (event === 'port-closed') {
                    logSensorExchangeToConsole('PORT CLOSED');
                    return;
                }
                if (event === 'baud-switch') {
                    logSensorExchangeToConsole('BAUD SWITCH ' + p.fromBaud + ' -> ' + p.toBaud);
                    return;
                }
                if (event === 'rs485-mode') {
                    logSensorExchangeToConsole(
                        'RS485 MODE rts:' +
                            (p.prevRs485Rts ? 'on' : 'off') +
                            '->' +
                            (p.rs485Rts ? 'on' : 'off') +
                            ' rtsTxHigh:' +
                            (p.prevRs485RtsTxHigh ? '1' : '0') +
                            '->' +
                            (p.rs485RtsTxHigh ? '1' : '0')
                    );
                    return;
                }
                if (event === 'attempt-failed') {
                    logSensorExchangeToConsole('REQUEST FAILED: ' + (p.error || 'Нет ответа'));
                    return;
                }
                logSensorExchangeToConsole('EVENT ' + event, p);
            };
            logSensorExchangeToConsole('TRACE ENABLED');
        }

        function detachSensorTrace(device) {
            if (!device) return;
            device.onFrameExchange = null;
            device.onExchangeEvent = null;
            logSensorExchangeToConsole('TRACE DISABLED');
        }

        function bytesToU16Text(bytes) {
            if (!bytes || bytes.length < 2) return '';
            const out = [];
            for (let i = 0; i + 1 < bytes.length; i += 2) {
                out.push(String(u16BEFromBytes(bytes[i], bytes[i + 1])));
            }
            return out.join(', ');
        }

        function parseHexByteString(text) {
            const src = String(text || '')
                .trim()
                .replace(/0x/gi, '')
                .replace(/[,\s;:|]+/g, ' ');
            if (!src) return [];
            const parts = src.split(' ').filter(Boolean);
            const out = [];
            for (let i = 0; i < parts.length; i += 1) {
                const p = parts[i];
                if (!/^[0-9a-fA-F]{1,2}$/.test(p)) {
                    throw new Error('Некорректный hex-байт: "' + p + '"');
                }
                out.push(parseInt(p, 16) & 0xff);
            }
            return out;
        }

        function decodeInterface(raw) {
            return {
                raw: raw & 0xffff,
                address: raw & 0xff,
                mode: (raw >> 8) & 0x03,
                baudCode: (raw >> 10) & 0x0f,
                parity: (raw >> 14) & 0x03
            };
        }

        function encodeInterface(address, mode, baudCode, parity) {
            return (
                (address & 0xff) |
                ((mode & 0x03) << 8) |
                ((baudCode & 0x0f) << 10) |
                ((parity & 0x03) << 14)
            );
        }

        function decodeMUnit(raw) {
            return {
                raw: raw & 0xffff,
                resultUnit: raw & 0x0f,
                rangeUnit: (raw >> 4) & 0x0f
            };
        }

        function encodeMUnit(resultUnit, rangeUnit) {
            return ((rangeUnit & 0x0f) << 4) | (resultUnit & 0x0f);
        }

        function decodeChannelSetup(raw) {
            return {
                raw: raw & 0xffff,
                mode: raw & 0x01,
                gain: (raw >> 1) & 0x07,
                filter: (raw >> 4) & 0x03
            };
        }

        function encodeChannelSetup(mode, gain, filter) {
            return (mode & 0x01) | ((gain & 0x07) << 1) | ((filter & 0x03) << 4);
        }

        function selectedSensorAddr() {
            return clampInt((cfgTarget && cfgTarget.value) || '1', 1, 247, 1);
        }

        function selectedBusAddr() {
            return clampInt(
                (cfgModbusAddr && cfgModbusAddr.value) || String(selectedSensorAddr()),
                1,
                247,
                selectedSensorAddr()
            );
        }

        function ensureSensorTargetOption(addr, selectValue) {
            if (!cfgTarget) return;
            const value = String(addr);
            const exists = Array.prototype.some.call(cfgTarget.options, function (opt) {
                return opt.value === value;
            });
            if (!exists) {
                const opt = document.createElement('option');
                opt.value = value;
                opt.textContent = 'Пользовательский адрес ' + value;
                cfgTarget.appendChild(opt);
            }
            if (selectValue !== false) {
                cfgTarget.value = value;
            }
        }

        async function readHoldingBytes(startReg, regCount, timeoutMs) {
            if (!sensorDev) throw new Error('порт не подключён');
            const resp = await sensorDev.readHolding(startReg, regCount, timeoutMs || 2000, 0);
            const b = KorrektorDevice.modbusDataBytes(resp);
            if (b.length < regCount * 2) {
                throw new Error('короткий ответ: ожидалось ' + regCount * 2 + ' байт, получено ' + b.length);
            }
            return b;
        }

        async function readInputBytes(startReg, regCount, timeoutMs) {
            if (!sensorDev) throw new Error('порт не подключён');
            const resp = await sensorDev.readInputRegisters(startReg, regCount, timeoutMs || 2000, 0);
            const b = KorrektorDevice.modbusDataBytes(resp);
            if (b.length < regCount * 2) {
                throw new Error('короткий ответ: ожидалось ' + regCount * 2 + ' байт, получено ' + b.length);
            }
            return b;
        }

        async function readHoldingU16(reg, timeoutMs) {
            const b = await readHoldingBytes(reg, 1, timeoutMs);
            return u16BEFromBytes(b[0], b[1]);
        }

        async function writeHoldingU16(reg, value) {
            if (!sensorDev) throw new Error('порт не подключён');
            const v = value & 0xffff;
            await sensorDev.writeMultiple(reg, [(v >> 8) & 0xff, v & 0xff]);
        }

        function getPollIntervalMs() {
            return clampInt((pollIntervalInput && pollIntervalInput.value) || POLL_INTERVAL_MS, POLL_INTERVAL_MIN_MS, POLL_INTERVAL_MAX_MS, POLL_INTERVAL_MS);
        }

        function setVizRawMetrics(metrics) {
            const m = metrics || {};
            if (vizAdcPress) vizAdcPress.textContent = m.adcPress == null ? '—' : String(m.adcPress);
            if (vizAdcTerm) vizAdcTerm.textContent = m.adcTerm == null ? '—' : String(m.adcTerm);
            if (vizPressureRaw) vizPressureRaw.textContent = m.pressureRaw == null ? '—' : String(m.pressureRaw);
            if (vizPressureKpa) vizPressureKpa.textContent = m.pressureKpa == null ? '—' : String(m.pressureKpa);
        }

        function isPlausiblePressure(raw) {
            return Number.isFinite(raw) && Math.abs(raw) <= MAX_SENSOR_PRESSURE_KPA;
        }

        async function switchSensorBaud(baud) {
            if (!sensorDev) return false;
            if (sensorBaud === baud) return true;
            try {
                await sensorDev.switchBaudRate(baud);
                sensorBaud = baud;
                setSelectedBaud(baud);
                plog('Датчик: скорость порта переключена на ' + baud + ' бод.');
                return true;
            } catch (e) {
                plog('Датчик: ошибка переключения скорости на ' + baud + ' бод — ' + errText(e));
                return false;
            }
        }

        function profileByKey(key) {
            for (let i = 0; i < SENSOR_LINK_PROFILES.length; i += 1) {
                if (SENSOR_LINK_PROFILES[i].key === key) return SENSOR_LINK_PROFILES[i];
            }
            return SENSOR_LINK_PROFILES[0];
        }

        function profileOrder(startProfile) {
            const first = startProfile || SENSOR_LINK_PROFILES[0];
            return [first].concat(
                SENSOR_LINK_PROFILES.filter(function (p) {
                    return p.key !== first.key;
                })
            );
        }

        async function switchSensorLinkProfile(nextProfile) {
            if (!sensorDev || !nextProfile) return false;
            if (sensorLinkProfile && sensorLinkProfile.key === nextProfile.key) return true;
            if (typeof sensorDev.setRs485Mode !== 'function') return false;
            try {
                await sensorDev.setRs485Mode({
                    rs485Rts: nextProfile.rs485Rts !== false,
                    rs485RtsTxHigh: nextProfile.rs485RtsTxHigh !== false
                });
                sensorLinkProfile = nextProfile;
                plog('Датчик: профиль RS485 переключён на ' + nextProfile.label + '.');
                return true;
            } catch (e) {
                plog('Датчик: ошибка переключения профиля RS485 — ' + errText(e));
                return false;
            }
        }

        /** Множители пересчёта давления в кПа (как в Mida15Tool). */
        const PRESSURE_UNITS = {
            kPa: { label: 'кПа', factor: 1 },
            MPa: { label: 'МПа', factor: 0.001 },
            Pa: { label: 'Па', factor: 1000 },
            bar: { label: 'бар', factor: 0.01 },
            mmHg: { label: 'мм рт. ст.', factor: 7.5006157583 },
            kgfcm2: { label: 'кгс/см²', factor: 0.01019716213 }
        };

        /** Параметры датчика по адресу (с дефолтами). */
        function getSensorCfg(addr) {
            const d = {
                k: 1,
                zero: 0,
                unit: 'kPa',
                rangeUp: 0,
                rangeDown: 0,
                dfOrder: 3,
                filter: 1
            };
            const c = sensorCfg[addr];
            if (c) {
                Object.assign(d, c);
            }
            d.unit = 'kPa'; // единицы давления всегда кПа (как при настройке датчика)
            return d;
        }

        /** Заполнить поля конфигуратора из сохранённых параметров выбранного датчика. */
        function loadCfgIntoForm() {
            const addr = selectedSensorAddr();
            const c = getSensorCfg(addr);
            if (cfgK) cfgK.value = c.k;
            if (cfgZero) cfgZero.value = c.zero;
            if (cfgRangeUp) cfgRangeUp.value = c.rangeUp;
            if (cfgRangeDown) cfgRangeDown.value = c.rangeDown;
            if (cfgDFOrder) cfgDFOrder.value = c.dfOrder;
            if (cfgFilter) cfgFilter.value = c.filter;
            if (cfgModbusAddr) cfgModbusAddr.value = String(addr);
        }

        /** Сохранить параметры выбранного датчика из формы. */
        function saveCfgFromForm() {
            const addr = selectedSensorAddr();
            const c = getSensorCfg(addr);
            c.k = parseFloat((cfgK && cfgK.value) || '1');
            c.zero = parseFloat((cfgZero && cfgZero.value) || '0');
            c.unit = 'kPa'; // единицы давления всегда кПа
            c.rangeUp = parseFloat((cfgRangeUp && cfgRangeUp.value) || '0');
            c.rangeDown = parseFloat((cfgRangeDown && cfgRangeDown.value) || '0');
            c.dfOrder = parseInt((cfgDFOrder && cfgDFOrder.value) || '3', 10);
            c.filter = parseInt((cfgFilter && cfgFilter.value) || '1', 10);
            sensorCfg[addr] = c;
            try {
                localStorage.setItem('wb_sensor_cfg', JSON.stringify(sensorCfg));
            } catch (_e) {}
            return c;
        }

        function applyDeviceCfgToForm(addr, data) {
            if (!data) return;
            const iface = decodeInterface(data.interfaceRaw || 0);
            const munit = decodeMUnit(data.munitRaw || 0);
            const pch = decodeChannelSetup(data.pchRaw || 0);
            const tch = decodeChannelSetup(data.tchRaw || 0);

            if (cfgModbusAddr) cfgModbusAddr.value = String(iface.address || addr || 1);
            if (cfgBusBaud) cfgBusBaud.value = String(INTERFACE_CODE_TO_BAUD[iface.baudCode] || 19200);
            setSelectInt(cfgParity, iface.parity);
            setSelectInt(cfgMode, iface.mode > 1 ? 0 : iface.mode);
            setSelectInt(cfgResultUnit, munit.resultUnit);
            setSelectInt(cfgRangeUnit, munit.rangeUnit);
            setSelectInt(cfgPFilter, pch.filter > 2 ? 0 : pch.filter);
            setSelectInt(cfgPGain, pch.gain);
            setSelectInt(cfgPMode, pch.mode);
            setSelectInt(cfgTFilter, tch.filter > 2 ? 0 : tch.filter);
            setSelectInt(cfgTGain, tch.gain);
            setSelectInt(cfgTMode, tch.mode);
            setSelectInt(cfgRangeCheck, data.rngCheck ? 1 : 0);
            setSelectInt(cfgWorkMode, data.wmode ? 1 : 0);
            if (cfgDpShift) cfgDpShift.value = Number.isFinite(data.dpShift) ? String(data.dpShift) : '0';
            if (cfgDFOrder) cfgDFOrder.value = String(clampInt(data.dfOrder, 0, 6, 3));
            if (regOut) {
                const lines = [
                    'Interface=' + hex2(data.interfaceRaw || 0),
                    'MUnit=' + hex2(data.munitRaw || 0) + ' (RES=' + (MUNIT_RESULT_LABEL[munit.resultUnit] || munit.resultUnit) + ', RNG=' + (MUNIT_RANGE_LABEL[munit.rangeUnit] || munit.rangeUnit) + ')',
                    'PChSetup=' + hex2(data.pchRaw || 0),
                    'TChSetup=' + hex2(data.tchRaw || 0),
                    'DFOrder=' + String(data.dfOrder),
                    'RngCheck=' + String(data.rngCheck),
                    'dP=' + (Number.isFinite(data.dpShift) ? String(data.dpShift) : '0'),
                    'WMode=' + String(data.wmode),
                    'Start=' + hex2(data.startRaw || 0)
                ];
                regOut.textContent = lines.join('\n');
            }
        }

        async function readSensorConfigurator() {
            if (!isConnected()) {
                setMsg('Сначала подключите USB-адаптер датчика.', true);
                return;
            }
            const addr = selectedBusAddr();
            sensorDev.address = addr;
            try {
                setMsg('Чтение конфигурации MIDA15 с адреса ' + addr + '…');
                const interfaceRaw = await readHoldingU16(SENSOR_INTERFACE_REG, 1800);
                const munitRaw = await readHoldingU16(SENSOR_MUNIT_REG, 1800);
                const pchRaw = await readHoldingU16(SENSOR_PCH_SETUP_REG, 1800);
                const tchRaw = await readHoldingU16(SENSOR_TCH_SETUP_REG, 1800);
                const dfRaw = await readHoldingU16(SENSOR_DFORDER_REG, 1800);
                const rngRaw = await readHoldingU16(SENSOR_RNGCHECK_REG, 1800);
                const dpBytes = await readHoldingBytes(SENSOR_DP_REG, 2, 1800);
                const wmodeRaw = await readHoldingU16(SENSOR_WMODE_REG, 1800);
                const startRaw = await readHoldingU16(SENSOR_START_REG, 1800);
                const data = {
                    interfaceRaw: interfaceRaw,
                    munitRaw: munitRaw,
                    pchRaw: pchRaw,
                    tchRaw: tchRaw,
                    dfOrder: dfRaw & 0xff,
                    rngCheck: rngRaw & 0xff,
                    dpShift: KorrektorDevice.parseFloat32LE(dpBytes.subarray(0, 4)),
                    wmode: wmodeRaw & 0xff,
                    startRaw: startRaw
                };
                applyDeviceCfgToForm(addr, data);
                const iface = decodeInterface(interfaceRaw);
                setMsg(
                    'Конфигурация считана: адрес ' +
                        addr +
                        ' → Interface=' +
                        hex2(interfaceRaw) +
                        ', baud=' +
                        (INTERFACE_CODE_TO_BAUD[iface.baudCode] || 'неизв.') +
                        ', parity=' +
                        iface.parity +
                        '.'
                );
                plog('Датчик: считана конфигурация MIDA15, адрес ' + addr + '.');
            } catch (e) {
                setMsg('Ошибка чтения конфигурации: ' + errText(e), true);
                plog('Датчик: ошибка чтения конфигурации — ' + errText(e));
            }
        }

        function collectDeviceCfgFromForm(currentAddr) {
            const addr = clampInt((cfgModbusAddr && cfgModbusAddr.value) || currentAddr, 1, 247, currentAddr);
            const mode = readSelectInt(cfgMode, 0, 0, 1);
            const parity = readSelectInt(cfgParity, 0, 0, 2);
            const baud = clampInt((cfgBusBaud && cfgBusBaud.value) || sensorBaud, 1200, 28800, 19200);
            const baudCode = BAUD_TO_INTERFACE_CODE[baud];
            if (!Number.isFinite(baudCode)) {
                throw new Error('Недопустимая скорость шины: ' + baud);
            }
            const resultUnit = readSelectInt(cfgResultUnit, 1, 0, 15);
            const rangeUnit = readSelectInt(cfgRangeUnit, 1, 0, 15);
            const pFilter = readSelectInt(cfgPFilter, 1, 0, 3);
            const pGain = readSelectInt(cfgPGain, 0, 0, 7);
            const pMode = readSelectInt(cfgPMode, 0, 0, 1);
            const tFilter = readSelectInt(cfgTFilter, 1, 0, 3);
            const tGain = readSelectInt(cfgTGain, 0, 0, 7);
            const tMode = readSelectInt(cfgTMode, 0, 0, 1);
            const dfOrder = clampInt((cfgDFOrder && cfgDFOrder.value) || '3', 0, 6, 3);
            const rngCheck = readSelectInt(cfgRangeCheck, 0, 0, 1);
            const wmode = readSelectInt(cfgWorkMode, 0, 0, 1);
            const dpShift = parseFloat((cfgDpShift && cfgDpShift.value) || '0');
            if (!Number.isFinite(dpShift)) {
                throw new Error('Некорректное значение dP.');
            }
            const startRaw = 0;
            return {
                newAddr: addr,
                baud: baud,
                interfaceRaw: encodeInterface(addr, mode, baudCode, parity),
                munitRaw: encodeMUnit(resultUnit, rangeUnit),
                pchRaw: encodeChannelSetup(pMode, pGain, pFilter),
                tchRaw: encodeChannelSetup(tMode, tGain, tFilter),
                dfOrder: dfOrder,
                rngCheck: rngCheck,
                dpShift: dpShift,
                wmode: wmode,
                startRaw: startRaw
            };
        }

        async function writeSensorConfigurator() {
            if (!isConnected()) {
                setMsg('Сначала подключите USB-адаптер датчика.', true);
                return;
            }
            const currentAddr = selectedBusAddr();
            let cfg;
            try {
                cfg = collectDeviceCfgFromForm(currentAddr);
            } catch (e) {
                setMsg(errText(e), true);
                return;
            }
            sensorDev.address = currentAddr;
            try {
                const pwd = cfgWritePassword ? cfgWritePassword.value.trim() : '';
                setMsg('Запись конфигурации MIDA15 в датчик (адрес ' + currentAddr + ')…');
                if (pwd) {
                    const passNum = clampInt(pwd, 0, 65535, 0);
                    await writeHoldingU16(SENSOR_PASSWORD_REG, passNum);
                }
                await writeHoldingU16(SENSOR_MUNIT_REG, cfg.munitRaw);
                await writeHoldingU16(SENSOR_PCH_SETUP_REG, cfg.pchRaw);
                await writeHoldingU16(SENSOR_TCH_SETUP_REG, cfg.tchRaw);
                await writeHoldingU16(SENSOR_DFORDER_REG, cfg.dfOrder & 0xff);
                await writeHoldingU16(SENSOR_RNGCHECK_REG, cfg.rngCheck & 0xff);
                await sensorDev.writeMultiple(SENSOR_DP_REG, Array.from(KorrektorDevice.floatBytesLE(cfg.dpShift)));
                await writeHoldingU16(SENSOR_WMODE_REG, cfg.wmode & 0xff);
                await writeHoldingU16(SENSOR_START_REG, cfg.startRaw);
                await writeHoldingU16(SENSOR_INTERFACE_REG, cfg.interfaceRaw);

                if (cfg.newAddr !== currentAddr) {
                    ensureSensorTargetOption(cfg.newAddr);
                    sensorDev.address = cfg.newAddr;
                    if (cfgModbusAddr) cfgModbusAddr.value = String(cfg.newAddr);
                }
                if (cfg.baud !== sensorBaud) {
                    await switchSensorBaud(cfg.baud);
                }
                setMsg(
                    'Конфигурация записана: адрес=' +
                        cfg.newAddr +
                        ', Interface=' +
                        hex2(cfg.interfaceRaw) +
                        ', MUnit=' +
                        hex2(cfg.munitRaw) +
                        '.'
                );
                plog('Датчик: конфигурация MIDA15 записана (адрес ' + currentAddr + ' → ' + cfg.newAddr + ').');
            } catch (e) {
                setMsg('Ошибка записи конфигурации: ' + errText(e), true);
                plog('Датчик: ошибка записи конфигурации — ' + errText(e));
            }
        }

        async function writeSensorStartCommand(startValue) {
            if (!isConnected()) {
                setMsg('Сначала подключите USB-адаптер датчика.', true);
                return;
            }
            const addr = selectedBusAddr();
            sensorDev.address = addr;
            try {
                await writeHoldingU16(SENSOR_START_REG, startValue ? 0xff00 : 0x0000);
                setMsg(
                    'Команда ' +
                        (startValue ? 'Start' : 'Stop') +
                        ' отправлена на адрес ' +
                        addr +
                        ' (reg 250 = ' +
                        hex2(startValue ? 0xff00 : 0x0000) +
                        ').'
                );
            } catch (e) {
                setMsg('Ошибка команды Start/Stop: ' + errText(e), true);
            }
        }

        async function runManualRegRead(isHolding) {
            if (!isConnected()) {
                setMsg('Сначала подключите USB-адаптер датчика.', true);
                return;
            }
            const addr = selectedBusAddr();
            const start = clampInt((regAddr && regAddr.value) || '2', 0, 65535, 2);
            const count = clampInt((regCount && regCount.value) || '1', 1, 32, 1);
            sensorDev.address = addr;
            try {
                const bytes = isHolding
                    ? await readHoldingBytes(start, count, 1800)
                    : await readInputBytes(start, count, 1800);
                const lines = [
                    (isHolding ? 'Holding' : 'Input') + ' addr=' + addr + ' reg=' + start + ' count=' + count,
                    'HEX: ' + bytesToHex(bytes),
                    'U16: ' + bytesToU16Text(bytes)
                ];
                if (count >= 2) {
                    lines.push('F32[0]: ' + String(KorrektorDevice.parseFloat32LE(bytes.subarray(0, 4))));
                }
                if (regOut) regOut.textContent = lines.join('\n');
                setMsg('Прочитано ' + count + ' рег. с адреса ' + addr + ' (' + (isHolding ? '0x03' : '0x04') + ').');
            } catch (e) {
                setMsg('Ошибка чтения регистров: ' + errText(e), true);
                if (regOut) regOut.textContent = 'Ошибка: ' + errText(e);
            }
        }

        async function runManualRegWrite() {
            if (!isConnected()) {
                setMsg('Сначала подключите USB-адаптер датчика.', true);
                return;
            }
            const addr = selectedBusAddr();
            const start = clampInt((regAddr && regAddr.value) || '2', 0, 65535, 2);
            let bytes;
            try {
                bytes = parseHexByteString((regData && regData.value) || '');
            } catch (e) {
                setMsg(errText(e), true);
                return;
            }
            if (!bytes.length || bytes.length % 2 !== 0) {
                setMsg('Для записи нужны hex-данные чётной длины (по 2 байта на регистр).', true);
                return;
            }
            sensorDev.address = addr;
            try {
                await sensorDev.writeMultiple(start, bytes);
                if (regOut) {
                    regOut.textContent =
                        'Write 0x10 addr=' +
                        addr +
                        ' reg=' +
                        start +
                        ' regs=' +
                        bytes.length / 2 +
                        '\nHEX: ' +
                        bytesToHex(bytes);
                }
                setMsg('Запись выполнена: ' + bytes.length / 2 + ' рег. на адрес ' + addr + '.');
            } catch (e) {
                setMsg('Ошибка записи регистров: ' + errText(e), true);
            }
        }

        async function readSensorLive(addr) {
            if (!sensorDev) return null;
            sensorDev.address = addr;
            let pressureRaw = null;
            let adcPress = null;
            let adcTerm = null;
            const prevPressure = lastPressureRawByAddr.get(addr);

            // Базовый путь: чтение пары входных регистров 0x0002..0x0003.
            try {
                const meas = await readInputBytes(SENSOR_MEAS_REG, 2, 1200);
                const p = decodePressureFromBytes(meas.subarray(0, 4), prevPressure);
                if (isPlausiblePressure(p)) {
                    pressureRaw = p;
                }
            } catch (_e) {}

            // Расширенный блок: 0x0001..0x0004 с ADC-метриками и альтернативным размещением pressure.
            try {
                const input = await readInputBytes(SENSOR_INPUT_BLOCK_REG, 4, 1200);
                adcPress = i16BEFromBytes(input[0], input[1]);
                adcTerm = i16BEFromBytes(input[2], input[3]);
                const pFromReg3 = decodePressureFromBytes(input.subarray(4, 8), prevPressure);
                const pFromReg2 = decodePressureFromBytes(input.subarray(2, 6), prevPressure);
                if (pressureRaw == null) {
                    if (isPlausiblePressure(pFromReg3)) {
                        pressureRaw = pFromReg3;
                    } else if (isPlausiblePressure(pFromReg2)) {
                        pressureRaw = pFromReg2;
                    }
                }
            } catch (_e2) {}

            if (pressureRaw != null && Number.isFinite(pressureRaw)) {
                lastPressureRawByAddr.set(addr, pressureRaw);
            }

            if (pressureRaw == null && adcPress == null && adcTerm == null) {
                return null;
            }
            return {
                adcPress: adcPress,
                adcTerm: adcTerm,
                pressureRaw: pressureRaw
            };
        }

        /** Инициализировать график (canvas). */
        function initChart() {
            if (!chartCanvas || typeof window.Chart === 'undefined') {
                return;
            }
            if (chart) {
                chart.destroy();
            }
            chart = new window.Chart(chartCanvas, {
                type: 'line',
                data: {
                    labels: [],
                    datasets: [
                        {
                            label: 'Абсолютное давление',
                            data: [],
                            borderColor: '#0d6efd',
                            backgroundColor: 'rgba(13,110,253,0.1)',
                            fill: true,
                            tension: 0.2,
                            pointRadius: 0
                        },
                        {
                            label: 'Датчик перепада',
                            data: [],
                            borderColor: '#198754',
                            backgroundColor: 'rgba(25,135,84,0.1)',
                            fill: true,
                            tension: 0.2,
                            pointRadius: 0
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: false,
                    scales: {
                        x: { display: true, title: { display: true, text: 'время' } },
                        y: { display: true, title: { display: true, text: 'давление' } }
                    }
                }
            });
        }

        /** Добавить точку в историю и обновить график. */
        function pushChartPoint(absVal, diffVal) {
            if (!chartCanvas || typeof window.Chart === 'undefined') {
                return;
            }
            const now = new Date();
            const t = now.toLocaleTimeString('ru-RU', { hour12: false });
            chartHistory.push({ t: t, abs: absVal, diff: diffVal });
            if (chartHistory.length > CHART_MAX_POINTS) {
                chartHistory.shift();
            }
            if (!chart) {
                initChart();
            }
            if (!chart) {
                return;
            }
            const unitKey = 'kPa';
            const absCfg = getSensorCfg(1);
            const diffCfg = getSensorCfg(2);
            chart.data.labels = chartHistory.map(function (h) {
                return h.t;
            });
            chart.data.datasets[0].data = chartHistory.map(function (h) {
                return h.abs == null ? null : (h.abs - absCfg.zero) * absCfg.k * (PRESSURE_UNITS[unitKey] || PRESSURE_UNITS.kPa).factor;
            });
            chart.data.datasets[1].data = chartHistory.map(function (h) {
                return h.diff == null ? null : (h.diff - diffCfg.zero) * diffCfg.k * (PRESSURE_UNITS[unitKey] || PRESSURE_UNITS.kPa).factor;
            });
            chart.update();
        }

        function paintScanBadges() {
            if (!scanBadges) return;
            scanBadges.innerHTML = '';
            if (found.size === 0) {
                const span = document.createElement('span');
                span.className = 'badge rounded-pill text-bg-secondary';
                span.textContent = 'устройства не найдены';
                scanBadges.appendChild(span);
                return;
            }
            const sorted = Array.from(found.keys()).sort(function (a, b) {
                return a - b;
            });
            sorted.forEach(function (addr) {
                const info = found.get(addr);
                const span = document.createElement('span');
                span.className = 'badge rounded-pill text-bg-success';
                span.textContent = 'адрес ' + addr + ' · тип ' + info.typeHex;
                span.title =
                    'Тип/версия карты датчика (0x000A) = ' +
                    info.type +
                    (info.via ? '; ответ через ' + info.via : '');
                scanBadges.appendChild(span);
            });
        }

        function syncTargetsFromScan() {
            if (!cfgTarget || found.size === 0) return;
            Array.from(found.keys())
                .sort(function (a, b) {
                    return a - b;
                })
                .forEach(function (addr) {
                    ensureSensorTargetOption(addr, false);
                });
        }

        /** Пробный опрос адреса: 0x03/0x000A, затем 0x04/0x000A (если нужно). */
        async function probeAddress(addr) {
            if (!sensorDev) return { ok: false, error: 'порт не подключён' };
            sensorDev.address = addr;
            const probes = [
                {
                    via: '0x03/0x000A',
                    run: function () {
                        return sensorDev.readHolding(SENSOR_TYPE_REG, 1, SCAN_TIMEOUT_MS, 0);
                    }
                },
                {
                    via: '0x04/0x000A',
                    run: function () {
                        return sensorDev.readInputRegisters(SENSOR_TYPE_REG, 1, SCAN_TIMEOUT_MS, 0);
                    }
                }
            ];
            let lastErr = 'нет ответа';
            for (let i = 0; i < probes.length; i += 1) {
                const p = probes[i];
                try {
                    const resp = await p.run();
                    const b = KorrektorDevice.modbusDataBytes(resp);
                    if (b.length < 2) {
                        lastErr = p.via + ': короткий ответ';
                        continue;
                    }
                    const type = b[0] | (b[1] << 8);
                    return { ok: true, data: { addr: addr, type: type, typeHex: hex2(type), via: p.via } };
                } catch (e) {
                    lastErr = p.via + ': ' + errText(e);
                }
            }
            return { ok: false, error: lastErr };
        }

        async function scanPass(baud) {
            found.clear();
            let noReply = 0;
            let firstError = '';
            for (let addr = SCAN_ADDR_MIN; addr <= SCAN_ADDR_MAX; addr += 1) {
                const r = await probeAddress(addr);
                if (r && r.ok) {
                    found.set(addr, r.data);
                    plog(
                        'Датчик: адрес ' +
                            addr +
                            ' ответил, тип ' +
                            r.data.typeHex +
                            ' (через ' +
                            r.data.via +
                            ', ' +
                            baud +
                            ' бод).'
                    );
                    continue;
                }
                const msg = (r && r.error) || 'нет ответа';
                if (/нет ответа/i.test(msg)) {
                    noReply += 1;
                } else if (!firstError) {
                    firstError = 'адрес ' + addr + ': ' + msg;
                }
            }
            return { noReply: noReply, firstError: firstError };
        }

        async function doScan() {
            if (scanBusy) return;
            if (!isConnected()) {
                setMsg('Сначала подключите COM-порт.', true);
                return;
            }
            scanBusy = true;
            const initialProfile = profileByKey(sensorLinkProfile && sensorLinkProfile.key);
            const initialBaud = sensorBaud || getSelectedBaud();
            const scanBauds = [initialBaud].concat(
                SCAN_FALLBACK_BAUDS.filter(function (b) {
                    return b !== initialBaud;
                })
            );
            const scanProfiles = profileOrder(initialProfile);
            const scanBaudText = scanBauds.join('/');
            let stats = { noReply: 0, firstError: '' };
            let successBaud = null;
            let successProfile = null;
            let foundAny = false;
            setMsg('Сканирование адресов 1–16 (' + initialBaud + ' бод, ' + initialProfile.label + ')…');
            try {
                for (let p = 0; p < scanProfiles.length; p += 1) {
                    const profile = scanProfiles[p];
                    if (p > 0) {
                        setMsg('Нет ответа, пробую профиль RS485: ' + profile.label + '…');
                        const switchedProfile = await switchSensorLinkProfile(profile);
                        if (!switchedProfile) {
                            continue;
                        }
                    }
                    for (let i = 0; i < scanBauds.length; i += 1) {
                        const baud = scanBauds[i];
                        if (sensorBaud !== baud) {
                            setMsg(
                                'Профиль ' +
                                    profile.label +
                                    ': нет ответа на ' +
                                    sensorBaud +
                                    ' бод, пробую ' +
                                    baud +
                                    '…'
                            );
                            const switched = await switchSensorBaud(baud);
                            if (!switched) {
                                continue;
                            }
                        }
                        stats = await scanPass(baud);
                        if (found.size > 0) {
                            successBaud = baud;
                            successProfile = profile;
                            foundAny = true;
                            break;
                        }
                    }
                    if (foundAny) break;
                }
                if (found.size === 0 && sensorBaud !== initialBaud) {
                    await switchSensorBaud(initialBaud);
                }
                if (found.size === 0 && sensorLinkProfile.key !== initialProfile.key) {
                    await switchSensorLinkProfile(initialProfile);
                }
                if (scanResults) scanResults.classList.remove('d-none');
                paintScanBadges();
                syncTargetsFromScan();
                if (found.size === 0) {
                    let msg =
                        'Сканирование завершено: датчики не ответили на адресах 1–16 ' +
                        '(проверены ' +
                        scanBaudText +
                        ' бод, профили RTS/инверсия/Auto DE).';
                    if (stats.firstError) {
                        msg += ' ' + stats.firstError;
                    } else if (stats.noReply > 0) {
                        msg += ' Проверьте питание датчика, линию A/B и полярность RS485.';
                    }
                    setMsg(msg, true);
                } else {
                    setMsg(
                        'Сканирование завершено: найдено устройств — ' +
                            found.size +
                            (successBaud ? ' (скорость ' + successBaud + ' бод, ' + successProfile.label + ').' : '.')
                    );
                }
            } finally {
                scanBusy = false;
            }
        }

        /** Автоматическая настройка датчиков: подключение → сканирование → настройка адресов 1 и 2 → ответ. */
        /** Автоматическая настройка одного датчика: подключение → сканирование → настройка адреса → ответ. */
        async function autoConfigure(addr) {
            if (autoBusy) return;
            autoBusy = true;
            const name = addr === 1 ? 'датчик абсолютного давления' : 'датчик перепада';
            try {
                // 1. Подключение USB-адаптера датчика
                if (!isConnected()) {
                    setMsg('Шаг 1/4: подключение USB-адаптера датчика…');
                    await connectSensorUsb(true);
                    if (!isConnected()) {
                        setMsg('Не удалось подключить датчик. Проверьте USB-адаптер.', true);
                        return;
                    }
                }
                // 2. Сканирование адресов 1–16
                setMsg('Шаг 2/4: сканирование адресов 1–16…');
                await doScan();
                if (found.size === 0) {
                    setMsg('Датчики не найдены (адреса 1–16).', true);
                    return;
                }
                // 3. Настройка выбранного адреса
                setMsg('Шаг 3/4: настройка ' + name + ' (адрес ' + addr + ')…');
                if (!found.has(addr)) {
                    setMsg(name + ' (адрес ' + addr + ') не найден при сканировании.', true);
                    return;
                }
                const c = getSensorCfg(addr);
                c.unit = 'kPa'; // единицы всегда кПа
                sensorCfg[addr] = c;
                const live = await readSensorLive(addr);
                const raw = live ? live.pressureRaw : null;
                const kPa = raw == null ? null : (raw - c.zero) * c.k;
                try {
                    localStorage.setItem('wb_sensor_cfg', JSON.stringify(sensorCfg));
                } catch (_e) {}
                // 4. Ответ по нашей логике
                const v = kPa == null ? 'нет данных' : kPa.toFixed(3) + ' кПа';
                setMsg('Настройка завершена: ' + name + ' (адрес ' + addr + ') = ' + v + '.');
                plog('Датчик: автонастройка ' + name + ' (адрес ' + addr + ') завершена — ' + v + '.');
                // Обновить индикатор визуализатора, если он есть
                if (addr === 1 && pollAbs) pollAbs.textContent = v;
                if (addr === 2 && pollDiff) pollDiff.textContent = v;
            } finally {
                autoBusy = false;
            }
        }

        /** Один опрос измерений в стиле Visualizer (0x0001..0x0004), с fallback на 0x0002. */
        async function pollOnce() {
            if (pollBusy || !isConnected()) return;
            pollBusy = true;
            try {
                const ABS_ADDR = 1; // датчик абсолютного давления
                const DIFF_ADDR = 2; // датчик перепада
                const absLive = await readSensorLive(ABS_ADDR);
                const diffLive = await readSensorLive(DIFF_ADDR);
                const absVal = absLive ? absLive.pressureRaw : null;
                const diffVal = diffLive ? diffLive.pressureRaw : null;
                const unitKey = 'kPa';
                const absCfg = getSensorCfg(1);
                const diffCfg = getSensorCfg(2);
                const fmt = function (p, cfg) {
                    if (p == null) return '—';
                    const kPa = (p - cfg.zero) * cfg.k;
                    const u = PRESSURE_UNITS[unitKey] || PRESSURE_UNITS.kPa;
                    return (kPa * u.factor).toFixed(cfg.dfOrder) + ' ' + u.label;
                };
                if (pollAbs) pollAbs.textContent = fmt(absVal, absCfg);
                if (pollAbsState) {
                    pollAbsState.textContent = absVal == null ? 'нет данных' : 'норма';
                    pollAbsState.className =
                        'badge rounded-pill mt-1 ' + (absVal == null ? 'text-bg-secondary' : 'text-bg-success');
                }
                if (pollDiff) pollDiff.textContent = fmt(diffVal, diffCfg);
                if (pollDiffState) {
                    pollDiffState.textContent = diffVal == null ? 'нет данных' : 'норма';
                    pollDiffState.className =
                        'badge rounded-pill mt-1 ' + (diffVal == null ? 'text-bg-secondary' : 'text-bg-success');
                }
                const preferred = absLive && absLive.pressureRaw != null ? absLive : diffLive;
                if (preferred && preferred.pressureRaw != null) {
                    const cfg = preferred === absLive ? absCfg : diffCfg;
                    setVizRawMetrics({
                        adcPress: preferred.adcPress,
                        adcTerm: preferred.adcTerm,
                        pressureRaw: preferred.pressureRaw,
                        pressureKpa: ((preferred.pressureRaw - cfg.zero) * cfg.k).toFixed(cfg.dfOrder)
                    });
                } else {
                    setVizRawMetrics(null);
                }
                pushChartPoint(absVal, diffVal);
            } finally {
                pollBusy = false;
            }
        }

        function startPoll() {
            if (!isConnected()) {
                setMsg('Сначала подключите COM-порт.', true);
                return;
            }
            if (pollPanel) pollPanel.classList.remove('d-none');
            const periodMs = getPollIntervalMs();
            setMsg('Живой опрос измерений MIDA15 (' + periodMs + ' мс)…');
            void pollOnce();
            if (pollTimer) clearInterval(pollTimer);
            pollTimer = setInterval(function () {
                void pollOnce();
            }, periodMs);
        }

        /** Ручная запись значения отключена: у MIDA15 регистр 0x0002 является Interface-регистром. */
        async function applySensorValue(addr, name) {
            if (!isConnected()) {
                setMsg('Сначала подключите USB-адаптер датчика.', true);
                return;
            }
            setMsg('Запись значения отключена: регистр 0x0002 управляет адресом/интерфейсом MIDA15.', true);
            plog(
                'Датчик: запись значения в ' +
                    name +
                    ' (адрес ' +
                    addr +
                    ') отклонена — 0x0002 является Interface-регистром.'
            );
        }

        /** Калибровка нуля: текущее значение (кПа) выбранного датчика становится сдвигом нуля. */
        async function setZero() {
            if (!isConnected()) {
                setMsg('Сначала подключите USB-адаптер датчика.', true);
                return;
            }
            const addr = selectedSensorAddr();
            const name = addr === 1 ? 'датчик абсолютного давления' : 'датчик перепада';
            sensorDev.address = addr;
            try {
                const live = await readSensorLive(addr);
                const raw = live ? live.pressureRaw : null;
                if (raw == null || !Number.isFinite(raw)) {
                    setMsg('Не удалось прочитать текущее значение ' + name + ' (адрес ' + addr + ').', true);
                    return;
                }
                const c = getSensorCfg(addr);
                c.zero = raw;
                sensorCfg[addr] = c;
                try {
                    localStorage.setItem('wb_sensor_cfg', JSON.stringify(sensorCfg));
                } catch (_e) {}
                setMsg('Ноль ' + name + ' (адрес ' + addr + ') установлен: сдвиг = ' + raw + ' кПа. Давление теперь ≈ 0.');
                plog('Датчик: калибровка нуля ' + name + ' (адрес ' + addr + '): сдвиг = ' + raw + ' кПа.');
            } catch (e) {
                setMsg('Ошибка калибровки нуля: ' + (e.message || String(e)), true);
                plog('Датчик: ошибка калибровки нуля — ' + (e.message || String(e)));
            }
        }

        /** Открыть панель настройки для конкретного датчика. */
        function openSetPanel(addr, name) {
            if (!isConnected()) {
                setMsg('Сначала подключите USB-адаптер датчика.', true);
                return;
            }
            if (setLabel) setLabel.textContent = 'Значение — ' + name + ' (адрес ' + addr + ')';
            if (setValue) setValue.value = '';
            if (setPanel) setPanel.classList.remove('d-none');
            window.__sensorSetTarget = { addr: addr, name: name };
        }

        const setAbsBtn = $('wbSensorSetAbs');
        if (setAbsBtn) {
            setAbsBtn.addEventListener('click', function () {
                openSetPanel(1, 'датчик абсолютного давления');
            });
        }
        const setDiffBtn = $('wbSensorSetDiff');
        if (setDiffBtn) {
            setDiffBtn.addEventListener('click', function () {
                openSetPanel(2, 'датчик перепада');
            });
        }
        if (setApply) {
            setApply.addEventListener('click', function () {
                const t = window.__sensorSetTarget || { addr: 1, name: 'датчик' };
                void applySensorValue(t.addr, t.name);
            });
        }

        // Конфигуратор: загрузка параметров при смене датчика
        if (cfgTarget) {
            cfgTarget.addEventListener('change', function () {
                loadCfgIntoForm();
            });
        }
        // Конфигуратор: применить параметры
        if (cfgApply) {
            cfgApply.addEventListener('click', function () {
                const c = saveCfgFromForm();
                const addr = selectedSensorAddr();
                const name = addr === 1 ? 'датчик абсолютного давления' : 'датчик перепада';
                setMsg('Параметры ' + name + ' (адрес ' + addr + ') сохранены: K=' + c.k + ', сдвиг=' + c.zero + ', ед.=' + PRESSURE_UNITS[c.unit].label + '.');
                plog('Датчик: сохранены параметры ' + name + ' (адрес ' + addr + '): K=' + c.k + ', сдвиг=' + c.zero + ', ед.=' + c.unit + ', диапазон ' + c.rangeDown + '…' + c.rangeUp + ', разрядность=' + c.dfOrder + ', фильтр=' + c.filter + '.');
            });
        }
        if (cfgReadDevice) {
            cfgReadDevice.addEventListener('click', function () {
                void readSensorConfigurator();
            });
        }
        if (cfgWriteDevice) {
            cfgWriteDevice.addEventListener('click', function () {
                void writeSensorConfigurator();
            });
        }
        if (cfgStartBtn) {
            cfgStartBtn.addEventListener('click', function () {
                void writeSensorStartCommand(true);
            });
        }
        if (cfgStopBtn) {
            cfgStopBtn.addEventListener('click', function () {
                void writeSensorStartCommand(false);
            });
        }
        if (regReadHoldingBtn) {
            regReadHoldingBtn.addEventListener('click', function () {
                void runManualRegRead(true);
            });
        }
        if (regReadInputBtn) {
            regReadInputBtn.addEventListener('click', function () {
                void runManualRegRead(false);
            });
        }
        if (regWriteBtn) {
            regWriteBtn.addEventListener('click', function () {
                void runManualRegWrite();
            });
        }
        // Визуализатор: инициализация графика при открытии вкладки
        if (vizTab) {
            vizTab.addEventListener('shown.bs.tab', function () {
                initChart();
            });
        }
        // Загрузить сохранённые параметры при старте
        try {
            const saved = localStorage.getItem('wb_sensor_cfg');
            if (saved) {
                const parsed = JSON.parse(saved);
                Object.keys(parsed).forEach(function (k) {
                    sensorCfg[parseInt(k, 10)] = parsed[k];
                });
            }
        } catch (_e) {}
        loadCfgIntoForm();

        const connectBtn = $('wbSensorComConnect');
        const disconnectBtn = $('wbSensorComDisconnect');
        const scanBtn = $('wbSensorScan');
        const pollBtn = $('wbSensorPoll');

        /** Подключить USB-адаптер датчика. filterKao=true — только PID 0x7523, иначе любой USB. */
        async function connectSensorUsb(filterKao) {
            const baud = getSelectedBaud();
            if (isConnected()) {
                if (sensorBaud !== baud) {
                    setMsg('USB-адаптер уже подключён, меняю скорость на ' + baud + ' бод…');
                    const switched = await switchSensorBaud(baud);
                    if (switched) {
                        setMsg('Скорость датчика переключена на ' + baud + ' бод.');
                    } else {
                        setMsg('Не удалось переключить скорость на ' + baud + ' бод.', true);
                    }
                    return;
                }
                setMsg('USB-адаптер уже подключён (' + sensorBaud + ' бод, ' + sensorLinkProfile.label + ').');
                return;
            }
            const K = window.KorrektorDevice;
            if (!K) {
                setMsg('Модуль KorrektorDevice не загружен.', true);
                return;
            }
            const opts = {
                baudRate: baud,
                rs485Rts: sensorLinkProfile.rs485Rts !== false,
                rs485RtsTxHigh: sensorLinkProfile.rs485RtsTxHigh !== false
            };
            if (filterKao) {
                opts.filters = [{ usbVendorId: SENSOR_USB_VID, usbProductId: SENSOR_USB_PID }];
            }
            const d = new K(1);
            attachSensorTrace(d);
            try {
                setMsg('Подключение USB-адаптера датчика (' + baud + ' бод)…');
                const reopened = await d.reconnectGranted(opts);
                if (!reopened) {
                    await d.connect(opts);
                }
                sensorDev = d;
                sensorBaud = baud;
                setComStatus('подключено', true);
                setMsg('USB-адаптер датчика подключён. Нажмите «Сканировать адреса».');
                plog('Датчик: USB-адаптер подключён (' + baud + ' бод, ' + sensorLinkProfile.label + ').');
            } catch (e) {
                setComStatus('нет связи', false);
                let msg = e.message || String(e);
                if (filterKao && (e.name === 'NotFoundError' || /cancel|отмен/i.test(msg))) {
                    msg += '. Адаптер не найден? Нажмите «Любой USB».';
                }
                setMsg('Ошибка подключения: ' + msg, true);
                plog('Датчик: ошибка подключения — ' + msg);
                detachSensorTrace(d);
            }
        }

        if (connectBtn) {
            connectBtn.addEventListener('click', function () {
                void connectSensorUsb(true);
            });
        }

        const connectAnyBtn = $('wbSensorComConnectAny');
        if (connectAnyBtn) {
            connectAnyBtn.addEventListener('click', function () {
                void connectSensorUsb(false);
            });
        }

        if (disconnectBtn) {
            disconnectBtn.addEventListener('click', async function () {
                stopPoll();
                if (sensorDev) {
                    try {
                        detachSensorTrace(sensorDev);
                        await sensorDev.disconnect();
                    } catch (_e) {}
                    sensorDev = null;
                }
                sensorBaud = getSelectedBaud();
                found.clear();
                if (scanResults) scanResults.classList.add('d-none');
                if (scanBadges) scanBadges.innerHTML = '';
                setComStatus('нет связи', false);
                setMsg('COM-порт датчика закрыт.');
            });
        }

        const autoBtn1 = $('wbSensorAuto1');
        if (autoBtn1) {
            autoBtn1.addEventListener('click', function () {
                void autoConfigure(1);
            });
        }
        const autoBtn2 = $('wbSensorAuto2');
        if (autoBtn2) {
            autoBtn2.addEventListener('click', function () {
                void autoConfigure(2);
            });
        }
        if (scanBtn) {
            scanBtn.addEventListener('click', function () {
                void doScan();
            });
        }
        if (pollBtn) {
            pollBtn.addEventListener('click', function () {
                startPoll();
            });
        }

        const setZeroBtn = $('wbSensorSetZero');
        if (setZeroBtn) {
            setZeroBtn.addEventListener('click', function () {
                void setZero();
            });
        }
    }

    function initWorkbench() {
        if (!document.body.classList.contains('wb-page')) {
            return;
        }

        initSensorConfig();

        try {
            const saved = localStorage.getItem('order1c_odataBase');
            const baseEl = $('paramOrder1cBase');
            if (saved && baseEl && !baseEl.value.trim()) {
                baseEl.value = saved;
            }
        } catch (_e) {}

        const orderInput = $('paramOrder1cNumber');
        const orderSelect = $('paramOrder1cSelect');
        const manualWrap = $('paramOrder1cManualWrap');
        const newAlert = $('paramOrder1cNewAlert');
        const newBadge = $('paramOrder1cNewBadge');

        function setManualVisible(on) {
            if (manualWrap) {
                manualWrap.classList.toggle('d-none', !on);
            }
        }

        function syncNumberFromSelect() {
            if (!orderSelect || !orderInput) {
                return;
            }
            const v = orderSelect.value;
            if (!v) {
                setManualVisible(false);
                return;
            }
            if (v === '__manual__') {
                setManualVisible(true);
                orderInput.focus();
                return;
            }
            setManualVisible(false);
            orderInput.value = v;
        }

        let wbNotifyItems = [];
        let wbNotifySeq = 0;

        function renderWbNotifyList() {
            if (!newAlert) {
                return;
            }
            if (!wbNotifyItems.length) {
                newAlert.innerHTML = '';
                newAlert.classList.add('d-none');
                if (newBadge) {
                    newBadge.classList.add('d-none');
                }
                return;
            }
            if (newBadge) {
                newBadge.classList.remove('d-none');
                newBadge.textContent =
                    wbNotifyItems.length === 1 ? 'новый заказ' : 'новых: ' + wbNotifyItems.length;
            }
            newAlert.classList.remove('d-none');
            newAlert.innerHTML = wbNotifyItems
                .map(function (item) {
                    const testBit = item.test
                        ? '<span class="badge text-bg-warning text-dark me-1">ТЕСТ</span> '
                        : '';
                    const text =
                        item.test && item.message
                            ? item.message + ' · <strong>' + item.number + '</strong>'
                            : '<strong>' + item.number + '</strong>';
                    return (
                        '<div class="d-flex flex-wrap align-items-center gap-2 py-1 border-bottom border-success border-opacity-25" data-wb-notify="' +
                        item.id +
                        '">' +
                        '<span class="flex-grow-1">' +
                        testBit +
                        '<i class="bi bi-bell-fill me-1"></i>' +
                        text +
                        '</span>' +
                        '<button type="button" class="btn btn-outline-secondary btn-sm py-0" data-wb-dismiss="' +
                        item.id +
                        '">Скрыть</button>' +
                        '</div>'
                    );
                })
                .join('');
        }

        function showNewOrdersUi(newOrders) {
            if (!newOrders || !newOrders.length) {
                return;
            }
            newOrders.forEach(function (o) {
                wbNotifySeq += 1;
                wbNotifyItems.push({
                    id: 'wb-' + wbNotifySeq + '-' + Date.now(),
                    number: o.number || '',
                    test: !!o.test,
                    message: o.message || '',
                });
            });
            renderWbNotifyList();
            try {
                if (newAlert && typeof newAlert.scrollIntoView === 'function') {
                    newAlert.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            } catch (_e) {}
        }

        newAlert?.addEventListener('click', function (e) {
            const btn = e.target.closest('[data-wb-dismiss]');
            if (!btn) {
                return;
            }
            const id = btn.getAttribute('data-wb-dismiss');
            wbNotifyItems = wbNotifyItems.filter(function (it) {
                return it.id !== id;
            });
            renderWbNotifyList();
        });

        async function refreshActiveOrderList() {
            const O = window.Order1cOdata;
            if (!O || typeof O.fillActiveOrdersSelect !== 'function' || !orderSelect) {
                return;
            }
            const prev = normalizeOrder((orderInput && orderInput.value) || '');
            try {
                await O.fillActiveOrdersSelect(orderSelect, {
                    keepManualOption: true,
                });
                if (prev) {
                    const has = Array.prototype.some.call(orderSelect.options, function (opt) {
                        return opt.value === prev;
                    });
                    if (has) {
                        orderSelect.value = prev;
                        setManualVisible(false);
                    } else {
                        orderSelect.value = '__manual__';
                        setManualVisible(true);
                        orderInput.value = prev;
                    }
                }
                if (newBadge) {
                    newBadge.classList.add('d-none');
                }
            } catch (e) {
                plog('Список заказов 1С: ' + (e.message || String(e)));
                setManualVisible(true);
            }
        }

        orderSelect?.addEventListener('change', function () {
            syncNumberFromSelect();
        });

        $('paramOrder1cRefreshList')?.addEventListener('click', function () {
            void refreshActiveOrderList();
        });

        // Загрузка только по «Войти в заказ» / Enter — без автоприёма при наборе номера.
        orderInput?.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                void manualOpenOrderSession();
            }
        });

        $('wbOrderSessionOpen')?.addEventListener('click', function () {
            syncNumberFromSelect();
            void manualOpenOrderSession();
        });

        void refreshActiveOrderList();

        // Уведомления (в т.ч. тест из админки) сразу — не ждём загрузки списка 1С
        (function startWbOrdersWatcher() {
            const O = window.Order1cOdata;
            if (!O || typeof O.startActiveOrdersWatcher !== 'function') {
                setTimeout(startWbOrdersWatcher, 1000);
                return;
            }
            if (window.__wbActiveOrdersWatcher) {
                return;
            }
            window.__wbActiveOrdersWatcher = O.startActiveOrdersWatcher({
                intervalMs: 60000,
                onNew: function (newOrders) {
                    showNewOrdersUi(newOrders);
                    void refreshActiveOrderList();
                },
                onError: function (e) {
                    console.warn('[workbench] active orders watch', e);
                },
            });
        })();

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
                    plog('Сессия заказа завершена. Повторный ввод того же номера вернёт в эту сессию.');
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
        paintSenselockAgentBadge();
        window.addEventListener('tm07-senselock-agent', function () {
            paintSenselockAgentBadge();
            paintSessionBadge();
        });

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
            paintSenselockAgentBadge();
            paintSessionBadge();
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

        $('paramCorrectorWrite')?.addEventListener('click', function () {
            void writeCorrectorParamsLater().catch(function (err) {
                plog('Корректор: ' + (err.message || String(err)));
                setWbStatus(err.message || String(err), true);
            });
        });

    $('paramCorrectorDatesToday')?.addEventListener('click', function () {
            const Ops = window.TM07_WORKBENCH_OPS;
            if (!Ops) {
                return;
            }
            if (typeof Ops.applyCorrectorVerificationDates === 'function') {
                Ops.applyCorrectorVerificationDates(true);
                const st = $('paramCorrectorStatus');
                if (st) {
                    st.textContent = '✓ п.80/81 подставлены';
                    st.classList.remove('text-danger', 'text-body-secondary');
                    st.classList.add('text-success');
                }
            }
        });

        $('paramComplexWrite')?.addEventListener('click', function () {
            void writeComplexParamsLater().catch(function (err) {
                plog('Комплекс: ' + (err.message || String(err)));
                setWbStatus(err.message || String(err), true);
            });
        });

        $('paramComplexDatesToday')?.addEventListener('click', function () {
            const Ops = window.TM07_WORKBENCH_OPS;
            if (!Ops) {
                return;
            }
            if (typeof Ops.applyComplexVerificationDates === 'function') {
                Ops.applyComplexVerificationDates(true);
                const st = $('paramComplexStatus');
                if (st) {
                    st.textContent = '✓ п.202/203 подставлены';
                    st.classList.remove('text-danger', 'text-body-secondary');
                    st.classList.add('text-success');
                }
            }
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
                        const resumeSid = pendingResumeSessionId;
                        try {
                            const events = window.TM07_BENCH_EVENTS;
                            await events.ensureOperator();
                            const data = await events.reopenOrderSession(resumeSid);
                            const num =
                                data && data.session && data.session.orderNumber
                                    ? data.session.orderNumber
                                    : '';
                            if (num && orderInput) {
                                orderInput.value = num;
                                // sessionId держим до openOrderSession внутри prepare —
                                // иначе создастся новая сессия поверх открытой.
                                pendingResumeSessionId = resumeSid;
                                await prepareOrderFromInput(true, { sessionId: resumeSid });
                            } else {
                                pendingResumeSessionId = null;
                                applyActiveSessionToUI();
                                paintSessionBadge();
                                await maybeAutoConfirmAssembly();
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
        valuesMatchForVerify: valuesMatchForVerify,
        paintVerifyMismatches: paintVerifyMismatches,
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initWorkbench);
    } else {
        initWorkbench();
    }
})();
