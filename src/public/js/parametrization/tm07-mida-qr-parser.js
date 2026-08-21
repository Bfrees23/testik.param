/**
 * Парсер QR/штрихкода датчиков MIDA для параметризации ТМ-07.
 * Формат: серийный;MIDA;тип;15;EX;IP65;погрешн.;Pmin;Pmax;MPa;код;выход
 * Пример: 24428615;MIDA;DA;15;EX;IP65;0.25;0.08;0.2;MPa;064;DINC
 * (0.25 — погрешность %, 0.08 — низ диапазона, 0.2 — верх диапазона)
 */
(function () {
    'use strict';

    const MIDA_VENDOR = 'MIDA';

    /** @type {Record<string, object>} */
    const CHANNELS = {
        DA: {
            label: 'абс. давление газа',
            steps: {
                55: '1',
                56: '2',
                57: null,
                59: '1',
                6: null,
                7: null,
                14: null,
            },
        },
        DD: {
            label: 'перепад давления',
            steps: {
                62: '1',
                63: '1',
                64: null,
                // п.66 (запомнить ЧЭ) — не авто; только вручную при необходимости
                10: null,
                11: null,
                18: null,
            },
        },
        DP: {
            label: 'перепад давления',
            steps: {
                62: '1',
                63: '1',
                64: null,
                10: null,
                11: null,
                18: null,
            },
        },
        DT: {
            label: 'температура газа',
            steps: {
                60: '2',
                61: null,
                15: null,
            },
        },
        TG: {
            label: 'температура газа',
            steps: {
                60: '2',
                61: null,
                15: null,
            },
        },
        TT: {
            label: 'температура техн. параметров',
            steps: {
                67: '1',
                68: null,
                19: null,
            },
        },
        TP: {
            label: 'температура техн. параметров',
            steps: {
                67: '1',
                68: null,
                19: null,
            },
        },
    };

    /** Русская раскладка → латиница (USB-сканер шлёт коды клавиш US QWERTY). */
    const SCANNER_LAYOUT_RU =
        'ёйцукенгшщзхъфывапролджэячсмитьбю' +
        'ЁЙЦУКЕНГШЩЗХЪФЫВАПРОЛДЖЭЯЧСМИТЬБЮ';
    const SCANNER_LAYOUT_EN =
        '`qwertyuiop[]asdfghjkl;\'zxcvbnm,.' +
        '~QWERTYUIOP{}ASDFGHJKL:"ZXCVBNM<>?';
    const scannerLayoutMap = {};
    for (let i = 0; i < SCANNER_LAYOUT_RU.length; i += 1) {
        scannerLayoutMap[SCANNER_LAYOUT_RU[i]] = SCANNER_LAYOUT_EN[i];
    }

    function fixScannerKeyboardLayout(raw) {
        return String(raw || '')
            .split('')
            .map(function (ch) {
                return scannerLayoutMap[ch] != null ? scannerLayoutMap[ch] : ch;
            })
            .join('');
    }

    function normalizeQrText(raw) {
        return fixScannerKeyboardLayout(String(raw || ''))
            .trim()
            .replace(/[\r\n]+/g, '')
            .replace(/\s+/g, '');
    }

    function parseNum(s) {
        const n = parseFloat(String(s || '').replace(',', '.'));
        return Number.isFinite(n) ? n : null;
    }

    function pressureToKpa(value, unit) {
        const n = parseNum(value);
        if (n == null) {
            return null;
        }
        const u = String(unit || 'MPa').toUpperCase();
        if (u === 'MPA' || u === 'МПА') {
            return n * 1000;
        }
        if (u === 'KPA' || u === 'КПА') {
            return n;
        }
        if (u === 'BAR' || u === 'БАР') {
            return n * 100;
        }
        return n * 1000;
    }

    function f2(n) {
        return Number(n).toFixed(2);
    }

    /** Диапазон давления в кПа: без минусов, min ≤ max. */
    function normalizePressureRangeKpa(minKpa, maxKpa) {
        let lo = minKpa != null && Number.isFinite(minKpa) ? Math.abs(minKpa) : null;
        let hi = maxKpa != null && Number.isFinite(maxKpa) ? Math.abs(maxKpa) : null;
        if (lo != null && hi != null && lo > hi) {
            const t = lo;
            lo = hi;
            hi = t;
        }
        return { minKpa: lo, maxKpa: hi };
    }

    function isTempSensorType(t) {
        const u = String(t || '').toUpperCase();
        return u === 'DT' || u === 'TG' || u === 'TT' || u === 'TP';
    }

    /** S/N температурников в приборе — 4 цифры (п.61, п.68). */
    function formatTempSerial(serial) {
        const d = String(serial || '').replace(/\D/g, '');
        if (!d) {
            return '';
        }
        if (d.length <= 4) {
            return d.padStart(4, '0');
        }
        return d.slice(-4);
    }

    function resolveTempSensorTarget() {
        const Ops = window.TM07_WORKBENCH_OPS;
        if (Ops && typeof Ops.getNextRequiredSensor === 'function') {
            const next = Ops.getNextRequiredSensor();
            if (next === 'DT' || next === 'TT') {
                return { sensorType: next };
            }
            if (next === 'DA' || next === 'DD') {
                return {
                    error:
                        'Сейчас нужен QR MIDA (давление' +
                        (next === 'DD' ? '/перепад' : '') +
                        '). Температурный S/N — 4 цифры на шаге DT или TT.',
                };
            }
            return { error: 'Все требуемые температурные датчики уже введены.' };
        }
        const allowed =
            Ops && typeof Ops.isSensorAllowedInOrder === 'function'
                ? function (k) {
                      return Ops.isSensorAllowedInOrder(k);
                  }
                : function () {
                      return true;
                  };
        const v61 = document.getElementById('val_61');
        const v68 = document.getElementById('val_68');
        if (allowed('DT') && v61 && !String(v61.value || '').trim()) {
            return { sensorType: 'DT' };
        }
        if (allowed('TT') && v68 && !String(v68.value || '').trim()) {
            return { sensorType: 'TT' };
        }
        return { error: 'Температурные S/N уже введены или не требуются по заказу.' };
    }

    /**
     * 4 цифры — отдельный ввод S/N температурного датчика (без QR MIDA).
     * @param {string} raw
     */
    function parseTempSerialLine(raw) {
        const text = normalizeQrText(raw);
        if (!/^\d{4}$/.test(text)) {
            return { ok: false };
        }
        const target = resolveTempSensorTarget();
        if (target.error) {
            return { ok: false, error: target.error };
        }
        const sensorType = target.sensorType;
        const channel = CHANNELS[sensorType];
        if (!channel) {
            return { ok: false, error: 'Неизвестный тип температурного датчика' };
        }
        return {
            ok: true,
            parsed: {
                serial: text,
                vendor: '',
                sensorType: sensorType,
                channel: channel,
                tempSerialOnly: true,
            },
        };
    }

    /**
     * @param {string} raw
     * @returns {{ok:boolean, error?:string, fields?:string[], parsed?:object}}
     */
    function parseMidaQrLine(raw) {
        const text = normalizeQrText(raw);
        if (!text) {
            return { ok: false, error: 'Пустая строка' };
        }
        if (/^\d{4}$/.test(text)) {
            return { ok: false, error: 'TEMP_SERIAL' };
        }
        const fields = text.split(';').map((p) => p.trim());
        if (fields.length < 3) {
            return { ok: false, error: 'Ожидается формат с полями через «;»' };
        }
        const vendor = String(fields[1] || '').toUpperCase();
        const sensorType = String(fields[2] || '').toUpperCase();
        if (vendor !== MIDA_VENDOR) {
            return { ok: false, error: 'Поддерживается только MIDA, получено: ' + (fields[1] || '—') };
        }
        const channel = CHANNELS[sensorType];
        if (!channel) {
            return {
                ok: false,
                error: 'Неизвестный тип датчика «' + sensorType + '» (ожидается DA, DD, DT, TT…)',
            };
        }
        const serial = String(fields[0] || '').replace(/\D/g, '');
        if (!serial) {
            return { ok: false, error: 'Нет серийного номера в первом поле' };
        }
        const unit = fields[9] || 'MPa';
        const accuracy = parseNum(fields[6]);
        const rangeMinKpa = pressureToKpa(fields[7], unit);
        const rangeMaxKpa = pressureToKpa(fields[8], unit);

        return {
            ok: true,
            fields: fields,
            parsed: {
                serial: serial,
                vendor: vendor,
                sensorType: sensorType,
                series: fields[3] || '',
                ex: fields[4] || '',
                ip: fields[5] || '',
                accuracyRaw: fields[6] || '',
                rangeMinRaw: fields[7] || '',
                rangeMaxRaw: fields[8] || '',
                accuracy: accuracy,
                unit: unit,
                modelCode: fields[10] || '',
                outputCode: fields[11] || '',
                rangeMaxKpa: rangeMaxKpa,
                rangeMinKpa: rangeMinKpa,
                channel: channel,
            },
        };
    }

  /**
   * @param {object} parsed — результат parseMidaQrLine().parsed
   * @returns {Record<number, string>}
   */
    function buildParamSteps(parsed) {
        const out = {};
        const ch = parsed.channel;
        const t = parsed.sensorType;

        Object.keys(ch.steps).forEach(function (sidStr) {
            const sid = parseInt(sidStr, 10);
            const fixed = ch.steps[sid];
            if (fixed != null) {
                out[sid] = fixed;
            }
        });

        if (t === 'DA') {
            out[57] = parsed.serial;
            const pr = normalizePressureRangeKpa(parsed.rangeMinKpa, parsed.rangeMaxKpa);
            if (pr.minKpa != null) {
                out[6] = f2(pr.minKpa);
            }
            if (pr.maxKpa != null) {
                out[7] = f2(pr.maxKpa);
            }
            if (parsed.accuracy != null) {
                out[14] = f2(Math.abs(parsed.accuracy));
            }
        } else if (t === 'DD' || t === 'DP') {
            out[64] = parsed.serial;
            const pr = normalizePressureRangeKpa(parsed.rangeMinKpa, parsed.rangeMaxKpa);
            if (pr.minKpa != null) {
                out[10] = f2(pr.minKpa);
            }
            if (pr.maxKpa != null) {
                out[11] = f2(pr.maxKpa);
            }
            // п.18: по диапазону (0–1 / 1.6 / 2.5 → 0.5 %, иначе 0.25 %), не «как в QR».
            const E = window.TM07_CORRECTOR_ERROR_LIMITS;
            if (E && typeof E.nominalDeltaDpForPmax === 'function' && pr.maxKpa != null) {
                out[18] = f2(E.nominalDeltaDpForPmax(pr.maxKpa));
            } else if (parsed.accuracy != null) {
                out[18] = f2(Math.abs(parsed.accuracy));
            }
        } else if (t === 'DT' || t === 'TG') {
            out[61] = formatTempSerial(parsed.serial);
            if (parsed.accuracy != null) {
                out[15] = f2(parsed.accuracy);
            }
        } else if (t === 'TT' || t === 'TP') {
            out[68] = formatTempSerial(parsed.serial);
            if (parsed.accuracy != null) {
                out[19] = f2(parsed.accuracy);
            }
        }

        return out;
    }

    function describeParsed(parsed) {
        const parts = [parsed.sensorType, parsed.channel.label, 'S/N ' + parsed.serial];
        if (parsed.tempSerialOnly) {
            return parts.join(', ') + ' (4 цифры)';
        }
        if (parsed.rangeMinKpa != null && parsed.rangeMaxKpa != null) {
            parts.push('P ' + parsed.rangeMinRaw + '…' + parsed.rangeMaxRaw + ' ' + parsed.unit);
        }
        return parts.join(', ');
    }

    function setStepInput(stepId, value, lines, note) {
        const inp = document.getElementById('val_' + stepId);
        if (!inp || inp.disabled || value == null || value === '') {
            return false;
        }
        inp.value = window.TM07_param_formatStepValue
            ? window.TM07_param_formatStepValue(stepId, value)
            : String(value);
        lines.push('п.' + stepId + ' ← QR ' + note);
        return true;
    }

    function qrLog(msg, tag) {
        const le = document.getElementById('paramLog');
        if (le) {
            const t = new Date().toLocaleTimeString();
            const prefix = tag || 'QR';
            le.innerHTML += '[' + t + '] [' + prefix + '] ' + msg + '<br>';
            le.scrollTop = le.scrollHeight;
        }
    }

    function setQrStatus(text, isError) {
        const st = document.getElementById('paramQrStatus');
        if (!st) {
            return;
        }
        st.textContent = text || '';
        st.className = 'small mt-2 mb-0' + (isError ? ' text-danger' : text ? ' text-success' : ' text-body-secondary');
    }

    /**
     * @param {object} parsed
     * @param {string} [logTag]
     */
    function applyParsedToInputs(parsed, logTag) {
        const Ops = window.TM07_WORKBENCH_OPS;
        const tag = logTag || (parsed.tempSerialOnly ? 'TEMP' : 'QR');

        if (Ops && typeof Ops.validateSensorScanAgainstOrder === 'function') {
            const check = Ops.validateSensorScanAgainstOrder(
                parsed.sensorType,
                parsed.serial,
                parsed
            );
            if (!check.ok) {
                qrLog('✗ ОТКЛОНЁН: ' + (check.error || 'не совпадает с заказом'), tag);
                return { ok: false, error: check.error || 'Датчик не совпадает с заказом' };
            }
            if (check.warning) {
                qrLog('⚠ ' + check.warning, tag);
            }
            if (check.valueCheck && check.valueCheck.details && check.valueCheck.details.length) {
                qrLog('сверка значений: ' + check.valueCheck.details.join('; '), tag);
            }
        } else if (
            Ops &&
            typeof Ops.isSensorAllowedInOrder === 'function' &&
            !Ops.isSensorAllowedInOrder(parsed.sensorType)
        ) {
            const err =
                typeof Ops.sensorNotInOrderError === 'function'
                    ? Ops.sensorNotInOrderError(parsed.sensorType)
                    : 'Датчик не предусмотрен заказом';
            qrLog('✗ ОТКЛОНЁН: ' + err, tag);
            return { ok: false, error: err };
        }

        const steps = buildParamSteps(parsed);
        const note = describeParsed(parsed);
        const lines = [];
        let filled = 0;
        Object.keys(steps).forEach(function (sidStr) {
            const sid = parseInt(sidStr, 10);
            if (setStepInput(sid, steps[sidStr], lines, note)) {
                filled += 1;
            }
        });
        // После QR: п.63/67 только по составу заказа (не оставлять «вкл» от чужого скана).
        if (Ops && typeof Ops.getEquipmentFromOrder === 'function') {
            const equip = Ops.getEquipmentFromOrder();
            const v63 = document.getElementById('val_63');
            const v67 = document.getElementById('val_67');
            if (v63 && !v63.disabled) {
                v63.value = equip.hasPpd ? '1' : '0';
            }
            if (v67 && !v67.disabled) {
                v67.value = equip.hasPttp ? '1' : '0';
            }
        }
        if (window.TM07Order1cToParam && window.TM07Order1cToParam.propagateDerivedThresholds) {
            filled += window.TM07Order1cToParam.propagateDerivedThresholds(lines);
        }
        // Пересчёт порогов/масок после QR. Row может быть пустым — applyParamAutoFill
        // подхватит кэш заказа 1С (иначе п.63/77 ошибочно уходят в «выкл» / И1).
        if (window.TM07Order1cToParam && window.TM07Order1cToParam.applyParamAutoFillToInputs) {
            const complexInp = document.getElementById('val_200');
            const complex =
                complexInp && complexInp.value ? String(complexInp.value).trim() : '';
            let orderRow = {};
            try {
                const key =
                    window.TM07Order1cToParam.STORAGE_KEY || 'order1c_param_lastOrder';
                const raw = sessionStorage.getItem(key) || localStorage.getItem(key);
                if (raw) {
                    const o = JSON.parse(raw);
                    if (o && o.row && typeof o.row === 'object') {
                        orderRow = o.row;
                    }
                }
            } catch (_e) {}
            filled += window.TM07Order1cToParam.applyParamAutoFillToInputs(
                orderRow,
                '',
                complex,
                lines
            );
        }
        const needHint =
            Ops && typeof Ops.requiredSensorsHint === 'function' ? Ops.requiredSensorsHint() : '';
        qrLog(
            '✓ ' + note + ': ' + lines.join('; ') + (needHint ? ' | заказ: ' + needHint : ''),
            tag
        );
        if (Ops && typeof Ops.markSensorScanned === 'function') {
            Ops.markSensorScanned(parsed.sensorType, parsed.serial);
        }
        if (Ops && typeof Ops.paintSensorBadges === 'function') {
            Ops.paintSensorBadges();
        }
        try {
            window.dispatchEvent(
                new CustomEvent('tm07-qr-scanned', {
                    detail: { sensorType: parsed.sensorType, serial: parsed.serial },
                })
            );
        } catch (_e) {}
        return { ok: true, filled: filled, lines: lines, describe: note, parsed: parsed };
    }

    /**
     * QR MIDA или 4 цифры для температурников.
     * @param {string} raw
     */
    function applyScanToInputs(raw) {
        const normalized = normalizeQrText(raw);
        if (!normalized) {
            return { ok: false, error: 'Пустая строка' };
        }

        if (/^\d{4}$/.test(normalized)) {
            const temp = parseTempSerialLine(normalized);
            if (temp.ok) {
                return applyParsedToInputs(temp.parsed, 'TEMP');
            }
            if (temp.error) {
                return { ok: false, error: temp.error };
            }
        }

        const result = parseMidaQrLine(raw);
        if (result.ok) {
            if (isTempSensorType(result.parsed.sensorType)) {
                result.parsed.serial = formatTempSerial(result.parsed.serial);
            }
            return applyParsedToInputs(result.parsed, 'QR');
        }

        if (/^\d+$/.test(normalized)) {
            return {
                ok: false,
                error: 'S/N температурного датчика — ровно 4 цифры (например 6319). Давление — полный QR MIDA.',
            };
        }

        return { ok: false, error: result.error === 'TEMP_SERIAL' ? 'Ожидается QR MIDA или 4 цифры' : result.error };
    }

    /**
     * @param {string} raw
     * @returns {{ok:boolean, error?:string, filled?:number, lines?:string[], describe?:string, parsed?:object}}
     */
    function applyMidaQrToInputs(raw) {
        return applyScanToInputs(raw);
    }

    /** S/N из штрихкода БПЭК — без нецифровых символов (формат п.228 Uint64). */
    function telemetrySerialFromBarcode(raw) {
        return String(raw ?? '').replace(/\D/g, '') || null;
    }

    /**
     * Штрихкод БПЭК (блок телеметрии) при .БТ в обозначении комплекса → п.228.
     * @param {string} raw
     * @returns {{ok:boolean, error?:string, serial?:string, filled?:number}}
     */
    function applyTelemetryBarcodeToInputs(raw) {
        const serial = telemetrySerialFromBarcode(raw);
        if (!serial) {
            return { ok: false, error: 'Штрихкод БПЭК без цифр (нужен S/N блока телеметрии)' };
        }
        const inp = document.getElementById('val_228');
        if (!inp) {
            return { ok: false, error: 'Поле п.228 не найдено' };
        }
        inp.value = serial;
        return { ok: true, serial: serial, filled: 1 };
    }

    /** Группы датчиков для окна «Параметры датчиков» (шаги из CHANNELS). */
    const SENSOR_STEP_GROUPS = [
        { key: 'DA', label: 'Давление (DA)', types: ['DA'], badgeBg: 'bg-primary-subtle', badgeBorder: 'border-primary', badgeText: 'text-primary' },
        { key: 'DT', label: 'Темп. газа (DT)', types: ['DT', 'TG'], badgeBg: 'bg-success-subtle', badgeBorder: 'border-success', badgeText: 'text-success' },
        { key: 'DD', label: 'Перепад (DD)', types: ['DD', 'DP'], badgeBg: 'bg-warning-subtle', badgeBorder: 'border-warning', badgeText: 'text-warning' },
        { key: 'TT', label: 'Темп. ТП (TT)', types: ['TT', 'TP'], badgeBg: 'bg-info-subtle', badgeBorder: 'border-info', badgeText: 'text-info' },
    ];

    function escAttr(v) {
        return String(v ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function stepTitleFor(stepId) {
        const doc = window.TM07_PARAMETRIZATION_DOC;
        if (doc && Array.isArray(doc.steps)) {
            const s = doc.steps.find((x) => Number(x.id) === Number(stepId));
            if (s && s.title) {
                return s.title;
            }
        }
        return 'п.' + stepId;
    }

    function buildSensorStepGroups() {
        return SENSOR_STEP_GROUPS.map(function (grp) {
            const stepIds = new Set();
            grp.types.forEach(function (t) {
                const ch = CHANNELS[t];
                if (ch && ch.steps) {
                    Object.keys(ch.steps).forEach(function (idStr) {
                        stepIds.add(parseInt(idStr, 10));
                    });
                }
            });
            return { key: grp.key, label: grp.label, stepIds: Array.from(stepIds).sort(function (a, b) { return a - b; }) };
        });
    }

    function renderSensorParamsTable() {
        const tbody = document.getElementById('sensorParamsTableBody');
        if (!tbody) {
            return;
        }
        let html = '';
        buildSensorStepGroups().forEach(function (grp) {
            const badge =
                '<span class="d-inline-block align-middle px-2 py-1 rounded border ' +
                grp.badgeBg + ' ' + grp.badgeBorder + ' ' + grp.badgeText +
                '" style="font-size:.85rem;min-width:52px;text-align:center;font-weight:600">' +
                escAttr(grp.key) + '</span>';
            html +=
                '<tr class="' + grp.badgeBg + '">' +
                '<td colspan="4" class="fw-bold ' + grp.badgeText + '" style="font-size:.9rem;padding:.35rem .75rem">' +
                escAttr(grp.label) + '</td>' +
                '</tr>';
            grp.stepIds.forEach(function (sid) {
                const inp = document.getElementById('val_' + sid);
                const val = inp ? String(inp.value || '') : '';
                html +=
                    '<tr>' +
                    '<td class="text-nowrap fw-semibold">' + badge + '</td>' +
                    '<td class="text-nowrap">п.' + sid + '</td>' +
                    '<td>' + escAttr(stepTitleFor(sid)) + '</td>' +
                    '<td><input type="text" class="form-control form-control-sm font-monospace sensor-param-val" data-step="' + sid + '" value="' + escAttr(val) + '"></td>' +
                    '</tr>';
            });
        });
        tbody.innerHTML = html;
    }

    function initSensorParamsPanel() {
        const openBtn = document.getElementById('sensorParamsOpen');
        if (!openBtn || !document.getElementById('sensorParamsModal')) {
            return;
        }
        const statusEl = document.getElementById('sensorParamsStatus');
        openBtn.addEventListener('click', function () {
            renderSensorParamsTable();
            if (statusEl) statusEl.textContent = '';
            const modalEl = document.getElementById('sensorParamsModal');
            if (modalEl && window.bootstrap) {
                const inst = window.bootstrap.Modal.getOrCreateInstance(modalEl);
                inst.show();
            }
        });
        document.getElementById('sensorParamsRefresh')?.addEventListener('click', function () {
            renderSensorParamsTable();
            if (statusEl) statusEl.textContent = 'Таблица обновлена из ввода.';
        });
        document.getElementById('sensorParamsApply')?.addEventListener('click', function () {
            const rows = document.querySelectorAll('.sensor-param-val');
            let applied = 0;
            rows.forEach(function (elInp) {
                const sid = Number(elInp.getAttribute('data-step'));
                const target = document.getElementById('val_' + sid);
                if (target && !target.disabled) {
                    target.value = elInp.value;
                    applied += 1;
                }
            });
            if (statusEl) statusEl.textContent = 'Применено параметров: ' + applied + '.';
        });
    }

    function initTelemetryBarcodePanel() {
        const inp = document.getElementById('paramTelemetrySerial');
        if (!inp) {
            return;
        }
        const statusEl = document.getElementById('paramTelemetryStatus');
        function runApply() {
            const r = applyTelemetryBarcodeToInputs(inp.value);
            if (!r.ok) {
                if (statusEl) statusEl.textContent = '✗ ' + (r.error || 'Ошибка');
                inp.select();
                return;
            }
            if (statusEl) statusEl.textContent = '✓ п.228 ← ' + r.serial;
            inp.value = '';
            inp.focus();
        }
        document.getElementById('paramTelemetryApply')?.addEventListener('click', runApply);
        inp.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                runApply();
            }
        });
    }

    /** Показывать/скрывать панель БПЭК (штрихкод блока телеметрии) — только при .БТ в заказе. */
    function setTelemetryPanelVisible(visible) {
        const panel = document.getElementById('paramTelemetryPanel');
        if (panel) {
            panel.classList.toggle('d-none', !visible);
        }
    }

    function initMidaQrPanel() {
        const inp = document.getElementById('paramQrSensor');
        if (!inp) {
            return;
        }
        function runApply() {
            const normalized = normalizeQrText(inp.value);
            if (!normalized) {
                setQrStatus('Введите или отсканируйте строку QR.', true);
                return;
            }
            if (normalized !== inp.value) {
                inp.value = normalized;
            }
            const r = applyScanToInputs(normalized);
            if (!r.ok) {
                setQrStatus('✗ ' + (r.error || 'Ошибка разбора'), true);
                // Не очищаем поле — оператор видит, что пикнул, и может исправить.
                inp.select();
                return;
            }
            const Ops = window.TM07_WORKBENCH_OPS;
            const need =
                Ops && typeof Ops.requiredSensorsHint === 'function' ? ' | ' + Ops.requiredSensorsHint() : '';
            setQrStatus('✓ ' + r.describe + ' (' + r.filled + ' полей)' + need, false);
            inp.value = '';
            if (Ops && typeof Ops.paintWorkflowSteps === 'function') {
                Ops.paintWorkflowSteps();
            }
            inp.focus();
        }
        document.getElementById('paramQrApply')?.addEventListener('click', runApply);
        document.getElementById('paramQrClear')?.addEventListener('click', function () {
            inp.value = '';
            setQrStatus('', false);
            inp.focus();
        });
        inp.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                runApply();
            }
        });
        if (document.body.classList.contains('wb-page')) {
            inp.focus();
        }
    }

    window.TM07_MIDA_QR = {
        CHANNELS: CHANNELS,
        parseMidaQrLine: parseMidaQrLine,
        parseTempSerialLine: parseTempSerialLine,
        buildParamSteps: buildParamSteps,
        describeParsed: describeParsed,
        applyScanToInputs: applyScanToInputs,
        applyMidaQrToInputs: applyMidaQrToInputs,
        applyTelemetryBarcodeToInputs: applyTelemetryBarcodeToInputs,
        formatTempSerial: formatTempSerial,
        fixScannerKeyboardLayout: fixScannerKeyboardLayout,
        initMidaQrPanel: initMidaQrPanel,
        initTelemetryBarcodePanel: initTelemetryBarcodePanel,
        initSensorParamsPanel: initSensorParamsPanel,
        setTelemetryPanelVisible: setTelemetryPanelVisible,
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            initMidaQrPanel();
            initTelemetryBarcodePanel();
            initSensorParamsPanel();
        });
    } else {
        initMidaQrPanel();
        initTelemetryBarcodePanel();
        initSensorParamsPanel();
    }
})();
