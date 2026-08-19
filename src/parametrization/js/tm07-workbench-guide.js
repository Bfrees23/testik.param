/**
 * Пошаговый мастер оператора: всплывающие подсказки на рабочем месте ТМ-07.
 */
(function () {
    'use strict';

    const SS_DISABLE = 'wb_guide_disabled_session';
    const TOTAL_STEPS = 6;

    let modalInstance = null;
    let highlightedEl = null;
    let lastPhase = '';
    let manualPhase = '';
    let writing = false;
    let advanceTimer = null;

    function $(id) {
        return document.getElementById(id);
    }

    function Ops() {
        return window.TM07_WORKBENCH_OPS;
    }

    function isConnected() {
        const K = window.TM07_PARAM_KAO;
        return K && typeof K.isConnected === 'function' && K.isConnected();
    }

    function hasActiveOrderSession() {
        const events = window.TM07_BENCH_EVENTS;
        return !!(events && events.hasActiveOrder && events.hasActiveOrder());
    }

    function getSessionStage() {
        const events = window.TM07_BENCH_EVENTS;
        return events && events.getSessionStage ? events.getSessionStage() : null;
    }

    function isAssemblyDone() {
        const stage = getSessionStage();
        return stage === 'parametrization' || stage === 'completed';
    }

    function hasCorrectorSerial() {
        const disp =
            ($('wbCorrectorSerialDisplay') || {}).value ||
            ($('val_3') || {}).value ||
            '';
        return /^300\d{7}$/.test(String(disp || '').trim());
    }

    function isOrderReady() {
        const num = ($('paramOrder1cNumber') || {}).value;
        if (!String(num || '').trim()) {
            return false;
        }
        const v200 = ($('val_200') || {}).value;
        const v6 = ($('val_6') || {}).value;
        return !!(String(v200 || '').trim() || String(v6 || '').trim());
    }

    function isGuideDisabled() {
        try {
            return sessionStorage.getItem(SS_DISABLE) === '1';
        } catch (_e) {
            return false;
        }
    }

    function setGuideDisabled(on) {
        try {
            if (on) {
                sessionStorage.setItem(SS_DISABLE, '1');
            } else {
                sessionStorage.removeItem(SS_DISABLE);
            }
        } catch (_e) {}
    }

    function openGuideOnEnter() {
        manualPhase = '';
        lastPhase = '';
        writing = false;
        const phase = resolvePhase();
        renderModal(phase);
        lastPhase = phase;
    }

    function isModalVisible() {
        const el = $('wbGuideModal');
        return !!(el && el.classList.contains('show'));
    }

    function clearHighlight() {
        if (highlightedEl) {
            highlightedEl.classList.remove('wb-guide-highlight');
            highlightedEl = null;
        }
    }

    function highlightTarget(selector) {
        clearHighlight();
        if (!selector) {
            return;
        }
        const el = document.querySelector(selector);
        if (!el) {
            return;
        }
        highlightedEl = el;
        el.classList.add('wb-guide-highlight');
        try {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } catch (_e) {
            el.scrollIntoView(true);
        }
    }

    function getNextSensorKey() {
        const o = Ops();
        if (!o || typeof o.getRequiredSensorKeys !== 'function') {
            return null;
        }
        const keys = o.getRequiredSensorKeys();
        for (let i = 0; i < keys.length; i += 1) {
            if (typeof o.isSensorFilled === 'function' && !o.isSensorFilled(keys[i])) {
                return keys[i];
            }
        }
        return null;
    }

    function qrProgressText() {
        const o = Ops();
        if (!o) {
            return '';
        }
        const keys = o.getRequiredSensorKeys ? o.getRequiredSensorKeys() : [];
        let done = 0;
        keys.forEach(function (k) {
            if (o.isSensorFilled && o.isSensorFilled(k)) {
                done += 1;
            }
        });
        return done + ' из ' + keys.length + ' отсканировано';
    }

    function resolvePhase() {
        if (writing) {
            return 'writing';
        }
        if (manualPhase) {
            return manualPhase;
        }
        if (!hasActiveOrderSession() || !isOrderReady()) {
            return 'order';
        }
        if (!isAssemblyDone()) {
            return 'assembly';
        }
        if (!isConnected()) {
            return 'connect';
        }
        if (getNextSensorKey()) {
            return 'qr';
        }
        const o = Ops();
        const needMeter =
            !o || typeof o.isComplexOrder !== 'function' || o.isComplexOrder();
        if (
            needMeter &&
            o &&
            typeof o.isMeterSerialFilled === 'function' &&
            !o.isMeterSerialFilled()
        ) {
            return 'meter';
        }
        return 'parametrize';
    }

    function phaseContent(phase) {
        const o = Ops();
        const labels = (o && o.SENSOR_LABELS) || {};
        const nextKey = getNextSensorKey();

        switch (phase) {
            case 'order':
                return {
                    step: 1,
                    icon: 'bi-file-earmark-spreadsheet',
                    title: 'Введите номер заказа',
                    html:
                        '<p class="mb-2">Введите номер заказа из 1С и нажмите <strong>«Войти в заказ»</strong> — откроется сессия параметризации.</p>' +
                        '<p class="mb-0 small text-body-secondary">Параметры заказа подгрузятся из 1С автоматически.</p>',
                    target: '#paramOrder1cNumber',
                    action: 'Понятно',
                    autoAdvance: true,
                };
            case 'assembly':
                return {
                    step: 2,
                    icon: 'bi-cpu',
                    title: 'Сборка корректора',
                    html:
                        '<p class="mb-2">На карточке «Корректор · сборка» нажмите <strong>«Сгенерировать»</strong> — получите S/N для шильда (формат 300…).</p>' +
                        '<p class="mb-2">После физической сборки корректора нажмите <strong>«Подтвердить сборку»</strong>.</p>' +
                        '<p class="mb-0 small text-body-secondary">' +
                        (hasCorrectorSerial() ? 'S/N готов — подтвердите сборку.' : 'S/N ещё не сгенерирован.') +
                        '</p>',
                    target: '#wbCorrectorCard',
                    action: 'Понятно',
                    autoAdvance: true,
                };
            case 'connect':
                return {
                    step: 3,
                    icon: 'bi-plug',
                    title: 'Подключите КАО',
                    html:
                        '<p class="mb-2">Подключите USB-адаптер КАО к корректору и нажмите кнопку <strong>«КАО»</strong> (или «Любой USB», если адаптер не определяется).</p>' +
                        '<p class="mb-0 small text-body-secondary">Дождитесь зелёного статуса «подключено» справа от кнопок.</p>',
                    target: '#paramConnectKao',
                    action: 'Понятно',
                    autoAdvance: true,
                };
            case 'qr': {
                const label = labels[nextKey] || nextKey || 'датчик';
                const isTemp = nextKey === 'DT' || nextKey === 'TT';
                const list = o && o.getRequiredSensorKeys ? o.getRequiredSensorKeys() : [];
                let listHtml = '<ul class="mb-2 ps-3">';
                list.forEach(function (k) {
                    const done = o.isSensorFilled && o.isSensorFilled(k);
                    listHtml +=
                        '<li class="' +
                        (done ? 'text-success' : '') +
                        '">' +
                        (done ? '✓ ' : '○ ') +
                        (labels[k] || k) +
                        (k === 'DT' || k === 'TT' ? ' <span class="text-body-secondary">(4 цифры)</span>' : '') +
                        '</li>';
                });
                listHtml += '</ul>';
                const scanHint = isTemp
                    ? '<p class="mb-1">Введите или отсканируйте <strong>4 цифры</strong> серийного номера с наклейки температурного датчика, затем Enter.</p>'
                    : '<p class="mb-1">Наведите сканер на QR-код MIDA на корпусе датчика. После скана нажмите Enter — поле очистится для следующего.</p>';
                return {
                    step: 4,
                    icon: isTemp ? 'bi-123' : 'bi-qr-code-scan',
                    title: isTemp ? 'S/N температурного датчика' : 'Сканируйте QR датчика',
                    html:
                        '<p class="mb-2">Сейчас нужен: <strong>' + label + '</strong></p>' +
                        listHtml +
                        scanHint +
                        '<p class="mb-0 small text-body-secondary">' + qrProgressText() + '</p>',
                    target: '#paramQrSensor',
                    action: 'Понятно',
                    autoAdvance: true,
                };
            }
            case 'meter':
                return {
                    step: 5,
                    icon: 'bi-speedometer',
                    title: 'S/N счётчика',
                    html:
                        '<p class="mb-2">Введите <strong>серийный номер счётчика газа</strong> с заводской таблички (4–8 цифр).</p>' +
                        '<p class="mb-0 small text-body-secondary">Поле «S/N счётчика» — можно позже. Enter подставит п.102 и даты; «Записать счётчик» пишет в прибор даже после параметризации.</p>',
                    target: '#paramMeterSerial',
                    action: 'Понятно',
                    autoAdvance: true,
                };
            case 'parametrize':
                return {
                    step: 6,
                    icon: 'bi-lightning-charge',
                    title: 'Параметризация',
                    html:
                        '<p class="mb-2">Все данные готовы. Нажмите жёлтую кнопку <strong>«Параметризовать»</strong> — параметры запишутся в корректор автоматически.</p>' +
                        '<p class="mb-0 small text-body-secondary">Не отключайте КАО до сообщения «Готово» в журнале.</p>',
                    target: '#paramWriteAll',
                    action: 'Записать',
                    autoAdvance: false,
                };
            case 'writing':
                return {
                    step: 6,
                    icon: 'bi-hourglass-split',
                    title: 'Идёт запись…',
                    html:
                        '<p class="mb-2">Параметры записываются в корректор. Пожалуйста, подождите.</p>' +
                        '<div class="text-center my-3 py-3 px-2 rounded-3 bg-light">' +
                        '<div id="wbWriteTimerLeft" class="fs-3 fw-bold lh-sm text-body">⏳ расчёт…</div>' +
                        '<div class="small text-body-secondary mt-1">прошло <span id="wbWriteTimerElapsed">—</span> · шаг <span id="wbWriteTimerStep">—</span></div>' +
                        '</div>' +
                        '<div class="d-flex align-items-center justify-content-center gap-2 text-body-secondary">' +
                        '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>' +
                        '<span>Не отключайте USB и не закрывайте страницу.</span></div>',
                    target: null,
                    action: null,
                    autoAdvance: false,
                    hideFooter: true,
                };
            case 'done':
                return {
                    step: 6,
                    icon: 'bi-check-circle',
                    title: 'Готово!',
                    html:
                        '<p class="mb-2">Параметризация завершена успешно. Паспорт(а) DOCX сформированы автоматически.</p>' +
                        '<div id="wbPassportLinks" class="mb-2 d-none"></div>' +
                        '<p class="mb-0 small text-body-secondary">Нажмите «Следующий прибор», чтобы начать новый цикл.</p>',
                    target: null,
                    action: 'Следующий прибор',
                    autoAdvance: false,
                    success: true,
                };
            case 'error':
                return {
                    step: null,
                    icon: 'bi-exclamation-triangle',
                    title: 'Нужно исправить',
                    html: '<div id="wbGuideErrorBody"></div>',
                    target: null,
                    action: 'Понятно',
                    autoAdvance: false,
                    danger: true,
                };
            default:
                return null;
        }
    }

    function ensureModal() {
        if (modalInstance) {
            return modalInstance;
        }
        const el = $('wbGuideModal');
        if (!el || !window.bootstrap) {
            return null;
        }
        modalInstance = window.bootstrap.Modal.getOrCreateInstance(el, {
            backdrop: 'static',
            keyboard: false,
        });
        return modalInstance;
    }

    function renderModal(phase, extraHtml) {
        if (isGuideDisabled() && phase !== 'writing' && phase !== 'done' && phase !== 'error') {
            return;
        }

        const content = phaseContent(phase);
        if (!content) {
            return;
        }

        const badge = $('wbGuideStepBadge');
        const titleEl = $('wbGuideTitle');
        const bodyEl = $('wbGuideBody');
        const iconEl = $('wbGuideIcon');
        const actionBtn = $('wbGuideAction');
        const skipBtn = $('wbGuideSkip');
        const footer = $('wbGuideFooter');

        if (badge) {
            if (content.step) {
                badge.textContent = 'Шаг ' + content.step + ' из ' + TOTAL_STEPS;
                badge.classList.remove('d-none');
            } else {
                badge.classList.add('d-none');
            }
        }
        if (iconEl) {
            iconEl.className = 'bi fs-3 me-2 ' + (content.icon || 'bi-info-circle');
            iconEl.classList.toggle('text-success', !!content.success);
            iconEl.classList.toggle('text-danger', !!content.danger);
            iconEl.classList.toggle('text-primary', !content.success && !content.danger);
        }
        if (titleEl) {
            titleEl.textContent = content.title;
        }
        if (bodyEl) {
            bodyEl.innerHTML = extraHtml || content.html;
        }
        if (footer) {
            footer.classList.toggle('d-none', !!content.hideFooter);
        }
        if (actionBtn) {
            if (content.action) {
                actionBtn.textContent = content.action;
                actionBtn.classList.remove('d-none');
                actionBtn.classList.toggle('btn-success', !!content.success);
                actionBtn.classList.toggle('btn-warning', phase === 'parametrize');
                actionBtn.classList.toggle('btn-primary', phase !== 'parametrize' && !content.success);
            } else {
                actionBtn.classList.add('d-none');
            }
        }
        if (skipBtn) {
            skipBtn.classList.toggle('d-none', phase === 'writing' || phase === 'done');
        }

        highlightTarget(content.target);

        const modal = ensureModal();
        if (modal) {
            modal.show();
        }
    }

    function scheduleRefresh(delayMs) {
        if (advanceTimer) {
            clearTimeout(advanceTimer);
        }
        advanceTimer = setTimeout(function () {
            advanceTimer = null;
            refreshGuide(true);
        }, delayMs == null ? 400 : delayMs);
    }

    function refreshGuide(fromAuto) {
        if (isGuideDisabled() && !writing && !manualPhase) {
            clearHighlight();
            return;
        }

        const phase = resolvePhase();
        if (phase === lastPhase && fromAuto && phase !== 'qr') {
            return;
        }

        if (fromAuto && lastPhase && phase !== lastPhase) {
            const prev = phaseContent(lastPhase);
            const next = phaseContent(phase);
            if (prev && next && prev.autoAdvance && isConnected()) {
                renderModal(phase);
                lastPhase = phase;
                return;
            }
        }

        if (phase !== lastPhase || phase === 'qr' || phase === 'meter' || phase === 'assembly' || phase === 'error') {
            renderModal(phase);
            lastPhase = phase;
        } else if (phase === 'qr') {
            renderModal('qr');
        }
    }

    function showErrors(messages) {
        manualPhase = 'error';
        lastPhase = '';
        const html =
            '<ul class="mb-0 ps-3">' +
            messages
                .map(function (m) {
                    return '<li>' + m + '</li>';
                })
                .join('') +
            '</ul>';
        renderModal('error', html);
    }

    function clearError() {
        if (manualPhase === 'error') {
            manualPhase = '';
            lastPhase = '';
        }
    }

    function setWriting(on) {
        writing = !!on;
        if (on) {
            manualPhase = '';
            lastPhase = '';
            renderModal('writing');
        } else {
            lastPhase = '';
            scheduleRefresh(300);
        }
    }

    function showDone(passportFiles) {
        writing = false;
        manualPhase = 'done';
        lastPhase = '';
        renderModal('done');
        const Passport = window.TM07_PASSPORT;
        if (Passport && typeof Passport.renderPassportLinks === 'function') {
            Passport.renderPassportLinks(passportFiles || Passport.getLastFiles());
        }
    }

    function startNextDevice() {
        manualPhase = '';
        lastPhase = '';
        writing = false;

        const orderEl = $('paramOrder1cNumber');
        if (orderEl) {
            orderEl.value = '';
        }
        const o = Ops();
        if (o && typeof o.resetScannedSensors === 'function') {
            o.resetScannedSensors();
        }
        if (o && typeof o.resetMeterSerial === 'function') {
            o.resetMeterSerial();
        }
        if (window.TM07_WORKBENCH && typeof window.TM07_WORKBENCH.resetSession === 'function') {
            window.TM07_WORKBENCH.resetSession();
        }
        if (window.TM07_PASSPORT && typeof window.TM07_PASSPORT.renderPassportLinks === 'function') {
            window.TM07_PASSPORT.renderPassportLinks([]);
        }
        if (o) {
            o.paintSensorBadges();
            o.paintMeterBadge();
            o.paintWorkflowSteps();
        }

        const modal = ensureModal();
        if (modal) {
            modal.hide();
        }
        clearHighlight();
        scheduleRefresh(600);
    }

    function onActionClick() {
        const phase = resolvePhase();
        if (phase === 'parametrize') {
            const modal = ensureModal();
            if (modal) {
                modal.hide();
            }
            clearHighlight();
            const btn = $('paramWriteAll');
            if (btn) {
                btn.click();
            }
            return;
        }
        if (phase === 'done' || manualPhase === 'done') {
            startNextDevice();
            return;
        }
        if (manualPhase === 'error') {
            clearError();
            refreshGuide(false);
            return;
        }
        const modal = ensureModal();
        if (modal) {
            modal.hide();
        }
        clearHighlight();
    }

    function initGuide() {
        if (!document.body.classList.contains('wb-page')) {
            return;
        }

        try {
            localStorage.removeItem('wb_guide_disabled');
        } catch (_e) {}

        $('wbGuideAction')?.addEventListener('click', onActionClick);
        $('wbGuideSkip')?.addEventListener('click', function () {
            setGuideDisabled(true);
            const modal = ensureModal();
            if (modal) {
                modal.hide();
            }
            clearHighlight();
        });
        $('wbGuideHelpBtn')?.addEventListener('click', function () {
            setGuideDisabled(false);
            manualPhase = '';
            lastPhase = '';
            refreshGuide(false);
        });

        const conn = $('paramConnStatus');
        if (conn) {
            new MutationObserver(function () {
                if (isConnected() && lastPhase === 'connect') {
                    scheduleRefresh(600);
                }
                if (Ops()) {
                    Ops().paintWorkflowSteps();
                }
            }).observe(conn, { childList: true, characterData: true, subtree: true });
        }

        window.addEventListener('tm07-order-applied', function () {
            if (lastPhase === 'order' || resolvePhase() === 'assembly' || resolvePhase() === 'qr') {
                scheduleRefresh(500);
            }
        });

        window.addEventListener('tm07-order-session-changed', function () {
            scheduleRefresh(400);
        });

        window.addEventListener('tm07-qr-scanned', function () {
            scheduleRefresh(200);
        });

        window.addEventListener('tm07-meter-serial-applied', function () {
            scheduleRefresh(300);
        });

        $('wbGuideModal')?.addEventListener('hidden.bs.modal', function () {
            if (!writing && resolvePhase() !== 'parametrize') {
                clearHighlight();
            }
        });

        function tryOpenOnEnter() {
            if (isGuideDisabled() || isModalVisible()) {
                return;
            }
            openGuideOnEnter();
        }

        window.addEventListener('load', function () {
            setTimeout(tryOpenOnEnter, 250);
        });

        setTimeout(tryOpenOnEnter, 600);
    }

    window.TM07_WORKBENCH_GUIDE = {
        refresh: function () {
            refreshGuide(false);
        },
        showErrors: showErrors,
        setWriting: setWriting,
        showDone: showDone,
        startNextDevice: startNextDevice,
        isDisabled: isGuideDisabled,
        openOnEnter: openGuideOnEnter,
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initGuide);
    } else {
        initGuide();
    }
})();
