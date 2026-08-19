/**
 * Автоматизация рабочего места: требуемые датчики QR, проверка перед записью, даты поверки.
 */
(function () {
    'use strict';

    const SENSOR_LABELS = {
        DA: 'давление (DA)',
        DT: 'темп. газа (DT)',
        DD: 'перепад (DD)',
        TT: 'темп. ТП (TT)',
    };

    const METER_VERIFY_NEXT_YEARS_DEFAULT = 6;
    const COMPLEX_VERIFY_NEXT_YEARS_DEFAULT = 5;
    /** МПИ комплекса по РЭ: Р2/Р6/Т2 = 4 года, остальные (Р1/Р3/Р4/Р5/Т1) = 5. */
    const COMPLEX_VERIFY_YEARS_BY_FAMILY = {
        R2: 4,
        R6: 4,
        T2: 4,
        R1: 5,
        R3: 5,
        R4: 5,
        R5: 5,
        T1: 5,
    };
    const TELEMETRY_NAME_DEFAULT = 'TM-02/ТМ';
    /** БТ из обозначения комплекса / заказа → наименование блока телеметрии (п.227). */
    const BT_BLOCK_NAMES = {
        БТ1: 'БПЭК-02/ЦК Б',
        БТ2: 'БПЭК-04/ЦК Б',
        БТ3: 'БПЭК-05/ЦК',
    };

    function resolveTelemetryBlockName() {
        const blobs = [readStepVal(200), readStepVal(227)];
        try {
            const Ops = window.TM07Order1cToParam;
            const row =
                (window.__wbLastOrderRow && window.__wbLastOrderRow) ||
                null;
            if (row && Ops && typeof Ops.collectOrderTextBlob === 'function') {
                blobs.push(Ops.collectOrderTextBlob(row, readStepVal(200)));
            }
        } catch (_e) {}
        try {
            const raw =
                sessionStorage.getItem('order1c_param_lastOrder') ||
                localStorage.getItem('order1c_param_lastOrder');
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && parsed.row) {
                    const parts = [];
                    Object.keys(parsed.row).forEach(function (k) {
                        const v = parsed.row[k];
                        if (typeof v === 'string' && v.trim()) {
                            parts.push(v);
                        }
                    });
                    blobs.push(parts.join(' '));
                }
            }
        } catch (_e2) {}
        // Не используем \b — в JS граница слова не работает с кириллицей (БТ1/.БТ).
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

    window.__wbScannedSensors = window.__wbScannedSensors || {
        DA: null,
        DD: null,
        DT: null,
        TT: null,
    };

    const METER_SERIAL_MIN = 4;
    const METER_SERIAL_MAX = 16;

    function $(id) {
        return document.getElementById(id);
    }

    function readStepVal(stepId) {
        const inp = $('val_' + stepId);
        if (!inp || inp.disabled) {
            return '';
        }
        return String(inp.value || '').trim();
    }

    /** Семейство из п.200: ПК-ТМ-Р1.БТ → R1, ПК-ТМ-Т2 → T2. */
    function complexFamilyCodeFromDesignation(des) {
        const s = String(des || '')
            .toUpperCase()
            .replace(/\s+/g, '')
            .replace(/Ё/g, 'Е');
        const m = s.match(/ПК-?ТМ-?([РТRT])(\d+)/i) || s.match(/(?:^|[^A-Z0-9])([RTРТ])(\d+)/);
        if (!m) {
            return null;
        }
        const ch = m[1];
        const letter = ch === 'Р' || ch === 'R' ? 'R' : ch === 'Т' || ch === 'T' ? 'T' : null;
        if (!letter) {
            return null;
        }
        return letter + String(parseInt(m[2], 10));
    }

    function complexVerifyYearsForDesignation(des) {
        const fam = complexFamilyCodeFromDesignation(des);
        if (fam && COMPLEX_VERIFY_YEARS_BY_FAMILY[fam] != null) {
            return COMPLEX_VERIFY_YEARS_BY_FAMILY[fam];
        }
        return COMPLEX_VERIFY_NEXT_YEARS_DEFAULT;
    }

    /** Паспорт счётчика по п.100 / п.200 — для МПИ п.104. */
    function meterPassportFromSteps() {
        const name = String(readStepVal(100) || '')
            .toUpperCase()
            .replace(/Ё/g, 'Е');
        if (/ЭМИС|EMIS|РГС\s*245|RGS\s*245/.test(name)) {
            return 'emis-rgs245';
        }
        if (/ПРОМЕТР/.test(name)) {
            return 'prometr-r';
        }
        if (/RVG/.test(name) && /Б|К|B|K/.test(name)) {
            return 'rvg-bc';
        }
        if (/РВГ/.test(name) && /ИСП\.?\s*А|ИСП\s*А|\bА\b/.test(name)) {
            return 'rvg-a';
        }
        if (/РВГ/.test(name)) {
            return 'rvg-b';
        }
        if (/СГР|\bSGR\b/.test(name)) {
            return 'sgr';
        }
        if (/ТАУ|TAU|ТСГ/.test(name)) {
            return /ИСП\.?\s*Б|ИСП\s*Б/.test(name) ? 'tau-tsg-b' : 'tau-tsg-a';
        }
        if (/\bСГ\b|\bSG\b|T1-/.test(name)) {
            return 'sg';
        }
        const fam = complexFamilyCodeFromDesignation(readStepVal(200));
        const byFam = {
            R1: 'emis-rgs245',
            R2: 'prometr-r',
            R3: 'rvg-bc',
            R4: 'rvg-a',
            R5: 'rvg-b',
            R6: 'sgr',
            T1: 'sg',
            T2: 'tau-tsg-a',
        };
        return fam ? byFam[fam] || null : null;
    }

    function meterVerifyYearsForCurrent() {
        const passport = meterPassportFromSteps();
        const C = window.TM07_COMPLEX_METER_TYPES;
        if (C && typeof C.meterVerifyYearsForPassport === 'function') {
            return C.meterVerifyYearsForPassport(passport);
        }
        return METER_VERIFY_NEXT_YEARS_DEFAULT;
    }

    function pad2(n) {
        return String(n).padStart(2, '0');
    }

    function todayTDate() {
        const d = new Date();
        return pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + '.' + d.getFullYear();
    }

    function parseTDate(s) {
        const m = String(s || '')
            .trim()
            .match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/);
        if (!m) {
            return null;
        }
        return {
            day: parseInt(m[1], 10),
            month: parseInt(m[2], 10),
            year: parseInt(m[3], 10),
        };
    }

    function formatTDate(parts) {
        return pad2(parts.day) + '.' + pad2(parts.month) + '.' + parts.year;
    }

    function addYearsTDate(dateStr, years) {
        const p = parseTDate(dateStr);
        if (!p) {
            return null;
        }
        return formatTDate({ day: p.day, month: p.month, year: p.year + years });
    }

    function setStepIfEmpty(stepId, value, lines, note) {
        if (value == null || value === '') {
            return false;
        }
        const inp = $('val_' + stepId);
        if (!inp || inp.disabled) {
            return false;
        }
        const cur = String(inp.value || '').trim();
        // 00.00.0000 / одни нули — как пусто (заводской шаблон).
        if (cur && !/^0+[./\-]?0+[./\-]?0+$/.test(cur.replace(/\s/g, ''))) {
            return false;
        }
        inp.value = window.TM07_param_formatStepValue
            ? window.TM07_param_formatStepValue(stepId, value)
            : String(value);
        if (lines) {
            lines.push('п.' + stepId + ' ← ' + note);
        }
        return true;
    }

    function setStepValue(stepId, value, lines, note) {
        if (value == null || value === '') {
            return false;
        }
        const inp = $('val_' + stepId);
        if (!inp || inp.disabled) {
            return false;
        }
        inp.value = window.TM07_param_formatStepValue
            ? window.TM07_param_formatStepValue(stepId, value)
            : String(value);
        if (lines) {
            lines.push('п.' + stepId + ' ← ' + note);
        }
        return true;
    }

    function collectOrderTextBlob() {
        const ToParam = window.TM07Order1cToParam;
        let row = {};
        try {
            const raw =
                sessionStorage.getItem(
                    ToParam && ToParam.STORAGE_KEY ? ToParam.STORAGE_KEY : 'order1c_param_lastOrder'
                ) ||
                localStorage.getItem(
                    ToParam && ToParam.STORAGE_KEY ? ToParam.STORAGE_KEY : 'order1c_param_lastOrder'
                );
            if (raw) {
                const o = JSON.parse(raw);
                if (o && o.row) {
                    row = o.row;
                }
            }
        } catch (_e) {}
        const nom = readStepVal(200);
        if (ToParam && typeof ToParam.collectOrderTextBlob === 'function') {
            return ToParam.collectOrderTextBlob(row, nom);
        }
        return nom;
    }

    function getEquipmentFromOrder() {
        const C = window.TM07_CORRECTOR_EXECUTION;
        const text = collectOrderTextBlob();
        return C && C.detectEquipment ? C.detectEquipment(text) : { hasPpd: false, hasPttp: false };
    }

    /** Заказ на комплекс ПК-ТМ (иначе — только корректор ТМ-07). */
    function isComplexOrder() {
        const C = window.TM07_CORRECTOR_EXECUTION;
        const des = readStepVal(200);
        if (C && typeof C.isComplexCorrectorUsage === 'function' && C.isComplexCorrectorUsage(des)) {
            return true;
        }
        const text = collectOrderTextBlob();
        if (C && typeof C.isComplexCorrectorUsage === 'function' && C.isComplexCorrectorUsage(text)) {
            return true;
        }
        return /ПК-ТМ-/i.test(des || '') || /ПК-ТМ-/i.test(text || '');
    }

    function getRequiredSensorKeys() {
        const equip = getEquipmentFromOrder();
        const req = ['DA', 'DT'];
        if (equip.hasPpd) {
            req.push('DD');
        }
        if (equip.hasPttp) {
            req.push('TT');
        }
        return req;
    }

    function canonicalSensorKey(sensorType) {
        const t = String(sensorType || '').toUpperCase();
        const map = { DP: 'DD', TG: 'DT', TP: 'TT' };
        return map[t] || t;
    }

    /** Датчик из QR допускается только если он есть в заказе (не «доп.»). */
    function isSensorAllowedInOrder(sensorType) {
        const key = canonicalSensorKey(sensorType);
        if (!SENSOR_LABELS[key]) {
            return false;
        }
        return getRequiredSensorKeys().indexOf(key) >= 0;
    }

    function hasOrderContextForSensors() {
        if (readStepVal(200)) {
            return true;
        }
        const num = String(($('paramOrder1cNumber') || {}).value || '').trim();
        if (!num) {
            return false;
        }
        try {
            const ToParam = window.TM07Order1cToParam;
            const key =
                ToParam && ToParam.STORAGE_KEY ? ToParam.STORAGE_KEY : 'order1c_param_lastOrder';
            const raw = sessionStorage.getItem(key) || localStorage.getItem(key);
            if (!raw) {
                return false;
            }
            const o = JSON.parse(raw);
            return !!(o && o.row);
        } catch (_e) {
            return false;
        }
    }

    function sensorNotInOrderError(sensorType) {
        const key = canonicalSensorKey(sensorType);
        const label = SENSOR_LABELS[key] || key || String(sensorType || '');
        return (
            'Датчик «' +
            label +
            '» в заказе не предусмотрен — скан отклонён. Нужны только: ' +
            getRequiredSensorKeys()
                .map(function (k) {
                    return SENSOR_LABELS[k] || k;
                })
                .join(', ') +
            '.'
        );
    }

    /**
     * Снимок ожидаемых значений датчиков из заказа (после автозаполнения).
     * С ним сверяем QR: диапазоны и погрешность, не только тип DA/DD.
     */
    function captureOrderSensorExpectations() {
        function num(sid) {
            const s = readStepVal(sid);
            if (!s) {
                return null;
            }
            const n = parseFloat(String(s).replace(',', '.'));
            return Number.isFinite(n) ? n : null;
        }
        const expect = {
            DA: {
                pmin: num(6),
                pmax: num(7),
                accuracy: num(14),
            },
            DD: {
                pmin: num(10),
                pmax: num(11),
                accuracy: (function () {
                    const pmax = num(11);
                    const E = window.TM07_CORRECTOR_ERROR_LIMITS;
                    if (E && typeof E.nominalDeltaDpForPmax === 'function' && pmax != null) {
                        return E.nominalDeltaDpForPmax(pmax);
                    }
                    return num(18);
                })(),
            },
            DT: {
                tmin: num(8),
                tmax: num(9),
                accuracy: num(15),
            },
            TT: {
                tmin: num(12),
                tmax: num(13),
                accuracy: num(19),
            },
            capturedAt: Date.now(),
            orderHint: requiredSensorsHint(),
        };
        window.__wbOrderSensorExpect = expect;
        return expect;
    }

    function getOrderSensorExpectations() {
        return window.__wbOrderSensorExpect || null;
    }

    function nearlyEqual(a, b, absTol, relTol) {
        if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) {
            return true;
        }
        const d = Math.abs(a - b);
        const scale = Math.max(Math.abs(a), Math.abs(b), 1e-9);
        return d <= absTol || d <= scale * relTol;
    }

    /**
     * Сверка значений QR с ожиданием из заказа (диапазон / погрешность).
     * @param {object} parsed — результат парсера MIDA QR
     * @returns {{ok:boolean, error?:string, details?:string[]}}
     */
    function compareQrValuesWithOrder(parsed) {
        if (!parsed || parsed.tempSerialOnly) {
            return { ok: true, details: [] };
        }
        const key = canonicalSensorKey(parsed.sensorType);
        const expect = getOrderSensorExpectations();
        if (!expect || !expect[key]) {
            // Нет снимка — сравнить с текущими полями формы (заказ уже подставлен).
            captureOrderSensorExpectations();
        }
        const exp = (window.__wbOrderSensorExpect && window.__wbOrderSensorExpect[key]) || {};
        const details = [];
        const mismatches = [];

        if (key === 'DA' || key === 'DD') {
            const qrMin = parsed.rangeMinKpa;
            const qrMax = parsed.rangeMaxKpa;
            const qrAcc = parsed.accuracy != null ? Math.abs(parsed.accuracy) : null;
            // Допуск: 1 кПа или 1% (для малых ППД — 0.05 кПа)
            const absP = key === 'DD' ? 0.05 : 1;
            const relP = 0.01;
            if (exp.pmin != null && qrMin != null) {
                details.push(
                    'Pmin заказ ' + exp.pmin + ' кПа / QR ' + Number(qrMin).toFixed(2) + ' кПа'
                );
                if (!nearlyEqual(exp.pmin, qrMin, absP, relP)) {
                    mismatches.push(
                        'Pmin: заказ ' + exp.pmin + ' кПа ≠ QR ' + Number(qrMin).toFixed(2) + ' кПа'
                    );
                }
            }
            if (exp.pmax != null && qrMax != null) {
                details.push(
                    'Pmax заказ ' + exp.pmax + ' кПа / QR ' + Number(qrMax).toFixed(2) + ' кПа'
                );
                if (!nearlyEqual(exp.pmax, qrMax, absP, relP)) {
                    mismatches.push(
                        'Pmax: заказ ' + exp.pmax + ' кПа ≠ QR ' + Number(qrMax).toFixed(2) + ' кПа'
                    );
                }
            }
            if (exp.accuracy != null && qrAcc != null) {
                let expAcc = exp.accuracy;
                if (key === 'DD') {
                    const E = window.TM07_CORRECTOR_ERROR_LIMITS;
                    const pmaxForRule = exp.pmax != null ? exp.pmax : qrMax;
                    if (E && typeof E.nominalDeltaDpForPmax === 'function' && pmaxForRule != null) {
                        expAcc = E.nominalDeltaDpForPmax(pmaxForRule);
                    }
                }
                details.push('δ заказ ' + expAcc + '% / QR ' + Number(qrAcc).toFixed(2) + '%');
                if (!nearlyEqual(expAcc, qrAcc, 0.05, 0.02)) {
                    if (key === 'DD') {
                        // Норматив по диапазону важнее цифры на QR — в форму пишем правило.
                        details.push(
                            'δ.ΔP по диапазону → ' + expAcc + '% (QR ' + Number(qrAcc).toFixed(2) + '% игнор.)'
                        );
                    } else {
                        mismatches.push(
                            'погрешность: заказ ' +
                                exp.accuracy +
                                '% ≠ QR ' +
                                Number(qrAcc).toFixed(2) +
                                '%'
                        );
                    }
                }
            }
            if (exp.pmin == null && exp.pmax == null && exp.accuracy == null) {
                details.push('в заказе нет чисел диапазона для ' + key + ' — сверка значений пропущена');
            }
        } else if (key === 'DT' || key === 'TT') {
            // Полный QR температуры (редко): сверить погрешность, если есть.
            const qrAcc = parsed.accuracy;
            if (exp.accuracy != null && qrAcc != null) {
                details.push('δ заказ ' + exp.accuracy + ' / QR ' + Number(qrAcc).toFixed(2));
                if (!nearlyEqual(exp.accuracy, qrAcc, 0.05, 0.02)) {
                    mismatches.push(
                        'погрешность: заказ ' + exp.accuracy + ' ≠ QR ' + Number(qrAcc).toFixed(2)
                    );
                }
            }
        }

        if (mismatches.length) {
            return {
                ok: false,
                error:
                    'Значения QR не совпадают с заказом (' +
                    (SENSOR_LABELS[key] || key) +
                    '): ' +
                    mismatches.join('; ') +
                    '. Пикните датчик с тем же диапазоном, что в заказе.',
                details: details,
                mismatches: mismatches,
            };
        }
        return { ok: true, details: details };
    }

    /**
     * Жёсткая сверка QR/S/N с составом заказа.
     * @returns {{ok:boolean, error?:string, warning?:string, key?:string, valueCheck?:object}}
     */
    function validateSensorScanAgainstOrder(sensorType, serial, parsed) {
        if (!hasOrderContextForSensors()) {
            return {
                ok: false,
                error: 'Сначала загрузите заказ 1С — иначе нельзя проверить, тот ли датчик.',
            };
        }
        const key = canonicalSensorKey(sensorType);
        if (!SENSOR_LABELS[key]) {
            return {
                ok: false,
                error:
                    'Неизвестный тип датчика «' +
                    String(sensorType || '') +
                    '». Ожидаются DA / DD (перепад) / DT / TT.',
            };
        }
        if (!isSensorAllowedInOrder(key)) {
            return { ok: false, error: sensorNotInOrderError(key), key: key };
        }
        const sn = String(serial || '').trim();
        const prev = window.__wbScannedSensors && window.__wbScannedSensors[key];
        const prevSn = prev && prev.serial ? String(prev.serial).trim() : '';
        const fieldSn = readStepVal(sensorStepIds(key)[0] || 0);
        const existing = prevSn || fieldSn;
        if (existing && sn && existing !== sn) {
            return {
                ok: false,
                error:
                    'Канал «' +
                    (SENSOR_LABELS[key] || key) +
                    '» уже заполнен S/N ' +
                    existing +
                    ', а считан ' +
                    sn +
                    '. Это другой датчик — скан отклонён. Сбросьте канал или пикните правильный QR.',
                key: key,
            };
        }
        const valueCheck = compareQrValuesWithOrder(parsed || null);
        if (!valueCheck.ok) {
            return {
                ok: false,
                error: valueCheck.error,
                key: key,
                valueCheck: valueCheck,
            };
        }
        const next = getNextRequiredSensor();
        let warning = '';
        if (next && next !== key) {
            warning =
                'По порядку сейчас ожидается «' +
                (SENSOR_LABELS[next] || next) +
                '», считан «' +
                (SENSOR_LABELS[key] || key) +
                '» — тип из заказа, но не следующий в очереди.';
        }
        if (valueCheck.details && valueCheck.details.length) {
            warning = (warning ? warning + ' ' : '') + 'Сверка OK: ' + valueCheck.details.join('; ');
        }
        return { ok: true, key: key, warning: warning, valueCheck: valueCheck };
    }

    function requiredSensorsHint() {
        return getRequiredSensorKeys()
            .map(function (k) {
                const done = isSensorFilled(k);
                return (done ? '✓' : '○') + ' ' + (SENSOR_LABELS[k] || k);
            })
            .join(' · ');
    }

    /** Убрать из сессии сканы/поля датчиков, которых нет в заказе. */
    function purgeSensorsNotInOrder() {
        const required = getRequiredSensorKeys();
        const scanned = window.__wbScannedSensors || {};
        ['DA', 'DD', 'DT', 'TT'].forEach(function (key) {
            if (required.indexOf(key) >= 0) {
                return;
            }
            scanned[key] = null;
            sensorStepIds(key).forEach(function (sid) {
                const inp = $('val_' + sid);
                if (inp && !inp.disabled) {
                    inp.value = '';
                }
            });
        });
        window.__wbScannedSensors = scanned;
    }

    /** Скрыть/показать блоки счётчика и комплекса + строки перепада/TT в таблице. */
    function updateOrderScopeUi() {
        const complex = isComplexOrder();
        const equip = getEquipmentFromOrder();
        const meterPanel = $('paramMeterPanel') && $('paramMeterPanel').closest('.accordion-item');
        const complexPanel = $('paramComplexPanel') && $('paramComplexPanel').closest('.accordion-item');
        const meterSerialCard = $('wbMeterCard') || ($('paramMeterSerial') && $('paramMeterSerial').closest('.card'));
        [meterSerialCard, meterPanel, complexPanel].forEach(function (el) {
            if (el) {
                el.classList.toggle('d-none', !complex);
            }
        });
        // Перепад / TT: скрыть строки, если датчика нет в заказе (основные + комплекс + финал-зеркала).
        document.querySelectorAll('#paramTbody tr[data-step-id], #paramMeterTbody tr[data-step-id], #paramComplexTbody tr[data-step-id], #paramFinalTbody tr[data-step-id]').forEach(function (tr) {
            const sid = parseInt(tr.getAttribute('data-step-id'), 10);
            let hide = false;
            // ППД (перепад): диапазоны, погрешность, канал Dp, зеркала комплекса
            if (
                [10, 11, 18, 46, 47, 48, 49, 62, 63, 64, 65, 66, 215, 216, 223].indexOf(sid) >= 0
            ) {
                hide = !equip.hasPpd;
            }
            // ПТТП (темп. технолог.): диапазоны, погрешность, канал Tp, зеркала
            if (
                [12, 13, 19, 50, 51, 52, 53, 67, 68, 217, 218, 224].indexOf(sid) >= 0
            ) {
                hide = !equip.hasPttp;
            }
            tr.classList.toggle('d-none', hide);
            if (hide) {
                const inp = tr.querySelector('input.param-val');
                if (inp && !inp.disabled) {
                    // Режимы каналов оставляем «0» (выкл.) — их нужно записать в прибор.
                    if (sid === 63 || sid === 67) {
                        inp.value = '0';
                    } else {
                        inp.value = '';
                    }
                }
            }
        });
        const qrHint = document.querySelector('label[for="paramQrSensor"]');
        const qrHelp = qrHint && qrHint.parentElement && qrHint.parentElement.querySelector('.small.text-body-secondary');
        if (qrHelp) {
            const need = requiredSensorsHint();
            let tip = 'По заказу: ' + need + '. ';
            tip += 'Давление — полный QR MIDA. Температура газа (DT) — 4 цифры с наклейки.';
            if (equip.hasPpd) {
                tip =
                    'По заказу: ' +
                    need +
                    '. Давление и перепад — полный QR MIDA. Температура газа (DT) — 4 цифры.';
            }
            if (equip.hasPttp) {
                tip += ' Температура ТП (TT) — 4 цифры.';
            }
            tip += ' Чужой тип или другой диапазон/погрешность из QR будет отклонён.';
            qrHelp.textContent = tip;
        }
        void complex;
    }

    function sensorStepIds(key) {
        if (key === 'DA') {
            return [57];
        }
        if (key === 'DT') {
            return [61];
        }
        if (key === 'DD') {
            return [64];
        }
        if (key === 'TT') {
            return [68];
        }
        return [];
    }

    function isSensorFilled(key) {
        const scanned = window.__wbScannedSensors[key];
        if (scanned) {
            return true;
        }
        return sensorStepIds(key).some(function (sid) {
            return !!readStepVal(sid);
        });
    }

    function normalizeMeterSerial(raw) {
        return String(raw || '')
            .replace(/\s/g, '')
            .replace(/\D/g, '');
    }

    function isMeterSerialFilled() {
        const sn = readStepVal(102) || normalizeMeterSerial(($('paramMeterSerial') || {}).value);
        return sn.length >= METER_SERIAL_MIN && sn.length <= METER_SERIAL_MAX;
    }

    function getMeterSerial() {
        const fromStep = readStepVal(102);
        if (fromStep) {
            return normalizeMeterSerial(fromStep);
        }
        return normalizeMeterSerial(($('paramMeterSerial') || {}).value);
    }

    function paintMeterBadge() {
        const badge = $('wbMeterBadge');
        if (!badge) {
            return;
        }
        const ok = isMeterSerialFilled();
        badge.textContent = ok ? '✓ ' + getMeterSerial() : 'не введён';
        badge.className =
            'badge rounded-pill ms-auto ' + (ok ? 'text-bg-success' : 'text-bg-warning text-dark');
    }

    function setMeterSerialStatus(text, isError) {
        const st = $('paramMeterSerialStatus');
        if (!st) {
            return;
        }
        st.textContent = text || '';
        st.className = 'small mt-2 mb-0' + (isError ? ' text-danger' : text ? ' text-success' : ' text-body-secondary');
    }

    /**
     * @param {string} raw
     * @returns {{ok:boolean, error?:string, serial?:string}}
     */
    function applyMeterSerial(raw) {
        const sn = normalizeMeterSerial(raw);
        if (!sn) {
            return { ok: false, error: 'Введите серийный номер счётчика.' };
        }
        if (sn.length < METER_SERIAL_MIN || sn.length > METER_SERIAL_MAX) {
            return {
                ok: false,
                error: 'S/N счётчика — от ' + METER_SERIAL_MIN + ' до ' + METER_SERIAL_MAX + ' цифр.',
            };
        }
        const ui = $('paramMeterSerial');
        if (ui) {
            ui.value = sn;
        }
        const step = $('val_102');
        if (step && !step.disabled) {
            step.value = sn;
        }
        window.__wbMeterSerial = sn;
        paintMeterBadge();
        paintWorkflowSteps();
        // Даты поверки счётчика — только вручную / «Даты сегодня», не авто при S/N.
        syncMeterDateFieldsFromSteps();
        setMeterSerialStatus('✓ п.102 ← ' + sn, false);
        const le = $('paramLog');
        if (le) {
            const t = new Date().toLocaleTimeString();
            le.innerHTML += '[' + t + '] [METER] S/N счётчика ' + sn + ' → п.102<br>';
            le.scrollTop = le.scrollHeight;
        }
        try {
            window.dispatchEvent(new CustomEvent('tm07-meter-serial-applied', { detail: { serial: sn } }));
        } catch (_e) {}
        return { ok: true, serial: sn };
    }

    function resetMeterSerial() {
        window.__wbMeterSerial = null;
        const ui = $('paramMeterSerial');
        if (ui) {
            ui.value = '';
        }
        const d103 = $('paramMeterVerifyDate');
        const d104 = $('paramMeterVerifyNext');
        if (d103) {
            d103.value = '';
        }
        if (d104) {
            d104.value = '';
        }
        setMeterSerialStatus('', false);
        paintMeterBadge();
    }

    function focusMeterInput() {
        const inp = $('paramMeterSerial');
        if (inp) {
            inp.focus();
        }
    }

    function syncMeterSerialFromStep() {
        const sn = readStepVal(102);
        if (!sn) {
            return;
        }
        const ui = $('paramMeterSerial');
        if (ui && !normalizeMeterSerial(ui.value)) {
            ui.value = normalizeMeterSerial(sn);
        }
        syncMeterDateFieldsFromSteps();
        paintMeterBadge();
    }

    function initMeterSerialPanel() {
        const inp = $('paramMeterSerial');
        if (!inp) {
            return;
        }
        function runApply() {
            const r = applyMeterSerial(inp.value);
            if (!r.ok) {
                setMeterSerialStatus(r.error || 'Ошибка', true);
                return;
            }
            inp.select();
        }
        inp.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                runApply();
            }
        });
        inp.addEventListener('change', function () {
            if (normalizeMeterSerial(inp.value).length >= METER_SERIAL_MIN) {
                runApply();
            }
        });

        const d103 = $('paramMeterVerifyDate');
        const d104 = $('paramMeterVerifyNext');
        function pushDates() {
            applyMeterDateFieldsToSteps();
            syncMeterDateFieldsFromSteps();
        }
        d103?.addEventListener('change', pushDates);
        d104?.addEventListener('change', pushDates);

        $('paramMeterDatesToday')?.addEventListener('click', function () {
            if (!isMeterSerialFilled()) {
                const r = applyMeterSerial(inp.value);
                if (!r.ok) {
                    setMeterSerialStatus(r.error || 'Сначала введите S/N счётчика', true);
                    return;
                }
            }
            applyMeterVerificationDates(true);
            setMeterSerialStatus('✓ п.103/104 ← сегодня / +МПИ', false);
        });
    }

    function getNextRequiredSensor() {
        const keys = getRequiredSensorKeys();
        for (let i = 0; i < keys.length; i += 1) {
            if (!isSensorFilled(keys[i])) {
                return keys[i];
            }
        }
        return null;
    }

    function markSensorScanned(sensorType, serial) {
        const key = canonicalSensorKey(sensorType);
        if (!SENSOR_LABELS[key]) {
            return false;
        }
        if (!isSensorAllowedInOrder(key)) {
            return false;
        }
        window.__wbScannedSensors[key] = String(serial || '').trim() || '1';
        paintSensorBadges();
        paintWorkflowSteps();
        try {
            window.dispatchEvent(
                new CustomEvent('tm07-qr-scanned', {
                    detail: { sensorType: sensorType, serial: serial },
                })
            );
        } catch (_e) {}
        return true;
    }

    function resetScannedSensors() {
        window.__wbScannedSensors = { DA: null, DD: null, DT: null, TT: null };
        paintSensorBadges();
    }

    function defaultValueForStep(step) {
        if (!step) {
            return '';
        }
        if (step.defaultVal != null) {
            return String(step.defaultVal);
        }
        if (step.defaultNum != null) {
            if (step.type === 'f' || step.type === 'd') {
                return Number(step.defaultNum).toFixed(2);
            }
            return String(step.defaultNum);
        }
        if (step.defaultHex != null) {
            return String(step.defaultHex);
        }
        return '';
    }

    /** После сброса сессии вернуть дефолты (в т.ч. финал из таблиц токов/моточасов). */
    function restoreParamStepDefaults() {
        const packs = [];
        const doc = window.TM07_PARAMETRIZATION_DOC;
        if (doc && Array.isArray(doc.steps)) {
            packs.push(doc.steps);
        }
        const extra = window.TM07_PARAMETRIZATION_EXTRA;
        if (extra && Array.isArray(extra.sections)) {
            extra.sections.forEach(function (sec) {
                if (sec && Array.isArray(sec.steps)) {
                    packs.push(sec.steps);
                }
            });
        }
        packs.forEach(function (steps) {
            steps.forEach(function (step) {
                if (!step || step.type === 'x' || step.readOnly) {
                    return;
                }
                const inp = document.getElementById('val_' + step.id);
                if (!inp || inp.disabled) {
                    return;
                }
                if (String(inp.value || '').trim() !== '') {
                    return;
                }
                const v = defaultValueForStep(step);
                if (v !== '') {
                    inp.value = v;
                }
            });
        });
    }

    function clearParamFieldValues() {
        document.querySelectorAll('input.param-val[id^="val_"]').forEach(function (inp) {
            if (!inp.disabled) {
                inp.value = '';
            }
        });
        window.__wbOrderSensorExpect = null;
        restoreParamStepDefaults();
    }

    function resetAllForNewSession() {
        resetScannedSensors();
        resetMeterSerial();
        clearParamFieldValues();
        const qr = $('paramQrSensor');
        if (qr) {
            qr.value = '';
        }
        const qrSt = $('paramQrStatus');
        if (qrSt) {
            qrSt.textContent = '';
        }
        paintSensorBadges();
        paintMeterBadge();
        paintWorkflowSteps();
    }

    function paintSensorBadges() {
        const host = $('wbSensorBadges');
        if (!host) {
            return;
        }
        purgeSensorsNotInOrder();
        updateOrderScopeUi();
        const required = getRequiredSensorKeys();
        host.innerHTML = '';
        required.forEach(function (key) {
            const done = isSensorFilled(key);
            const span = document.createElement('span');
            span.className =
                'badge rounded-pill ' +
                (done ? 'text-bg-success' : 'text-bg-warning text-dark');
            span.textContent = (done ? '✓ ' : '○ ') + (SENSOR_LABELS[key] || key);
            host.appendChild(span);
        });
    }

    function paintWorkflowSteps() {
        const steps = document.querySelectorAll('.bench-op-workflow .bench-op-step');
        if (!steps.length) {
            return;
        }
        const events = window.TM07_BENCH_EVENTS;
        const hasOrder =
            (events && events.hasActiveOrder && events.hasActiveOrder()) ||
            !!readStepVal(200) ||
            !!($('paramOrder1cNumber') || {}).value;
        const stage = events && events.getSessionStage ? events.getSessionStage() : null;
        const assemblyDone = stage === 'parametrization' || stage === 'completed';
        const serial = readStepVal(3);
        const connected =
            window.TM07_PARAM_KAO &&
            typeof window.TM07_PARAM_KAO.isConnected === 'function' &&
            window.TM07_PARAM_KAO.isConnected();
        const orderReady = !!readStepVal(200) || !!($('paramOrder1cNumber') || {}).value;
        const required = getRequiredSensorKeys();
        const scansDone = required.every(isSensorFilled);

        steps.forEach(function (el) {
            el.classList.remove('is-current', 'is-done');
        });

        let current = 0;
        if (hasOrder) {
            current = 1;
        }
        if (hasOrder && serial) {
            current = 1;
        }
        if (hasOrder && assemblyDone) {
            current = 2;
        }
        if (assemblyDone && connected) {
            current = 3;
        }
        if (assemblyDone && connected && orderReady) {
            current = 4;
        }
        if (assemblyDone && connected && orderReady && scansDone) {
            current = 5;
        }
        if (assemblyDone && connected && orderReady && scansDone && isMeterSerialFilled()) {
            current = 6;
        }
        const post = window.__wbPostWrite || {};
        if (stage === 'completed' || (post.writeOk && post.verifyOk)) {
            current = 7;
        }
        if (stage === 'completed' || (post.writeOk && post.verifyOk && post.passportOk)) {
            current = 8;
        }

        steps.forEach(function (el, i) {
            if (i < current) {
                el.classList.add('is-done');
            } else if (i === current) {
                el.classList.add('is-current');
            }
        });
    }

    function applyMeterVerificationDates(force) {
        const out = [];
        if (!isMeterSerialFilled() && !force) {
            return 0;
        }
        const today = todayTDate();
        const meterYears = meterVerifyYearsForCurrent();
        const nextMeter = addYearsTDate(today, meterYears);
        const meterPass = meterPassportFromSteps();
        const setFn = force ? setStepValue : setStepIfEmpty;
        setFn(103, today, out, 'дата поверки (сегодня)');
        setFn(
            104,
            nextMeter,
            out,
            '+' + meterYears + ' лет' + (meterPass ? ' (' + meterPass + ')' : '')
        );
        syncMeterDateFieldsFromSteps();
        return out.length;
    }

    function syncMeterDateFieldsFromSteps() {
        const d103 = readStepVal(103);
        const d104 = readStepVal(104);
        const inp103 = $('paramMeterVerifyDate');
        const inp104 = $('paramMeterVerifyNext');
        if (inp103 && d103) {
            inp103.value = d103;
        }
        if (inp104 && d104) {
            inp104.value = d104;
        }
    }

    function applyMeterDateFieldsToSteps() {
        const d103 = String(($('paramMeterVerifyDate') || {}).value || '').trim();
        const d104 = String(($('paramMeterVerifyNext') || {}).value || '').trim();
        if (d103 && /^\d{2}\.\d{2}\.\d{4}$/.test(d103)) {
            setStepValue(103, d103, null, 'из карточки счётчика');
        }
        if (d104 && /^\d{2}\.\d{2}\.\d{4}$/.test(d104)) {
            setStepValue(104, d104, null, 'из карточки счётчика');
        }
    }

    function validateMeterForWrite() {
        const errors = [];
        if (!isMeterSerialFilled()) {
            errors.push('Введите серийный номер счётчика (п.102, 4–16 цифр).');
        }
        applyMeterDateFieldsToSteps();
        const d103 = readStepVal(103);
        const d104 = readStepVal(104);
        if (!d103 || !/^\d{2}\.\d{2}\.\d{4}$/.test(d103)) {
            errors.push('Укажите дату поверки счётчика (п.103, ДД.ММ.ГГГГ).');
        }
        if (!d104 || !/^\d{2}\.\d{2}\.\d{4}$/.test(d104)) {
            errors.push('Укажите дату следующей поверки счётчика (п.104, ДД.ММ.ГГГГ).');
        }
        return { ok: errors.length === 0, errors: errors };
    }

    function applyVerificationAndDefaults(lines) {
        const out = lines || [];

        // Даты поверки счётчика — не авто (только кнопка «Даты сегодня» / ручной ввод).
        syncMeterDateFieldsFromSteps();

        // п.202/203 — 00.00.0000 (не подставлять «сегодня»).
        setStepIfEmpty(202, '00.00.0000', out, 'дата поверки комплекса → 00.00.0000');
        setStepIfEmpty(203, '00.00.0000', out, 'дата след. поверки комплекса → 00.00.0000');

        const C = window.TM07_COMPLEX_METER_TYPES;
        const code101 = readStepVal(101);
        let mechMax = null;
        if (C && typeof C.counterMechMaxForType === 'function' && code101) {
            mechMax = C.counterMechMaxForType(code101);
        }
        if (!mechMax && window.TM07_EMIS_RGS245 && typeof window.TM07_EMIS_RGS245.counterMechMaxForType === 'function' && code101) {
            mechMax = window.TM07_EMIS_RGS245.counterMechMaxForType(code101);
        }
        setStepIfEmpty(
            121,
            mechMax || '999999',
            out,
            mechMax && code101
                ? 'макс. счётного механизма по РЭ (' + code101 + ')'
                : 'макс. счётного механизма (запас)'
        );
        setStepIfEmpty(107, '0', out, 'накопленный объём → 0');
        // п.122/229 — только из заказа (parseFlowDirection) или вручную; без тихого «0».
        // п.228 не заполняем (по паспорту «-»). п.227 — из БТ1/2/3 заказа.
        const btName = resolveTelemetryBlockName();
        setStepValue(227, btName, out, 'блок телеметрии / БТ');

        return out.length;
    }

    function hasManufacturerKey() {
        try {
            const hidden = $('paramLkgHex');
            if (hidden && hidden.dataset && hidden.dataset.mfgReady === '1') {
                return true;
            }
        } catch (_e) {}
        return !!(window.__paramLkgManufacturerReady === true);
    }

    function hasSupplierKey() {
        try {
            const hidden = $('paramLkgHex');
            if (hidden && hidden.dataset && hidden.dataset.supplierReady === '1') {
                return true;
            }
        } catch (_e) {}
        return !!(window.__paramLkgSupplierReady === true);
    }

    function paintLkgStatusBadge() {
        const badge = $('paramLkgStatus');
        if (!badge) {
            return;
        }
        const supplier = hasSupplierKey();
        const mfg = hasManufacturerKey();
        if (supplier && mfg) {
            badge.textContent = 'ЛКГ ✓';
            badge.className = 'badge rounded-pill text-bg-success';
            badge.title = 'Ключи поставщика и производителя загружены (.env или админка)';
        } else if (supplier) {
            badge.textContent = 'ЛКГ поставщик';
            badge.className = 'badge rounded-pill text-bg-warning text-dark';
            badge.title =
                'Нет ключа производителя — п.3/4/5 не запишутся. Задайте TM07_MANUFACTURER_LKG_HEX в .env или в админке → ТМ-07';
        } else {
            badge.textContent = 'ЛКГ нет';
            badge.className = 'badge rounded-pill text-bg-danger';
            badge.title =
                'Задайте TM07_SUPPLIER_LKG_HEX в .env или ключ поставщика в админке → ТМ-07';
        }
    }

    async function refreshLkgStatusFromServer() {
        try {
            let settings = null;
            if (window.TM07_SETTINGS && typeof window.TM07_SETTINGS.getDeviceSettings === 'function') {
                settings = await window.TM07_SETTINGS.getDeviceSettings();
            } else {
                const r = await fetch('/api/admin-settings.php?action=bench', { credentials: 'same-origin' });
                const j = await r.json();
                settings = j && j.success ? j.settings : null;
            }
            if (!settings) {
                paintLkgStatusBadge();
                return;
            }
            const t = settings.tm07 || {};
            const br = settings.benchRegisters || {};
            const supplierRaw = String(t.supplierLkgHex || br.corrLkgHex || '').trim();
            const mfgRaw = String(t.manufacturerLkgHex || '').trim();
            const supplierOk = /^\s*[0-9A-Fa-f]{2}(\s+[0-9A-Fa-f]{2}){3}\s*$/.test(supplierRaw);
            const mfgOk = mfgRaw.length >= 11;
            window.__paramLkgSupplierReady = supplierOk;
            window.__paramLkgManufacturerReady = mfgOk;
            const hexEl = $('paramLkgHex');
            if (hexEl && hexEl.dataset) {
                hexEl.dataset.supplierReady = supplierOk ? '1' : '0';
                hexEl.dataset.mfgReady = mfgOk ? '1' : '0';
            }
        } catch (_e) {
            /* keep previous flags */
        }
        paintLkgStatusBadge();
    }

    function validateBeforeParametrize() {
        const errors = [];
        const warnings = [];

        if (
            !window.TM07_BENCH_EVENTS ||
            typeof window.TM07_BENCH_EVENTS.hasOperator !== 'function' ||
            !window.TM07_BENCH_EVENTS.hasOperator()
        ) {
            errors.push('Войдите как оператор (кнопка «Оператор» — фамилия и имя).');
        }

        if (
            !window.TM07_BENCH_EVENTS ||
            typeof window.TM07_BENCH_EVENTS.hasActiveOrder !== 'function' ||
            !window.TM07_BENCH_EVENTS.hasActiveOrder()
        ) {
            errors.push('Откройте сессию заказа (введите номер и «Войти в заказ»).');
        }

        if (
            window.TM07_BENCH_EVENTS &&
            typeof window.TM07_BENCH_EVENTS.canAccessParametrization === 'function' &&
            !window.TM07_BENCH_EVENTS.canAccessParametrization()
        ) {
            const stage =
                window.TM07_BENCH_EVENTS.getSessionStage &&
                window.TM07_BENCH_EVENTS.getSessionStage();
            if (stage === 'completed') {
                errors.push('Параметризация по этой сессии уже завершена — начните новую сессию.');
            } else {
                errors.push('Подтвердите сборку корректора (S/N и кнопка «Подтвердить сборку»).');
            }
        }

        if (!readStepVal(3) && !window.__wbAssemblyCorrectorSerial) {
            errors.push('S/N корректора (п.3) не задан — сгенерируйте на карточке сборки.');
        }

        if (
            !window.TM07_PARAM_KAO ||
            typeof window.TM07_PARAM_KAO.isConnected !== 'function' ||
            !window.TM07_PARAM_KAO.isConnected()
        ) {
            errors.push('Подключите КАО (кнопка «КАО»).');
        }

        const orderNum = ($('paramOrder1cNumber') || {}).value;
        if (!String(orderNum || '').trim()) {
            errors.push('Введите номер заказа 1С.');
        }

        if (!readStepVal(200) && !readStepVal(6)) {
            warnings.push('Заказ не загружен или параметры пусты — дождитесь автозагрузки.');
        }

        const pmin = parseFloat(String(readStepVal(6) || '').replace(',', '.'));
        if (Number.isFinite(pmin) && pmin <= 0) {
            errors.push('Pmin (п.6) = 0 — перезагрузите заказ 1С или проверьте характеристику ПАД(…).');
        }

        getRequiredSensorKeys().forEach(function (key) {
            if (!isSensorFilled(key)) {
                errors.push('Отсканируйте QR датчика: ' + (SENSOR_LABELS[key] || key) + '.');
            }
        });
        // Доп. контроль: в сессии не должно остаться «лишних» каналов вне заказа.
        ['DA', 'DD', 'DT', 'TT'].forEach(function (key) {
            if (getRequiredSensorKeys().indexOf(key) >= 0) {
                return;
            }
            if (isSensorFilled(key)) {
                errors.push(
                    'В форме есть датчик «' +
                        (SENSOR_LABELS[key] || key) +
                        '», которого нет в заказе — сбросьте сессию или перезагрузите заказ.'
                );
            }
        });

        if (isComplexOrder()) {
            // Счётчик часто монтируют позже — не блокируем параметризацию корректора.
            if (!isMeterSerialFilled()) {
                warnings.push(
                    'S/N счётчика пока нет — параметризация корректора продолжится. Введите п.102–104 позже и нажмите «Записать счётчик».'
                );
            }

            const dir122 = readStepVal(122);
            const dir229 = readStepVal(229);
            if (dir122 === '' || dir229 === '') {
                errors.push(
                    'Укажите направление потока (п.122 и п.229): из характеристики заказа («справа налево»…) или вручную (0–3).'
                );
            } else if (!/^[0-3]$/.test(dir122) || !/^[0-3]$/.test(dir229)) {
                errors.push('Направление п.122/229 должно быть 0…3 (слева направо / справа налево / сверху вниз / снизу вверх).');
            } else if (dir122 !== dir229) {
                warnings.push('п.122 (' + dir122 + ') ≠ п.229 (' + dir229 + ') — проверьте направление счётчика и комплекса.');
            }
        }

        if (!hasSupplierKey()) {
            errors.push(
                'Нет ключа ЛКГ поставщика — задайте TM07_SUPPLIER_LKG_HEX в .env или в админке → ТМ-07.'
            );
        }

        if (!hasManufacturerKey()) {
            warnings.push(
                'Нет ключа производителя — п.3/4/5 (S/N корректора) не запишутся. Задайте в админке → ТМ-07.'
            );
        }

        return {
            ok: errors.length === 0,
            errors: errors,
            warnings: warnings,
            requiredSensors: getRequiredSensorKeys(),
        };
    }

    function focusQrInput() {
        const inp = $('paramQrSensor');
        if (inp) {
            inp.focus();
        }
    }

    function initWorkbenchOps() {
        if (!document.body.classList.contains('wb-page')) {
            return;
        }

        paintSensorBadges();
        paintMeterBadge();
        paintWorkflowSteps();
        paintLkgStatusBadge();
        initMeterSerialPanel();
        syncMeterSerialFromStep();
        updateOrderScopeUi();
        void refreshLkgStatusFromServer();

        window.addEventListener('tm07-order-applied', function () {
            paintSensorBadges();
            updateOrderScopeUi();
            paintWorkflowSteps();
        });

        const conn = $('paramConnStatus');
        if (conn) {
            new MutationObserver(paintWorkflowSteps).observe(conn, {
                childList: true,
                characterData: true,
                subtree: true,
            });
        }

        const orderInput = $('paramOrder1cNumber');
        orderInput?.addEventListener('change', function () {
            resetScannedSensors();
            resetMeterSerial();
            paintSensorBadges();
        });

        window.addEventListener('tm07-order-session-changed', function () {
            paintWorkflowSteps();
        });

        window.addEventListener('tm07-lkg-ready', function () {
            paintLkgStatusBadge();
        });

        window.addEventListener('tm07-order-applied', function () {
            paintSensorBadges();
            paintMeterBadge();
            paintWorkflowSteps();
            focusQrInput();
        });

        window.addEventListener('tm07-qr-scanned', function () {
            const o = window.TM07_WORKBENCH_OPS;
            if (o && typeof o.getNextRequiredSensor === 'function' && !o.getNextRequiredSensor()) {
                focusMeterInput();
            }
        });
    }

    window.TM07_WORKBENCH_OPS = {
        SENSOR_LABELS: SENSOR_LABELS,
        getRequiredSensorKeys: getRequiredSensorKeys,
        getNextRequiredSensor: getNextRequiredSensor,
        isSensorAllowedInOrder: isSensorAllowedInOrder,
        sensorNotInOrderError: sensorNotInOrderError,
        validateSensorScanAgainstOrder: validateSensorScanAgainstOrder,
        hasOrderContextForSensors: hasOrderContextForSensors,
        requiredSensorsHint: requiredSensorsHint,
        purgeSensorsNotInOrder: purgeSensorsNotInOrder,
        isSensorFilled: isSensorFilled,
        markSensorScanned: markSensorScanned,
        resetScannedSensors: resetScannedSensors,
        clearParamFieldValues: clearParamFieldValues,
        resetAllForNewSession: resetAllForNewSession,
        paintSensorBadges: paintSensorBadges,
        paintWorkflowSteps: paintWorkflowSteps,
        applyVerificationAndDefaults: applyVerificationAndDefaults,
        resolveTelemetryBlockName: resolveTelemetryBlockName,
        validateBeforeParametrize: validateBeforeParametrize,
        focusQrInput: focusQrInput,
        focusMeterInput: focusMeterInput,
        isMeterSerialFilled: isMeterSerialFilled,
        isComplexOrder: isComplexOrder,
        getEquipmentFromOrder: getEquipmentFromOrder,
        collectOrderTextBlob: collectOrderTextBlob,
        updateOrderScopeUi: updateOrderScopeUi,
        isSensorAllowedInOrder: isSensorAllowedInOrder,
        sensorNotInOrderError: sensorNotInOrderError,
        validateSensorScanAgainstOrder: validateSensorScanAgainstOrder,
        hasOrderContextForSensors: hasOrderContextForSensors,
        requiredSensorsHint: requiredSensorsHint,
        captureOrderSensorExpectations: captureOrderSensorExpectations,
        compareQrValuesWithOrder: compareQrValuesWithOrder,
        getOrderSensorExpectations: getOrderSensorExpectations,
        canonicalSensorKey: canonicalSensorKey,
        purgeSensorsNotInOrder: purgeSensorsNotInOrder,
        applyMeterSerial: applyMeterSerial,
        resetMeterSerial: resetMeterSerial,
        paintMeterBadge: paintMeterBadge,
        syncMeterSerialFromStep: syncMeterSerialFromStep,
        applyMeterVerificationDates: applyMeterVerificationDates,
        syncMeterDateFieldsFromSteps: syncMeterDateFieldsFromSteps,
        applyMeterDateFieldsToSteps: applyMeterDateFieldsToSteps,
        validateMeterForWrite: validateMeterForWrite,
        paintLkgStatusBadge: paintLkgStatusBadge,
        refreshLkgStatusFromServer: refreshLkgStatusFromServer,
        shouldWriteSensorMemory: function (stepId) {
            // п.59/66 — не в автопакете (как CorrReader): только вручную при необходимости.
            void stepId;
            return false;
        },
        normalizeSensorKey: function (type) {
            const t = String(type || '')
                .trim()
                .toUpperCase();
            if (t === 'DP') {
                return 'DD';
            }
            if (t === 'TG') {
                return 'DT';
            }
            if (t === 'TP') {
                return 'TT';
            }
            return t;
        },
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initWorkbenchOps);
    } else {
        initWorkbenchOps();
    }
})();
