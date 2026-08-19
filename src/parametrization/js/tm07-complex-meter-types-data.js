/**
 * Типоразмеры счётчиков по табл. 2–10 (ПК-ТМ-Р1…Т2).
 * ЭМИС-РГС 245 (табл. 2) — в tm07-emis-rgs245-data.js; остальные семейства — здесь.
 */
(function () {
    'use strict';

    const MAX_WORKING_PRESSURE_KPA = 1600;
    /** СГ75МТ (ПК-ТМ-Т1): Pmax работы 7,5 МПа по РЭ. */
    const MAX_WORKING_PRESSURE_SG_KPA = 7500;
    /**
     * Температуры среды/окружения: РЭ табл. 13–14.
     * R1–R5: −30…+60 / −40…+60; R6: −30…+50; T1: −20…+50; T2: −40…+60.
     */
    const TEMP_R1_R5 = { gasMin: -30, gasMax: 60, ambMin: -40, ambMax: 60 };
    /** РВГ исп. А/Б: УРГП.407273.001 РЭ табл. 5 — газ −30…+60, окружение −40…+70. */
    const TEMP_RVG = { gasMin: -30, gasMax: 60, ambMin: -40, ambMax: 70 };
    /** Раско RVG исп. Б,К (RVG.pdf): газ −30…+60, окружение −40…+70 (не +60). */
    const TEMP_RVG_BC = { gasMin: -30, gasMax: 60, ambMin: -40, ambMax: 70 };
    const TEMP_BY_PASSPORT = {
        'prometr-r': TEMP_R1_R5,
        'rvg-bc': TEMP_RVG_BC,
        'rvg-a': TEMP_RVG,
        'rvg-b': TEMP_RVG,
        sgr: { gasMin: -30, gasMax: 50, ambMin: -40, ambMax: 60 },
        sg: { gasMin: -20, gasMax: 50, ambMin: -40, ambMax: 60 },
        'tau-tsg-a': { gasMin: -40, gasMax: 60, ambMin: -40, ambMax: 60 },
        'tau-tsg-b': { gasMin: -40, gasMax: 60, ambMin: -40, ambMax: 60 },
    };
    /** МПИ счётчика (п.104), лет — по типовым СИ; комплекс — отдельно в workbench-ops. */
    const METER_VERIFY_YEARS_BY_PASSPORT = {
        'emis-rgs245': 4,
        'prometr-r': 6,
        'rvg-bc': 6,
        /** УРГП.407273.001 РЭ п.3.4 — интервал между поверками 5 лет. */
        'rvg-a': 5,
        'rvg-b': 5,
        sgr: 6,
        sg: 6,
        'tau-tsg-a': 4,
        'tau-tsg-b': 4,
    };
    const METER_VERIFY_YEARS_DEFAULT = 6;

    function f2(n) {
        return Number(n).toFixed(2);
    }

    /** ΔPmax в прибор: Па/1000 (80 → 0.08), без лишних нулей. */
    function fDp(n) {
        const x = Number(n);
        if (!Number.isFinite(x)) {
            return '';
        }
        return x
            .toFixed(4)
            .replace(/0+$/, '')
            .replace(/\.$/, '');
    }

    /**
     * Макс. значение счётного механизма (меню 2.22 / п.121) по ёмкости из РЭ счётчика.
     * ЭМИС-РГС 245 / RVG / РВГ: G≤65 → 10⁶; G≤650 → 10⁷; G≥1000 → 10⁸.
     * @param {string|object|number|null} typeOrCode
     * @returns {string}
     */
    function counterMechMaxForType(typeOrCode) {
        let g = null;
        if (typeof typeOrCode === 'number' && Number.isFinite(typeOrCode)) {
            g = typeOrCode;
        } else {
            g = nominalQFromG(typeOrCode);
        }
        if (g == null || !Number.isFinite(g)) {
            return '999999';
        }
        if (g <= 65) {
            return '999999';
        }
        if (g <= 650) {
            return '9999999';
        }
        return '99999999';
    }

    function tempLimitsForPassport(passport) {
        return TEMP_BY_PASSPORT[passport] || TEMP_R1_R5;
    }

    function meterVerifyYearsForPassport(passport) {
        if (passport && METER_VERIFY_YEARS_BY_PASSPORT[passport] != null) {
            return METER_VERIFY_YEARS_BY_PASSPORT[passport];
        }
        return METER_VERIFY_YEARS_DEFAULT;
    }

    function maxWorkingPressureForPassport(passport) {
        return passport === 'sg' ? MAX_WORKING_PRESSURE_SG_KPA : MAX_WORKING_PRESSURE_KPA;
    }

    function impulsesPerM3(impulseM3) {
        if (!impulseM3 || !Number.isFinite(impulseM3)) {
            return '';
        }
        return f2(1 / impulseM3);
    }

    /**
     * В прибор (п.101) — G-рейтинг без DN-суффикса: G400-100 → G400.
     * @param {string|object} typeOrCode
     */
    function deviceTypeCodeForStep101(typeOrCode) {
        if (window.TM07_EMIS_RGS245 && window.TM07_EMIS_RGS245.deviceTypeCodeForStep101) {
            return window.TM07_EMIS_RGS245.deviceTypeCodeForStep101(typeOrCode);
        }
        const code =
            typeOrCode && typeof typeOrCode === 'object'
                ? String(typeOrCode.code || '')
                : String(typeOrCode || '');
        const m = code
            .toUpperCase()
            .replace(/\s+/g, '')
            .match(/^(G\d{2,4})(?:-\d{2,3})?$/);
        return m ? m[1] : code.trim();
    }

    /** Номинальный расход = число рядом с G (G40 → 40). Параметризация (1) п.54/110. */
    function nominalQFromG(typeOrCode) {
        if (window.TM07_EMIS_RGS245 && window.TM07_EMIS_RGS245.nominalQFromG) {
            return window.TM07_EMIS_RGS245.nominalQFromG(typeOrCode);
        }
        const code =
            typeOrCode && typeof typeOrCode === 'object'
                ? String(typeOrCode.code || '')
                : String(typeOrCode || '');
        const m = code
            .toUpperCase()
            .replace(/\s+/g, '')
            .match(/G(\d{2,4})/);
        if (!m) {
            return null;
        }
        const n = parseInt(m[1], 10);
        return Number.isFinite(n) ? n : null;
    }

    /** Разбор G400 / G400-100 из заказа. */
    function parseGOrderTypeCode(code) {
        const s = String(code || '')
            .toUpperCase()
            .replace(/\s+/g, '');
        const m = s.match(/^(G)(\d{2,4})(?:-(\d{2,3}))?$/);
        if (!m) {
            return { orderCode: s, gCode: s, du: null };
        }
        return {
            orderCode: s,
            gCode: m[1] + m[2],
            du: m[3] ? parseInt(m[3], 10) : null,
        };
    }

    function defaultImpulseM3(qmax) {
        if (qmax >= 1000) {
            return 10;
        }
        if (qmax >= 160) {
            return 1;
        }
        return 0.1;
    }

    /** Qt / Qmax — оценка (в РЭ ПК-ТМ табл. 2–10 нет Qt; ориентир как у ЭМИС-РГС). */
    function defaultQtFactor(qmax) {
        if (qmax <= 16) {
            return 0.15;
        }
        if (qmax <= 25) {
            return 0.1;
        }
        return 0.05;
    }

    /** Qstart — ступени по Qmax (ориентир табл. ЭМИС / типовые ротационные). */
    function defaultSensitivity(qmax) {
        if (qmax <= 16) {
            return 0.04;
        }
        if (qmax < 160) {
            return 0.06;
        }
        if (qmax < 400) {
            return 0.1;
        }
        if (qmax < 650) {
            return 0.12;
        }
        if (qmax < 1000) {
            return 0.7;
        }
        return 1.0;
    }

    /**
     * Порог чувствительности / цена импульса по табл. АПЗ / ТАУГАЗ / Раско
     * (T5 п.73/76 = цена_имп / порог). ЭМИС-РГС — в tm07-emis-rgs245-data.js.
     * @returns {{sensitivity:number, impulseM3:number}|null}
     */
    function pulseTableForType(passport, type) {
        if (!type) {
            return null;
        }
        const code = String(type.code || '')
            .toUpperCase()
            .replace(/\s+/g, '');
        const g = (code.match(/G\d+/) || [])[0] || code;
        const du = Number(type.du);
        const gNum = parseInt(String(g).replace(/^G/i, ''), 10);

        if (passport === 'sgr') {
            // АПЗ / СГР (не СГ).
            if ((Number.isFinite(gNum) && gNum <= 65 && (!Number.isFinite(du) || du <= 50)) || du <= 50) {
                if (Number.isFinite(gNum) && gNum <= 65) {
                    return { sensitivity: 0.05, impulseM3: 0.1 };
                }
            }
            if (du === 80 && (g === 'G65' || g === 'G100')) {
                return { sensitivity: 0.15, impulseM3: 1 };
            }
            if (du === 80 && (g === 'G160' || g === 'G250')) {
                return { sensitivity: 0.5, impulseM3: 1 };
            }
            if (du === 100 && g === 'G160') {
                return { sensitivity: 0.5, impulseM3: 1 };
            }
            if (du === 100 && g === 'G250') {
                return { sensitivity: 0.8, impulseM3: 1 };
            }
            return null;
        }

        if (passport === 'rvg-a') {
            // УРГП.407273.001 РЭ табл. 3 (порог) + табл. 9 ДИ-Н (имп/м³ → м³/имп).
            if (Number.isFinite(gNum) && gNum <= 65) {
                return { sensitivity: 0.03, impulseM3: 0.1 };
            }
            if (g === 'G100') {
                return { sensitivity: 0.05, impulseM3: 1 };
            }
            if (g === 'G160') {
                return { sensitivity: 0.1, impulseM3: 1 };
            }
            if (g === 'G250') {
                return { sensitivity: 0.2, impulseM3: 1 };
            }
            if (g === 'G400') {
                return { sensitivity: 0.4, impulseM3: 1 };
            }
            return null;
        }

        if (passport === 'rvg-b') {
            // УРГП.407273.001 РЭ табл. 4 + табл. 9 ДИ-Н.
            if (Number.isFinite(gNum) && gNum <= 65) {
                return { sensitivity: 0.1, impulseM3: 0.1 };
            }
            if (g === 'G100') {
                return { sensitivity: 0.16, impulseM3: 1 };
            }
            return null;
        }

        if (passport === 'rvg-bc') {
            // Раско RVG Б/К после 2022.
            if (Number.isFinite(gNum) && gNum <= 65) {
                return { sensitivity: 0.08, impulseM3: 0.1 };
            }
            if (g === 'G100' || g === 'G160') {
                return { sensitivity: 0.15, impulseM3: 1 };
            }
            if (g === 'G250') {
                return { sensitivity: 0.2, impulseM3: 1 };
            }
            if (g === 'G400') {
                return { sensitivity: 0.4, impulseM3: 1 };
            }
            if (g === 'G650') {
                return { sensitivity: 0.7, impulseM3: 1 };
            }
            if (g === 'G1000') {
                return { sensitivity: 1, impulseM3: 10 };
            }
            return null;
        }

        return null;
    }

    /**
     * ΔPmax счётчика при Qmax — оценка для семейств без РЭ счётчика в коде.
     * В РЭ ПК-ТМ (ТМР.407279.400) табл. 2–10 нет ΔPmax; §12.2.1 отсылает к РЭ счётчика.
     * Для РВГ А/Б — «Перепад при Qmax, Па» / 1000 (80 Па → 0.08 кПа).
     */
    function defaultDpMaxKpa(qmax, du) {
        if (qmax <= 16) {
            return 0.25;
        }
        if (qmax < 160) {
            return 0.4;
        }
        if (qmax <= 250 && Number(du) <= 80) {
            return 0.5;
        }
        return 1.0;
    }

    /**
     * [code, du, qmax, qmin, turndown, dpPa?]
     * @param {Array} rows
     * @param {{qtFactor?: number}|null} opts — qtFactor: доля Qt/Qmax (РВГ исп. У = 0.05 по табл. 5)
     */
    function mapRows(rows, opts) {
        const qtFixed = opts && opts.qtFactor != null ? opts.qtFactor : null;
        const out = {};
        rows.forEach(function (row) {
            const code = row[0];
            const du = row[1];
            const qmax = row[2];
            const qmin = row[3];
            const turndown = row[4];
            const dpPa = row[5];
            const id = code + '-' + du + '-Q' + qmax + '-R' + turndown;
            out[id] = {
                id: id,
                code: code,
                du: du,
                qmax: qmax,
                qmin: qmin,
                turndown: turndown,
                impulseM3: defaultImpulseM3(qmax),
                sensitivity: defaultSensitivity(qmax),
                dpMaxKpa:
                    dpPa != null && Number.isFinite(Number(dpPa))
                        ? Number(dpPa) / 1000
                        : defaultDpMaxKpa(qmax, du),
                qtFactor: qtFixed != null ? qtFixed : defaultQtFactor(qmax),
            };
        });
        return out;
    }

    // Таблица 3 — ПК-ТМ-Р2, ПРОМЕТР-Р
    const PROMETR_R = mapRows([
        ['G25', 50, 40, 0.5, 80],
        ['G40', 50, 65, 0.5, 130],
        ['G65', 50, 100, 0.8, 160],
        ['G100', 80, 160, 1.0, 160],
        ['G160', 80, 250, 1.6, 160],
        ['G160', 100, 250, 1.6, 160],
        ['G250', 100, 400, 2.5, 160],
        ['G400', 100, 650, 4.0, 160],
    ]);

    // Таблица 4 — ПК-ТМ-Р3, RVG исп. Б, К
    const RVG_BC = mapRows([
        ['G10', 50, 16, 0.5, 30],
        ['G16', 50, 25, 0.8, 30],
        ['G25', 50, 40, 0.6, 80],
        ['G25', 50, 40, 0.8, 50],
        ['G25', 50, 40, 1.3, 30],
        ['G40', 50, 65, 0.6, 160],
        ['G40', 50, 65, 0.8, 130],
        ['G40', 50, 65, 1.0, 100],
        ['G40', 50, 65, 1.3, 80],
        ['G40', 50, 65, 2.0, 65],
        ['G65', 50, 100, 0.4, 250],
        ['G65', 50, 100, 0.5, 200],
        ['G65', 50, 100, 0.6, 160],
        ['G65', 50, 100, 0.8, 130],
        ['G65', 50, 100, 1.0, 100],
        ['G65', 50, 100, 1.3, 80],
        ['G65', 50, 100, 1.6, 65],
        ['G65', 50, 100, 2.0, 50],
        ['G65', 50, 100, 3.0, 30],
        ['G100', 80, 160, 0.6, 250],
        ['G100', 80, 160, 0.8, 200],
        ['G100', 80, 160, 1.0, 160],
        ['G100', 80, 160, 1.3, 130],
        ['G100', 80, 160, 1.6, 100],
        ['G100', 80, 160, 2.0, 80],
        ['G100', 80, 160, 2.5, 65],
        ['G100', 80, 160, 3.0, 50],
        ['G100', 80, 160, 5.0, 30],
        ['G160', 80, 250, 1.0, 250],
        ['G160', 80, 250, 1.3, 200],
        ['G160', 80, 250, 1.6, 160],
        ['G160', 80, 250, 2.0, 130],
        ['G160', 80, 250, 2.5, 100],
        ['G160', 80, 250, 3.0, 80],
        ['G160', 80, 250, 4.0, 65],
        ['G160', 80, 250, 5.0, 50],
        ['G160', 80, 250, 8.0, 30],
        ['G250', 100, 400, 1.6, 250],
        ['G250', 100, 400, 2.0, 200],
        ['G250', 100, 400, 2.5, 160],
        ['G250', 100, 400, 3.0, 130],
        ['G250', 100, 400, 4.0, 100],
        ['G250', 100, 400, 5.0, 80],
        ['G250', 100, 400, 6.0, 65],
        ['G250', 100, 400, 8.0, 50],
        ['G250', 100, 400, 13.0, 30],
        ['G160', 100, 250, 1.0, 250],
        ['G160', 100, 250, 1.3, 200],
        ['G160', 100, 250, 1.6, 160],
        ['G160', 100, 250, 2.0, 130],
        ['G160', 100, 250, 2.5, 100],
        ['G160', 100, 250, 3.0, 80],
        ['G160', 100, 250, 4.0, 65],
        ['G160', 100, 250, 5.0, 50],
        ['G160', 100, 250, 8.0, 30],
        ['G400', 100, 650, 2.5, 250],
        ['G400', 100, 650, 3.0, 200],
        ['G400', 100, 650, 4.0, 160],
        ['G400', 100, 650, 5.0, 130],
        ['G400', 100, 650, 6.5, 100],
        ['G400', 100, 650, 8.0, 80],
        ['G400', 100, 650, 10.0, 65],
        ['G400', 100, 650, 13.0, 50],
        ['G400', 100, 650, 20.0, 30],
        ['G400', 150, 650, 5.0, 130],
        ['G400', 150, 650, 6.5, 100],
        ['G400', 150, 650, 8.0, 80],
        ['G400', 150, 650, 10.0, 65],
        ['G400', 150, 650, 13.0, 50],
        ['G400', 150, 650, 20.0, 30],
        ['G650', 150, 1000, 8.0, 130],
        ['G650', 150, 1000, 10.0, 100],
        ['G650', 150, 1000, 12.0, 80],
        ['G650', 150, 1000, 16.0, 65],
        ['G650', 150, 1000, 20.0, 50],
        ['G650', 150, 1000, 33.0, 30],
        ['G1000', 200, 1600, 12.0, 130],
        ['G1000', 200, 1600, 16.0, 100],
        ['G1000', 200, 1600, 20.0, 80],
        ['G1000', 200, 1600, 24.0, 65],
        ['G1000', 200, 1600, 32.0, 50],
        ['G1000', 200, 1600, 53.0, 30],
    ]);

    // Табл. 1 УРГП.407273.001 РЭ — ПК-ТМ-Р4, РВГ исп. А
    // [G, DN, Qmax, Qmin, turndown, ΔP@Qmax Па]; Qt = 0,05·Qmax (исп. У, табл. 5)
    const RVG_A = mapRows(
        [
            ['G16', 50, 25, 0.5, 50, 55],
            ['G16', 50, 25, 0.8, 30, 55],
            ['G16', 50, 25, 1.3, 20, 55],
            ['G25', 50, 40, 0.5, 80, 80],
            ['G25', 50, 40, 0.6, 65, 80],
            ['G25', 50, 40, 0.8, 50, 80],
            ['G25', 50, 40, 1.3, 30, 80],
            ['G25', 50, 40, 2.0, 20, 80],
            ['G40', 50, 65, 0.5, 130, 230],
            ['G40', 50, 65, 0.6, 100, 230],
            ['G40', 50, 65, 0.8, 80, 230],
            ['G40', 50, 65, 1.0, 65, 230],
            ['G40', 50, 65, 1.3, 50, 230],
            ['G40', 50, 65, 2.0, 30, 230],
            ['G40', 50, 65, 3.0, 20, 230],
            ['G65', 50, 100, 0.4, 250, 540],
            ['G65', 50, 100, 0.5, 200, 540],
            ['G65', 50, 100, 0.6, 160, 540],
            ['G65', 50, 100, 0.8, 130, 540],
            ['G65', 50, 100, 1.0, 100, 540],
            ['G65', 50, 100, 1.3, 80, 540],
            ['G65', 50, 100, 1.6, 65, 540],
            ['G65', 50, 100, 2.0, 50, 540],
            ['G65', 50, 100, 3.0, 30, 540],
            ['G65', 50, 100, 5.0, 20, 540],
            ['G100', 80, 160, 0.6, 250, 425],
            ['G100', 80, 160, 0.8, 200, 425],
            ['G100', 80, 160, 1.0, 160, 425],
            ['G100', 80, 160, 1.3, 130, 425],
            ['G100', 80, 160, 1.6, 100, 425],
            ['G100', 80, 160, 2.0, 80, 425],
            ['G100', 80, 160, 2.5, 65, 425],
            ['G100', 80, 160, 3.0, 50, 425],
            ['G100', 80, 160, 5.0, 30, 425],
            ['G100', 80, 160, 8.0, 20, 425],
            ['G160', 80, 250, 1.0, 250, 575],
            ['G160', 80, 250, 1.3, 200, 575],
            ['G160', 80, 250, 1.6, 160, 575],
            ['G160', 80, 250, 2.0, 130, 575],
            ['G160', 80, 250, 2.5, 100, 575],
            ['G160', 80, 250, 3.0, 80, 575],
            ['G160', 80, 250, 4.0, 65, 575],
            ['G160', 80, 250, 5.0, 50, 575],
            ['G160', 80, 250, 8.0, 30, 575],
            ['G160', 80, 250, 13.0, 20, 575],
            ['G250', 100, 400, 1.6, 250, 810],
            ['G250', 100, 400, 2.0, 200, 810],
            ['G250', 100, 400, 2.5, 160, 810],
            ['G250', 100, 400, 3.0, 130, 810],
            ['G250', 100, 400, 4.0, 100, 810],
            ['G250', 100, 400, 5.0, 80, 810],
            ['G250', 100, 400, 6.0, 65, 810],
            ['G250', 100, 400, 8.0, 50, 810],
            ['G250', 100, 400, 13.0, 30, 810],
            ['G250', 100, 400, 20.0, 20, 810],
            ['G400', 100, 650, 2.5, 250, 1700],
            ['G400', 100, 650, 3.0, 200, 1700],
            ['G400', 100, 650, 4.0, 160, 1700],
            ['G400', 100, 650, 5.0, 130, 1700],
            ['G400', 100, 650, 6.5, 100, 1700],
            ['G400', 100, 650, 8.0, 80, 1700],
            ['G400', 100, 650, 10.0, 65, 1700],
            ['G400', 100, 650, 13.0, 50, 1700],
            ['G400', 100, 650, 20.0, 30, 1700],
            ['G400', 100, 650, 32.0, 20, 1700],
            ['G400', 150, 650, 2.5, 250, 1700],
            ['G400', 150, 650, 3.0, 200, 1700],
            ['G400', 150, 650, 4.0, 160, 1700],
            ['G400', 150, 650, 5.0, 130, 1700],
            ['G400', 150, 650, 6.5, 100, 1700],
            ['G400', 150, 650, 8.0, 80, 1700],
            ['G400', 150, 650, 10.0, 65, 1700],
            ['G400', 150, 650, 13.0, 50, 1700],
            ['G400', 150, 650, 20.0, 30, 1700],
            ['G400', 150, 650, 32.0, 20, 1700],
        ],
        { qtFactor: 0.05 }
    );

    // Табл. 2 УРГП.407273.001 РЭ — ПК-ТМ-Р5, РВГ исп. Б
    const RVG_B = mapRows(
        [
            ['G16', 50, 25, 0.8, 30, 55],
            ['G16', 50, 25, 1.3, 20, 55],
            ['G25', 50, 40, 0.6, 65, 80],
            ['G25', 50, 40, 0.8, 50, 80],
            ['G25', 50, 40, 1.3, 30, 80],
            ['G25', 50, 40, 2.0, 20, 80],
            ['G40', 50, 65, 0.8, 80, 230],
            ['G40', 50, 65, 1.0, 65, 230],
            ['G40', 50, 65, 1.3, 50, 230],
            ['G40', 50, 65, 2.0, 30, 230],
            ['G40', 50, 65, 3.0, 20, 230],
            ['G65', 50, 100, 0.5, 200, 490],
            ['G65', 50, 100, 0.6, 160, 490],
            ['G65', 50, 100, 1.0, 100, 490],
            ['G65', 50, 100, 1.3, 80, 490],
            ['G65', 50, 100, 1.6, 65, 490],
            ['G65', 50, 100, 2.0, 50, 490],
            ['G65', 50, 100, 3.0, 30, 490],
            ['G65', 50, 100, 5.0, 20, 490],
            ['G100', 80, 160, 0.8, 200, 425],
            ['G100', 80, 160, 1.0, 160, 425],
            ['G100', 80, 160, 1.6, 100, 425],
            ['G100', 80, 160, 2.0, 80, 425],
            ['G100', 80, 160, 2.5, 65, 425],
            ['G100', 80, 160, 3.0, 50, 425],
            ['G100', 80, 160, 5.0, 30, 425],
            ['G100', 80, 160, 8.0, 20, 425],
        ],
        { qtFactor: 0.05 }
    );

    // Таблица 7 — ПК-ТМ-Р6, СГР
    const SGR = mapRows([
        ['G16', 50, 25, 0.8, 30],
        ['G25', 50, 40, 0.8, 50],
        ['G25', 50, 40, 1.3, 30],
        ['G40', 50, 65, 0.6, 100],
        ['G40', 50, 65, 0.8, 80],
        ['G40', 50, 65, 1.3, 50],
        ['G40', 50, 65, 2.0, 30],
        ['G65', 50, 100, 0.6, 160],
        ['G65', 50, 100, 0.8, 130],
        ['G65', 50, 100, 1.0, 100],
        ['G65', 50, 100, 1.3, 80],
        ['G65', 50, 100, 2.0, 50],
        ['G65', 50, 100, 3.0, 30],
        ['G65', 80, 100, 1.0, 100],
        ['G65', 80, 100, 1.3, 80],
        ['G65', 80, 100, 2.0, 50],
        ['G65', 80, 100, 3.0, 30],
        ['G100', 80, 160, 1.0, 160],
        ['G100', 80, 160, 1.3, 130],
        ['G100', 80, 160, 1.6, 100],
        ['G100', 80, 160, 2.0, 80],
        ['G100', 80, 160, 3.0, 50],
        ['G100', 80, 160, 5.0, 30],
        ['G160', 80, 250, 1.6, 160],
        ['G160', 80, 250, 2.0, 130],
        ['G160', 80, 250, 2.5, 100],
        ['G160', 80, 250, 3.0, 80],
        ['G160', 80, 250, 5.0, 50],
        ['G160', 80, 250, 8.0, 30],
        ['G250', 80, 400, 2.5, 160],
        ['G250', 80, 400, 3.0, 130],
        ['G250', 80, 400, 4.0, 100],
        ['G250', 80, 400, 5.0, 80],
        ['G250', 80, 400, 8.0, 50],
        ['G250', 80, 400, 13.0, 30],
        ['G160', 100, 250, 1.6, 160],
        ['G160', 100, 250, 2.0, 130],
        ['G160', 100, 250, 2.5, 100],
        ['G160', 100, 250, 3.0, 80],
        ['G160', 100, 250, 5.0, 50],
        ['G160', 100, 250, 8.0, 30],
        ['G250', 100, 400, 2.5, 160],
        ['G250', 100, 400, 3.0, 130],
        ['G250', 100, 400, 4.0, 100],
        ['G250', 100, 400, 5.0, 80],
        ['G250', 100, 400, 8.0, 50],
        ['G250', 100, 400, 13.0, 30],
    ]);

    // Таблица 8 — ПК-ТМ-Т1, СГ (код T1-…)
    const SG = mapRows([
        ['T1-65', 50, 65, 6.5, 10],
        ['T1-65', 50, 65, 5.0, 12.5],
        ['T1-100', 50, 100, 10.0, 10],
        ['T1-100', 50, 100, 8.0, 12.5],
        ['T1-100', 50, 100, 5.0, 20],
        ['T1-160', 80, 160, 8.0, 20],
        ['T1-250', 80, 250, 12.5, 20],
        ['T1-250', 80, 250, 10.0, 25],
        ['T1-250', 80, 250, 8.0, 30],
        ['T1-400', 100, 400, 20.0, 20],
        ['T1-400', 100, 400, 16.0, 25],
        ['T1-400', 100, 400, 12.5, 30],
        ['T1-650', 100, 650, 32.5, 20],
        ['T1-650', 100, 650, 26.0, 25],
        ['T1-650', 100, 650, 20.0, 30],
        ['T1-800', 150, 800, 40.0, 20],
        ['T1-800', 150, 800, 26.6, 30],
        ['T1-1000', 150, 1000, 50.0, 20],
        ['T1-1000', 150, 1000, 32.5, 30],
        ['T1-1600', 200, 1600, 80.0, 20],
        ['T1-1600', 200, 1600, 53.3, 30],
        ['T1-2500', 200, 2500, 125.0, 20],
        ['T1-2500', 200, 2500, 80.0, 30],
        ['T1-4000', 200, 4000, 200.0, 20],
        ['T1-4000', 200, 4000, 130.0, 30],
    ]);

    // Таблицы 9–10 — ПК-ТМ-Т2, ТАУ-ТСГ исп. А и Б
    const TAU_TSG_A = mapRows([
        ['G65', 50, 100, 5.0, 20],
        ['G100', 80, 160, 8.0, 20],
        ['G160', 80, 250, 13.0, 20],
        ['G250', 80, 400, 10.0, 40],
        ['G250', 80, 400, 13.0, 30],
        ['G250', 80, 400, 20.0, 20],
        ['G250', 100, 400, 20.0, 20],
        ['G400', 100, 650, 16.0, 40],
        ['G400', 100, 650, 20.0, 30],
        ['G400', 100, 650, 32.0, 20],
        ['G400', 150, 650, 32.0, 20],
        ['G650', 150, 1000, 32.0, 30],
        ['G650', 150, 1000, 50.0, 20],
        ['G1000', 200, 1600, 32.0, 50],
        ['G1000', 200, 1600, 40.0, 40],
        ['G1000', 200, 1600, 50.0, 30],
        ['G1000', 200, 1600, 80.0, 20],
        ['G1600', 200, 2500, 80.0, 30],
        ['G1600', 200, 2500, 130.0, 20],
    ]);

    const TAU_TSG_B = mapRows([
        ['G100', 80, 160, 8.0, 20],
        ['G160', 80, 250, 13.0, 20],
        ['G250', 80, 400, 13.0, 30],
        ['G250', 80, 400, 20.0, 20],
        ['G250', 100, 400, 20.0, 20],
        ['G400', 100, 650, 20.0, 30],
        ['G400', 100, 650, 32.0, 20],
        ['G400', 150, 650, 32.0, 20],
        ['G650', 150, 1000, 32.0, 30],
        ['G650', 150, 1000, 50.0, 20],
        ['G1000', 200, 1600, 50.0, 30],
        ['G1000', 200, 1600, 80.0, 20],
    ]);

    const FAMILIES = {
        'prometr-r': { meterName: 'ПРОМЕТР-Р', table: 3, types: PROMETR_R },
        'rvg-bc': { meterName: 'RVG (исп. Б,К)', table: 4, types: RVG_BC },
        'rvg-a': { meterName: 'РВГ (исп.А)', table: 5, types: RVG_A },
        'rvg-b': { meterName: 'РВГ (исп.Б)', table: 6, types: RVG_B },
        sgr: { meterName: 'СГР', table: 7, types: SGR },
        sg: { meterName: 'СГ', table: 8, types: SG },
        'tau-tsg-a': { meterName: 'ТАУ-ТСГ (исп.А)', table: 9, types: TAU_TSG_A },
        'tau-tsg-b': { meterName: 'ТАУ-ТСГ (исп.Б)', table: 10, types: TAU_TSG_B },
    };

    function listTypes(passport) {
        if (passport === 'emis-rgs245' && window.TM07_EMIS_RGS245) {
            return window.TM07_EMIS_RGS245.listTypes();
        }
        const fam = FAMILIES[passport];
        if (!fam) {
            return [];
        }
        return Object.keys(fam.types).map(function (k) {
            return fam.types[k];
        });
    }

    function findByCode(passport, code) {
        const c = String(code || '').trim().toUpperCase();
        if (!c) {
            return null;
        }
        if (passport === 'emis-rgs245' && window.TM07_EMIS_RGS245) {
            return window.TM07_EMIS_RGS245.findByCode(c);
        }
        const fam = FAMILIES[passport];
        if (!fam) {
            return null;
        }
        const norm = c.replace(/\s+/g, '');
        for (const t of listTypes(passport)) {
            if (String(t.code).toUpperCase().replace(/\s+/g, '') === norm) {
                return t;
            }
            if (t.id && String(t.id).toUpperCase().replace(/\s+/g, '') === norm) {
                return t;
            }
        }
        return null;
    }

    function resolveType(passport, opts) {
        const o = opts || {};
        if (passport === 'emis-rgs245' && window.TM07_EMIS_RGS245) {
            return window.TM07_EMIS_RGS245.resolveType(o);
        }
        if (o.typeCode) {
            let t = findByCode(passport, o.typeCode);
            if (!t) {
                const parsed = parseGOrderTypeCode(o.typeCode);
                if (parsed.gCode && parsed.gCode !== String(o.typeCode).toUpperCase().replace(/\s+/g, '')) {
                    t = findByCode(passport, parsed.gCode);
                    if (t && parsed.du != null && Number(t.du) !== parsed.du) {
                        t = null;
                    }
                }
            }
            if (t) {
                return t;
            }
        }
        const du = parseInt(String(o.du ?? ''), 10);
        if (!Number.isFinite(du)) {
            return null;
        }
        const candidates = listTypes(passport).filter(function (t) {
            return t.du === du;
        });
        if (!candidates.length) {
            return null;
        }
        if (candidates.length === 1) {
            return candidates[0];
        }
        const qmin = parseFloat(String(o.qmin ?? '').replace(',', '.'));
        const qmax = parseFloat(String(o.qmax ?? '').replace(',', '.'));
        const turndown = parseInt(String(o.turndown ?? ''), 10);

        function typeScore(t) {
            let score = 0;
            let parts = 0;
            if (Number.isFinite(qmax)) {
                score += Math.abs(t.qmax - qmax) * 4;
                parts += 1;
            }
            if (Number.isFinite(qmin)) {
                score += Math.abs(t.qmin - qmin) * 2;
                parts += 1;
            }
            if (Number.isFinite(turndown)) {
                score += Math.abs(t.turndown - turndown);
                parts += 1;
            }
            return parts ? score : Infinity;
        }

        let best = candidates[0];
        let bestScore = typeScore(best);
        for (let i = 1; i < candidates.length; i += 1) {
            const s = typeScore(candidates[i]);
            if (s < bestScore) {
                best = candidates[i];
                bestScore = s;
            }
        }
        return Number.isFinite(bestScore) ? best : candidates[0];
    }

    /** Метрологическое исп. РВГ из заказа: О / У / 2У (табл. 5 УРГП.407273.001). */
    function rvgAccuracyClassFromOrder() {
        let text = '';
        try {
            const Ops = typeof window !== 'undefined' ? window.TM07_WORKBENCH_OPS : null;
            if (Ops && typeof Ops.collectOrderTextBlob === 'function') {
                text = String(Ops.collectOrderTextBlob() || '');
            }
        } catch (_e) {}
        if (!text) {
            try {
                const cached = sessionStorage.getItem('tm07_last_order1c_blob');
                if (cached) text = cached;
            } catch (_e2) {}
        }
        const s = String(text || '');
        if (/\/\s*2\s*У\b|исп\.?\s*2\s*У\b|2\s*У\b/i.test(s)) {
            return '2У';
        }
        if (/\/\s*О\b|исп\.?\s*О\b|(?:^|[^\d])О(?:\s*\/|\s*$)/i.test(s) && !/2О|3О|4О|СТО/i.test(s)) {
            // «А/О», «исп. О» — не путать с 2О
            if (/[\/\s]О\b|исп\.?\s*О\b/i.test(s)) {
                return 'О';
            }
        }
        if (/\/\s*У\b|исп\.?\s*У\b/i.test(s)) {
            return 'У';
        }
        return 'У';
    }

    function meterStepValues(passport, type) {
        if (passport === 'emis-rgs245' && window.TM07_EMIS_RGS245) {
            return window.TM07_EMIS_RGS245.meterStepValues(type);
        }
        const fam = FAMILIES[passport];
        if (!type || !fam) {
            return {};
        }
        const qtFactorBase = type.qtFactor != null ? type.qtFactor : defaultQtFactor(type.qmax);
        let qt = qtFactorBase * type.qmax;
        // РВГ (УРГП.407273.001 табл. 5): О → 0,1·Qmax; У → 0,05·Qmax; 2У — без Qt, ставим Qmin.
        if (passport === 'rvg-a' || passport === 'rvg-b') {
            const acc = rvgAccuracyClassFromOrder();
            if (acc === '2У') {
                qt = type.qmin;
            } else if (acc === 'О') {
                qt = 0.1 * type.qmax;
            } else {
                qt = 0.05 * type.qmax;
            }
        }
        const qnom = nominalQFromG(type);
        const temps = tempLimitsForPassport(passport);
        const pulse = pulseTableForType(passport, type);
        const impulseM3 =
            (pulse && pulse.impulseM3) || type.impulseM3 || defaultImpulseM3(type.qmax);
        const sensitivity =
            (pulse && pulse.sensitivity) != null
                ? pulse.sensitivity
                : type.sensitivity != null
                  ? type.sensitivity
                  : defaultSensitivity(type.qmax);
        return {
            100: meterNameForStep100(passport),
            101: deviceTypeCodeForStep101(type),
            105: String(type.du),
            106: impulsesPerM3(impulseM3),
            108: f2(sensitivity),
            109: f2(type.qmin),
            110: qnom != null ? f2(qnom) : '',
            111: f2(type.qmax),
            // п.112 Qt: РВГ — по исп. О/У/2У (табл. 5); иначе qtFactor×Qmax
            112: f2(qt),
            // п.113 ΔPmax: для РВГ — перепад при Qmax, Па / 1000 (80 → 0.08 кПа); иначе оценка
            113: fDp(type.dpMaxKpa != null ? type.dpMaxKpa : defaultDpMaxKpa(type.qmax, type.du)),
            114: f2(maxWorkingPressureForPassport(passport)),
            115: f2(temps.gasMin),
            116: f2(temps.gasMax),
            117: f2(temps.ambMin),
            118: f2(temps.ambMax),
            121: counterMechMaxForType(type),
        };
    }

    function familyLabel(passport) {
        if (passport === 'emis-rgs245') {
            return 'ЭМИС-РГС 245';
        }
        const fam = FAMILIES[passport];
        return fam ? fam.meterName : passport;
    }

    /** Имя для п.100 в прибор: без скобок «(исп.А)» и т.п. */
    function meterNameForStep100(passportOrLabel) {
        const raw =
            passportOrLabel && FAMILIES[passportOrLabel]
                ? FAMILIES[passportOrLabel].meterName
                : passportOrLabel === 'emis-rgs245'
                  ? 'ЭМИС-РГС 245'
                  : familyLabel(passportOrLabel) || String(passportOrLabel || '');
        return String(raw)
            .replace(/\s*\([^)]*\)\s*/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    window.TM07_COMPLEX_METER_TYPES = {
        FAMILIES: FAMILIES,
        listTypes: listTypes,
        findByCode: findByCode,
        resolveType: resolveType,
        meterStepValues: meterStepValues,
        familyLabel: familyLabel,
        meterNameForStep100: meterNameForStep100,
        tempLimitsForPassport: tempLimitsForPassport,
        meterVerifyYearsForPassport: meterVerifyYearsForPassport,
        maxWorkingPressureForPassport: maxWorkingPressureForPassport,
        deviceTypeCodeForStep101: deviceTypeCodeForStep101,
        nominalQFromG: nominalQFromG,
        counterMechMaxForType: counterMechMaxForType,
        parseGOrderTypeCode: parseGOrderTypeCode,
    };
})();
