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

    function paintCorrectorSerialUi() {
        const Ops = window.TM07_WORKBENCH_OPS;
        if (Ops && typeof Ops.syncCorrectorVerifFieldsFromSteps === 'function') {
            Ops.syncCorrectorVerifFieldsFromSteps();
        } else if (Ops && typeof Ops.paintCorrectorVerifBadge === 'function') {
            Ops.paintCorrectorVerifBadge();
        }
        const wb = window.TM07_WORKBENCH;
        if (wb && typeof wb.paintAssemblyCard === 'function') {
            wb.paintAssemblyCard();
        }
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
                paintCorrectorSerialUi();
                plog('п.3 ← ' + serial + (note ? ' (' + note + ')' : '') + ' (карточка сборки)');
                return;
            }
            if (stepId === 201) {
                const ui = el('paramComplexSerial');
                if (ui) {
                    ui.value = serial;
                }
                const Ops = window.TM07_WORKBENCH_OPS;
                if (Ops && typeof Ops.applyComplexSerial === 'function') {
                    Ops.applyComplexSerial(serial);
                }
                plog('п.201 ← ' + serial + (note ? ' (' + note + ')' : '') + ' (карточка комплекса)');
                return;
            }
            throw new Error('Поле п.' + stepId + ' недоступно');
        }
        inp.value = formatStepValue(stepId, serial);
        plog('п.' + stepId + ' ← ' + serial + (note ? ' (' + note + ')' : ''));
        if (stepId === 201) {
            const ui = el('paramComplexSerial');
            if (ui) {
                ui.value = serial;
            }
            const Ops = window.TM07_WORKBENCH_OPS;
            if (Ops && typeof Ops.applyComplexSerial === 'function') {
                Ops.applyComplexSerial(serial);
            }
        }
        if (stepId === 3) {
            const display = el('wbCorrectorSerialDisplay');
            if (display) {
                display.value = serial;
            }
            window.__wbAssemblyCorrectorSerial = serial;
            paintCorrectorSerialUi();
        }
    }

    function collectXlsxMeta() {
        const meta = {
            execution: 'И1',
            productTitle: '',
            characteristics: '',
            customer: '',
            fwVersion: '',
        };
        try {
            const C = window.TM07_CORRECTOR_EXECUTION;
            const Ops = window.TM07_WORKBENCH_OPS;
            let text = '';
            if (Ops && typeof Ops.collectOrderTextBlob === 'function') {
                text = String(Ops.collectOrderTextBlob() || '');
            }
            if (C && typeof C.resolveCorrectorExecution === 'function') {
                const exec = C.resolveCorrectorExecution({ fullText: text });
                if (exec && exec.variant) {
                    meta.execution = exec.variant;
                }
            }
        } catch (_e) {}
        const titleEl = el('paramProductTitle');
        const charEl = el('paramCharacteristics');
        const custEl = el('paramCustomer');
        const fwEl = el('paramFwVersion');
        if (titleEl) meta.productTitle = String(titleEl.value || '').trim();
        if (charEl) meta.characteristics = String(charEl.value || '').trim();
        if (custEl) meta.customer = String(custEl.value || '').trim();
        if (fwEl) meta.fwVersion = String(fwEl.value || '').trim();
        const s3 = el('val_3');
        if (s3 && String(s3.value || '').trim()) {
            meta.serialCorrector = String(s3.value).trim();
        }
        const s201 = el('val_201');
        if (s201 && String(s201.value || '').trim()) {
            meta.serialComplex = String(s201.value).trim();
        }
        return meta;
    }

    async function confirmOverwrite(stepId) {
        if (!fieldHasValue(stepId)) {
            return true;
        }
        const cur = String(el('val_' + stepId).value || '').trim();
        plog('П.п.' + stepId + ' уже заполнен (' + cur + ') — выдаём новый номер.');
        return true;
    }

    async function offerNameplatePrint(kind, serial) {
        // Печать шильда временно отключена
        return;
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
        const result = await reg.allocate(kind, Object.assign(collectXlsxMeta(), {
            orderNumber: orderNumber || null,
        }));
        if (!result || !result.serial) {
            throw new Error('Реестр не вернул номер');
        }
        const v = reg.validateSerial(result.serial, new Date(), result.prefix, {
            allowAnyProductionMonth: !!result.reused,
        });
        if (!v.ok) {
            throw new Error(v.error || 'Неверный формат номера');
        }
        const reusedNote = result.reused
            ? 'заказ уже есть, номер из реестра'
            : '№' + String(result.seq).padStart(3, '0');
        applySerialToStep(stepId, result.serial, reg.describeKind(kind) + ', ' + reusedNote);
        if (stepId === 201) {
            const Ops = window.TM07_WORKBENCH_OPS;
            if (Ops && typeof Ops.applyComplexSerial === 'function') {
                Ops.applyComplexSerial(result.serial);
            } else {
                const ui = el('paramComplexSerial');
                if (ui) {
                    ui.value = result.serial;
                }
            }
        }
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

    function formatAllocateStatus(label, result) {
        if (!result) {
            return '';
        }
        if (result.reused) {
            const src = result.source === 'db' || result.source === 'db-next' ? 'БД' : 'реестр';
            return label + ': ' + result.serial + ' — уже выдан (' + src + '), новый не создавался';
        }
        return (
            label +
            ': ' +
            result.serial +
            ' (' +
            result.fullYear +
            '-' +
            String(result.mm).padStart(2, '0') +
            ', №' +
            String(result.seq).padStart(3, '0') +
            ', ' +
            (result.backend || '') +
            ')'
        );
    }

    async function onGenerateCorrector() {
        try {
            const result = await runAllocate(R().KIND.CORRECTOR, 3);
            if (!result) {
                return;
            }
            setStatus(formatAllocateStatus('Корректор', result));
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
            setStatus(formatAllocateStatus('Комплекс', result));
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
            let orderNumber = null;
            const events = window.TM07_BENCH_EVENTS;
            if (events && typeof events.getActiveOrderNumber === 'function') {
                orderNumber = events.getActiveOrderNumber();
            }
            if (!orderNumber) {
                const orderEl = el('paramOrder1cNumber');
                orderNumber = orderEl ? String(orderEl.value || '').trim() : null;
            }
            const peekOpts = { orderNumber: orderNumber || null };
            const c = await reg.peek(reg.KIND.CORRECTOR, peekOpts);
            const k = await reg.peek(reg.KIND.COMPLEX, peekOpts);
            if (c.reused || k.reused) {
                hint.textContent =
                    'Заказ уже в таблице: корректор ' +
                    c.serial +
                    (c.reused ? ' (есть)' : ' (новый)') +
                    ', комплекс ' +
                    k.serial +
                    (k.reused ? ' (есть)' : ' (новый)');
            } else {
                hint.textContent =
                    'Следующий: корректор ' +
                    c.serial +
                    ', комплекс ' +
                    k.serial +
                    ' (бэкенд: ' +
                    reg.getBackend() +
                    ')';
            }
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
                    setStatus(formatAllocateStatus(reg.describeKind(kind), result));
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

    /** Автоподстановка S/N корректора (п.3) и комплекса (п.201) по номеру заказа. */
    async function ensureOrderSerials(opts) {
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
            if (!orderNumber) {
                const orderEl = el('paramOrder1cNumber');
                orderNumber = orderEl ? String(orderEl.value || '').trim() : null;
            }
        }
        const out = { corrector: null, complex: null, correctorResult: null, complexResult: null };
        try {
            const corr = await runAllocate(reg.KIND.CORRECTOR, 3, {
                force: true,
                orderNumber: orderNumber,
                printNameplate: false,
            });
            if (corr && corr.serial) {
                out.corrector = corr.serial;
                out.correctorResult = corr;
            }
        } catch (e) {
            plog('S/N корректора: ' + (e.message || String(e)));
            throw e;
        }
        const Ops = window.TM07_WORKBENCH_OPS;
        const correctorOnly =
            Ops && typeof Ops.isComplexOrder === 'function' && !Ops.isComplexOrder();
        // Заказ только на корректор: п.201 = 0, номер 400… не выдаём.
        if (correctorOnly && o.includeComplex !== true) {
            if (typeof Ops.applyCorrectorOnlyComplexIdentity === 'function') {
                Ops.applyCorrectorOnlyComplexIdentity();
            } else if (typeof Ops.applyComplexSerial === 'function') {
                Ops.applyComplexSerial('0');
            } else {
                const inp = el('val_201');
                if (inp) {
                    inp.value = '0';
                }
                const card = el('paramComplexSerial');
                if (card) {
                    card.value = '0';
                }
            }
            out.complex = '0';
            refreshPreview();
            return out;
        }
        let needComplex = o.includeComplex !== false;
        if (!needComplex && orderNumber) {
            try {
                const peek = await reg.peek(reg.KIND.COMPLEX, { orderNumber: orderNumber });
                if (peek && peek.reused && peek.serial) {
                    needComplex = true;
                }
            } catch (_e) {}
        }
        if (needComplex) {
            try {
                const cx = await runAllocate(reg.KIND.COMPLEX, 201, {
                    force: true,
                    orderNumber: orderNumber,
                    printNameplate: false,
                });
                if (cx && cx.serial) {
                    out.complex = cx.serial;
                    out.complexResult = cx;
                }
            } catch (e) {
                plog('S/N комплекса: ' + (e.message || String(e)));
            }
        }
        refreshPreview();
        return out;
    }

    async function ensureSerialNumbersAuto(opts) {
        return ensureOrderSerials(opts || {});
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
        if (inp && !inp.disabled && String(inp.value || '').trim() && !o.force && !orderNumber) {
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
        ensureOrderSerials: ensureOrderSerials,
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
