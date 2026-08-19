/**
 * UI генерации серийных номеров на странице параметризации (п.3, п.201).
 */
(function () {
    'use strict';

    const R = () => window.TM07_SERIAL_REGISTRY;

    function el(id) {
        return document.getElementById(id);
    }

    function setStatus(text, isError) {
        const st = el('paramSerialRegistryStatus');
        if (!st) {
            return;
        }
        st.textContent = text || '';
        st.className = 'small mt-2 mb-0 ' + (isError ? 'text-danger' : text ? 'text-success' : 'text-body-secondary');
    }

    function plog(msg) {
        const le = el('paramLog');
        if (!le) {
            return;
        }
        const t = new Date().toLocaleTimeString();
        le.innerHTML += '[' + t + '] [S/N] ' + msg + '<br>';
        le.scrollTop = le.scrollHeight;
    }

    function formatStepValue(stepId, serial) {
        if (window.TM07_param_formatStepValue) {
            return window.TM07_param_formatStepValue(stepId, serial);
        }
        return serial;
    }

    function fieldHasValue(stepId) {
        const inp = el('val_' + stepId);
        if (!inp || inp.disabled) {
            return false;
        }
        return String(inp.value || '').trim() !== '';
    }

    function applySerialToStep(stepId, serial, note) {
        const inp = el('val_' + stepId);
        if (stepId === 3) {
            const display = el('wbCorrectorSerialDisplay');
            if (display) {
                display.value = serial;
            }
            window.__wbAssemblyCorrectorSerial = serial;
        }
        if (!inp || inp.disabled) {
            if (stepId === 3) {
                plog('п.3 ← ' + serial + (note ? ' (' + note + ')' : '') + ' (карточка сборки)');
                return;
            }
            throw new Error('Поле п.' + stepId + ' недоступно');
        }
        inp.value = formatStepValue(stepId, serial);
        plog('п.' + stepId + ' ← ' + serial + (note ? ' (' + note + ')' : ''));
    }

    async function confirmOverwrite(stepId) {
        if (!fieldHasValue(stepId)) {
            return true;
        }
        const cur = String(el('val_' + stepId).value || '').trim();
        return window.confirm('П.п.' + stepId + ' уже заполнен (' + cur + '). Выдать новый серийный номер?');
    }

    async function offerNameplatePrint(kind, serial) {
        const Nameplate = window.TM07_NAMEPLATE;
        if (!Nameplate || !serial || typeof Nameplate.printNameplate !== 'function') {
            return;
        }
        try {
            await Nameplate.printNameplate({ kind: kind, serial: serial });
            plog('PDF шильдик: ' + serial);
        } catch (e) {
            plog('Шильдик: ' + (e.message || String(e)));
        }
    }

    async function runAllocate(kind, stepId, opts) {
        const o = opts || {};
        const reg = R();
        if (!reg) {
            throw new Error('Нет модуля TM07_SERIAL_REGISTRY');
        }
        if (!o.force && !(await confirmOverwrite(stepId))) {
            return null;
        }
        let orderNumber = o.orderNumber || null;
        if (!orderNumber) {
            const events = window.TM07_BENCH_EVENTS;
            if (events && typeof events.getActiveOrderNumber === 'function') {
                orderNumber = events.getActiveOrderNumber();
            }
            if (!orderNumber) {
                const orderEl = el('paramOrder1cNumber');
                orderNumber = orderEl ? String(orderEl.value || '').trim() : null;
            }
        }
        const result = await reg.allocate(kind, { orderNumber: orderNumber || null });
        if (!result || !result.serial) {
            throw new Error('Реестр не вернул номер');
        }
        const v = reg.validateSerial(result.serial, new Date(), result.prefix);
        if (!v.ok) {
            throw new Error(v.error || 'Неверный формат номера');
        }
        applySerialToStep(stepId, result.serial, reg.describeKind(kind) + ', №' + String(result.seq).padStart(3, '0'));
        if (o.printNameplate !== false) {
            await offerNameplatePrint(kind, result.serial);
        }
        return result;
    }

    async function onPrintCorrector() {
        try {
            const serial = readVal(3) || (el('wbCorrectorSerialDisplay') || {}).value || '';
            await offerNameplatePrint(R().KIND.CORRECTOR, String(serial || '').trim());
        } catch (e) {
            setStatus(e.message || String(e), true);
        }
    }

    async function onPrintComplex() {
        try {
            await offerNameplatePrint(R().KIND.COMPLEX, readVal(201));
        } catch (e) {
            setStatus(e.message || String(e), true);
        }
    }

    function readVal(stepId) {
        const inp = el('val_' + stepId);
        return inp ? String(inp.value || '').trim() : '';
    }

    async function onGenerateCorrector() {
        try {
            const result = await runAllocate(R().KIND.CORRECTOR, 3);
            if (!result) {
                return;
            }
            setStatus(
                'Корректор: ' +
                    result.serial +
                    ' (' +
                    result.fullYear +
                    '-' +
                    String(result.mm).padStart(2, '0') +
                    ', №' +
                    String(result.seq).padStart(3, '0') +
                    ', ' +
                    result.backend +
                    ')'
            );
        } catch (e) {
            setStatus(e.message || String(e), true);
        }
    }

    async function onGenerateComplex() {
        try {
            const result = await runAllocate(R().KIND.COMPLEX, 201);
            if (!result) {
                return;
            }
            setStatus(
                'Комплекс: ' +
                    result.serial +
                    ' (' +
                    result.fullYear +
                    '-' +
                    String(result.mm).padStart(2, '0') +
                    ', №' +
                    String(result.seq).padStart(3, '0') +
                    ', ' +
                    result.backend +
                    ')'
            );
        } catch (e) {
            setStatus(e.message || String(e), true);
        }
    }

    async function onGeneratePair() {
        try {
            const reg = R();
            const r1 = await runAllocate(reg.KIND.CORRECTOR, 3);
            const r2 = await runAllocate(reg.KIND.COMPLEX, 201);
            if (!r1 && !r2) {
                return;
            }
            const parts = [];
            if (r1) {
                parts.push('корр. ' + r1.serial);
            }
            if (r2) {
                parts.push('компл. ' + r2.serial);
            }
            setStatus(parts.join('; '));
        } catch (e) {
            setStatus(e.message || String(e), true);
        }
    }

    async function refreshPreview() {
        const reg = R();
        const hint = el('paramSerialRegistryHint');
        if (!reg || !hint) {
            return;
        }
        try {
            const c = await reg.peek(reg.KIND.CORRECTOR);
            const k = await reg.peek(reg.KIND.COMPLEX);
            hint.textContent =
                'Следующий: корректор ' +
                c.serial +
                ', комплекс ' +
                k.serial +
                ' (бэкенд: ' +
                reg.getBackend() +
                ')';
        } catch (e) {
            hint.textContent = e.message || String(e);
        }
    }

    function injectRowButton(stepId, kind, title) {
        const inp = el('val_' + stepId);
        if (!inp || inp.dataset.serialGenBtn) {
            return;
        }
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-outline-primary btn-sm mt-1 param-serial-gen-inline';
        btn.title = title;
        btn.textContent = 'Сгенерировать';
        btn.addEventListener('click', async function () {
            try {
                const reg = R();
                if (!reg) {
                    throw new Error('Нет TM07_SERIAL_REGISTRY');
                }
                const result = await runAllocate(kind, stepId);
                if (result) {
                    setStatus(reg.describeKind(kind) + ': ' + result.serial);
                    refreshPreview();
                }
            } catch (e) {
                setStatus(e.message || String(e), true);
            }
        });
        inp.insertAdjacentElement('afterend', btn);
        inp.dataset.serialGenBtn = '1';
    }

    function injectInlineButtons() {
        const reg = R();
        if (!reg) {
            return;
        }
        injectRowButton(3, reg.KIND.CORRECTOR, '300YYMMNNN — корректор');
        injectRowButton(201, reg.KIND.COMPLEX, '400YYMMNNN — комплекс');
    }

    function bindPanel() {
        el('paramSerialGenCorrector')?.addEventListener('click', async function () {
            await onGenerateCorrector();
            refreshPreview();
        });
        el('paramSerialGenComplex')?.addEventListener('click', async function () {
            await onGenerateComplex();
            refreshPreview();
        });
        el('paramSerialGenPair')?.addEventListener('click', async function () {
            await onGeneratePair();
            refreshPreview();
        });
        el('paramSerialPrintCorrector')?.addEventListener('click', onPrintCorrector);
        el('paramSerialPrintComplex')?.addEventListener('click', onPrintComplex);
        el('paramSerialRegistryRefresh')?.addEventListener('click', refreshPreview);
    }

    function whenTableReady(cb) {
        if (el('val_3')) {
            cb();
            return;
        }
        const obs = new MutationObserver(function () {
            if (el('val_3')) {
                obs.disconnect();
                cb();
            }
        });
        obs.observe(document.body, { childList: true, subtree: true });
    }

    /** Автовыдача S/N для п.201 (комплекс) без диалогов; корректор — на карточке сборки. */
    async function ensureSerialNumbersAuto(opts) {
        const o = opts || {};
        const reg = R();
        if (!reg) {
            return { corrector: null, complex: null };
        }
        let orderNumber = o.orderNumber || null;
        if (!orderNumber) {
            const events = window.TM07_BENCH_EVENTS;
            if (events && typeof events.getActiveOrderNumber === 'function') {
                orderNumber = events.getActiveOrderNumber();
            }
        }
        const out = { corrector: null, complex: null };
        const pairs = [{ kind: reg.KIND.COMPLEX, stepId: 201 }];
        if (o.includeCorrector) {
            pairs.unshift({ kind: reg.KIND.CORRECTOR, stepId: 3 });
        }
        for (const p of pairs) {
            const inp = el('val_' + p.stepId);
            if (!inp || inp.disabled || String(inp.value || '').trim()) {
                continue;
            }
            const result = await runAllocate(p.kind, p.stepId, {
                force: true,
                orderNumber: orderNumber,
                printNameplate: false,
            });
            if (result) {
                out[p.kind === reg.KIND.CORRECTOR ? 'corrector' : 'complex'] = result.serial;
            }
        }
        return out;
    }

    /** S/N корректора (п.3) для карточки сборки и шильда. */
    async function allocateCorrectorSerial(opts) {
        const reg = R();
        if (!reg) {
            return null;
        }
        const o = opts || {};
        let orderNumber = o.orderNumber || null;
        if (!orderNumber) {
            const events = window.TM07_BENCH_EVENTS;
            if (events && typeof events.getActiveOrderNumber === 'function') {
                orderNumber = events.getActiveOrderNumber();
            }
        }
        const inp = el('val_3');
        if (inp && !inp.disabled && String(inp.value || '').trim() && !o.force) {
            return { serial: String(inp.value).trim(), stepId: 3 };
        }
        if (o.force || !inp || inp.disabled) {
            return runAllocate(reg.KIND.CORRECTOR, 3, {
                force: true,
                orderNumber: orderNumber,
                printNameplate: o.printNameplate,
            });
        }
        return runAllocate(reg.KIND.CORRECTOR, 3, {
            force: !!o.force,
            orderNumber: orderNumber,
            printNameplate: o.printNameplate,
        });
    }

    window.TM07_SERIAL_REGISTRY_UI = {
        ensureSerialNumbersAuto: ensureSerialNumbersAuto,
        allocateCorrectorSerial: allocateCorrectorSerial,
        runAllocate: runAllocate,
        printNameplate: offerNameplatePrint,
    };

    function init() {
        if (!R()) {
            return;
        }
        bindPanel();
        whenTableReady(function () {
            injectInlineButtons();
            refreshPreview();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
