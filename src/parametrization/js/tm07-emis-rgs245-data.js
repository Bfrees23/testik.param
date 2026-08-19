/**
 * Справочник «ЭМИС-РГС 245» по РЭ v2.0.1 (табл. 1.2–1.5).
 * Используется для подстановки параметров счётчика (п.100–122) при комплексе ПК-ТМ-Р1.
 */
(function () {
    'use strict';

    /** @type {Record<string, object>} */
    const TYPES = {
        G10: {
            code: 'G10',
            du: 25,
            qmin: 0.4,
            qmax: 16,
            turndown: 40,
            sensitivity: 0.04,
            impulseM3: 0.1,
            dpMaxKpa: 0.25,
            qtFactor: 0.15,
        },
        G16: {
            code: 'G16',
            du: 50,
            qmin: 0.5,
            qmax: 25,
            turndown: 50,
            sensitivity: 0.06,
            impulseM3: 0.1,
            dpMaxKpa: 0.4,
            qtFactor: 0.1,
        },
        G25: {
            code: 'G25',
            du: 50,
            qmin: 0.5,
            qmax: 40,
            turndown: 80,
            sensitivity: 0.06,
            impulseM3: 0.1,
            dpMaxKpa: 0.4,
            qtFactor: 0.05,
        },
        G40: {
            code: 'G40',
            du: 50,
            qmin: 0.5,
            qmax: 65,
            turndown: 130,
            sensitivity: 0.06,
            impulseM3: 0.1,
            dpMaxKpa: 0.4,
            qtFactor: 0.05,
        },
        G65: {
            code: 'G65',
            du: 50,
            qmin: 0.5,
            qmax: 100,
            turndown: 200,
            sensitivity: 0.06,
            impulseM3: 0.1,
            dpMaxKpa: 0.4,
            qtFactor: 0.05,
        },
        G100: {
            code: 'G100',
            du: 80,
            qmin: 0.65,
            qmax: 160,
            turndown: 250,
            sensitivity: 0.06,
            impulseM3: 1.0,
            dpMaxKpa: 0.5,
            qtFactor: 0.05,
        },
        'G160-80': {
            code: 'G160-80',
            du: 80,
            qmin: 1.6,
            qmax: 250,
            turndown: 160,
            sensitivity: 0.1,
            impulseM3: 1.0,
            dpMaxKpa: 0.5,
            qtFactor: 0.05,
        },
        'G160-100': {
            code: 'G160-100',
            du: 100,
            qmin: 1.6,
            qmax: 250,
            turndown: 160,
            sensitivity: 0.1,
            impulseM3: 1.0,
            dpMaxKpa: 1.0,
            qtFactor: 0.05,
        },
        G250: {
            code: 'G250',
            du: 100,
            qmin: 2.0,
            qmax: 400,
            turndown: 200,
            sensitivity: 0.1,
            impulseM3: 1.0,
            dpMaxKpa: 1.0,
            qtFactor: 0.05,
        },
        'G400-100': {
            code: 'G400-100',
            du: 100,
            qmin: 3.2,
            qmax: 650,
            turndown: 200,
            sensitivity: 0.12,
            impulseM3: 1.0,
            dpMaxKpa: 1.0,
            qtFactor: 0.05,
        },
        'G400-150': {
            code: 'G400-150',
            du: 150,
            qmin: 6.5,
            qmax: 650,
            turndown: 100,
            sensitivity: 0.6,
            impulseM3: 1.0,
            dpMaxKpa: 1.0,
            qtFactor: 0.05,
        },
        G650: {
            code: 'G650',
            du: 150,
            qmin: 10.0,
            qmax: 1000,
            turndown: 100,
            sensitivity: 0.7,
            impulseM3: 1.0,
            dpMaxKpa: 1.0,
            qtFactor: 0.05,
        },
        G1000: {
            code: 'G1000',
            du: 200,
            qmin: 16,
            qmax: 1600,
            turndown: 100,
            sensitivity: 1.0,
            impulseM3: 10.0,
            dpMaxKpa: 1.0,
            qtFactor: 0.05,
        },
    };

    const MAX_WORKING_PRESSURE_KPA = 1600;
    /**
     * ЭМИС-РГС 245 (ПК-ТМ-Р1): по паспорту счётчика (ЭМИС-РГС-245.pdf) —
     * среда −30…+80 °С (НЕ +60, как в РЭ комплекса табл. 13), окружение −40…+60 °С.
     * П.115–118 — параметры счётчика (Меню 2.16–2.19), поэтому берём спецификацию счётчика.
     */
    const GAS_T_MIN = -30;
    const GAS_T_MAX = 80;
    const AMBIENT_T_MIN = -40;
    const AMBIENT_T_MAX = 60;

    function f2(n) {
        return Number(n).toFixed(2);
    }

    function impulsesPerM3(impulseM3) {
        if (!impulseM3 || !Number.isFinite(impulseM3)) return '';
        return f2(1 / impulseM3);
    }

    /**
     * В прибор (п.101) — только G-рейтинг: G400-100 → G400.
     * Полный код из заказа показываем под полем.
     */
    function deviceTypeCodeForStep101(typeOrCode) {
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

    /**
     * Макс. счётного механизма (п.121) по РЭ ЭМИС-РГС 245:
     * G10–G65 → 10⁶; G100–G650 → 10⁷; G1000 → 10⁸.
     */
    function counterMechMaxForType(typeOrCode) {
        const g = nominalQFromG(typeOrCode);
        if (g == null) {
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

    function listTypes() {
        return Object.keys(TYPES).map((k) => TYPES[k]);
    }

    function findByCode(code) {
        const c = String(code || '').trim().toUpperCase();
        if (!c) return null;
        if (TYPES[c]) return TYPES[c];
        const norm = c.replace(/\s+/g, '');
        for (const t of listTypes()) {
            if (t.code.toUpperCase().replace(/\s+/g, '') === norm) return t;
        }
        return null;
    }

    /**
     * Подбор типоразмера по Du, Qmin/Qmax и динамическому диапазону (1:N) из заказа.
     */
    function resolveType(opts) {
        const o = opts || {};
        if (o.typeCode) {
            let t = findByCode(o.typeCode);
            if (!t) {
                const raw = String(o.typeCode || '')
                    .toUpperCase()
                    .replace(/\s+/g, '');
                const m = raw.match(/^(G\d{2,4})(?:-(\d{2,3}))?$/);
                if (m) {
                    const g = m[1];
                    const duSuffix = m[2] ? parseInt(m[2], 10) : null;
                    // G400 → предпочесть G400-100 / G400-150 по DN.
                    const du = Number.isFinite(duSuffix)
                        ? duSuffix
                        : parseInt(String(o.du ?? ''), 10);
                    const byG = listTypes().filter(function (x) {
                        return String(x.code)
                            .toUpperCase()
                            .replace(/\s+/g, '')
                            .startsWith(g);
                    });
                    if (byG.length === 1) {
                        t = byG[0];
                    } else if (byG.length && Number.isFinite(du)) {
                        t = byG.find(function (x) {
                            return x.du === du;
                        }) || null;
                    }
                }
            }
            if (t) return t;
        }
        const du = parseInt(String(o.du ?? ''), 10);
        if (!Number.isFinite(du)) return null;
        const candidates = listTypes().filter((t) => t.du === du);
        if (!candidates.length) return null;
        if (candidates.length === 1) return candidates[0];

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

    /** Значения для полей val_100…val_122 (кроме серийника, дат, накопленного объёма). */
    function meterStepValues(type) {
        if (!type) return {};
        const qt = type.qtFactor * type.qmax;
        const qnom = nominalQFromG(type);
        return {
            100: 'ЭМИС-РГС-245',
            101: deviceTypeCodeForStep101(type),
            105: String(type.du),
            106: impulsesPerM3(type.impulseM3),
            108: f2(type.sensitivity),
            109: f2(type.qmin),
            110: qnom != null ? f2(qnom) : '',
            111: f2(type.qmax),
            // п.112 Qt = qtFactor×Qmax (столбец Qt/«О»)
            112: f2(qt),
            113: f2(type.dpMaxKpa),
            114: f2(MAX_WORKING_PRESSURE_KPA),
            115: f2(GAS_T_MIN),
            116: f2(GAS_T_MAX),
            117: f2(AMBIENT_T_MIN),
            118: f2(AMBIENT_T_MAX),
            121: counterMechMaxForType(type),
        };
    }

    window.TM07_EMIS_RGS245 = {
        TYPES: TYPES,
        listTypes: listTypes,
        findByCode: findByCode,
        resolveType: resolveType,
        meterStepValues: meterStepValues,
        deviceTypeCodeForStep101: deviceTypeCodeForStep101,
        nominalQFromG: nominalQFromG,
        counterMechMaxForType: counterMechMaxForType,
    };
})();
