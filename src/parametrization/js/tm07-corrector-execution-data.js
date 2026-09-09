/**
 * Исполнения корректора ТМ-07 (И1…И4) и маски п.74–77, режим комплекса п.78–79.
 * Источник: инструкция по параметризации (маски тревог/аварий).
 */
(function () {
    'use strict';

    const VARIANTS = {
        И1: {
            code: 'И1',
            title: 'Базовая комплектация',
            alarmMask: '0x43FF',
            emergencyMask: '0x33',
            warningMaskSupplier: '0x3C003',
            warningMaskManufacturer: '0x3C3FF',
        },
        И2: {
            code: 'И2',
            title: 'Базовая + ППД',
            alarmMask: '0x4FFF',
            emergencyMask: '0x37',
            warningMaskSupplier: '0x3C003',
            warningMaskManufacturer: '0x3CFFF',
        },
        И3: {
            code: 'И3',
            title: 'Базовая + ПТТП',
            alarmMask: '0x73FF',
            emergencyMask: '0x3B',
            warningMaskSupplier: '0x3C003',
            warningMaskManufacturer: '0x3F3FF',
        },
        И4: {
            code: 'И4',
            title: 'Максимальная комплектация',
            alarmMask: '0x7FFF',
            emergencyMask: '0x3F',
            warningMaskSupplier: '0x3C003',
            warningMaskManufacturer: '0x3FFFF',
        },
    };

    function normalizeComplexKey(designation) {
        return String(designation || '')
            .trim()
            .toUpperCase()
            .replace(/\s+/g, '')
            .replace(/\.БТ$/, '');
    }

    function isComplexCorrectorUsage(complexDesignation) {
        const raw = String(complexDesignation || '');
        if (/ПК-ТМ-/i.test(raw)) {
            return true;
        }
        const key = normalizeComplexKey(raw);
        return key.indexOf('ПК-ТМ-') === 0;
    }

    /** Явное «И2» / «исполнение И3» в тексте заказа.
     * Не используем \\b перед «И» — в JS без /u кириллица не word-char, граница ломается.
     */
    function extractExecutionFromText(text) {
        const s = String(text || '');
        const patterns = [
            /исполнени[ея]\s*[«"']?\s*И\s*([1-4])\s*[»"']?/i,
            /(?:^|[^0-9A-Za-zА-Яа-яЁё])И\s*([1-4])(?![0-9])/i,
        ];
        for (let i = 0; i < patterns.length; i += 1) {
            const m = s.match(patterns[i]);
            if (m) {
                return 'И' + m[1];
            }
        }
        return null;
    }

    /**
     * По составу датчиков в наименовании/характеристиках заказа.
     * @returns {{hasPpd:boolean,hasPttp:boolean}}
     */
    function detectEquipment(text) {
        const s = String(text || '');
        let hasPpd =
            // Явные токены заказа 1С / конфигурации: ППД(0-4)+УК и т.п.
            /ППД/i.test(s) ||
            /преобразовател[ья]?\s+перепада\s+давления/i.test(s) ||
            /датчик\s+перепада\s+давления/i.test(s) ||
            /датчик[а-я]*\s+давления\s+разност/i.test(s) ||
            /\bДДР\b/i.test(s) ||
            /разност[иь]\s+давлен/i.test(s) ||
            /дифференциальн[а-я]+\s+давлен/i.test(s) ||
            /перепад[а]?\s+давлен/i.test(s);
        // ПТГ = темп. газа (DT) — всегда; второй температурник (TT) только при ПТТП / «технолог».
        let hasPttp =
            /ПТТП/i.test(s) ||
            /\bДТТП\b/i.test(s) ||
            /преобразовател[ья]?\s+температур[ыы]\s+технолог/i.test(s) ||
            /датчик[а-я]*\s+температур[ыы]?\s+технолог/i.test(s) ||
            /температур[аы]\s+технолог/i.test(s);
        // Исполнение И2/И4 ⇒ ППД; И3/И4 ⇒ ПТТП (если явно указано в заказе).
        const mExec =
            s.match(/исполнени[ея]\s*[«"']?\s*И\s*([1-4])\s*[»"']?/i) ||
            s.match(/(?:^|[^0-9A-Za-zА-Яа-яЁё])И\s*([1-4])(?![0-9])/i);
        if (mExec) {
            const n = parseInt(mExec[1], 10);
            if (n === 2 || n === 4) {
                hasPpd = true;
            }
            if (n === 3 || n === 4) {
                hasPttp = true;
            }
        }
        return { hasPpd: hasPpd, hasPttp: hasPttp };
    }

    function resolveExecutionVariant(hasPpd, hasPttp) {
        if (hasPpd && hasPttp) {
            return 'И4';
        }
        if (hasPpd) {
            return 'И2';
        }
        if (hasPttp) {
            return 'И3';
        }
        return 'И1';
    }

    /**
     * T5: (м³/имп) / (м³/ч) → ч, округление до 0,1 ч ВВЕРХ (не в меньшую сторону) → сек.
     * Пример: 8,33333 ч → 8,4 ч (30240 с), а не 8,3 ч.
     * @param {number} m3PerImpulse цена импульса, м³/имп
     * @param {number} sensitivityM3h порог чувствительности, м³/ч
     */
    function calcT5DelaySeconds(m3PerImpulse, sensitivityM3h) {
        const ci = parseFloat(String(m3PerImpulse).replace(',', '.'));
        const q = parseFloat(String(sensitivityM3h).replace(',', '.'));
        if (!Number.isFinite(ci) || !Number.isFinite(q) || q <= 0) {
            return null;
        }
        const hours = ci / q;
        const hoursRound = Math.ceil(hours * 10) / 10;
        return Math.round(hoursRound * 3600);
    }

    /**
     * @param {{complexDesignation?:string, fullText?:string, impulsesPerM3?:number|null, sensitivityM3h?:number|null}} opts
     */
    function resolveCorrectorExecution(opts) {
        const o = opts || {};
        const text = String(o.fullText || '');
        const explicit = extractExecutionFromText(text);
        let equip = detectEquipment(text);
        if (o.equipment && typeof o.equipment === 'object') {
            equip = {
                hasPpd: !!(equip.hasPpd || o.equipment.hasPpd),
                hasPttp: !!(equip.hasPttp || o.equipment.hasPttp),
            };
        } else {
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
        }
        // Исполнение: объединяем явный Иn из текста и состав датчиков (ППД/ПТТП).
        if (explicit === 'И2' || explicit === 'И4') {
            equip.hasPpd = true;
        }
        if (explicit === 'И3' || explicit === 'И4') {
            equip.hasPttp = true;
        }
        const variantCode = resolveExecutionVariant(equip.hasPpd, equip.hasPttp);
        const variant = VARIANTS[variantCode];
        if (!variant) {
            return null;
        }

        let m3PerImp = null;
        if (o.m3PerImpulse != null && Number.isFinite(o.m3PerImpulse)) {
            m3PerImp = o.m3PerImpulse;
        } else if (o.impulsesPerM3 != null && Number.isFinite(o.impulsesPerM3) && o.impulsesPerM3 > 0) {
            m3PerImp = 1 / o.impulsesPerM3;
        }

        const t5 = calcT5DelaySeconds(m3PerImp, o.sensitivityM3h);
        const inComplex =
            isComplexCorrectorUsage(o.complexDesignation) || isComplexCorrectorUsage(o.fullText);

        const steps = {
            71: variant.warningMaskSupplier,
            72: variant.warningMaskManufacturer,
            74: variant.alarmMask,
            75: variant.alarmMask,
            77: variant.emergencyMask,
        };
        if (t5 != null) {
            steps[73] = String(t5);
            steps[76] = String(t5);
        }
        // Параметризация (1): п.78 и п.79 — зеркальные флаги «самостоятельное СИ» / «в комплексе».
        // Только корректор: 78=1, 79=0. В составе ПК-ТМ: 78=0, 79=1.
        if (inComplex) {
            steps[78] = '0';
            steps[79] = '1';
        } else {
            steps[78] = '1';
            steps[79] = '0';
        }

        return {
            variant: variantCode,
            title: variant.title,
            explicit: explicit,
            equipment: equip,
            inComplex: inComplex,
            t5Seconds: t5,
            steps: steps,
        };
    }

    /**
     * Пересчитать подписи «исполнение Иn» на масках 71/72/74/75/77 (бейджи в таблицах).
     * Бейджи рисуются один раз при построении таблиц — до загрузки заказа, поэтому после
     * автозаполнения пересчитываем их по текущему тексту заказа. Если заказа ещё нет — не трогаем.
     */
    function refreshMaskExecutionBadges(fullTextHint) {
        if (typeof document === 'undefined') {
            return;
        }
        const badges = document.querySelectorAll('.param-mask-exec[data-mask-step]');
        if (!badges.length) {
            return;
        }
        let text = String(fullTextHint || '');
        if (!String(text).trim()) {
            try {
                const Ops = typeof window !== 'undefined' ? window.TM07_WORKBENCH_OPS : null;
                if (Ops && typeof Ops.collectOrderTextBlob === 'function') {
                    text = String(Ops.collectOrderTextBlob() || '');
                }
            } catch (_e) {}
        }
        if (!String(text).trim()) {
            return;
        }
        let variant = 'И1';
        try {
            const exec = resolveCorrectorExecution({ fullText: text });
            if (exec && exec.variant) {
                variant = exec.variant;
            }
        } catch (_e) {}
        badges.forEach(function (badge) {
            badge.textContent = 'исполнение ' + variant;
        });
    }

    window.TM07_CORRECTOR_EXECUTION = {
        VARIANTS: VARIANTS,
        normalizeComplexKey: normalizeComplexKey,
        isComplexCorrectorUsage: isComplexCorrectorUsage,
        extractExecutionFromText: extractExecutionFromText,
        detectEquipment: detectEquipment,
        resolveExecutionVariant: resolveExecutionVariant,
        calcT5DelaySeconds: calcT5DelaySeconds,
        resolveCorrectorExecution: resolveCorrectorExecution,
        refreshMaskExecutionBadges: refreshMaskExecutionBadges,
    };
})();
