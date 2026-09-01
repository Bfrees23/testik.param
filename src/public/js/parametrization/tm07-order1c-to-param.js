/**
 * Подстановка реквизитов из строки заказа 1С (OData) в поля val_* на странице параметризации.
 * Сопоставление по шаблонам имён полей: правьте window.TM07_ORDER1C_KEY_RULES под свою публикацию 1С.
 * Зависимости: window.Order1cOdata (order-1c-odata.js), sessionStorage key order1c_param_lastOrder.
 */
(function () {
    'use strict';

    const STORAGE_LAST = 'order1c_param_lastOrder';
    const ODATA_BASE_LS = 'order1c_odataBase';

    function persistOrderCache(payload) {
        const json = JSON.stringify(payload);
        try {
            sessionStorage.setItem(STORAGE_LAST, json);
        } catch (_e) {}
        try {
            localStorage.setItem(STORAGE_LAST, json);
        } catch (_e) {}
        if (window.TM07_WORKBENCH_STATE && typeof window.TM07_WORKBENCH_STATE.save === 'function') {
            window.TM07_WORKBENCH_STATE.save();
        }
    }

    function readOrderCacheRaw() {
        try {
            return sessionStorage.getItem(STORAGE_LAST) || localStorage.getItem(STORAGE_LAST);
        } catch (_e) {
            return null;
        }
    }

    function isScalarOdata(v) {
        if (v === null || v === undefined) {
            return false;
        }
        if (Array.isArray(v)) {
            return false;
        }
        return typeof v !== 'object' || v instanceof String || v instanceof Number;
    }

    function fmtNum(v) {
        const s = String(v)
            .replace(/\s/g, '')
            .replace(/,/g, '.');
        const n = parseFloat(s);
        if (!Number.isFinite(n)) {
            return String(v);
        }
        if (Number.isInteger(n) && Math.abs(n) >= 100000) {
            return String(Math.trunc(n));
        }
        return n.toFixed(2);
    }

    function fmtSerial10(v) {
        const d = String(v).replace(/\D/g, '');
        if (!d) {
            return null;
        }
        if (d.length >= 10) {
            return d.slice(-10);
        }
        if (d.length < 1) {
            return null;
        }
        return d.padStart(10, '0');
    }

    function fmtC32(v) {
        return String(v).replace(/\0/g, ' ').trim().slice(0, 32);
    }

    function fmtChr30(v) {
        return fmtC32(v).slice(0, 30);
    }

    /** Из «Комплекс промышленного учета газа ПК-ТМ-Р1.БТ (…)» → «ПК-ТМ-Р1.БТ» для п.200. */
    function extractComplexDesignation(fullName) {
        let s = String(fullName || '').replace(/\s+/g, ' ').trim();
        const prefixRe = /комплекс\s+промышленного\s+учета\s+газа\s*/i;
        const pm = s.match(prefixRe);
        if (pm) {
            s = s.slice(pm.index + pm[0].length).trim();
        }
        const paren = s.indexOf('(');
        if (paren >= 0) {
            s = s.slice(0, paren).trim();
        }
        const token = (s.split(/\s+/).find((t) => t.length > 0) || s).trim();
        return fmtChr30(token);
    }

    function normalizeComplexDesignationKey(designation) {
        return String(designation || '')
            .trim()
            .toUpperCase()
            .replace(/\s+/g, '')
            .replace(/\.БТ$/, '');
    }

    /**
     * Счётчик по типу комплекса (п.200 → п.100).
     * Доп. типы: window.TM07_COMPLEX_METER_MAP = { 'ПК-ТМ-Р7': { meterName: '…', … } }.
     */
    var DEFAULT_COMPLEX_METER_MAP = {
        'ПК-ТМ-Р1': {
            meterName: 'ЭМИС-РГС-245',
            kind: 'rotational',
            passport: 'emis-rgs245',
            description: 'ротационного счетчика ЭМИС-РГС-245 с корректором объема газа ТМ-07',
        },
        /*
        'ПК-ТМ-Р2': {
            meterName: 'ПРОМЕТР-Р',
            kind: 'rotational',
            passport: 'prometr-r',
            description: 'ротационного счетчика ПРОМЕТР-Р с корректором объема газа ТМ-07',
        },
        */
        'ПК-ТМ-Р3': {
            meterName: 'RABO',
            kind: 'rotational',
            passport: 'rvg-bc',
            description: 'ротационного счетчика RABO (Раско) с корректором объема газа ТМ-07',
        },
        'ПК-ТМ-Р4': {
            meterName: 'РВГ (исп.А)',
            kind: 'rotational',
            passport: 'rvg-a',
            description: 'ротационного счетчика РВГ (исп.А, УРГП) с корректором объема газа ТМ-07',
        },
        'ПК-ТМ-Р5': {
            meterName: 'РВГ (исп.Б)',
            kind: 'rotational',
            passport: 'rvg-b',
            description: 'ротационного счетчика РВГ (исп.Б, УРГП) с корректором объема газа ТМ-07',
        },
        'ПК-ТМ-Р6': {
            meterName: 'СГР',
            kind: 'rotational',
            passport: 'sgr',
            description: 'ротационного счетчика газа СГР с корректором объема газа ТМ-07',
        },
        'ПК-ТМ-Т1': {
            meterName: 'СГ',
            kind: 'turbine',
            passport: 'sg',
            description: 'турбинного счетчика СГ с корректором объема газа ТМ-07',
        },
        'ПК-ТМ-Т2': {
            meterName: 'ТАУ-ТСГ',
            kind: 'turbine',
            passport: 'tau-tsg',
            description: 'турбинного счетчика ТАУ-ТСГ с корректором объема газа ТМ-07',
        },
    };

    function getComplexMeterMap() {
        const extra = window.TM07_COMPLEX_METER_MAP;
        if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
            return Object.assign({}, DEFAULT_COMPLEX_METER_MAP, extra);
        }
        return DEFAULT_COMPLEX_METER_MAP;
    }

    function resolveMeterByComplexDesignation(designation) {
        const key = normalizeComplexDesignationKey(designation);
        if (!key) {
            return null;
        }
        const map = getComplexMeterMap();
        return map[key] || null;
    }

    function applyMeterNameByComplexDesignation(complexDesignation, lines) {
        const profile = resolveMeterByComplexDesignation(complexDesignation);
        if (!profile || !profile.meterName) {
            return false;
        }
        // В прибор (п.100) — без «(исп.А)» / «(исп. Б,К)» и т.п.
        const name = String(profile.meterName)
            .replace(/\s*\([^)]*\)\s*/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        return setMeterStepInput(100, name, lines, 'наименование счётчика из комплекса');
    }

    function parseDnToken(s) {
        const m = String(s || '').trim().match(/^DN\s*(\d+)$/i);
        return m ? m[1] : null;
    }

    function parseTurndownSuffix(s) {
        const m = String(s || '').match(/\(\s*1\s*:\s*(\d+)\s*\)/i);
        return m ? parseInt(m[1], 10) : null;
    }

    /**
     * Компактная спецификация счётчика: DN50;0,5-100 (1:200).
     * @returns {{du:number,qmin:number|null,qmax:number|null,turndown:number|null}|null}
     */
    function parseCompactMeterOrderHints(text) {
        const src = String(text || '');
        const re = /DN\s*(\d+)\s*;\s*(\d+(?:[.,]\d+)?)\s*-\s*(\d+(?:[.,]\d+)?)(?:\s*\(\s*1\s*:\s*(\d+)\s*\))?/gi;
        let best = null;
        let m;
        while ((m = re.exec(src)) !== null) {
            const item = {
                du: parseInt(m[1], 10),
                qmin: parseFloat(String(m[2]).replace(',', '.')),
                qmax: parseFloat(String(m[3]).replace(',', '.')),
                turndown: m[4] ? parseInt(m[4], 10) : null,
            };
            if (!best || item.turndown != null) {
                best = item;
            }
        }
        return best;
    }

    /** DN, Qmin/Qmax, turndown (1:N), код G… из полного наименования заказа и полей row. */
    function extractOrderMeterHints(row, primaryFullName) {
        const texts = [];
        if (primaryFullName) {
            texts.push(String(primaryFullName));
        }
        if (row && typeof row === 'object') {
            Object.keys(row).forEach(function (k) {
                const v = row[k];
                if (typeof v === 'string' && v.trim()) {
                    texts.push(v);
                }
            });
        }
        const joined = texts.join(' ');
        const hints = { du: null, qmin: null, qmax: null, turndown: null, typeCode: null, typeCodeOrder: null };

        const compact = parseCompactMeterOrderHints(joined);
        if (compact) {
            hints.du = compact.du;
            hints.qmin = compact.qmin;
            hints.qmax = compact.qmax;
            hints.turndown = compact.turndown;
        }

        if (hints.du == null) {
            const dnM = joined.match(/\bDN\s*(\d+)\b/i);
            if (dnM) {
                hints.du = parseInt(dnM[1], 10);
            }
        }
        if (hints.qmin == null || hints.qmax == null) {
            const qM = joined.match(/(\d+(?:[.,]\d+)?)\s*-\s*(\d+(?:[.,]\d+)?)(?:\s*\(\s*1\s*:\s*(\d+)\s*\))?/);
            if (qM) {
                const qmin = parseFloat(String(qM[1]).replace(',', '.'));
                const qmax = parseFloat(String(qM[2]).replace(',', '.'));
                // Отсечь диапазоны давления в кПа (напр. 0–7500 / 100–1600), не расход.
                if (Number.isFinite(qmin) && Number.isFinite(qmax) && isPlausibleFlowRange(qmin, qmax)) {
                    hints.qmin = qmin;
                    hints.qmax = qmax;
                }
            }
        }
        if (hints.turndown == null) {
            hints.turndown = parseTurndownSuffix(joined);
        }

        const gCodes = joined.match(/\bG\d{2,4}(?:-\d{2,3})?\b/gi);
        if (gCodes && gCodes.length) {
            const orderG = gCodes[0].toUpperCase();
            hints.typeCodeOrder = orderG;
            // Для подбора типоразмера оставляем полный код (G400-100); DN из суффикса.
            hints.typeCode = orderG;
            const C = window.TM07_COMPLEX_METER_TYPES;
            const parsed =
                C && typeof C.parseGOrderTypeCode === 'function'
                    ? C.parseGOrderTypeCode(orderG)
                    : null;
            if (parsed && parsed.du != null && hints.du == null) {
                hints.du = parsed.du;
            }
        }
        const t1m = joined.match(/ПК-ТМ-Т1-(\d+)/i);
        if (t1m) {
            hints.typeCode = 'T1-' + t1m[1];
        }
        const duComplex = document.getElementById('val_204');
        if (!hints.du && duComplex && duComplex.value) {
            const d = parseInt(String(duComplex.value).trim(), 10);
            if (Number.isFinite(d)) {
                hints.du = d;
            }
        }
        const qmaxMeter = document.getElementById('val_111');
        const qmaxMain = document.getElementById('val_29');
        if (!hints.qmax && qmaxMeter && qmaxMeter.value) {
            const q = parseFloat(String(qmaxMeter.value).replace(',', '.'));
            if (Number.isFinite(q)) {
                hints.qmax = q;
            }
        }
        if (!hints.qmax && qmaxMain && qmaxMain.value) {
            const q = parseFloat(String(qmaxMain.value).replace(',', '.'));
            if (Number.isFinite(q)) {
                hints.qmax = q;
            }
        }
        return hints;
    }

    function setMeterStepInput(stepId, value, lines, note) {
        const inp = document.getElementById('val_' + stepId);
        if (!inp || inp.disabled || value == null || value === '') {
            return false;
        }
        inp.value = window.TM07_param_formatStepValue
            ? window.TM07_param_formatStepValue(stepId, value)
            : String(value);
        lines.push('п.' + stepId + ' ← ' + note);
        return true;
    }

    /** Подпись под полем (например полный G400-100 из заказа при п.101 = G400). */
    function setStepFieldHint(stepId, text) {
        const inp = document.getElementById('val_' + stepId);
        if (!inp) {
            return;
        }
        let hint = document.getElementById('valhint_' + stepId);
        if (!hint) {
            hint = document.createElement('div');
            hint.id = 'valhint_' + stepId;
            hint.className = 'small text-body-secondary mt-1 param-order-hint';
            inp.insertAdjacentElement('afterend', hint);
        }
        const t = String(text || '').trim();
        hint.textContent = t;
        hint.classList.toggle('d-none', !t);
    }

    function setMeterStepInputIfEmpty(stepId, value, lines, note) {
        const inp = document.getElementById('val_' + stepId);
        if (!inp || inp.disabled || String(inp.value || '').trim() !== '') {
            return false;
        }
        return setMeterStepInput(stepId, value, lines, note);
    }

    /** Реальные маски И1…И4 — в поля финальной секции (val_final_*). */
    function setFinalMaskInput(stepId, value, lines, note) {
        const inp = document.getElementById('val_final_' + stepId);
        if (!inp || inp.disabled || value == null || value === '') {
            return false;
        }
        inp.value = window.TM07_param_formatStepValue
            ? window.TM07_param_formatStepValue(stepId, value)
            : String(value);
        lines.push('п.' + stepId + ' (финал) ← ' + note);
        return true;
    }

    function resolveMeterPassport(profile, row, primaryFullName) {
        if (!profile || !profile.passport) {
            return null;
        }
        if (profile.passport !== 'tau-tsg') {
            return profile.passport;
        }
        const text = collectOrderTextBlob(row, primaryFullName);
        if (/исп\.?\s*[«"]?\s*Б\s*[»"]?/i.test(text) || /\bТАУ-ТСГ\s*Б\b/i.test(text)) {
            return 'tau-tsg-b';
        }
        return 'tau-tsg-a';
    }

    /** Табл. 2–10: типоразмер счётчика → п.100–118 (кроме серийника, дат, объёма). */
    function applyComplexMeterTypeParams(row, primaryFullName, complexDesignation, lines) {
        const C = window.TM07_COMPLEX_METER_TYPES;
        const profile = resolveMeterByComplexDesignation(complexDesignation);
        const passport = resolveMeterPassport(profile, row, primaryFullName);
        if (!C || !profile || !passport) {
            return 0;
        }
        const hints = extractOrderMeterHints(row, primaryFullName);
        const type = C.resolveType(passport, {
            du: hints.du,
            qmin: hints.qmin,
            qmax: hints.qmax,
            turndown: hints.turndown,
            typeCode: hints.typeCode,
        });
        const label = C.familyLabel(passport);
        if (!type) {
            if (hints.du != null) {
                lines.push(label + ': не найден типоразмер для DN=' + hints.du);
            }
            return 0;
        }
        const vals = C.meterStepValues(passport, type);
        // п.101 в прибор — G400; полный код заказа (G400-100) — под полем.
        const orderTypeLabel =
            hints.typeCodeOrder || hints.typeCode || type.code || '';
        if (C.deviceTypeCodeForStep101) {
            vals[101] = C.deviceTypeCodeForStep101(hints.typeCodeOrder || type);
        }
        let n = 0;
        Object.keys(vals).forEach(function (sidStr) {
            const sid = parseInt(sidStr, 10);
            const note =
                sid === 101 && orderTypeLabel && vals[101] !== orderTypeLabel
                    ? label + ' ' + vals[101] + ' (заказ ' + orderTypeLabel + ')'
                    : label + ' ' + type.code;
            if (setMeterStepInput(sid, vals[sidStr], lines, note)) {
                n += 1;
            }
        });
        if (orderTypeLabel) {
            setStepFieldHint(101, 'из заказа: ' + orderTypeLabel);
        }
        // Пороги расхода корректора (п.28/29 → 30–33) = Qmin/Qmax типоразмера.
        if (type.qmin != null) {
            const qmin = f2Meter(type.qmin);
            if (setMeterStepInput(28, qmin, lines, label + ' Qmin→п.28')) {
                n += 1;
            }
            if (setMeterStepInput(30, qmin, lines, label + ' Qmin→п.30')) {
                n += 1;
            }
            if (setMeterStepInput(32, qmin, lines, label + ' Qmin→п.32')) {
                n += 1;
            }
        }
        if (type.qmax != null) {
            const qmax = f2Meter(type.qmax);
            if (setMeterStepInput(29, qmax, lines, label + ' Qmax→п.29')) {
                n += 1;
            }
            if (setMeterStepInput(31, qmax, lines, label + ' Qmax→п.31')) {
                n += 1;
            }
            if (setMeterStepInput(33, qmax, lines, label + ' Qmax→п.33')) {
                n += 1;
            }
        }
        if (n) {
            const spec = [
                'Du=' + type.du,
                hints.qmin != null && hints.qmax != null
                    ? 'Q ' + hints.qmin + '–' + hints.qmax
                    : 'Q ' + type.qmin + '–' + type.qmax,
                hints.turndown != null ? '1:' + hints.turndown : null,
                orderTypeLabel ? 'заказ ' + orderTypeLabel : null,
            ]
                .filter(Boolean)
                .join(', ');
            lines.push(label + ': типоразмер ' + (vals[101] || type.code) + ' (' + spec + ')');
        }
        return n;
    }

    function f2Meter(n) {
        const x = Number(n);
        if (!Number.isFinite(x)) {
            return String(n);
        }
        return (Math.round(x * 100) / 100).toFixed(2);
    }

    /** @deprecated используйте applyComplexMeterTypeParams */
    function applyEmisRgs245MeterParams(row, primaryFullName, complexDesignation, lines) {
        return applyComplexMeterTypeParams(row, primaryFullName, complexDesignation, lines);
    }

    function collectOrderTextBlob(row, primaryFullName) {
        const parts = [];
        if (primaryFullName) {
            parts.push(String(primaryFullName));
        }
        if (row && typeof row === 'object') {
            Object.keys(row).forEach(function (k) {
                const v = row[k];
                if (typeof v === 'string' && v.trim()) {
                    parts.push(v);
                }
            });
        }
        return parts.join(' ');
    }

    /** БТ1/2/3 из обозначения комплекса → наименование блока телеметрии (п.227). */
    const BT_BLOCK_NAMES = {
        БТ1: 'БПЭК-02/ЦК',
        БТ2: 'БПЭК-04/ЦК',
        БТ3: 'БПЭК-05/ЦК',
    };
    const TELEMETRY_NAME_DEFAULT = 'TM-02/ТМ';

    function resolveTelemetryBlockNameForOrder(row, primaryFullName) {
        const Ops = window.TM07_WORKBENCH_OPS;
        if (Ops && typeof Ops.resolveTelemetryBlockName === 'function') {
            try {
                const fromOps = Ops.resolveTelemetryBlockName();
                if (fromOps) {
                    return fromOps;
                }
            } catch (_e) {}
        }
        const blobs = [];
        const v200 = document.getElementById('val_200');
        if (v200 && String(v200.value || '').trim()) {
            blobs.push(String(v200.value).trim());
        }
        blobs.push(collectOrderTextBlob(row, primaryFullName));
        // Не используем \b — в JS граница слова не работает с кириллицей.
        const text = blobs.join(' ').toUpperCase().replace(/Ё/g, 'Е');
        const btNum = text.match(/(?:^|[^0-9A-ZА-Я])БТ\s*([123])(?![0-9])/);
        if (btNum) {
            return BT_BLOCK_NAMES['БТ' + btNum[1]];
        }
        if (/\.БТ(?:\s|$|[(),;])|(?:^|[^0-9A-ZА-Я])БТ(?:\s|$|[(),;])/.test(text)) {
            return BT_BLOCK_NAMES.БТ1;
        }
        return TELEMETRY_NAME_DEFAULT;
    }

    /** Табл. 15 → п.119/120/219/220; п.225/226 = 119+0.1 / 120+0.1. */
    function applyVolumeErrorLimitsToInputs(row, primaryFullName, complexDesignation, lines) {
        const L = window.TM07_VOLUME_ERROR_LIMITS;
        if (!L) {
            return 0;
        }
        const complexInp = document.getElementById('val_200');
        const design =
            complexDesignation ||
            (complexInp && complexInp.value ? String(complexInp.value).trim() : '');
        if (!design) {
            return 0;
        }
        const textBlob = collectOrderTextBlob(row, primaryFullName);
        const hints = extractOrderMeterHints(row, primaryFullName);
        const profile = resolveMeterByComplexDesignation(design);
        const typeInp = document.getElementById('val_101');
        const qmaxInp = document.getElementById('val_111');
        let typeCode =
            hints.typeCode || (typeInp && typeInp.value ? String(typeInp.value).trim() : null);
        let qmax = hints.qmax;
        if (!qmax && qmaxInp && qmaxInp.value) {
            const q = parseFloat(String(qmaxInp.value).replace(',', '.'));
            if (Number.isFinite(q)) {
                qmax = q;
            }
        }
        const passport = resolveMeterPassport(profile, row, primaryFullName);
        if (!typeCode && window.TM07_COMPLEX_METER_TYPES) {
            if (passport) {
                const meterType = window.TM07_COMPLEX_METER_TYPES.resolveType(passport, {
                    du: hints.du,
                    qmin: hints.qmin,
                    qmax: qmax,
                    turndown: hints.turndown,
                    typeCode: hints.typeCode,
                });
                if (meterType && meterType.code) {
                    typeCode = meterType.code;
                }
            }
        }
        let fullText = textBlob;
        if (profile && profile.meterName) {
            fullText += ' ' + String(profile.meterName);
        }
        const modification = L.extractModification(fullText);
        const resolved = L.resolveVolumeErrors({
            complexDesignation: design,
            modification: modification,
            typeCode: typeCode,
            qmax: qmax,
            fullText: fullText,
        });
        if (!resolved || !resolved.steps) {
            const ck = L.normalizeComplexKey(design);
            const allowed = L.COMPLEX_MODS && L.COMPLEX_MODS[ck];
            if (allowed) {
                lines.push(
                    'Табл.15/16: не удалось подобрать погрешности для ' +
                        ck +
                        (modification ? ' (мод.' + modification + ')' : ' (модификация не найдена)')
                );
            }
            return 0;
        }
        let n = 0;
        const modLabel = resolved.modification;
        const suffix = resolved.ruleNote ? ' (' + resolved.ruleNote + ')' : '';
        Object.keys(resolved.steps).forEach(function (sidStr) {
            const sid = parseInt(sidStr, 10);
            const tbl = resolved.tableByStep && resolved.tableByStep[sid] === 16 ? '16' : '15';
            const note =
                'табл.' + tbl + ' ' + resolved.complexKey + ', мод.' + modLabel + suffix;
            if (setMeterStepInput(sid, resolved.steps[sidStr], lines, note)) {
                n += 1;
            }
        });
        // Паспорт счётчика: п.119/120; затем п.225/226 = 119/120 + 0.1.
        const C = window.TM07_COMPLEX_METER_TYPES;
        const volOv =
            passport && C && typeof C.volumeErrorOverrideForPassport === 'function'
                ? C.volumeErrorOverrideForPassport(passport)
                : null;
        if (volOv && volOv.meter) {
            if (
                setMeterStepInput(
                    119,
                    String(volOv.meter.qminQt),
                    lines,
                    'паспорт счётчика (п.119)'
                )
            ) {
                n += 1;
            }
            if (
                setMeterStepInput(
                    120,
                    String(volOv.meter.qtQmax),
                    lines,
                    'паспорт счётчика (п.120)'
                )
            ) {
                n += 1;
            }
        }
        const v119 = document.getElementById('val_119');
        const v120 = document.getElementById('val_120');
        const std =
            L.standardStepsFromWorking &&
            L.standardStepsFromWorking(
                v119 && v119.value,
                v120 && v120.value
            );
        if (std) {
            if (setMeterStepInput(225, std[225], lines, 'п.225 = п.119+0.1')) {
                n += 1;
            }
            if (setMeterStepInput(226, std[226], lines, 'п.226 = п.120+0.1')) {
                n += 1;
            }
        }
        return n;
    }

    /** Строка заказа из session/localStorage (после loadAndApplyOrder). */
    function readCachedOrderRow() {
        try {
            const raw = readOrderCacheRaw();
            if (!raw) {
                return null;
            }
            const o = JSON.parse(raw);
            return o && o.row && typeof o.row === 'object' ? o.row : null;
        } catch (_e) {
            return null;
        }
    }

    /**
     * Текст заказа для detectEquipment / масок.
     * Если row пустой (как после QR), берём кэш 1С — иначе п.63/67/77 сбрасываются в «И1».
     */
    function resolveOrderTextForAutoFill(row, primaryFullName) {
        let textBlob = collectOrderTextBlob(row, primaryFullName);
        if (textBlob && String(textBlob).trim()) {
            return textBlob;
        }
        const cached = readCachedOrderRow();
        if (cached) {
            textBlob = collectOrderTextBlob(cached, primaryFullName);
            if (textBlob && String(textBlob).trim()) {
                return textBlob;
            }
        }
        const Ops = window.TM07_WORKBENCH_OPS;
        if (Ops && typeof Ops.collectOrderTextBlob === 'function') {
            try {
                const fromOps = Ops.collectOrderTextBlob();
                if (fromOps && String(fromOps).trim()) {
                    return fromOps;
                }
            } catch (_e) {}
        }
        return textBlob || '';
    }

    /** Полное автозаполнение по «Параметризация (1)» + зеркало комплекса. */
    // Маски в параметризации всегда staging 0/0/3/3/0; реальные И1…И4 — в финальную секцию.
    const MASK_STAGING_AUTOFILL = { 71: '0', 72: '0', 74: '3', 75: '3', 77: '0' };

    function applyParamAutoFillToInputs(row, primaryFullName, complexDesignation, lines) {
        const A = window.TM07_PARAM_AUTO_FILL;
        if (!A) {
            return 0;
        }
        const textBlob = resolveOrderTextForAutoFill(row, primaryFullName);
        const resolved = A.resolveParamAutoFill({
            fullText: textBlob,
            complexDesignation: complexDesignation,
        });
        if (!resolved || !resolved.steps) {
            return 0;
        }
        const alwaysSet = {
            // Tmin/Tmax корректора — всегда −40…+60 (не из ПТГ заказа / счётчика).
            8: 1,
            9: 1,
            // Плотность газа — всегда 0.70 (перекрывает значение из заказа 1С).
            22: 1,
            17: 1,
            25: 1,
            27: 1,
            40: 1,
            41: 1,
            42: 1,
            43: 1,
            44: 1,
            45: 1,
            47: 1,
            49: 1,
            27: 1,
            28: 1,
            29: 1,
            30: 1,
            31: 1,
            32: 1,
            33: 1,
            54: 1,
            63: 1,
            67: 1,
            18: 1,
            100: 1,
            107: 1,
            73: 1,
            76: 1,
            78: 1,
            79: 1,
            204: 1,
            205: 1,
            206: 1,
            207: 1,
            208: 1,
            209: 1,
            210: 1,
            211: 1,
            212: 1,
            213: 1,
            214: 1,
            215: 1,
            216: 1,
            217: 1,
            218: 1,
            221: 1,
            222: 1,
            223: 1,
            224: 1,
            // Финал: моточасы/очистка (маски 71/72/74/75/77 обрабатываются отдельно)
            298: 1,
            299: 1,
            302: 1,
            303: 1,
            304: 1,
            305: 1,
            306: 1,
            307: 1,
            308: 1,
            316: 1,
            318: 1,
            319: 1,
            320: 1,
            322: 1,
        };
        let n = 0;
        Object.keys(resolved.steps).forEach(function (sidStr) {
            const sid = parseInt(sidStr, 10);
            const note = resolved.notes[sid] || 'автозаполнение';
            const val = resolved.steps[sidStr];
            if (MASK_STAGING_AUTOFILL[sid] != null) {
                // Маски: в полях параметризации — staging 0/0/3/3/0,
                // реальные И1…И4 (из исполнения) — в финальную секцию (val_final_*).
                if (setMeterStepInput(sid, MASK_STAGING_AUTOFILL[sid], lines, 'staging 0/0/3/3/0 (реальные И1…И4 — в финале)')) {
                    n += 1;
                }
                if (val != null && val !== '' && setFinalMaskInput(sid, val, lines, note)) {
                    n += 1;
                }
                return;
            }
            const setter = alwaysSet[sid] ? setMeterStepInput : setMeterStepInputIfEmpty;
            if (setter(sid, val, lines, note)) {
                n += 1;
            }
        });
        // п.100 — наименование счётчика из типа комплекса (всегда, если ПК-ТМ).
        if (complexDesignation && applyMeterNameByComplexDesignation(complexDesignation, lines)) {
            n += 1;
        }
        // П.298/299 — всегда копия дат комплекса после их подстановки.
        [
            [298, 202],
            [299, 203],
        ].forEach(function (pair) {
            const dstId = pair[0];
            const srcId = pair[1];
            const src = document.getElementById('val_' + srcId);
            const v = src ? String(src.value || '').trim() : '';
            if (v && setMeterStepInput(dstId, v, lines, '= п.' + srcId)) {
                n += 1;
            }
        });
        const E = window.TM07_CORRECTOR_ERROR_LIMITS;
        if (E) {
            const vst = E.recomputeDeltaVstOnForm();
            if (vst != null && setMeterStepInput(17, vst, lines, '√(δ.P²+δ.T²+δ.K²)')) {
                n += 1;
            }
        }
        // Бейджи «исполнение Иn» (п.71/72/74/75/77) строятся до загрузки заказа —
        // после автозаполнения пересчитываем их по тексту заказа.
        const C = window.TM07_CORRECTOR_EXECUTION;
        if (C && typeof C.refreshMaskExecutionBadges === 'function') {
            try {
                C.refreshMaskExecutionBadges(textBlob);
            } catch (_eBadge) {}
        }
        if (n) {
            lines.push('Автозаполнение параметров: ' + n + ' п.');
        }
        return n;
    }

    /** @deprecated — используйте applyParamAutoFillToInputs */
    function applyCorrectorErrorLimitsToInputs(row, primaryFullName, complexDesignation, lines) {
        return applyParamAutoFillToInputs(row, primaryFullName, complexDesignation, lines);
    }

    /** @deprecated — используйте applyParamAutoFillToInputs */
    function applyCorrectorExecutionToInputs(row, primaryFullName, complexDesignation, lines) {
        return 0;
    }

    function fmtU16ish(v) {
        const t = String(v).replace(/\s/g, '').replace(/,/g, '.');
        const n = Math.round(parseFloat(t));
        if (Number.isFinite(n) && n >= 0 && n <= 0xffff) {
            return String(n);
        }
        const s = t.replace(/[^\d]/g, '');
        if (s) {
            return s.slice(0, 5);
        }
        return t;
    }

    function fmtUnixish(v) {
        const s = String(v).trim();
        if (!s) {
            return null;
        }
        if (/^\d{10,13}$/.test(s)) {
            return s.length > 10 ? s.slice(0, 10) : s;
        }
        if (/^0x[0-9a-f]+$/i.test(s)) {
            return String(parseInt(s, 16));
        }
        const t = Date.parse(s);
        if (Number.isFinite(t)) {
            return String(Math.floor(t / 1000));
        }
        return null;
    }

    function fmtTDate(v) {
        const s = String(v ?? '').trim();
        if (!s) {
            return null;
        }
        const m = s.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/);
        if (m) {
            const day = String(parseInt(m[1], 10)).padStart(2, '0');
            const month = String(parseInt(m[2], 10)).padStart(2, '0');
            return day + '.' + month + '.' + m[3];
        }
        const t = Date.parse(s);
        if (Number.isFinite(t)) {
            const d = new Date(t);
            return (
                String(d.getDate()).padStart(2, '0') +
                '.' +
                String(d.getMonth() + 1).padStart(2, '0') +
                '.' +
                d.getFullYear()
            );
        }
        return null;
    }

    function fmtMeterSerial(v) {
        const s = String(v ?? '').replace(/\D/g, '');
        return s || null;
    }

    function fmtTelemetrySerial(v) {
        const s = String(v ?? '').replace(/\D/g, '');
        return s || null;
    }

    var DEFAULT_RULES = [
        {
            id: 3,
            keyRe:
                /(Serial.*[Kk]orr|Serial.*Kор|Серийн.*(коррект|Kор|кор|300)|^REG_SERIAL$|300\d{7,}|Номер(К|к)оррект|Корректора$|Kорректора(?!.*пл)|S\/N.*кор)/i,
            format: (v) => fmtSerial10(v)
        },
        { id: 6, keyRe: /(^P_?min$|Pmin(?!ax)|^Pmin[,_]|Min.*(абс|давл)|^Мин(имал)?.*(абс|P)(?!ax)|Pabs.*min)/i, format: (v) => fmtNum(v) },
        { id: 7, keyRe: /(P_?maks|Pmax|Max.*(абс|давл)|^Макс(имал)?.*(абс|давл)|Pabs.*max|абс\.\s*P.*макс)/i, format: (v) => fmtNum(v) },
        { id: 8, keyRe: /(T_?min|Tgas.*min|темп.*(газ|G).*мин|Тмин(?!\.П)|Tmin(?!a))/i, format: (v) => fmtNum(v) },
        { id: 9, keyRe: /(T_?maks|Tmax|Tgas.*max|темп.*(газ|G).*(макс|max)|Тмакс(?!\.П))/i, format: (v) => fmtNum(v) },
        { id: 10, keyRe: /(dP_?min|DPmin|ΔPmin|DeltaPmin|Min.*(перепад|dP|Δ)|переп.*мин)/i, format: (v) => fmtNum(v) },
        { id: 11, keyRe: /(dP_?maks|DPmax|ΔPmax|DeltaPmax|Max.*(перепад|dP|Δ)|переп.*макс)/i, format: (v) => fmtNum(v) },
        { id: 12, keyRe: /(T2min|Т2(мин|min)|Ttech.*min|тех(н)?\.?\s*пр(оц)?.*(мин|low))/i, format: (v) => fmtNum(v) },
        { id: 13, keyRe: /(T2max|Т2(макс|max)|Ttech.*max|тех(н)?\.?\s*пр(оц)?.*(макс|high))/i, format: (v) => fmtNum(v) },
        { id: 14, keyRe: /(delta\s*P|d\.?\s*P|δ\.?\s*P|погрешн.*P(?!2)|dP(огр)?$)/i, format: (v) => fmtNum(v) },
        { id: 15, keyRe: /(δ\.?\s*T|d\.?\s*T(?!2)|погрешн.*T(?!2)|Err\.?\s*T(?!2))/i, format: (v) => fmtNum(v) },
        { id: 16, keyRe: /(δ\.?\s*K|Kст|K_?ст|d\.?\s*K|погр.*(объём|калибр|K(?!2)))/i, format: (v) => fmtNum(v) },
        { id: 17, keyRe: /(δ\.?\s*V|d\.?\s*Vст|Vст.*погр)/i, format: (v) => fmtNum(v) },
        { id: 18, keyRe: /(δ\.?\s*⊿|δ\.?\s*dP2|d\.?ΔP(?!$)|погр.*(переп|dP(?!$)))/i, format: (v) => fmtNum(v) },
        { id: 19, keyRe: /(δ\.?\s*T2|погр.*T2|Err.*T2)/i, format: (v) => fmtNum(v) },
        { id: 20, keyRe: /(REG_DATETIME|date.*time|дата(?!.*(изм|рожд))|DateTime(?!.*(create|соз)))/i, format: (v) => fmtUnixish(v) },
        { id: 21, keyRe: /(Kсж|Kcx|Kсx|Kж|сжимаем(ость)?(?!.*%))|(метод).*(K|газ|GNC)/i, format: (v) => fmtU16ish(v) },
        { id: 22, keyRe: /(плотн|плотность|ρ|rho(?!gram)|den(sity)?_?gas(?!$))/i, format: (v) => fmtNum(v) },
        { id: 23, keyRe: /(CO2|CO₂|CO_?2|Углек|углев)/i, format: (v) => fmtNum(v) },
        { id: 24, keyRe: /(N2|N₂|азот(?!$))/i, format: (v) => fmtNum(v) },
        { id: 25, keyRe: /(Er_?P|Err_?P|ПЗ.*Er\.?\s*P|погр.*(устр|P3).*P(?!$))/i, format: (v) => fmtNum(v) },
        { id: 26, keyRe: /(Er_?T|Err_?T|ПЗ.*Er\.?\s*T)/i, format: (v) => fmtNum(v) },
        { id: 27, keyRe: /(^Q0$|Q0[^a-zA-Zа-яё]|(граница|отсеч).*(P3|P₀)|flow.*(cut|off|zero))/i, format: (v) => fmtNum(v) },
        { id: 28, keyRe: /Qмин[^а-я]|Qmin(?!T)|мин.*расход|мин.*Q(?!max)/i, format: (v) => fmtNum(v) },
        { id: 29, keyRe: /Qмакс|Qmax[^T]|макс.*расход|макс.*Q(?!min)/i, format: (v) => fmtNum(v) },
        { id: 70, keyRe: /(период(?!ич)|Tизм|T_?meas|interv(?!al)|cек.*изм|sampling)/i, format: (v) => fmtU16ish(v) },
        {
            id: 102,
            keyRe: /(Serial.*[Mm]eter|Serial.*сч|Серийн.*счёт|счётчик.*сер|номер.*счёт|S\/N.*сч)/i,
            format: (v) => fmtMeterSerial(v),
        },
        {
            id: 103,
            keyRe: /(дата.*повер.*сч|Date.*verif.*meter|поверк.*счёт|Verification.*meter)/i,
            format: (v) => fmtTDate(v),
        },
        {
            id: 104,
            keyRe: /(след.*повер.*сч|next.*verif.*meter|DateNext.*meter|оконч.*повер.*сч)/i,
            format: (v) => fmtTDate(v),
        },
        {
            id: 202,
            keyRe: /(дата.*повер.*комп|Date.*verif.*complex|поверк.*комплекс|Verification.*complex)/i,
            format: (v) => fmtTDate(v),
        },
        {
            id: 203,
            keyRe: /(след.*повер.*комп|next.*verif.*complex|оконч.*повер.*комп)/i,
            format: (v) => fmtTDate(v),
        },
        { id: 106, keyRe: /(имп.*сч|импульс.*сч|Imp.*meter|pulse.*meter|цена.*имп)/i, format: (v) => fmtNum(v) },
        // п.122/229 — направление потока (не «тип имп» / «режим телем»).
        // Направление берётся из характеристики (parseFlowDirectionToken), не из OData-ключей.
        {
            id: 227,
            keyRe: /(наим.*телем|telemetry.*name|блок.*телем|TM-02)/i,
            format: (v) => fmtChr30(v),
        },
        {
            id: 228,
            keyRe: /(сер.*телем|Serial.*tele|телем.*сер|telemetry.*serial)/i,
            format: (v) => fmtTelemetrySerial(v),
        },
    ];

    if (!window.TM07_ORDER1C_KEY_RULES || !Array.isArray(window.TM07_ORDER1C_KEY_RULES)) {
        window.TM07_ORDER1C_KEY_RULES = DEFAULT_RULES;
    }

    /** П.4/5 — фиксированные значения (не перезаписываются данными 1С). */
    const FIXED_STEP_VALUES = {
        4: '10',
        5: '124',
        8: '-40',
        9: '60',
    };

    function applyFixedStepValues(lines) {
        Object.keys(FIXED_STEP_VALUES).forEach(function (sidStr) {
            const sid = Number(sidStr);
            const inp = document.getElementById('val_' + sid);
            if (!inp || inp.disabled) {
                return;
            }
            inp.value = FIXED_STEP_VALUES[sid];
            lines.push('п.' + sid + ' ← фикс. ' + FIXED_STEP_VALUES[sid]);
        });
    }

    /** Копирование базовых порогов в производные поля Q-группы. */
    const THRESHOLD_PROPAGATE = {
        6: [34, 36, 38],
        7: [35, 37, 39],
        28: [30, 32],
        29: [31, 33],
        40: [42, 44],
        41: [43, 45]
    };

    /** П.п. «максимум» — не допускаем отрицательных значений. */
    const MAX_STEP_IDS = new Set([7, 9, 11, 13, 29, 31, 33, 35, 37, 39, 41, 43, 45, 47, 49, 51, 53]);

    function ensureMaxNotNegative(stepId, val) {
        if (val == null || val === '') {
            return val;
        }
        if (!MAX_STEP_IDS.has(stepId)) {
            return val;
        }
        const n = parseFloat(String(val).replace(',', '.'));
        if (!Number.isFinite(n)) {
            return val;
        }
        if (n < 0) {
            return n % 1 === 0 ? String(Math.abs(Math.trunc(n))) : Math.abs(n).toFixed(2);
        }
        return val;
    }

    function normalizeMinMaxPair(minId, maxId, v1, v2) {
        let a = v1;
        let b = v2 != null ? v2 : v1;
        const n1 = parseFloat(String(a).replace(',', '.'));
        const n2 = parseFloat(String(b).replace(',', '.'));
        if (Number.isFinite(n1) && Number.isFinite(n2) && n1 > n2) {
            a = String(n2);
            b = String(n1);
        }
        return {
            min: ensureMaxNotNegative(minId, a),
            max: ensureMaxNotNegative(maxId, b),
        };
    }

    /** Диапазоны температур по методу Ксж (п.21). */
    const KSZH_METHOD = {
        2: { tmin: '-23.15', tmax: '60' },
        3: { tmin: '-40', tmax: '60' }
    };

    function parseKsxhFromText(text) {
        const m = String(text || '').match(/[KkКк][СсSsCс][ЖжJj][\s\-_]*([23])\b/i);
        return m ? m[1] : null;
    }

    function parseKsxhMethodToken(s) {
        const m = String(s || '').trim().match(/^[KkКк][СсSsCс][ЖжJj][\s\-_]*([23])$/i);
        return m ? m[1] : null;
    }

    function applyKsxhMethod(method, lines) {
        const spec = KSZH_METHOD[Number(method)];
        if (!spec) {
            return;
        }
        const inp21 = document.getElementById('val_21');
        if (inp21 && !inp21.disabled) {
            inp21.value = String(method);
            lines.push('п.21 ← Ксж-' + method);
        }
        const inp40 = document.getElementById('val_40');
        const inp41 = document.getElementById('val_41');
        if (inp40 && !inp40.disabled) {
            inp40.value = spec.tmin;
            lines.push('п.40 ← Ксж-' + method + '(Tmin)');
        }
        if (inp41 && !inp41.disabled) {
            inp41.value = spec.tmax;
            lines.push('п.41 ← Ксж-' + method + '(Tmax)');
        }
    }

    function propagateDerivedThresholds(lines) {
        let n = 0;
        Object.keys(THRESHOLD_PROPAGATE).forEach(function (srcIdStr) {
            const srcId = Number(srcIdStr);
            const src = document.getElementById('val_' + srcId);
            if (!src || src.disabled) {
                return;
            }
            const val = String(src.value || '').trim();
            if (!val) {
                return;
            }
            THRESHOLD_PROPAGATE[srcId].forEach(function (dstId) {
                const dst = document.getElementById('val_' + dstId);
                if (!dst || dst.disabled) {
                    return;
                }
                dst.value = ensureMaxNotNegative(dstId, val);
                lines.push('п.' + dstId + ' ← п.' + srcId);
                n += 1;
            });
        });
        return n;
    }

    function plog(msg) {
        const le = document.getElementById('paramLog');
        if (le) {
            const t = new Date().toLocaleTimeString();
            le.innerHTML += `[${t}] [1С→пар.] ${msg}<br>`;
            le.scrollTop = le.scrollHeight;
        }
    }

    function setStatus(s, isError) {
        const st = document.getElementById('paramOrder1cStatus');
        if (st) {
            st.textContent = s;
            st.className = 'small mt-2 mb-0' + (isError ? ' text-danger' : ' text-body-secondary');
        }
    }

    function setOrderStatusBadge(text, mode) {
        const el = document.getElementById('paramOrder1cOrderStatus');
        if (!el) {
            return;
        }
        const t = String(text || '').trim();
        if (!t) {
            el.textContent = 'Статус: —';
            el.className = 'badge rounded-pill text-bg-secondary param-order-status-badge';
            el.title = '';
            return;
        }
        el.textContent = 'Статус: ' + t;
        el.title = 'Статус заказа в 1С (OData поле Статус)';
        if (mode === 'error') {
            el.className = 'badge rounded-pill text-bg-danger param-order-status-badge';
        } else if (mode === 'loading') {
            el.className = 'badge rounded-pill text-bg-warning text-dark param-order-status-badge';
        } else {
            el.className = 'badge rounded-pill text-bg-primary param-order-status-badge';
        }
    }

    function formatOrderStatusFromRow(row) {
        const O = window.Order1cOdata;
        if (O && typeof O.formatOrderStatus === 'function') {
            return O.formatOrderStatus(row && row['Статус']);
        }
        const raw = row && row['Статус'];
        return raw == null ? '' : String(raw).trim();
    }

    async function resolveAndShowOrderStatus(number, entity, base, row) {
        const fromRow = formatOrderStatusFromRow(row);
        if (fromRow) {
            setOrderStatusBadge(fromRow, 'ok');
            return fromRow;
        }
        const O = window.Order1cOdata;
        if (!O || typeof O.fetchOrderStatus !== 'function') {
            setOrderStatusBadge('', 'idle');
            return '';
        }
        setOrderStatusBadge('загрузка…', 'loading');
        try {
            const st = await O.fetchOrderStatus(number, entity, base);
            if (st) {
                setOrderStatusBadge(st, 'ok');
                if (row && typeof row === 'object') {
                    row['Статус'] = st;
                }
                return st;
            }
            setOrderStatusBadge('не найден', 'error');
            return '';
        } catch (e) {
            setOrderStatusBadge('ошибка', 'error');
            plog('Статус 1С: ' + (e.message || String(e)));
            return '';
        }
    }

    function parseNumToken(v) {
        const t = String(v || '').replace(/\s/g, '').replace(',', '.');
        const n = parseFloat(t);
        return Number.isFinite(n) ? n.toFixed(2) : null;
    }

    function stepTargetByLabel(label) {
        const l = String(label || '').toLowerCase();
        if (!l) return null;
        // ППД / перепад давления → п.10–11 (до ПАД: иначе «перепад» ловится как «пад»)
        if (/(ппд|перепад|δp|Δp|delta\s*p)/i.test(l)) return [10, 11];
        // ПАД — абсолютное давление → п.6–7
        if (/(пад)/i.test(l)) return [6, 7];
        if (/(давл|pabs|абс\.?\s*p|^p(?!.*ад))/i.test(l)) return [6, 7];
        // ПТТП — температура технолог. параметров → T2min/T2max (п.12–13)
        if (/(пттп)/i.test(l)) return [12, 13];
        // ПТГ в заказе не пишем в Tmin/Tmax корректора — всегда −40…+60.
        if (/(птг)/i.test(l)) return null;
        if (/(темп|^t\b|tгаз|газ.*темп)/i.test(l)) return null;
        if (/(плотн|rho|ρ)/i.test(l)) return [22];
        if (/(co2|co₂|углек)/i.test(l)) return [23];
        if (/(n2|n₂|азот)/i.test(l)) return [24];
        // Динамический диапазон (1:200) — только для подбора типоразмера G, не в п.79
        if (/(динам|динамическ|dynamic|диапазон.*соотношение|turn.*down|turndown)/i.test(l)) return null;
        // Q газа – Qmin/Qmax (шаги 28/29)
        if (/(расход|q\s*\d*\s*-\s*\d+|qmin|qmax)/i.test(l)) return [28, 29];
        return null;
    }

    function normalizeSpecValueForLabel(label, raw) {
        const n = parseFloat(String(raw).replace(',', '.'));
        if (!Number.isFinite(n)) {
            return raw;
        }
        // ПАД в заказах 1С часто в МПа (0,1–1,0) → кПа (*1000). Уже в кПа (≥20) не трогаем.
        // ППД/перепад не масштабируем как ПАД.
        const lab = String(label || '');
        if (/(ппд|перепад|δp|Δp)/i.test(lab)) {
            return n.toFixed(2);
        }
        if (/(пад)/i.test(lab)) {
            if (Math.abs(n) < 20) {
                return String(Math.round(Math.abs(n) * 1000));
            }
            return String(Math.round(Math.abs(n)));
        }
        return n.toFixed(2);
    }

    function stripTurndownRatio(s) {
        return String(s || '').replace(/\s*\(\s*\d+\s*:\s*\d+\s*\)/gi, '').trim();
    }

    function parseQRangeToken(s) {
        const pair = parseNumericRangeToken(s);
        if (!pair) {
            return null;
        }
        const a = parseFloat(String(pair[0]).replace(',', '.'));
        const b = parseFloat(String(pair[1]).replace(',', '.'));
        if (!isPlausibleFlowRange(a, b)) {
            return null;
        }
        return [pair[0], pair[1]];
    }

    /** Типовые Qmax счётчиков ≤ 4000 м³/ч; 7500/1600 без DN — чаще давление, кПа. */
    function isPlausibleFlowRange(qmin, qmax) {
        if (!Number.isFinite(qmin) || !Number.isFinite(qmax) || qmax <= 0) {
            return false;
        }
        if (qmax > 4500) {
            return false;
        }
        return true;
    }

    /**
     * Диапазон min-max без ложного «минуса» у второй границы.
     * «4-60» → [4,60]; «-40-60» → [-40,60]; «0,1-1,0» → [0.10,1.00].
     * @returns {[string,string]|null}
     */
    function parseNumericRangeToken(s) {
        const src = String(s || '').trim();
        if (!src) {
            return null;
        }
        let m = src.match(/^(-?\d+(?:[.,]\d+)?)\s*[-–—]\s*(-?\d+(?:[.,]\d+)?)$/);
        if (!m) {
            m = src.match(/^(-?\d+(?:[.,]\d+)?)\s*(?:\.\.\.|…)\s*(-?\d+(?:[.,]\d+)?)$/);
        }
        if (!m) {
            return null;
        }
        const v1 = parseNumToken(m[1]);
        const v2 = parseNumToken(m[2]);
        if (v1 == null || v2 == null) {
            return null;
        }
        return [v1, v2];
    }

    /**
     * Числа внутри скобок: сначала диапазон, иначе отдельные значения (без scrape «A-B» → [A,-B]).
     * @returns {string[]}
     */
    function parseNumbersInsideSpec(inside) {
        const range = parseNumericRangeToken(inside);
        if (range) {
            return range;
        }
        const nums = [];
        const nRe = /(?:^|[^0-9.,])(-?\d+(?:[.,]\d+)?)/g;
        let nm;
        while ((nm = nRe.exec(String(inside || ''))) !== null) {
            const v = parseNumToken(nm[1]);
            if (v != null) {
                nums.push(v);
            }
        }
        return nums;
    }

    /**
     * ПТГ/ПТТП из 1С: компактно «4-60» = −40…+60 (°C), либо уже «-40-60».
     * @returns {[string|null, string|null]}
     */
    function normalizePtgRange(minRaw, maxRaw) {
        const a = parseFloat(String(minRaw ?? '').replace(',', '.'));
        const b = parseFloat(String(maxRaw ?? '').replace(',', '.'));
        if (!Number.isFinite(a) || !Number.isFinite(b)) {
            return [minRaw != null ? String(minRaw) : null, maxRaw != null ? String(maxRaw) : null];
        }
        // Компактный код 1С: первая цифра — |Tmin|/10 (обычно 2…6), вторая — Tmax.
        if (a >= 0 && a <= 15 && b > a && b <= 120) {
            return [String(-(a * 10)), String(b)];
        }
        return [String(a), String(b)];
    }

    /**
     * Компактная строка заказа: DN50;3-100 (1:30); 3-100
     * DN → диаметр, «3-100» → Qmin/Qmax, «(1:30)» игнорируется.
     */
    /**
     * Направление потока из характеристики заказа:
     * «слева направо»→0, «справа налево»→1, «сверху вниз»→2, «снизу вверх»→3.
     * @returns {{code:string,label:string}|null}
     */
    function parseFlowDirectionToken(text) {
        const s = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
        if (!s) {
            return null;
        }
        if (/справа\s+налево/.test(s)) {
            return { code: '1', label: 'справа налево' };
        }
        if (/слева\s+направо/.test(s)) {
            return { code: '0', label: 'слева направо' };
        }
        if (/сверху\s+вниз/.test(s)) {
            return { code: '2', label: 'сверху вниз' };
        }
        if (/снизу\s+вверх/.test(s)) {
            return { code: '3', label: 'снизу вверх' };
        }
        return null;
    }

    function applyFlowDirectionFromOrder(row, lines) {
        const texts = [];
        if (row && typeof row === 'object') {
            Object.keys(row).forEach(function (k) {
                const v = row[k];
                if (typeof v === 'string' && v.trim()) {
                    texts.push(v);
                }
            });
        }
        const dir = parseFlowDirectionToken(texts.join('; '));
        if (!dir) {
            return 0;
        }
        let n = 0;
        [122, 229].forEach(function (sid) {
            const inp = document.getElementById('val_' + sid);
            if (!inp || inp.disabled) {
                return;
            }
            inp.value = dir.code;
            lines.push('п.' + sid + ' ← ' + dir.label + ' (' + dir.code + ')');
            n += 1;
        });
        return n;
    }

    function extractCompactOrderSpecs(text) {
        const src = String(text || '').trim();
        if (!src) {
            return [];
        }
        const out = [];
        const parts = src.indexOf(';') >= 0 ? src.split(';') : [src];
        for (let part of parts) {
            part = stripTurndownRatio(part.trim());
            if (!part) {
                continue;
            }
            const dn = parseDnToken(part);
            if (dn) {
                out.push({ label: 'DN' + dn, values: [dn], type: 'dn' });
                continue;
            }
            const ksxh = parseKsxhMethodToken(part);
            if (ksxh) {
                out.push({ label: 'Ксж-' + ksxh, values: [ksxh], type: 'ksxh' });
                continue;
            }
            const flow = parseFlowDirectionToken(part);
            if (flow) {
                out.push({ label: flow.label, values: [flow.code], type: 'flow' });
                continue;
            }
            const q = parseQRangeToken(part);
            if (q) {
                out.push({ label: part, values: q, type: 'q' });
            }
        }
        return out;
    }

    function fillQRangeInputs(sp, lines, filledSteps) {
        const minId = 28;
        const maxId = 29;
        const v1 = sp.values[0] || null;
        const v2 = sp.values[1] || null;
        const inpMin = document.getElementById('val_' + minId);
        const inpMax = document.getElementById('val_' + maxId);
        if (inpMin && !inpMin.disabled && v1 != null) {
            inpMin.value = v1;
            if (!filledSteps.has(minId)) {
                lines.push('п.' + minId + ' ← ' + sp.label + '(min)');
                filledSteps.add(minId);
            }
        }
        if (inpMax && !inpMax.disabled && v2 != null) {
            inpMax.value = ensureMaxNotNegative(maxId, v2);
            if (!filledSteps.has(maxId)) {
                lines.push('п.' + maxId + ' ← ' + sp.label + '(max)');
                filledSteps.add(maxId);
            }
        }
    }

    /**
     * Извлекает пары вида "ПАД(0,25-100)" / "Pabs (0.1 ... 1.6)" и компактные "DN50;3-100".
     * @returns {Array<{label:string, values:string[]}>}
     */
    function extractSpecsFromText(text) {
        const src = String(text || '');
        const out = [];
        const re = /([A-Za-zА-Яа-яЁё0-9Δδ.\-\/\s]{2,}?)\s*[\(\[]([^()\[\]]+)[\)\]]/g;
        let m;
        while ((m = re.exec(src)) !== null) {
            const label = (m[1] || '').trim();
            const inside = (m[2] || '').trim();
            if (!label || !inside) continue;
            // Особый разбор: Qмин-Qмакс (0.5-100) или диаметр (DN50)
            const dnMatch = label.match(/dn(\d+)/i);
            if (dnMatch) {
                out.push({ label: label, values: [dnMatch[1]], type: 'dn' });
                continue;
            }
            const turndownMatch = inside.match(/^(\d+)\s*:\s*(\d+)$/);
            if (turndownMatch) {
                const qFromLabel = parseQRangeToken(label);
                if (qFromLabel) {
                    out.push({ label: label, values: qFromLabel, type: 'q' });
                    continue;
                }
                if (!/(динам|turndown|turn.*down|диапазон)/i.test(label)) {
                    continue;
                }
                out.push({ label: label, values: [turndownMatch[1], turndownMatch[2]], type: 'turndown' });
                continue;
            }
            const nums = parseNumbersInsideSpec(inside);
            if (!nums.length) continue;
            out.push({ label: label, values: nums });
        }
        out.push.apply(out, extractCompactOrderSpecs(src));
        if (!out.some(function (s) { return s.type === 'ksxh'; })) {
            const km = parseKsxhFromText(src);
            if (km) {
                out.push({ label: 'Ксж-' + km, values: [km], type: 'ksxh' });
            }
        }
        return out;
    }

    /**
     * Подстановка из строковых "характеристик в скобках" (ПАД(...), P(...), T(...)).
     */
    function applyBracketSpecsToInputs(row, lines) {
        const texts = [];
        if (row && typeof row === 'object') {
            Object.keys(row).forEach((k) => {
                const v = row[k];
                if (typeof v === 'string' && v.trim()) texts.push(v);
            });
        }
        const filledSteps = new Set();
        let ksxhDone = false;
        for (const text of texts) {
            const specs = extractSpecsFromText(text);
            for (const sp of specs) {
                const target = stepTargetByLabel(sp.label);
                // Специальные типы
                if (sp.type === 'ksxh' && sp.values[0] && !ksxhDone) {
                    applyKsxhMethod(sp.values[0], lines);
                    ksxhDone = true;
                    continue;
                }
                if (sp.type === 'dn') {
                    continue;
                }
                if (sp.type === 'turndown') {
                    continue;
                }
                if (sp.type === 'q' && sp.values[0] && sp.values[1]) {
                    fillQRangeInputs(sp, lines, filledSteps);
                    continue;
                }
                if (sp.type === 'flow' && sp.values[0] != null) {
                    [122, 229].forEach(function (sid) {
                        const inp = document.getElementById('val_' + sid);
                        if (!inp || inp.disabled) {
                            return;
                        }
                        inp.value = String(sp.values[0]);
                        if (!filledSteps.has(sid)) {
                            lines.push('п.' + sid + ' ← ' + sp.label + ' (' + sp.values[0] + ')');
                            filledSteps.add(sid);
                        }
                    });
                    continue;
                }
                if (!target || !target.length) continue;
                let values;
                // ПТГ → п.8–9; ПТТП → п.12–13 (компакт 1С: 4-60 → −40…60).
                if (/(птг|пттп)/i.test(sp.label)) {
                    const pair = normalizePtgRange(sp.values[0], sp.values[1]);
                    values = [pair[0], pair[1]];
                } else {
                    values = sp.values.map((x) => normalizeSpecValueForLabel(sp.label, x));
                }
                if (target.length === 1) {
                    const sid = target[0];
                    const inp = document.getElementById('val_' + sid);
                    if (!inp || inp.disabled || !values[0]) continue;
                    inp.value = values[0];
                    if (!filledSteps.has(sid)) {
                        lines.push('п.' + sid + ' ← ' + sp.label + '(...)');
                        filledSteps.add(sid);
                    }
                    continue;
                }
                const minId = target[0];
                const maxId = target[1];
                let v1 = values[0] || null;
                let v2 = values[1] || null;
                const pair = normalizeMinMaxPair(minId, maxId, v1, v2);
                v1 = pair.min;
                v2 = pair.max;
                const inpMin = document.getElementById('val_' + minId);
                const inpMax = document.getElementById('val_' + maxId);
                if (inpMin && !inpMin.disabled && v1 != null) {
                    inpMin.value = v1;
                    if (!filledSteps.has(minId)) {
                        lines.push('п.' + minId + ' ← ' + sp.label + '(min)');
                        filledSteps.add(minId);
                    }
                }
                if (inpMax && !inpMax.disabled && (v2 != null || v1 != null)) {
                    inpMax.value = v2 != null ? v2 : ensureMaxNotNegative(maxId, v1);
                    if (!filledSteps.has(maxId)) {
                        lines.push('п.' + maxId + ' ← ' + sp.label + '(max)');
                        filledSteps.add(maxId);
                    }
                }
            }
        }
        return filledSteps.size;
    }

    function applyProductFullNamesToInputs(row, lines) {
        const nom = String(row['НаименованиеПолное_Номенклатуры'] || '').trim();
        const ch = String(row['НаименованиеПолное_Характеристики'] || '').trim();
        const primary = nom || ch;
        if (!primary) {
            return 0;
        }
        let n = 0;
        const inp = document.getElementById('val_200');
        let complexDesignation = '';
        if (inp && !inp.disabled) {
            complexDesignation = extractComplexDesignation(primary);
            inp.value = complexDesignation;
            lines.push('п.200 ← ' + complexDesignation + ' (из НаименованиеПолное)');
            n = 1;
        }
        if (complexDesignation && applyMeterNameByComplexDesignation(complexDesignation, lines)) {
            n += 1;
        }
        return n;
    }

    function renderOrderContents(row, nom, ch, designation) {
        const box = document.getElementById('paramOrder1cContents');
        const nomEl = document.getElementById('paramOrder1cNom');
        const chEl = document.getElementById('paramOrder1cChar');
        if (!box) {
            return;
        }
        const n = String(nom || '').trim();
        const c = String(ch || '').trim();
        const d = String(designation || '').trim();
        const num = row && row.Number ? String(row.Number).trim() : '';
        const title = n || d || '';
        if (!title && !c && !num) {
            box.classList.add('d-none');
            if (nomEl) nomEl.textContent = '';
            if (chEl) chEl.textContent = '';
            return;
        }
        box.classList.remove('d-none');
        if (nomEl) {
            nomEl.textContent = (num ? num + ' · ' : '') + (title || '—');
        }
        if (chEl) {
            chEl.textContent = c || '';
            chEl.classList.toggle('d-none', !c);
        }
    }

    function applyOrder1cRowToInputs(row) {
        const rules = window.TM07_ORDER1C_KEY_RULES;
        if (!row || typeof row !== 'object') {
            return { ok: false, error: 'Нет объекта заказа' };
        }
        const usedKeys = new Set();
        const lines = [];
        for (let ri = 0; ri < rules.length; ri += 1) {
            const rule = rules[ri];
            if (rule.id === 80 || rule.id === 81 || rule.id === 103 || rule.id === 104 || rule.id === 202 || rule.id === 203) {
                continue;
            }
            for (const k of Object.keys(row)) {
                if (usedKeys.has(k)) {
                    continue;
                }
                if (!rule.keyRe.test(k)) {
                    continue;
                }
                const raw = row[k];
                if (!isScalarOdata(raw)) {
                    continue; 
                }
                const inp = document.getElementById('val_' + rule.id);
                if (!inp || inp.disabled) {
                    continue;
                }
                const s = rule.format ? rule.format(raw) : String(raw);
                if (s == null || s === '—' || String(s).trim() === '') {
                    continue;
                }
                let formatted = window.TM07_param_formatStepValue
                    ? window.TM07_param_formatStepValue(rule.id, s)
                    : String(s).trim();
                formatted = ensureMaxNotNegative(rule.id, formatted);
                inp.value = formatted;
                usedKeys.add(k);
                lines.push('п.' + rule.id + ' ← ' + k);
                break;
            }
        }
        const extra = applyBracketSpecsToInputs(row, lines);
        applyFlowDirectionFromOrder(row, lines);
        const nom = String(row['НаименованиеПолное_Номенклатуры'] || '').trim();
        const ch = String(row['НаименованиеПолное_Характеристики'] || '').trim();
        const primary = nom || ch;
        const complexDesignation = primary ? extractComplexDesignation(primary) : '';
        applyProductFullNamesToInputs(row, lines);
        if (primary && complexDesignation) {
            applyComplexMeterTypeParams(row, primary, complexDesignation, lines);
            applyVolumeErrorLimitsToInputs(row, primary, complexDesignation, lines);
            applyParamAutoFillToInputs(row, primary, complexDesignation, lines);
        } else if (primary) {
            applyParamAutoFillToInputs(row, primary, '', lines);
        }
        propagateDerivedThresholds(lines);
        applyFixedStepValues(lines);
        renderOrderContents(row, nom, ch, complexDesignation);
        // п.227 — только при .БТ / БТ1…3 в заказе (иначе не пишем).
        const btName = resolveTelemetryBlockNameForOrder(row, primary);
        const hasBt = !!btName && btName !== TELEMETRY_NAME_DEFAULT;
        let skip227 = !hasBt;
        try {
            const OpsTel = window.TM07_WORKBENCH_OPS;
            if (OpsTel && typeof OpsTel.shouldSkipTelemetryName === 'function') {
                skip227 = OpsTel.shouldSkipTelemetryName();
            }
        } catch (_eSkip) {}
        if (skip227) {
            setMeterStepInput(227, '', lines, 'без .БТ — п.227 не пишется');
        } else if (btName) {
            setMeterStepInput(227, btName, lines, 'блок телеметрии / БТ');
        }
        // Панель сканирования штрихкода БПЭК — только для заказов с телеметрией (.БТ).
        try {
            if (window.TM07_MIDA_QR && typeof window.TM07_MIDA_QR.setTelemetryPanelVisible === 'function') {
                window.TM07_MIDA_QR.setTelemetryPanelVisible(hasBt && !skip227);
            }
        } catch (_eBt) {}
        try {
            if (
                window.TM07_WORKBENCH_OPS &&
                typeof window.TM07_WORKBENCH_OPS.captureOrderSensorExpectations === 'function'
            ) {
                window.TM07_WORKBENCH_OPS.captureOrderSensorExpectations();
            }
        } catch (_eCap) {}
        if (row.Number) {
            resolveOrderNumberInput(row.Number);
        }
        return { ok: true, filled: lines.length, lines: lines, filledBySpecs: extra };
    }

    function parseRowOrThrow(text) {
        let o;
        try {
            o = JSON.parse(text);
        } catch (e) {
            throw new Error('JSON: ' + (e.message || String(e)));
        }
        if (o && o.row) {
            return o.row;
        }
        if (o && o.Ref_Key !== undefined) {
            return o;
        }
        if (o && o.value && Array.isArray(o.value) && o.value[0]) {
            return o.value[0];
        }
        throw new Error('Ожидается объект с Ref_Key или { row: {…} }');
    }

    async function fetchOrderRow(number, entity, base) {
        const O = window.Order1cOdata;
        if (!O) {
            throw new Error('Нет модуля Order1cOdata (нужен order-1c-odata.js).');
        }
        const n = O.normalizeOrderNumber ? O.normalizeOrderNumber(number) : String(number || '').trim();
        if (!n) {
            throw new Error('Укажите номер заказа.');
        }
        const ent = (entity || O.DEFAULT_ENTITY).trim();
        const path = O.buildOdataPath(n, ent);
        const b = (base || '').trim() || null;
        const data = await O.fetchViaProxy(path, b);
        const value = data.value;
        if (!Array.isArray(value) || !value.length) {
            throw new Error('Пустой ответ OData (value).');
        }
        const eq = O.orderNumbersEqual || ((a, b) => String(a || '').trim() === String(b || '').trim());
        let row = value.find((r) => eq(r.Number, n));
        if (!row && value.length === 1) {
            row = value[0];
        }
        if (!row) {
            throw new Error('Номер «' + n + '» не найден в value.');
        }
        try {
            if (typeof O.fetchOrderProductInfoByOrderNumber === 'function') {
                const info = await O.fetchOrderProductInfoByOrderNumber(n, ent, b);
                if (info.nomenclature && info.nomenclature.fullName) {
                    row['НаименованиеПолное_Номенклатуры'] = info.nomenclature.fullName;
                }
                if (info.characteristic && info.characteristic.fullName) {
                    row['НаименованиеПолное_Характеристики'] = info.characteristic.fullName;
                }
            } else if (typeof O.fetchCharacteristicByOrderNumber === 'function') {
                const ch = await O.fetchCharacteristicByOrderNumber(n, ent, b);
                if (ch && ch.fullName) {
                    row['НаименованиеПолное_Характеристики'] = ch.fullName;
                }
            }
        } catch (_e) {
            // Наименование из каталога не блокирует подстановку параметров.
        }
        return row;
    }

    function getById(id) {
        return document.getElementById(id);
    }

    function resolveOrderNumberInput(raw) {
        const O = window.Order1cOdata;
        const n =
            O && typeof O.normalizeOrderNumber === 'function'
                ? O.normalizeOrderNumber(raw)
                : String(raw || '').trim();
        const numEl = getById('paramOrder1cNumber');
        if (numEl && n && numEl.value.trim() !== n) {
            numEl.value = n;
        }
        return n;
    }

    async function loadAndApplyOrder(number, entity, base) {
        const O = window.Order1cOdata;
        if (!O) {
            throw new Error('Order1cOdata не загружен.');
        }
        const orderNum = resolveOrderNumberInput(number);
        const ent = (entity || (document.getElementById('paramOrder1cEntity') || {}).value || O.DEFAULT_ENTITY || '').trim();
        const b = (base || (document.getElementById('paramOrder1cBase') || {}).value || '').trim();
        if (b) {
            try {
                localStorage.setItem(ODATA_BASE_LS, b);
            } catch (_e) {}
        }
        const row = await fetchOrderRow(orderNum, ent, b);
        await resolveAndShowOrderStatus(orderNum, ent, b, row);
        persistOrderCache({
            row: row,
            number: String(orderNum),
            orderStatus: formatOrderStatusFromRow(row) || '',
            savedAt: Date.now(),
        });
        const r = applyOrder1cRowToInputs(row);
        if (!r.ok) {
            throw new Error(r.error || 'Не удалось подставить поля');
        }
        return { row: row, number: orderNum, apply: r, cached: false };
    }

    /** Подставить последний заказ из session/localStorage без OData. */
    function applyCachedOrder(preferredNumber) {
        const raw = readOrderCacheRaw();
        if (!raw) {
            throw new Error('Кэш заказа пуст — сначала загрузите заказ из 1С.');
        }
        let o;
        try {
            o = JSON.parse(raw);
        } catch (e) {
            throw new Error('Кэш заказа повреждён: ' + (e.message || String(e)));
        }
        if (!o || !o.row) {
            throw new Error('В кэше нет данных заказа.');
        }
        const want = preferredNumber ? resolveOrderNumberInput(preferredNumber) : '';
        const have = o.number ? resolveOrderNumberInput(o.number) : '';
        if (want && have && want !== have) {
            throw new Error(
                'В кэше заказ ' + have + ', а введён ' + want + '. Загрузите нужный заказ из 1С.'
            );
        }
        const numEl = getById('paramOrder1cNumber');
        if (numEl && have) {
            numEl.value = have;
        }
        const cachedStatus = o.orderStatus || formatOrderStatusFromRow(o.row);
        if (cachedStatus) {
            setOrderStatusBadge(cachedStatus, 'ok');
        }
        const r = applyOrder1cRowToInputs(o.row);
        if (!r.ok) {
            throw new Error(r.error || 'Не удалось подставить поля из кэша');
        }
        return {
            row: o.row,
            number: have || want || String(o.number || ''),
            apply: r,
            cached: true,
            savedAt: o.savedAt || null,
        };
    }

    function hasCachedOrder(preferredNumber) {
        try {
            const raw = readOrderCacheRaw();
            if (!raw) {
                return false;
            }
            const o = JSON.parse(raw);
            if (!o || !o.row) {
                return false;
            }
            if (!preferredNumber) {
                return true;
            }
            const want = resolveOrderNumberInput(preferredNumber);
            const have = o.number ? resolveOrderNumberInput(o.number) : '';
            return !want || !have || want === have;
        } catch (_e) {
            return false;
        }
    }

    function init() {
        const numEl = getById('paramOrder1cNumber');
        const entEl = getById('paramOrder1cEntity');
        const baseEl = getById('paramOrder1cBase');
        if (!numEl) {
            return;
        }
        const O = window.Order1cOdata;
        if (O && O.DEFAULT_ENTITY) {
            if (entEl && !entEl.value.trim()) {
                entEl.value = O.DEFAULT_ENTITY;
            }
        }
        let saved;
        try {
            saved = localStorage.getItem(ODATA_BASE_LS);
        } catch (_e) {
            saved = '';
        }
        if (baseEl && saved) {
            baseEl.value = saved;
        } else if (O && typeof O.bootstrapOdataConfig === 'function') {
            void O.bootstrapOdataConfig();
        }

        getById('paramOrder1cLoad')?.addEventListener('click', async () => {
            if (!O) {
                setStatus('Order1cOdata не загружен.', true);
                return;
            }
            setStatus('Загрузка…', false);
            setOrderStatusBadge('загрузка…', 'loading');
            try {
                const base = (baseEl && baseEl.value.trim()) || '';
                if (base) {
                    try {
                        localStorage.setItem(ODATA_BASE_LS, base);
                    } catch (_e) {}
                }
                const orderNum = resolveOrderNumberInput((numEl && numEl.value) || '');
                const ent = (entEl && entEl.value.trim()) || (O.DEFAULT_ENTITY || '');
                const row = await fetchOrderRow(orderNum, ent, base);
                const orderStatus = await resolveAndShowOrderStatus(orderNum, ent, base, row);
                persistOrderCache({
                    row: row,
                    number: String(orderNum),
                    orderStatus: orderStatus || formatOrderStatusFromRow(row) || '',
                    savedAt: Date.now(),
                });
                const r = applyOrder1cRowToInputs(row);
                if (!r.ok) {
                    setStatus(r.error || 'Ошибка', true);
                    return;
                }
                const nomName = row['НаименованиеПолное_Номенклатуры']
                    ? String(row['НаименованиеПолное_Номенклатуры']).trim()
                    : '';
                const chName = row['НаименованиеПолное_Характеристики']
                    ? String(row['НаименованиеПолное_Характеристики']).trim()
                    : '';
                const productName = nomName || chName;
                const statusNote = orderStatus ? ' Статус: ' + orderStatus + '.' : '';
                plog(
                    'Загружено и подставлено: ' +
                        r.filled +
                        ' полей. ' +
                        (r.lines && r.lines.length ? r.lines.join('; ') : '') +
                        (productName ? '; Наименование: ' + productName : '') +
                        statusNote
                );
                setStatus(
                    'Подставлено полей: ' +
                        r.filled +
                        (productName ? '. Наименование: ' + productName : '') +
                        statusNote +
                        (r.lines && r.lines.length ? '. ' + r.lines.join('; ') : ''),
                    false
                );
            } catch (e) {
                setStatus(e.message || String(e), true);
                setOrderStatusBadge('ошибка', 'error');
                plog('Ошибка: ' + (e.message || String(e)));
            }
        });

        getById('paramOrder1cFromCache')?.addEventListener('click', () => {
            setStatus('Чтение кэша…', false);
            let raw;
            try {
                raw = readOrderCacheRaw();
            } catch (e) {
                setStatus('SessionStorage: ' + (e.message || String(e)), true);
                return;
            }
            if (!raw) {
                setStatus('Сначала загрузите заказ на странице «Заказ 1С» или кнопкой «Загрузить…» выше.', true);
                return;
            }
            let o;
            try {
                o = JSON.parse(raw);
            } catch (e) {
                setStatus('Кэш не JSON: ' + (e.message || ''), true);
                return;
            }
            if (o && o.row) {
                if (numEl && o.number) {
                    numEl.value = o.number;
                }
                const cachedStatus = o.orderStatus || formatOrderStatusFromRow(o.row);
                if (cachedStatus) {
                    setOrderStatusBadge(cachedStatus, 'ok');
                } else {
                    void resolveAndShowOrderStatus(
                        o.number || (numEl && numEl.value) || '',
                        entEl && entEl.value,
                        (baseEl && baseEl.value.trim()) || '',
                        o.row
                    );
                }
                const r = applyOrder1cRowToInputs(o.row);
                if (!r.ok) {
                    setStatus(r.error || 'Ошибка', true);
                    return;
                }
                plog('Из кэша: ' + r.filled + ' пол. ' + (r.lines && r.lines.length ? r.lines.join('; ') : ''));
                setStatus('Из кэша, подставлено: ' + r.filled, false);
            } else {
                setStatus('В кэше нет .row; перезагрузите заказ.', true);
            }
        });

        getById('paramOrder1cApplyJson')?.addEventListener('click', () => {
            const ta = getById('paramOrder1cJson');
            const t = (ta && ta.value && ta.value.trim()) || '';
            if (!t) {
                setStatus('Вставьте JSON в поле выше.', true);
                return;
            }
            try {
                const row = parseRowOrThrow(t);
                void resolveAndShowOrderStatus(
                    row.Number || (numEl && numEl.value) || '',
                    entEl && entEl.value,
                    (baseEl && baseEl.value.trim()) || '',
                    row
                );
                const r = applyOrder1cRowToInputs(row);
                if (!r.ok) {
                    setStatus(r.error || 'Ошибка', true);
                    return;
                }
                plog('Из JSON: ' + r.filled + ' пол. ' + (r.lines && r.lines.length ? r.lines.join('; ') : ''));
                setStatus('Из вставки, подставлено: ' + r.filled, false);
            } catch (e) {
                setStatus(e.message || String(e), true);
            }
        });

        const sp = new URLSearchParams(window.location.search);
        if (sp.get('fromOrder1c') === '1' || sp.get('applyOrder1c') === '1') {
            try {
                const raw = readOrderCacheRaw();
                if (raw) {
                    const o = JSON.parse(raw);
                    if (o && o.row) {
                        if (numEl && o.number) {
                            numEl.value = o.number;
                        }
                        if (o.orderStatus) {
                            setOrderStatusBadge(o.orderStatus, 'ok');
                        } else {
                            void resolveAndShowOrderStatus(o.number, entEl && entEl.value, '', o.row);
                        }
                        const r = applyOrder1cRowToInputs(o.row);
                        if (r.ok) {
                            plog('Авто из 1С (посл. кэш): ' + r.filled + ' полей.');
                            setStatus('Автоподставлено: ' + r.filled + ' пол. (сессия со страницы «Заказ 1С»).', false);
                        } else {
                            setStatus('Кэш есть, не удалось: ' + (r.error || '—'), true);
                        }
                    }
                } else {
                    setStatus('Переход с заказа: в sessionStorage нет кэша — сначала загрузите заказ на /order-1c.html', true);
                }
            } catch (e) {
                setStatus(e.message || String(e), true);
            }
        }
    }

    window.applyOrder1cRowToParamInputs = applyOrder1cRowToInputs;
    window.TM07Order1cToParam = {
        applyOrder1cRowToInputs: applyOrder1cRowToInputs,
        fetchOrderRow: fetchOrderRow,
        loadAndApplyOrder: loadAndApplyOrder,
        applyCachedOrder: applyCachedOrder,
        hasCachedOrder: hasCachedOrder,
        extractComplexDesignation: extractComplexDesignation,
        resolveMeterByComplexDesignation: resolveMeterByComplexDesignation,
        applyComplexMeterTypeParams: applyComplexMeterTypeParams,
        applyParamAutoFillToInputs: applyParamAutoFillToInputs,
        applyEmisRgs245MeterParams: applyEmisRgs245MeterParams,
        applyCorrectorErrorLimitsToInputs: applyCorrectorErrorLimitsToInputs,
        applyCorrectorExecutionToInputs: applyCorrectorExecutionToInputs,
        applyVolumeErrorLimitsToInputs: applyVolumeErrorLimitsToInputs,
        extractModification: function (text) {
            const L = window.TM07_VOLUME_ERROR_LIMITS;
            return L ? L.extractModification(text) : null;
        },
        getComplexMeterMap: getComplexMeterMap,
        ensureMaxNotNegative: ensureMaxNotNegative,
        propagateDerivedThresholds: propagateDerivedThresholds,
        collectOrderTextBlob: collectOrderTextBlob,
        fmtTDate: fmtTDate,
        STORAGE_KEY: STORAGE_LAST,
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
