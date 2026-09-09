/**
 * Погрешности корректора ТМ-07 — п.14–19 (меню 1.3.16–1.3.21).
 * Номиналы по эталонной карте параметризации; δ.Vст — из δ.P, δ.T, δ.K.
 * П.18 и п.19 — только при наличии ППД / ПТТП (исполнения И2, И3, И4).
 */
(function () {
    'use strict';

    const STEP_IDS = {
        deltaP: 14,
        deltaT: 15,
        deltaK: 16,
        deltaVst: 17,
        deltaDp: 18,
        deltaT2: 19,
    };

    /** Номинальные пределы, % (эталон tm07-parametrization-v50.prm). */
    const NOMINAL = {
        deltaP: 0.25,
        deltaT: 0.1,
        deltaK: 0.01,
        deltaDp: 0.25,
        deltaT2: 0.1,
    };

    /**
     * δ.ΔP (п.18) по верхнему пределу перепада (п.11):
     * 0–1 / 0–1.6 / 0–2.5 кПа → 0.5 %; остальные диапазоны → 0.25 %.
     */
    function nominalDeltaDpForPmax(pmaxKpa) {
        const p = parseNum(pmaxKpa);
        if (p == null) {
            return NOMINAL.deltaDp;
        }
        const special = [1, 1.6, 2.5];
        for (let i = 0; i < special.length; i += 1) {
            if (Math.abs(p - special[i]) <= 0.05) {
                return 0.5;
            }
        }
        return 0.25;
    }

    function f2(n) {
        return Number(n).toFixed(2);
    }

    function f4(n) {
        return Number(n).toFixed(4);
    }

    function parseNum(raw) {
        if (raw == null || raw === '') {
            return null;
        }
        const n = parseFloat(String(raw).replace(',', '.'));
        return Number.isFinite(n) ? n : null;
    }

    function readStepValue(stepId) {
        const inp = document.getElementById('val_' + stepId);
        if (!inp || inp.disabled) {
            return null;
        }
        return parseNum(inp.value);
    }

    /** δ.Vст = √(δ.P² + δ.T² + δ.K²) — меню 1.3.19. */
    function computeDeltaVst(deltaP, deltaT, deltaK) {
        if (!Number.isFinite(deltaP) || !Number.isFinite(deltaT) || !Number.isFinite(deltaK)) {
            return null;
        }
        return Math.sqrt(deltaP * deltaP + deltaT * deltaT + deltaK * deltaK);
    }

    /**
     * @param {{fullText?:string, complexDesignation?:string, equipment?:{hasPpd?:boolean,hasPttp?:boolean}|null, existing?:Record<number,number|null>}} opts
     */
    function resolveCorrectorErrorLimits(opts) {
        const o = opts || {};
        const C = window.TM07_CORRECTOR_EXECUTION;
        let equip = o.equipment;
        if (!equip && C) {
            equip = C.detectEquipment(o.fullText || '');
        }
        const hasPpd = equip && equip.hasPpd;
        const hasPttp = equip && equip.hasPttp;

        const existing = o.existing || {};
        function pick(stepId, nominal) {
            if (existing[stepId] != null && Number.isFinite(existing[stepId])) {
                return existing[stepId];
            }
            const fromDom = readStepValue(stepId);
            if (fromDom != null) {
                return fromDom;
            }
            return nominal;
        }

        const deltaP = pick(STEP_IDS.deltaP, NOMINAL.deltaP);
        const deltaT = pick(STEP_IDS.deltaT, NOMINAL.deltaT);
        const deltaK = pick(STEP_IDS.deltaK, NOMINAL.deltaK);
        const deltaVst = computeDeltaVst(deltaP, deltaT, deltaK);

        const steps = {};
        steps[STEP_IDS.deltaP] = f2(deltaP);
        steps[STEP_IDS.deltaT] = f2(deltaT);
        steps[STEP_IDS.deltaK] = f4(deltaK);
        if (deltaVst != null) {
            steps[STEP_IDS.deltaVst] = f2(deltaVst);
        }
        if (hasPpd) {
            const dpMax = existing[11] != null ? existing[11] : readStepValue(11);
            const nomDp = nominalDeltaDpForPmax(dpMax);
            steps[STEP_IDS.deltaDp] = f2(pick(STEP_IDS.deltaDp, nomDp));
            // Если номинал по диапазону жёстче/иначе, чем «застрявший» 0.25 — всегда по правилу диапазона.
            if (dpMax != null) {
                steps[STEP_IDS.deltaDp] = f2(nomDp);
            }
        }
        if (hasPttp) {
            steps[STEP_IDS.deltaT2] = f2(pick(STEP_IDS.deltaT2, NOMINAL.deltaT2));
        }

        return {
            steps: steps,
            equipment: { hasPpd: !!hasPpd, hasPttp: !!hasPttp },
            computedVst: deltaVst,
        };
    }

    /**
     * Пересчитать только п.17 по текущим п.14–16 на форме.
     * @returns {string|null}
     */
    function recomputeDeltaVstOnForm() {
        const deltaP = readStepValue(STEP_IDS.deltaP);
        const deltaT = readStepValue(STEP_IDS.deltaT);
        const deltaK = readStepValue(STEP_IDS.deltaK);
        const v = computeDeltaVst(deltaP, deltaT, deltaK);
        return v != null ? f2(v) : null;
    }

    window.TM07_CORRECTOR_ERROR_LIMITS = {
        STEP_IDS: STEP_IDS,
        NOMINAL: NOMINAL,
        computeDeltaVst: computeDeltaVst,
        nominalDeltaDpForPmax: nominalDeltaDpForPmax,
        resolveCorrectorErrorLimits: resolveCorrectorErrorLimits,
        recomputeDeltaVstOnForm: recomputeDeltaVstOnForm,
    };
})();
