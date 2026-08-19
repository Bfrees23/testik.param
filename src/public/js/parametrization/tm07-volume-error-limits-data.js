/**
 * Таблицы 15–16 РЭ: пределы относительной погрешности объёма газа.
 * Табл. 15 — при рабочих условиях → п.119–120 (счётчик), п.219–220 (комплекс).
 * Табл. 16 — к стандартным условиям → п.225–226 (комплекс).
 * Привязка: исполнение комплекса (ПК-ТМ-Р1…Т2) + модификация (О, 2О, 3О, 4О, У, 2У).
 */
(function () {
    'use strict';

    const MODS = ['О', '2О', '3О', '4О', 'У', '2У'];

    /** Допустимые модификации по комплексу (табл. 15 и 16). */
    const COMPLEX_MODS = {
        'ПК-ТМ-Р1': ['О', '2О', '3О', '4О', 'У', '2У'],
        'ПК-ТМ-Р2': ['О'],
        'ПК-ТМ-Р3': ['О', '2О', '3О', '4О', 'У', '2У'],
        'ПК-ТМ-Р4': ['2О', '3О', 'У', '2У'],
        'ПК-ТМ-Р5': ['2О', 'У', '2У'],
        'ПК-ТМ-Р6': ['О'],
        'ПК-ТМ-Т1': ['О', '3О', '4О'],
        'ПК-ТМ-Т2': ['2О', '3О', 'У', '2У'],
    };

    const DEFAULT_MOD = {
        'ПК-ТМ-Р1': 'О',
        'ПК-ТМ-Р2': 'О',
        'ПК-ТМ-Р3': 'О',
        'ПК-ТМ-Р4': '2О',
        'ПК-ТМ-Р5': '2О',
        'ПК-ТМ-Р6': 'О',
        'ПК-ТМ-Т1': 'О',
        'ПК-ТМ-Т2': '2О',
    };

    /** @type {Record<string, Record<string, {qminQt?:number,qtQmax?:number,single?:number}>>} */
    const TABLE_15_WORKING = {
        'ПК-ТМ-Р1': {
            О: { qminQt: 1.9, qtQmax: 1.0 },
            '2О': { qminQt: 1.7, qtQmax: 1.0 },
            '3О': { qminQt: 1.5, qtQmax: 0.9 },
            '4О': { qminQt: 1.2, qtQmax: 0.75 },
            У: { qminQt: 0.9, qtQmax: 0.6 },
            '2У': { single: 0.9 },
        },
        'ПК-ТМ-Р2': {
            О: { qminQt: 2.0, qtQmax: 1.0 },
        },
        'ПК-ТМ-Р3': {
            О: { qminQt: 1.9, qtQmax: 1.0 },
            '2О': { qminQt: 1.7, qtQmax: 1.0 },
            '3О': { qminQt: 1.6, qtQmax: 1.0 },
            '4О': { qminQt: 1.4, qtQmax: 1.0 },
            У: { single: 0.9 },
            '2У': { single: 0.9 },
        },
        'ПК-ТМ-Р4': {
            '2О': { qminQt: 1.7, qtQmax: 1.0 },
            '3О': { qminQt: 1.5, qtQmax: 1.0 },
            У: { single: 0.9 },
            '2У': { single: 0.9 },
        },
        'ПК-ТМ-Р5': {
            '2О': { qminQt: 1.7, qtQmax: 1.0 },
            У: { single: 0.9 },
            '2У': { single: 0.9 },
        },
        'ПК-ТМ-Р6': {
            О: { qminQt: 1.9, qtQmax: 1.0 },
        },
        'ПК-ТМ-Т2': {
            '2О': { qminQt: 1.7, qtQmax: 1.0 },
            '3О': { qminQt: 1.5, qtQmax: 1.0 },
            У: { single: 0.9 },
            '2У': { single: 0.9 },
        },
    };

    /** Табл. 15 для ПК-ТМ-Т1: семейство счётчика × модификация × Qmax. */
    const TABLE_15_T1 = {
        SG16MT: {
            О: { qminQt: 1.9, qtQmax: 1.0, qmaxMin: 65, qmaxMax: 650 },
            '3О': { qminQt: 1.6, qtQmax: 1.0, qmaxMin: 800, qmaxMax: 1000 },
            '4О': { qminQt: 1.3, qtQmax: 0.9, qmaxMin: 1600, qmaxMax: 4000 },
        },
        SG75MT: {
            О: { qminQt: 1.9, qtQmax: 1.0, qmaxMin: 160, qmaxMax: 250 },
            '3О': { qminQt: 1.6, qtQmax: 1.0, qmaxMin: 400, qmaxMax: 1000 },
            '4О': { qminQt: 1.3, qtQmax: 0.9, qmaxMin: 1600, qmaxMax: 4000 },
        },
    };

    /**
     * Правила табл. 15 для комплексов с зависимостью от типоразмера (G… / T1-…).
     * Р4: 2О — G16…G250; 3О — G400; У — весь диапазон.
     * Т2: 2О — G65…G250; 3О — G400…G1600; У — весь диапазон.
     */
    const TABLE_15_TYPE_RULES = {
        'ПК-ТМ-Р4': {
            '2О': { gMin: 16, gMax: 250 },
            '3О': { gMin: 400, gMax: 400 },
            У: { single: true },
            '2У': { single: true },
        },
        'ПК-ТМ-Т2': {
            '2О': { gMin: 65, gMax: 250 },
            '3О': { gMin: 400, gMax: 1600 },
            У: { single: true },
            '2У': { single: true },
        },
    };

    /** Табл. 16 — к стандартным условиям (п.225–226 комплекс). */
    /** @type {Record<string, Record<string, {qminQt?:number,qtQmax?:number,single?:number}>>} */
    const TABLE_16_STANDARD = {
        'ПК-ТМ-Р1': {
            О: { qminQt: 2.0, qtQmax: 1.1 },
            '2О': { qminQt: 1.8, qtQmax: 1.1 },
            '3О': { qminQt: 1.6, qtQmax: 1.0 },
            '4О': { qminQt: 1.3, qtQmax: 0.85 },
            У: { qminQt: 1.0, qtQmax: 0.7 },
            '2У': { single: 1.0 },
        },
        'ПК-ТМ-Р2': {
            О: { qminQt: 2.1, qtQmax: 1.1 },
        },
        'ПК-ТМ-Р3': {
            О: { qminQt: 2.0, qtQmax: 1.1 },
            '2О': { qminQt: 1.8, qtQmax: 1.1 },
            '3О': { qminQt: 1.7, qtQmax: 1.1 },
            '4О': { qminQt: 1.5, qtQmax: 1.1 },
            У: { single: 1.0 },
            '2У': { single: 1.0 },
        },
        'ПК-ТМ-Р4': {
            '2О': { qminQt: 1.8, qtQmax: 1.1 },
            '3О': { qminQt: 1.6, qtQmax: 1.1 },
            У: { single: 1.0 },
            '2У': { single: 1.0 },
        },
        'ПК-ТМ-Р5': {
            '2О': { qminQt: 1.8, qtQmax: 1.1 },
            У: { single: 1.0 },
            '2У': { single: 1.0 },
        },
        'ПК-ТМ-Р6': {
            О: { qminQt: 2.0, qtQmax: 1.1 },
        },
        'ПК-ТМ-Т2': {
            '2О': { qminQt: 1.8, qtQmax: 1.1 },
            '3О': { qminQt: 1.6, qtQmax: 1.1 },
            У: { single: 1.0 },
            '2У': { single: 1.0 },
        },
    };

    /** Табл. 16 для ПК-ТМ-Т1 (СГ16МТ / СГ75МТ). */
    const TABLE_16_T1 = {
        SG16MT: {
            О: { qminQt: 2.0, qtQmax: 1.1, qmaxMin: 65, qmaxMax: 650 },
            '3О': { qminQt: 1.7, qtQmax: 1.1, qmaxMin: 800, qmaxMax: 1000 },
            '4О': { qminQt: 1.4, qtQmax: 1.0, qmaxMin: 1600, qmaxMax: 4000 },
        },
        SG75MT: {
            О: { qminQt: 2.0, qtQmax: 1.1, qmaxMin: 160, qmaxMax: 250 },
            '3О': { qminQt: 1.7, qtQmax: 1.1, qmaxMin: 400, qmaxMax: 1000 },
            '4О': { qminQt: 1.4, qtQmax: 1.0, qmaxMin: 1600, qmaxMax: 4000 },
        },
    };

    function f2(n) {
        return Number(n).toFixed(2);
    }

    function normalizeComplexKey(designation) {
        return String(designation || '')
            .trim()
            .toUpperCase()
            .replace(/\s+/g, '')
            .replace(/\.БТ$/, '');
    }

    function normalizeModification(raw) {
        let t = String(raw || '')
            .trim()
            .toUpperCase()
            .replace(/\s+/g, '')
            .replace(/O/g, 'О');
        // Сто / Ст.о → 2О; 2У остаётся 2У.
        if (t === 'СТО' || t === 'СТ.О' || t === 'СТОо' || t === 'STO' || t === 'ST.O') {
            return '2О';
        }
        if (t === '2У' || t === '2U') {
            return '2У';
        }
        if (t === 'U') {
            t = 'У';
        }
        if (t === 'У' || t === 'О' || t === '2О' || t === '3О' || t === '4О') {
            return t;
        }
        return null;
    }

    function extractModification(text) {
        const s = String(text || '');
        const patterns = [
            /модификаци[яи]\s*[«"'(:]?\s*(СТО|СТ\.?О|2У|[1-4][ОOО]|У)\s*[»"')]?/gi,
            /исполнени[ея][^.;]{0,120}модификаци[яи]\s*[«"']?\s*(СТО|СТ\.?О|2У|[1-4][ОOО]|У)/gi,
            /точност[ьи][^.;]{0,40}модификаци[яи]\s*[«"']?\s*(СТО|СТ\.?О|2У|[1-4][ОOО]|У)/gi,
            /точност[ьи]\s*[«"']?\s*(СТО|СТ\.?О|2У|[1-4][ОOО]|У)\s*[»"']?/gi,
            /[«"'(]\s*(СТО|СТ\.?О|2У|[1-4][ОOО]|У)\s*[»"')]/gi,
            /мод\.?\s*(СТО|СТ\.?О|2У|[1-4][ОOО]|У)\b/gi,
            /(СТО|СТ\.?О|2У|[1-4][ОOО]|У)\s*модификаци/gi,
            /(?:^|[\s,;/])(СТО|СТ\.?О|2У|[1-4][ОOО]|У)(?:[.\s,;»)/]|$)/gi,
        ];
        const found = [];
        for (let pi = 0; pi < patterns.length; pi += 1) {
            const re = patterns[pi];
            let m;
            while ((m = re.exec(s)) !== null) {
                const mod = normalizeModification(m[1]);
                if (mod) {
                    found.push(mod);
                }
            }
        }
        if (!found.length) {
            return null;
        }
        return found[found.length - 1];
    }

    function gTypeNumber(typeCode) {
        const m = String(typeCode || '').match(/G\s*(\d+)/i);
        return m ? parseInt(m[1], 10) : null;
    }

    function expandRow(row) {
        if (!row) {
            return null;
        }
        if (row.single != null) {
            return { qminQt: row.single, qtQmax: row.single };
        }
        return { qminQt: row.qminQt, qtQmax: row.qtQmax };
    }

    function pickRowFromBlock(block, modification) {
        if (!block) {
            return null;
        }
        const row = block[modification];
        return row ? expandRow(row) : null;
    }

    function inferT1Family(fullText) {
        const text = String(fullText || '');
        if (/СГ\s*75\s*МТ|SG\s*75\s*MT|СГ75МТ/i.test(text)) {
            return 'SG75MT';
        }
        if (/СГ\s*16\s*МТ|SG\s*16\s*MT|СГ16МТ/i.test(text)) {
            return 'SG16MT';
        }
        if (/\bСГ75/i.test(text)) {
            return 'SG75MT';
        }
        if (/\bСГ16/i.test(text)) {
            return 'SG16MT';
        }
        return 'SG16MT';
    }

    function inferT1Modification(family, modification, qmax) {
        const bandTable = TABLE_15_T1[family] || TABLE_16_T1[family];
        const q = Number.isFinite(qmax) ? qmax : null;
        const mods = COMPLEX_MODS['ПК-ТМ-Т1'];

        if (modification && mods.indexOf(modification) >= 0 && bandTable[modification]) {
            const row = bandTable[modification];
            if (q == null || (q >= row.qmaxMin && q <= row.qmaxMax)) {
                return modification;
            }
        }
        if (q != null) {
            for (let i = 0; i < mods.length; i += 1) {
                const mod = mods[i];
                const row = bandTable[mod];
                if (row && q >= row.qmaxMin && q <= row.qmaxMax) {
                    return mod;
                }
            }
        }
        return modification && mods.indexOf(modification) >= 0 ? modification : DEFAULT_MOD['ПК-ТМ-Т1'];
    }

    function resolveT1(family, modification, qmax) {
        const mod = inferT1Modification(family, modification, qmax);
        const w = pickRowFromBlock(TABLE_15_T1[family], mod);
        const s = pickRowFromBlock(TABLE_16_T1[family], mod);
        return {
            working: w,
            standard: s,
            modification: mod,
            ruleNote: family + ', мод.' + mod,
        };
    }

    function inferR4Modification(modification, typeCode) {
        if (modification === 'У' || modification === '2У') {
            return modification;
        }
        const g = gTypeNumber(typeCode);
        if (g === 400 || (typeCode && /^G\s*400/i.test(String(typeCode)))) {
            return '3О';
        }
        if (g != null && g >= 16 && g <= 250) {
            return '2О';
        }
        if (modification === '3О' || modification === '2О') {
            return modification;
        }
        return DEFAULT_MOD['ПК-ТМ-Р4'];
    }

    function resolveR4(modification, typeCode) {
        const mod = inferR4Modification(modification, typeCode);
        return {
            working: pickRowFromBlock(TABLE_15_WORKING['ПК-ТМ-Р4'], mod),
            standard: pickRowFromBlock(TABLE_16_STANDARD['ПК-ТМ-Р4'], mod),
            modification: mod,
            ruleNote: mod + (typeCode ? ', ' + typeCode : ''),
        };
    }

    function inferT2Modification(modification, typeCode) {
        if (modification === 'У' || modification === '2У') {
            return modification;
        }
        const g = gTypeNumber(typeCode);
        if (g != null && g >= 400 && g <= 1600) {
            return '3О';
        }
        if (g != null && g >= 65 && g <= 250) {
            return '2О';
        }
        if (modification === '3О' || modification === '2О') {
            return modification;
        }
        return DEFAULT_MOD['ПК-ТМ-Т2'];
    }

    function resolveT2(modification, typeCode) {
        const mod = inferT2Modification(modification, typeCode);
        return {
            working: pickRowFromBlock(TABLE_15_WORKING['ПК-ТМ-Т2'], mod),
            standard: pickRowFromBlock(TABLE_16_STANDARD['ПК-ТМ-Т2'], mod),
            modification: mod,
            ruleNote: mod + (typeCode ? ', ' + typeCode : ''),
        };
    }

    function resolveSimpleTable15(complexKey, modification) {
        const allowed = COMPLEX_MODS[complexKey];
        if (!allowed) {
            return null;
        }
        let mod = modification;
        if (!mod || allowed.indexOf(mod) < 0) {
            mod = DEFAULT_MOD[complexKey] || 'О';
        }
        if (allowed.indexOf(mod) < 0) {
            return null;
        }
        return {
            working: pickRowFromBlock(TABLE_15_WORKING[complexKey], mod),
            standard: pickRowFromBlock(TABLE_16_STANDARD[complexKey], mod),
            modification: mod,
            ruleNote: 'мод.' + mod,
        };
    }

    /**
     * Только табл. 15 (рабочие условия) → п.119–120, 219–220.
     * @param {{complexDesignation?:string, modification?:string|null, typeCode?:string|null, qmax?:number|null, fullText?:string}} opts
     */
    function resolveTable15Working(opts) {
        const all = resolveVolumeErrors(opts);
        if (!all || !all.working) {
            return null;
        }
        const built = buildStepValues(all.working, null);
        return {
            complexKey: all.complexKey,
            modification: all.modification,
            extractedModification: all.extractedModification,
            ruleNote: all.ruleNote,
            working: all.working,
            steps: built.values,
            tableByStep: built.tableByStep,
        };
    }

    /**
     * @param {{complexDesignation?:string, modification?:string|null, typeCode?:string|null, qmax?:number|null, fullText?:string}} opts
     */
    function resolveVolumeErrors(opts) {
        const o = opts || {};
        const complexKey = normalizeComplexKey(o.complexDesignation);
        if (!complexKey || !COMPLEX_MODS[complexKey]) {
            return null;
        }

        const extracted =
            normalizeModification(o.modification) || extractModification(o.fullText) || null;
        const typeCode = o.typeCode || null;
        const qmax = o.qmax != null ? parseFloat(String(o.qmax).replace(',', '.')) : null;

        let result;
        if (complexKey === 'ПК-ТМ-Р4') {
            result = resolveR4(extracted, typeCode);
        } else if (complexKey === 'ПК-ТМ-Т1') {
            result = resolveT1(inferT1Family(o.fullText), extracted, qmax);
        } else if (complexKey === 'ПК-ТМ-Т2') {
            result = resolveT2(extracted, typeCode);
        } else {
            result = resolveSimpleTable15(complexKey, extracted);
        }

        if (!result || (!result.working && !result.standard)) {
            return null;
        }

        const built = buildStepValues(result.working, result.standard);

        return {
            complexKey: complexKey,
            modification: result.modification,
            extractedModification: extracted,
            ruleNote: result.ruleNote,
            working: result.working,
            standard: result.standard,
            steps: built.values,
            tableByStep: built.tableByStep,
        };
    }

    function buildStepValues(working, standard) {
        const out = {};
        const meta = {};
        if (working) {
            [119, 120, 219, 220].forEach(function (sid) {
                const val = sid <= 120 ? (sid === 119 ? working.qminQt : working.qtQmax) : sid === 219 ? working.qminQt : working.qtQmax;
                out[sid] = f2(val);
                meta[sid] = 15;
            });
        }
        if (standard) {
            out[225] = f2(standard.qminQt);
            out[226] = f2(standard.qtQmax);
            meta[225] = 16;
            meta[226] = 16;
        }
        return { values: out, tableByStep: meta };
    }

    window.TM07_VOLUME_ERROR_LIMITS = {
        MODS: MODS,
        COMPLEX_MODS: COMPLEX_MODS,
        TABLE_15_WORKING: TABLE_15_WORKING,
        TABLE_15_T1: TABLE_15_T1,
        TABLE_15_TYPE_RULES: TABLE_15_TYPE_RULES,
        TABLE_16_STANDARD: TABLE_16_STANDARD,
        TABLE_16_T1: TABLE_16_T1,
        normalizeComplexKey: normalizeComplexKey,
        normalizeModification: normalizeModification,
        extractModification: extractModification,
        resolveTable15Working: resolveTable15Working,
        resolveVolumeErrors: resolveVolumeErrors,
    };
})();
