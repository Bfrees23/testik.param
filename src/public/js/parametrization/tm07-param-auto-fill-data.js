/**
 * Автозаполнение параметров ТМ-07 по «Параметризация (1).docx» и РЭ ПК-ТМ.
 * Источники: фикс. значения doc → п.п.; расчёт из других п.п.; исполнение И1–И4;
 * типоразмер счётчика (табл. 2–10); QR MIDA; заказ 1С.
 */
(function () {
    'use strict';

    const KSZH_T = { 2: { min: -23.15, max: 60 }, 3: { min: -40, max: 60 } };

    /** П.п. с фиксированным значением из инструкции (если поле пустое). */
    const DOC_FIXED = {
        8: '-40',
        9: '60',
        22: '0.70',
        23: '0.60',
        24: '0.30',
        26: '20',
        55: '1',
        56: '2',
        60: '2',
        69: '1',
        70: '60',
    };
    /** Фикс. значения канала перепада — только если в заказе есть ППД. */
    const DOC_FIXED_PPD = {
        10: '0',
        46: '-0.10',
        48: '-0.10',
    };
    /** Фикс. значения канала TT — только если в заказе есть ПТТП. */
    const DOC_FIXED_PTTP = {
        12: '-40',
        13: '60',
        50: '-40',
        51: '60',
        52: '-40',
        53: '60',
    };
    /**
     * Финальные параметры (Excel / инструкция): моточасы, токи, ёмкость, КС, очистка, архивы.
     * 0x0746 (ток ПАД) и TestMode — не пишем. П.298/299 — копия п.202/203.
     */
    const DOC_FIXED_FINAL = {
        302: '0',
        303: '0',
        304: '0',
        305: '0',
        306: '0',
        307: '0',
        308: '0',
        // 309–314 только чтение — не автозаполняем на запись
        316: '1',
        318: '1',
        319: '1',
        320: '1',
        322: '1',
    };

    function readVal(stepId) {
        const inp = document.getElementById('val_' + stepId);
        if (!inp || inp.disabled) {
            return null;
        }
        const s = String(inp.value || '').trim();
        return s === '' ? null : s;
    }

    function readNum(stepId) {
        const s = readVal(stepId);
        if (s == null) {
            return null;
        }
        const n = parseFloat(s.replace(',', '.'));
        return Number.isFinite(n) ? n : null;
    }

    function f2(n) {
        return Number(n).toFixed(2);
    }

    function parseKsxhMethod() {
        const m = readNum(21);
        if (m === 2 || m === 3) {
            return m;
        }
        return 2;
    }

    function meterTRange() {
        const tmin = readNum(115);
        const tmax = readNum(116);
        if (tmin != null && tmax != null) {
            return { min: tmin, max: tmax };
        }
        return { min: -40, max: 60 };
    }

    /** п.40–45: пересечение T Ксж и счётчика (Параметризация п.40–45). */
    function resolveGasTemperatureThresholds() {
        const km = parseKsxhMethod();
        const k = KSZH_T[km] || KSZH_T[2];
        const m = meterTRange();
        let tMin = Math.max(k.min, m.min);
        let tMax = Math.min(k.max, m.max);
        // Если пересечение выродилось — берём диапазон счётчика (табл.), иначе Ксж.
        if (!(tMin < tMax)) {
            if (m.min < m.max) {
                tMin = m.min;
                tMax = m.max;
            } else {
                tMin = k.min;
                tMax = k.max;
            }
        }
        return {
            tMin: f2(tMin),
            tMax: f2(tMax),
            note: 'Ксж-' + km + ' ∩ счётчик (п.115–116)',
        };
    }

    function resolveErP() {
        const pmin = readNum(6);
        const pmax = readNum(7);
        if (pmin == null || pmax == null) {
            return null;
        }
        return f2((pmin + pmax) / 2);
    }

    function resolveQ0FromQstart() {
        const qstart = readNum(108);
        if (qstart == null) {
            return null;
        }
        return f2(qstart);
    }

    function resolveQEr() {
        // Параметризация (1) п.54: номинальный расход счётчика (G40→40), не Qmax.
        const from110 = readNum(110);
        if (from110 != null) {
            return f2(from110);
        }
        const code101 = readVal(101);
        if (code101) {
            const C = window.TM07_COMPLEX_METER_TYPES;
            if (C && typeof C.nominalQFromG === 'function') {
                const n = C.nominalQFromG(code101);
                if (n != null) {
                    return f2(n);
                }
            }
            const m = String(code101)
                .toUpperCase()
                .match(/G(\d{2,4})/);
            if (m) {
                return f2(parseInt(m[1], 10));
            }
        }
        return null;
    }

    function resolveDpMaxCopy(stepId) {
        const dpmax = readNum(11);
        return dpmax != null ? f2(dpmax) : null;
    }

    function resolveChannelModes(equip) {
        const out = {};
        if (equip && equip.hasPpd) {
            // Тип 1–3; 0 недопустим (Modbus 0x03).
            out[62] = '1';
            out[63] = '1';
            out[10] = out[10] || '0';
        } else {
            // Без ППД: только выключаем режим (п.63=0). п.62 не трогаем — «0» прибор отвергает.
            out[63] = '0';
        }
        if (equip && equip.hasPttp) {
            out[67] = '1';
        } else {
            out[67] = '0';
        }
        return out;
    }

    /** Зеркало меню 3 ← меню 1 + меню 2 (комплекс ПК-ТМ). */
    function resolveComplexMirror(inComplex, equip) {
        if (!inComplex) {
            return {};
        }
        const map = {
            204: 105,
            205: 108,
            206: 109,
            207: 110,
            208: 111,
            209: 112,
            210: 113,
            211: 6,
            212: 7,
            213: 8,
            214: 9,
            215: 10,
            216: 11,
            221: 14,
            222: 15,
            223: 18,
            224: 19,
        };
        const out = {};
        Object.keys(map).forEach(function (dstStr) {
            const dst = parseInt(dstStr, 10);
            const src = map[dst];
            const v = readVal(src);
            if (v != null) {
                out[dst] = v;
            }
        });
        // п.213/214 — температура газа комплекса: пересечение диапазонов счётчика (п.115/116)
        // и корректора (п.8/9). Мин = максимальное из нижних (−30), Макс = минимальное из верхних (+60).
        const tMinMeter = readNum(115);
        const tMaxMeter = readNum(116);
        const tMinCorr = readNum(8);
        const tMaxCorr = readNum(9);
        if (tMinMeter != null || tMinCorr != null) {
            const v = Math.max(
                tMinMeter != null ? tMinMeter : -Infinity,
                tMinCorr != null ? tMinCorr : -Infinity
            );
            if (Number.isFinite(v)) {
                out[213] = f2(v);
            }
        }
        if (tMaxMeter != null || tMaxCorr != null) {
            const v = Math.min(
                tMaxMeter != null ? tMaxMeter : Infinity,
                tMaxCorr != null ? tMaxCorr : Infinity
            );
            if (Number.isFinite(v)) {
                out[214] = f2(v);
            }
        }
        // Без ПТТП: T2min/T2max комплекса = 0 (не зеркало п.12/13).
        if (!equip || !equip.hasPttp) {
            out[217] = '0';
            out[218] = '0';
        } else {
            const t2min = readVal(12);
            const t2max = readVal(13);
            if (t2min != null) {
                out[217] = t2min;
            }
            if (t2max != null) {
                out[218] = t2max;
            }
        }
        return out;
    }

    /**
     * @param {{fullText?:string, complexDesignation?:string}} opts
     * @returns {{steps:Record<number,string>, notes:Record<number,string>}}
     */
    function resolveParamAutoFill(opts) {
        const o = opts || {};
        const C = window.TM07_CORRECTOR_EXECUTION;
        const E = window.TM07_CORRECTOR_ERROR_LIMITS;
        const steps = {};
        const notes = {};

        Object.keys(DOC_FIXED).forEach(function (sidStr) {
            const sid = parseInt(sidStr, 10);
            steps[sid] = DOC_FIXED[sid];
            notes[sid] = 'Параметризация (1)';
        });

        Object.keys(DOC_FIXED_FINAL).forEach(function (sidStr) {
            const sid = parseInt(sidStr, 10);
            steps[sid] = DOC_FIXED_FINAL[sid];
            notes[sid] = 'финал (табл. токи/моточасы)';
        });

        // Даты комплекса в финал (п.298/299 ← п.202/203), если уже в форме.
        const d202 = readVal(202);
        const d203 = readVal(203);
        if (d202 != null) {
            steps[298] = d202;
            notes[298] = '= п.202';
        }
        if (d203 != null) {
            steps[299] = d203;
            notes[299] = '= п.203';
        }

        let equip = C ? C.detectEquipment(o.fullText || '') : { hasPpd: false, hasPttp: false };
        // Если в fullText не нашли ППД/ПТТП — сверить с составом заказа на форме (Ops).
        const Ops = typeof window !== 'undefined' ? window.TM07_WORKBENCH_OPS : null;
        if (Ops && typeof Ops.getEquipmentFromOrder === 'function') {
            try {
                const fromOrder = Ops.getEquipmentFromOrder() || {};
                equip = {
                    hasPpd: !!(equip.hasPpd || fromOrder.hasPpd),
                    hasPttp: !!(equip.hasPttp || fromOrder.hasPttp),
                };
            } catch (_e) {}
        }
        if (equip.hasPpd) {
            Object.keys(DOC_FIXED_PPD).forEach(function (sidStr) {
                const sid = parseInt(sidStr, 10);
                steps[sid] = DOC_FIXED_PPD[sid];
                notes[sid] = 'Параметризация (1), ППД';
            });
        }
        if (equip.hasPttp) {
            Object.keys(DOC_FIXED_PTTP).forEach(function (sidStr) {
                const sid = parseInt(sidStr, 10);
                steps[sid] = DOC_FIXED_PTTP[sid];
                notes[sid] = 'Параметризация (1), ПТТП';
            });
        }
        Object.assign(steps, resolveChannelModes(equip));
        notes[62] = notes[63] = 'исполнение/ППД';
        notes[67] = 'исполнение/ПТТП';

        const erP = resolveErP();
        if (erP != null) {
            steps[25] = erP;
            notes[25] = '(Pmin+Pmax)/2, п.6–7';
        }

        const tTh = resolveGasTemperatureThresholds();
        [40, 42, 44].forEach(function (sid) {
            steps[sid] = tTh.tMin;
            notes[sid] = tTh.note;
        });
        [41, 43, 45].forEach(function (sid) {
            steps[sid] = tTh.tMax;
            notes[sid] = tTh.note;
        });

        if (equip.hasPpd) {
            const dpMax = resolveDpMaxCopy();
            if (dpMax != null) {
                steps[47] = dpMax;
                steps[49] = dpMax;
                notes[47] = notes[49] = '= п.11';
            }
        }

        const q0 = resolveQ0FromQstart();
        if (q0 != null) {
            steps[27] = q0;
            notes[27] = '= п.108 Qstart';
        }

        // Пороги расхода корректора ← Qmin/Qmax счётчика (меню 2); тревоги п.30–33 = тем же.
        const qMinMeter = readNum(109);
        const qMaxMeter = readNum(111) || readNum(29);
        if (qMinMeter != null) {
            const qmin = f2(qMinMeter);
            steps[28] = qmin;
            steps[30] = qmin;
            steps[32] = qmin;
            notes[28] = '= п.109 Qmin';
            notes[30] = notes[32] = '= Qmin (п.28/109)';
        }
        if (qMaxMeter != null) {
            const qmax = f2(qMaxMeter);
            steps[29] = qmax;
            steps[31] = qmax;
            steps[33] = qmax;
            notes[29] = '= п.111 Qmax';
            notes[31] = notes[33] = '= Qmax (п.29/111)';
        }

        const qEr = resolveQEr();
        if (qEr != null) {
            steps[54] = qEr;
            notes[54] = 'номинал G (п.110 / п.101)';
        }

        // Нет Q — не оставляем заводские 7500; п.30–33 не обнуляем отдельно (копия Qmin/Qmax).
        [27, 28, 29, 54].forEach(function (sid) {
            if (steps[sid] == null) {
                steps[sid] = '0';
                notes[sid] = notes[sid] || 'нет Q → 0';
            }
        });
        // Если Qmin/Qmax уже есть в 28/29 — добить тревоги 30–33.
        if (steps[28] != null && steps[28] !== '0') {
            steps[30] = steps[30] || steps[28];
            steps[32] = steps[32] || steps[28];
            notes[30] = notes[30] || notes[28];
            notes[32] = notes[32] || notes[28];
        }
        if (steps[29] != null && steps[29] !== '0') {
            steps[31] = steps[31] || steps[29];
            steps[33] = steps[33] || steps[29];
            notes[31] = notes[31] || notes[29];
            notes[33] = notes[33] || notes[29];
        }

        // Накопленный объём счётчика — при параметризации обнуляем.
        steps[107] = '0';
        notes[107] = 'параметризация → 0';

        if (E) {
            const err = E.resolveCorrectorErrorLimits({
                fullText: o.fullText,
                equipment: equip,
            });
            if (err && err.steps) {
                Object.keys(err.steps).forEach(function (sidStr) {
                    const sid = parseInt(sidStr, 10);
                    if (!steps[sid]) {
                        steps[sid] = err.steps[sid];
                    }
                    notes[sid] = notes[sid] || 'погрешности корректора';
                });
            }
        }

        if (C) {
            const impPerM3 = readNum(106);
            const m3PerImp = impPerM3 != null && impPerM3 > 0 ? 1 / impPerM3 : null;
            const sens = readNum(108);
            const exec = C.resolveCorrectorExecution({
                complexDesignation: o.complexDesignation,
                fullText: o.fullText,
                m3PerImpulse: m3PerImp,
                sensitivityM3h: sens,
                equipment: equip,
            });
            if (exec && exec.steps) {
                Object.keys(exec.steps).forEach(function (sidStr) {
                    const sid = parseInt(sidStr, 10);
                    steps[sid] = exec.steps[sidStr];
                    if (sid === 71 || sid === 72) {
                        notes[sid] = 'маски предупр., ' + exec.variant;
                    } else if (sid === 73 || sid === 76) {
                        notes[sid] = 'T5/P5 задержка, ' + exec.variant;
                    } else if (sid === 74 || sid === 75 || sid === 77) {
                        notes[sid] = 'маски ' + exec.variant;
                    } else if (sid === 78 || sid === 79) {
                        notes[sid] = exec.inComplex
                            ? 'комплекс: п.78=0, п.79=1'
                            : 'только корректор: п.78=1, п.79=0';
                    }
                });
            }
        }

        const inComplex =
            C &&
            C.isComplexCorrectorUsage &&
            C.isComplexCorrectorUsage(o.complexDesignation);
        Object.assign(steps, resolveComplexMirror(inComplex, equip));
        if (inComplex) {
            [204, 205, 206, 207, 208, 209, 210, 211, 212, 213, 214, 215, 216, 217, 218, 221, 222, 223, 224].forEach(
                function (sid) {
                    if (steps[sid]) {
                        notes[sid] = (notes[sid] ? notes[sid] + '; ' : '') + 'зеркало меню 3';
                    }
                }
            );
            if (!equip.hasPttp) {
                notes[217] = notes[218] = 'без ПТТП → 0';
            }
        }

        return { steps: steps, notes: notes, equipment: equip, inComplex: !!inComplex };
    }

    window.TM07_PARAM_AUTO_FILL = {
        DOC_FIXED: DOC_FIXED,
        DOC_FIXED_FINAL: DOC_FIXED_FINAL,
        KSZH_T: KSZH_T,
        resolveGasTemperatureThresholds: resolveGasTemperatureThresholds,
        resolveParamAutoFill: resolveParamAutoFill,
    };
})();
