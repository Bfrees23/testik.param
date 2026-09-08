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

    /** Плашки ввода QR/S/N — отдельно на каждый канал заказа. */
    const SENSOR_CARD_META = {
        DA: {
            title: 'Давление (DA)',
            hint: 'Полный QR MIDA с корпуса датчика давления.',
            placeholder: 'серийный;MIDA;DA;…',
            inputmode: 'text',
            border: 'border-primary',
            headerBg: 'bg-primary-subtle',
        },
        DT: {
            title: 'Темп. газа (DT)',
            hint: '4 цифры серийного номера с наклейки температурного датчика.',
            placeholder: '4 цифры',
            inputmode: 'numeric',
            border: 'border-success',
            headerBg: 'bg-success-subtle',
        },
        DD: {
            title: 'Перепад (DD)',
            hint: 'Полный QR MIDA с корпуса датчика перепада (ППД).',
            placeholder: 'серийный;MIDA;DD;…',
            inputmode: 'text',
            border: 'border-warning',
            headerBg: 'bg-warning-subtle',
        },
        TT: {
            title: 'Темп. ТП (TT)',
            hint: '4 цифры с наклейки датчика температуры техн. параметров (ПТТП).',
            placeholder: '4 цифры',
            inputmode: 'numeric',
            border: 'border-info',
            headerBg: 'bg-info-subtle',
        },
    };

    const METER_VERIFY_NEXT_YEARS_DEFAULT = 5;
    const COMPLEX_VERIFY_NEXT_YEARS_DEFAULT = 5;
    /** МПИ корректора ТМ-07 — 5 лет (ГРСИ 93381-24, п.80/81). */
    const CORRECTOR_VERIFY_YEARS = 5;
    /**
     * МПИ комплекса ПК-ТМ (ГРСИ 95476-25): Т1/Р1 — 5 лет, Т2/Р2 — 4 года.
     * Р3/Р4/Р5 — 5 лет (как RVG/РВГ), Р6 — 4 года (СГР).
     */
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
    /** БТ из обозначения комплекса / заказа → наименование блока телеметрии (п.227). Без суффикса «Б». */
    const BT_BLOCK_NAMES = {
        БТ1: 'БПЭК-02/ЦК',
        БТ2: 'БПЭК-04/ЦК',
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

    /** В заказе есть блок телеметрии (.БТ / БТ1…3). */
    function orderHasTelemetryBlock() {
        const blobs = [];
        try {
            blobs.push(collectOrderTextFromCache() || '');
        } catch (_e) {}
        try {
            blobs.push(readStepVal(200) || '');
        } catch (_e2) {}
        const text = blobs.join(' ').toUpperCase().replace(/Ё/g, 'Е');
        if (/(?:^|[^0-9A-ZА-Я])БТ\s*[123](?![0-9])/.test(text)) {
            return true;
        }
        return /\.БТ(?:\s|$|[(),;])|(?:^|[^0-9A-ZА-Я])БТ(?:\s|$|[(),;])/.test(text);
    }

    /** Без .БТ наименование блока телеметрии (п.227) не пишем. */
    function shouldSkipTelemetryName() {
        return !orderHasTelemetryBlock();
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

    /**
     * МПИ комплекса = минимум из МПИ семейства, счётчика и корректора (5 лет).
     * Если интервалы разные — берём меньший, чтобы комплекс не «пережил» составные СИ.
     */
    function complexVerifyYearsEffective() {
        const familyYears = complexVerifyYearsForDesignation(readStepVal(200));
        const meterYears = meterVerifyYearsForCurrent();
        const years = Math.min(familyYears, meterYears, CORRECTOR_VERIFY_YEARS);
        return Number.isFinite(years) && years > 0 ? years : COMPLEX_VERIFY_NEXT_YEARS_DEFAULT;
    }

    /** Паспорт счётчика: сначала семейство из п.200 (Р3/Р4/Р5 не путать по короткому п.100). */
    function meterPassportFromSteps() {
        const fam = complexFamilyCodeFromDesignation(readStepVal(200));
        const byFam = {
            R1: 'emis-rgs245',
            // R2: 'prometr-r', // ПК-ТМ-Р2 / ПРОМЕТР-Р не выпускают
            R3: 'rvg-bc',
            R4: 'rvg-a',
            R5: 'rvg-b',
            R6: 'sgr',
            T1: 'sg',
            T2: 'tau-tsg-a',
        };
        if (fam && byFam[fam]) {
            if (fam === 'T2') {
                const blob = String(readStepVal(100) || '')
                    .toUpperCase()
                    .replace(/Ё/g, 'Е');
                if (/ИСП\.?\s*Б/.test(blob)) {
                    return 'tau-tsg-b';
                }
            }
            return byFam[fam];
        }
        const name = String(readStepVal(100) || '')
            .toUpperCase()
            .replace(/Ё/g, 'Е');
        if (/ЭМИС|EMIS|РГС\s*245|RGS\s*245/.test(name)) {
            return 'emis-rgs245';
        }
        // if (/ПРОМЕТР/.test(name)) {
        //     return 'prometr-r';
        // }
        if (/\bRABO\b/.test(name)) {
            return /ИСП\.?\s*R\b|\bR\b.*ДО\s*2022|ДО\s*2022/.test(name) ? 'rvg-r' : 'rvg-bc';
        }
        // Раско RVG — латиница; Таугаз РВГ — кириллица.
        if (/\bRVG\b/.test(name)) {
            if (/ИСП\.?\s*R\b/.test(name)) {
                return 'rvg-cyr-r';
            }
            return 'rvg-cyr-bc';
        }
        if (/РВГ/.test(name)) {
            if (/ИСП\.?\s*Б/.test(name) && !/ИСП\.?\s*А/.test(name)) {
                return 'rvg-b';
            }
            return 'rvg-a';
        }
        if (/РАСКО|RASKO/i.test(name)) {
            return /ИСП\.?\s*R\b/.test(name) ? 'rvg-r' : 'rvg-bc';
        }
        if (/СГР|\bSGR\b/.test(name)) {
            return 'sgr';
        }
        if (/ТАУ|TAU|ТСГ/.test(name)) {
            return /ИСП\.?\s*Б/.test(name) ? 'tau-tsg-b' : 'tau-tsg-a';
        }
        if (/\bСГ\b|\bSG\b|T1-/.test(name)) {
            return 'sg';
        }
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
        const t = String(s || '').trim();
        const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (iso) {
            return {
                day: parseInt(iso[3], 10),
                month: parseInt(iso[2], 10),
                year: parseInt(iso[1], 10),
            };
        }
        const m = t.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/);
        if (!m) {
            return null;
        }
        return {
            day: parseInt(m[1], 10),
            month: parseInt(m[2], 10),
            year: parseInt(m[3], 10),
        };
    }

    function isPlaceholderDate(s) {
        const t = String(s || '').trim();
        return !t || t === '01.01.2000' || t === '00.00.0000' || t === '2000-01-01';
    }

    function tDateToIso(s) {
        const p = parseTDate(s);
        if (!p) {
            return '';
        }
        return p.year + '-' + pad2(p.month) + '-' + pad2(p.day);
    }

    function currentCalendarYear() {
        return new Date().getFullYear();
    }

    function isRealCalendarDate(p) {
        if (!p) {
            return false;
        }
        const dt = new Date(p.year, p.month - 1, p.day);
        return (
            dt.getFullYear() === p.year &&
            dt.getMonth() === p.month - 1 &&
            dt.getDate() === p.day
        );
    }

    function daysInMonth(month, year) {
        const m = Number(month);
        const y = Number(year) || currentCalendarYear();
        if (!Number.isFinite(m) || m < 1 || m > 12) {
            return 31;
        }
        return new Date(y, m, 0).getDate();
    }

    function clampDayInput(raw, month, year) {
        let s = String(raw || '').replace(/\D/g, '').slice(0, 2);
        if (!s) {
            return '';
        }
        if (s.charAt(0) > '3') {
            s = '0' + s.charAt(0);
        }
        if (s.length === 1) {
            return s;
        }
        if (s.charAt(0) === '3' && s.charAt(1) > '1') {
            s = '31';
        }
        if (s === '00') {
            return '0';
        }
        let n = parseInt(s, 10);
        if (!Number.isFinite(n) || n < 1) {
            return s.charAt(0) === '0' ? '0' : '';
        }
        const max = daysInMonth(month, year);
        if (n > max) {
            n = max;
        }
        return pad2(n);
    }

    function clampMonthInput(raw) {
        let s = String(raw || '').replace(/\D/g, '').slice(0, 2);
        if (!s) {
            return '';
        }
        if (s.charAt(0) >= '2') {
            s = '0' + s.charAt(0);
        }
        if (s.length === 1) {
            return s;
        }
        if (s.charAt(0) === '1' && s.charAt(1) > '2') {
            return '12';
        }
        if (s === '00') {
            return '0';
        }
        const n = parseInt(s, 10);
        if (!Number.isFinite(n) || n < 1) {
            return s.charAt(0) === '0' ? '0' : '';
        }
        if (n > 12) {
            return '12';
        }
        return pad2(n);
    }

    function clampYearInput(raw, mode) {
        const cy = String(currentCalendarYear());
        let s = String(raw || '').replace(/\D/g, '').slice(0, 4);
        if (mode === 'current') {
            if (s.length === 4) {
                return cy;
            }
            let out = '';
            for (let i = 0; i < s.length; i += 1) {
                if (s.charAt(i) !== cy.charAt(i)) {
                    break;
                }
                out += s.charAt(i);
            }
            return out;
        }
        if (s.length === 4) {
            const n = parseInt(s, 10);
            const min = currentCalendarYear();
            const max = currentCalendarYear() + 20;
            if (!Number.isFinite(n) || n < min) {
                return String(min);
            }
            if (n > max) {
                return String(max);
            }
        }
        return s;
    }

    function cardDateToTDate(id) {
        const el = $(id);
        if (!el) {
            return '';
        }
        const v = String(el.value || '').trim();
        if (!/^\d{2}\.\d{2}\.\d{4}$/.test(v) && !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
            return '';
        }
        const p = parseTDate(v);
        if (!p || !isRealCalendarDate(p)) {
            return '';
        }
        return formatTDate(p);
    }

    function setCardDate(id, tdate) {
        const el = $(id);
        if (!el) {
            return;
        }
        if (isPlaceholderDate(tdate)) {
            el.value = '';
            return;
        }
        if (el.type === 'date') {
            el.value = tDateToIso(tdate);
            return;
        }
        el.value = String(tdate || '').trim();
    }

    function formatTDate(parts) {
        return pad2(parts.day) + '.' + pad2(parts.month) + '.' + parts.year;
    }

    function addYearsTDate(dateStr, years) {
        const p = parseTDate(dateStr);
        if (!p) {
            return null;
        }
        const d = new Date(p.year, p.month - 1, p.day);
        if (Number.isNaN(d.getTime())) {
            return null;
        }
        d.setFullYear(d.getFullYear() + years);
        return formatTDate({ day: d.getDate(), month: d.getMonth() + 1, year: d.getFullYear() });
    }

    /** Следующая поверка: +N лет и минус 1 день (21.08.2026 + 5 лет → 20.08.2031). */
    function addYearsMinusOneDayTDate(dateStr, years) {
        const p = parseTDate(dateStr);
        if (!p) {
            return null;
        }
        const d = new Date(p.year, p.month - 1, p.day);
        if (Number.isNaN(d.getTime())) {
            return null;
        }
        d.setFullYear(d.getFullYear() + years);
        d.setDate(d.getDate() - 1);
        return formatTDate({ day: d.getDate(), month: d.getMonth() + 1, year: d.getFullYear() });
    }

    function nextVerifyDateFromToday(years) {
        return addYearsMinusOneDayTDate(todayTDate(), years);
    }

    function maskDateField(el, yearMode) {
        if (!el || el.type === 'date') {
            return;
        }
        const old = String(el.value || '');
        const caret = el.selectionStart;
        const mode = yearMode === 'next' ? 'next' : 'current';
        let d = '';
        let m = '';
        let y = '';
        let slotCount = 1;
        if (old.indexOf('.') < 0) {
            const digits = old.replace(/\D/g, '').slice(0, 8);
            d = digits.slice(0, 2);
            m = digits.slice(2, 4);
            y = digits.slice(4, 8);
            slotCount = digits.length > 4 ? 3 : digits.length > 2 ? 2 : 1;
        } else {
            const parts = old.split('.');
            d = String(parts[0] || '').replace(/\D/g, '');
            m = String(parts[1] || '').replace(/\D/g, '');
            y = String(parts.slice(2).join('')).replace(/\D/g, '');
            slotCount = parts.length >= 3 ? 3 : 2;
            if (d.length > 2) {
                m = d.slice(2) + m;
                d = d.slice(0, 2);
            }
            if (m.length > 2) {
                y = m.slice(2) + y;
                m = m.slice(0, 2);
            }
        }
        m = clampMonthInput(m);
        const yHint = y.length === 4 ? parseInt(y, 10) : currentCalendarYear();
        const mHint = m.length === 2 ? parseInt(m, 10) : 0;
        d = clampDayInput(d, mHint, yHint);
        y = clampYearInput(y, mode);
        if (mode === 'current' && d.length === 2 && m.length === 2) {
            y = String(currentCalendarYear());
            slotCount = 3;
        }
        let out = d;
        if (slotCount >= 2 || m) {
            out = d + '.' + m;
        }
        if (slotCount >= 3 || y) {
            out = d + '.' + m + '.' + y;
        }
        if (el.value === out) {
            return;
        }
        el.value = out;
        try {
            const pos = Math.max(0, Math.min(out.length, caret == null ? out.length : caret));
            el.setSelectionRange(pos, pos);
        } catch (_e) {}
    }

    /** Карточка: дата поверки → след. поверка (дата + МПИ − 1 день). Не затирает набор. */
    function wireVerifyDatePair(opts) {
        const lastEl = $(opts.lastId);
        const nextEl = $(opts.nextId);
        if (!lastEl && !nextEl) {
            return;
        }
        function years() {
            return typeof opts.years === 'function' ? opts.years() : Number(opts.years) || 5;
        }
        function commitLast() {
            maskDateField(lastEl, 'current');
            const last = cardDateToTDate(opts.lastId);
            const p = parseTDate(last);
            if (!last || !p || p.year !== currentCalendarYear()) {
                return;
            }
            const nxt = addYearsMinusOneDayTDate(last, years());
            if (nxt && nextEl) {
                setCardDate(opts.nextId, nxt);
            }
            markVerifyDatesManual(opts.kind);
            if (typeof opts.applyToSteps === 'function') {
                opts.applyToSteps();
            }
            if (typeof opts.onStatus === 'function') {
                opts.onStatus();
            }
        }
        function commitNext() {
            maskDateField(nextEl, 'next');
            if (!cardDateToTDate(opts.nextId)) {
                return;
            }
            markVerifyDatesManual(opts.kind);
            if (typeof opts.applyToSteps === 'function') {
                opts.applyToSteps();
            }
            if (typeof opts.onStatus === 'function') {
                opts.onStatus();
            }
        }
        lastEl?.addEventListener('input', commitLast);
        lastEl?.addEventListener('change', commitLast);
        lastEl?.addEventListener('blur', commitLast);
        nextEl?.addEventListener('input', commitNext);
        nextEl?.addEventListener('change', commitNext);
        nextEl?.addEventListener('blur', commitNext);
    }

    function markVerifyDatesManual(kind) {
        window.__wbVerifyDatesManual = window.__wbVerifyDatesManual || {};
        if (kind) {
            window.__wbVerifyDatesManual[kind] = true;
        }
    }

    function clearVerifyDatesManual(kind) {
        window.__wbVerifyDatesManual = window.__wbVerifyDatesManual || {};
        if (kind) {
            window.__wbVerifyDatesManual[kind] = false;
        }
    }

    function verifyDatesAreManual(kind) {
        return !!(window.__wbVerifyDatesManual && window.__wbVerifyDatesManual[kind]);
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

    function collectOrderTextFromCache() {
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
        if (ToParam && typeof ToParam.collectOrderTextBlob === 'function') {
            return ToParam.collectOrderTextBlob(row, '');
        }
        const nom = (($('paramOrder1cNom') || {}).textContent || '');
        const ch = (($('paramOrder1cChar') || {}).textContent || '');
        return nom + ' ' + ch;
    }

    function getEquipmentFromOrder() {
        const C = window.TM07_CORRECTOR_EXECUTION;
        const text = collectOrderTextFromCache() || collectOrderTextBlob();
        return C && C.detectEquipment ? C.detectEquipment(text) : { hasPpd: false, hasPttp: false };
    }

    /** Заказ на комплекс ПК-ТМ (иначе — только корректор ТМ-07). Не смотрим п.200: шаблон может его заполнить. */
    function isComplexOrder() {
        const C = window.TM07_CORRECTOR_EXECUTION;
        const text = collectOrderTextFromCache();
        if (C && typeof C.isComplexCorrectorUsage === 'function' && C.isComplexCorrectorUsage(text)) {
            return true;
        }
        return /ПК-ТМ-/i.test(text || '');
    }

    /** Режим записи для заказа только на корректор: meter | with-complex */
    const CORRECTOR_PARAM_MODE_KEY = 'tm07_corrector_param_mode';

    function getCorrectorParamMode() {
        if (isComplexOrder()) {
            return 'complex-order';
        }
        try {
            const v = sessionStorage.getItem(CORRECTOR_PARAM_MODE_KEY);
            if (v === 'with-complex' || v === 'meter') {
                return v;
            }
        } catch (_e) {
            /* ignore */
        }
        return window.__wbCorrectorParamMode === 'with-complex' ? 'with-complex' : 'meter';
    }

    function setCorrectorParamMode(mode) {
        const next = mode === 'with-complex' ? 'with-complex' : 'meter';
        window.__wbCorrectorParamMode = next;
        try {
            sessionStorage.setItem(CORRECTOR_PARAM_MODE_KEY, next);
        } catch (_e) {
            /* ignore */
        }
        updateOrderScopeUi();
        const sel = $('paramCorrectorMeterTemplate');
        if (sel && sel.value) {
            applyCorrectorMeterTemplate(sel.value);
        }
    }

    /** Писать секцию комплекса: заказ ПК-ТМ или режим «+ регистры комплекса». */
    function shouldWriteComplexParams() {
        if (isComplexOrder()) {
            return true;
        }
        return getCorrectorParamMode() === 'with-complex';
    }

    /** Для одиночного корректора в режиме комплекса название (п.200) не пишем. */
    function shouldSkipComplexName() {
        return !isComplexOrder() && getCorrectorParamMode() === 'with-complex';
    }

    function paintCorrectorParamModeBar() {
        const bar = $('wbCorrectorParamModeBar');
        const hint = $('wbParamModeHint');
        const btnMeter = $('wbParamModeMeter');
        const btnComplex = $('wbParamModeComplex');
        const show = !isComplexOrder() && hasLoadedOrderFrom1c();
        if (bar) {
            bar.classList.toggle('d-none', !show);
        }
        if (!show) {
            return;
        }
        const mode = getCorrectorParamMode();
        if (btnMeter) {
            btnMeter.classList.toggle('active', mode === 'meter');
        }
        if (btnComplex) {
            btnComplex.classList.toggle('active', mode === 'with-complex');
        }
        if (hint) {
            hint.textContent =
                mode === 'with-complex'
                    ? 'Пишем корректор, счётчик и регистры комплекса. Наименование комплекса (п.200) не заполняем и не записываем.'
                    : 'Пишем параметры корректора и счётчика (шаблон типоразмера). Комплекс не трогаем.';
        }
    }

    function applyComplexNameSkipUi() {
        const skip = shouldSkipComplexName();
        const inp = $('val_200');
        const tr =
            (inp && inp.closest && inp.closest('tr[data-step-id]')) ||
            document.querySelector('#paramComplexTbody tr[data-step-id="200"]');
        if (tr) {
            tr.classList.toggle('wb-skip-complex-name', skip);
        }
        if (inp) {
            if (skip) {
                inp.value = '';
                inp.disabled = true;
                inp.title = 'Для заказа только на корректор наименование комплекса не пишется';
            } else if (inp.dataset && inp.dataset.wbForcedDisable === '1') {
                /* keep */
            } else {
                inp.disabled = false;
                inp.removeAttribute('title');
            }
        }
    }

    /** п.227: без .БТ в заказе поле очищаем и не пишем. */
    function applyTelemetryNameSkipUi() {
        const skip = shouldSkipTelemetryName();
        const inp = $('val_227');
        const tr =
            (inp && inp.closest && inp.closest('tr[data-step-id]')) ||
            document.querySelector('#paramComplexTbody tr[data-step-id="227"]');
        if (tr) {
            tr.classList.toggle('wb-skip-telemetry-name', skip);
        }
        if (skip) {
            setStepValue('227', '');
            if (inp) {
                inp.value = '';
                inp.disabled = true;
                inp.title = 'Без .БТ в заказе наименование блока телеметрии (п.227) не пишется';
            }
            return;
        }
        if (inp) {
            inp.disabled = false;
            inp.removeAttribute('title');
        }
        setStepValue('227', resolveTelemetryBlockName());
    }

    /** Зеркала счётчик → комплекс (без п.200 / S/N / дат поверки). */
    function fillComplexMirrorsFromMeter() {
        const map = [
            [105, 204],
            [108, 205],
            [109, 206],
            [110, 207],
            [111, 208],
            [112, 209],
            [113, 210],
            [6, 211],
            [7, 212],
            [8, 213],
            [9, 214],
            [10, 215],
            [11, 216],
            [12, 217],
            [13, 218],
            [119, 219],
            [120, 220],
            [14, 221],
            [15, 222],
            [18, 223],
            [19, 224],
            [122, 229],
        ];
        map.forEach(function (pair) {
            const src = readStepVal(pair[0]);
            if (src === '' || src == null) {
                return;
            }
            setStepValue(pair[1], String(src));
        });
        // Заказ только на корректор: S/N и даты комплекса как у счётчика-шаблона (0 / 01.01.2000).
        applyCorrectorOnlyComplexIdentity();
    }

    /** п.201=0, п.202/203=01.01.2000 для заказа без комплекса (как п.102–104). */
    function applyCorrectorOnlyComplexIdentity() {
        if (isComplexOrder()) {
            return;
        }
        setStepValue('201', '0');
        setStepValue('202', '01.01.2000');
        setStepValue('203', '01.01.2000');
        const ui = $('paramComplexSerial');
        if (ui) {
            ui.value = '0';
        }
        setCardDate('paramComplexVerifyDate', '01.01.2000');
        setCardDate('paramComplexVerifyNext', '01.01.2000');
        paintComplexBadge();
    }

    function hasLoadedOrderFrom1c() {
        const num = String(($('paramOrder1cNumber') || {}).value || '').trim();
        if (num) {
            return true;
        }
        try {
            const ToParam = window.TM07Order1cToParam;
            const key =
                ToParam && ToParam.STORAGE_KEY ? ToParam.STORAGE_KEY : 'order1c_param_lastOrder';
            const raw = sessionStorage.getItem(key) || localStorage.getItem(key);
            return !!(raw && JSON.parse(raw).row);
        } catch (_e) {
            return false;
        }
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

    function getStandaloneTemplates() {
        const data = window.TM07_COMPLEX_METER_TYPES;
        return data && data.listStandaloneTemplates ? data.listStandaloneTemplates() : [];
    }

    function fillCorrectorFamilySelect() {
        const famSel = $('paramCorrectorMeterFamily');
        if (!famSel) return;
        const prev = famSel.value;
        const templates = getStandaloneTemplates();
        famSel.innerHTML = '';
        const empty = document.createElement('option');
        empty.value = '';
        empty.textContent = '— Выберите счётчики —';
        famSel.appendChild(empty);
        templates.forEach(function (fam) {
            if (!(fam.options || []).length) return;
            const opt = document.createElement('option');
            opt.value = fam.passport;
            opt.textContent = fam.group || fam.designation || fam.passport;
            famSel.appendChild(opt);
        });
        if (prev) {
            famSel.value = prev;
        }
        fillCorrectorTypeSelect(famSel.value);
    }

    function fillCorrectorTypeSelect(passport) {
        const sel = $('paramCorrectorMeterTemplate');
        if (!sel) return;
        const prev = sel.value;
        sel.innerHTML = '';
        const empty = document.createElement('option');
        empty.value = '';
        if (!passport) {
            empty.textContent = '— Сначала счётчики —';
            sel.appendChild(empty);
            sel.disabled = true;
            return;
        }
        empty.textContent = '— Выберите типоразмер —';
        sel.appendChild(empty);
        const fam = getStandaloneTemplates().find(function (f) {
            return f.passport === passport;
        });
        (fam && fam.options ? fam.options : []).forEach(function (t) {
            const opt = document.createElement('option');
            opt.value = t.value || passport + '|' + t.typeId;
            opt.textContent = t.text || t.label || t.typeId;
            sel.appendChild(opt);
        });
        sel.disabled = false;
        let keepPrev = false;
        if (prev) {
            for (let i = 0; i < sel.options.length; i += 1) {
                if (sel.options[i].value === prev) {
                    keepPrev = true;
                    break;
                }
            }
        }
        sel.value = keepPrev ? prev : '';
    }

    function fillCorrectorTemplateSelect() {
        fillCorrectorFamilySelect();
    }

    function applyCorrectorMeterTemplate(compositeId) {
        const data = window.TM07_COMPLEX_METER_TYPES;
        const limits = window.TM07_VOLUME_ERROR_LIMITS;
        const hint = $('paramCorrectorTemplateHint');
        if (!compositeId) {
            if (hint) hint.textContent = '';
            return;
        }
        const parts = String(compositeId).split('|');
        const passport = (parts[0] || '').trim();
        const typeId = (parts[1] || '').trim();
        const rec = data && data.findTypeById ? data.findTypeById(passport, typeId) : null;
        if (!rec) {
            if (hint) hint.textContent = 'Типоразмер не найден.';
            return;
        }
        const steps =
            data && typeof data.meterStepValues === 'function'
                ? data.meterStepValues(passport, rec)
                : rec.meterStepValues || {};
        Object.keys(steps).forEach(function (k) {
            setStepValue(k, String(steps[k] == null ? '' : steps[k]));
        });
        setStepValue('102', '0');
        setStepValue('103', '01.01.2000');
        setStepValue('104', '01.01.2000');
        setStepValue('122', '0');
        // Заказ на корректор: S/N комплекса тоже 0 (не выдаём 400… из реестра).
        applyCorrectorOnlyComplexIdentity();
        const qmin = rec.qmin != null ? rec.qmin : rec.qmin_m3h;
        const qmax = rec.qmax != null ? rec.qmax : rec.qmax_m3h;
        if (qmin != null && qmin !== '') {
            setStepValue('28', String(qmin));
            setStepValue('30', String(qmin));
            setStepValue('32', String(qmin));
        }
        if (qmax != null && qmax !== '') {
            setStepValue('29', String(qmax));
            setStepValue('31', String(qmax));
            setStepValue('33', String(qmax));
        }
        let designation = '';
        const fams = data && data.listStandaloneTemplates ? data.listStandaloneTemplates() : [];
        for (let i = 0; i < fams.length; i += 1) {
            if (fams[i].passport === passport && fams[i].designation) {
                designation = fams[i].designation;
                break;
            }
        }
        if (limits && designation && typeof limits.resolveVolumeErrors === 'function') {
            const orderText = collectOrderTextFromCache() || '';
            const modification =
                typeof limits.extractModification === 'function'
                    ? limits.extractModification(orderText + ' ' + designation + ' ' + (rec.code || ''))
                    : null;
            const resolved = limits.resolveVolumeErrors({
                complexDesignation: designation,
                modification: modification,
                typeCode: rec.code || rec.id || typeId,
                qmax: qmax,
                fullText: orderText + ' ' + designation + ' ' + (rec.code || rec.id || ''),
            });
            if (resolved && resolved.steps) {
                // табл.15 → п.119/120/219/220; п.225/226 = 119/120 + 0.1.
                [119, 120].forEach(function (sid) {
                    if (resolved.steps[sid] != null) {
                        setStepValue(String(sid), String(resolved.steps[sid]));
                    }
                });
                if (shouldWriteComplexParams()) {
                    [219, 220, 225, 226].forEach(function (sid) {
                        if (resolved.steps[sid] != null) {
                            setStepValue(String(sid), String(resolved.steps[sid]));
                        }
                    });
                }
            }
        }
        // Паспорт счётчика может переопределить только п.119/120 (исп. R: 2/1).
        // После этого п.225/226 = 119+0.1 / 120+0.1.
        const volOv =
            data && typeof data.volumeErrorOverrideForPassport === 'function'
                ? data.volumeErrorOverrideForPassport(passport)
                : null;
        if (volOv && volOv.meter) {
            setStepValue('119', String(volOv.meter.qminQt));
            setStepValue('120', String(volOv.meter.qtQmax));
            if (
                shouldWriteComplexParams() &&
                limits &&
                typeof limits.standardStepsFromWorking === 'function'
            ) {
                const std = limits.standardStepsFromWorking(
                    volOv.meter.qminQt,
                    volOv.meter.qtQmax
                );
                if (std) {
                    setStepValue('225', std[225]);
                    setStepValue('226', std[226]);
                }
            }
        }
        // п.27 Q0 = порог чувствительности (п.108 Qstart).
        const v108 = readStepVal(108);
        if (v108) {
            setStepValue('27', String(v108));
        }
        // п.227 — только при .БТ в заказе; иначе не пишем.
        applyTelemetryNameSkipUi();
        // п.54 = номинал G (п.110), не оставлять «0» после автозаполнения без типоразмера.
        const v110 = readStepVal(110);
        if (v110) {
            setStepValue('54', String(v110));
        } else if (data && typeof data.nominalQFromG === 'function') {
            const nq = data.nominalQFromG(rec);
            if (nq != null) {
                setStepValue('54', String(nq));
            }
        }
        // п.73/76 T5/P5: (м³/имп) / Qstart → сек.
        const C = window.TM07_CORRECTOR_EXECUTION;
        if (C && typeof C.resolveCorrectorExecution === 'function') {
            const impPerM3 = parseFloat(String(readStepVal(106) || '').replace(',', '.'));
            const sens = parseFloat(String(readStepVal(108) || '').replace(',', '.'));
            const m3PerImp = Number.isFinite(impPerM3) && impPerM3 > 0 ? 1 / impPerM3 : null;
            const exec = C.resolveCorrectorExecution({
                complexDesignation: isComplexOrder() ? designation : '',
                fullText: collectOrderTextFromCache() || '',
                m3PerImpulse: m3PerImp,
                sensitivityM3h: Number.isFinite(sens) ? sens : null,
                equipment: getEquipmentFromOrder(),
            });
            if (exec && exec.steps) {
                if (exec.steps[73] != null) {
                    setStepValue('73', String(exec.steps[73]));
                }
                if (exec.steps[76] != null) {
                    setStepValue('76', String(exec.steps[76]));
                }
            }
        }
        if (hint) {
            if (shouldWriteComplexParams() && !isComplexOrder()) {
                fillComplexMirrorsFromMeter();
                setStepValue('200', '');
                // После зеркал 119→219: вернуть 219/220 из табл.15; 225/226 = итоговые 119/120 + 0.1.
                if (limits && designation && typeof limits.resolveVolumeErrors === 'function') {
                    const orderText2 = collectOrderTextFromCache() || '';
                    const resolved2 = limits.resolveVolumeErrors({
                        complexDesignation: designation,
                        typeCode: rec.code || rec.id || typeId,
                        qmax: qmax,
                        fullText: orderText2 + ' ' + designation + ' ' + (rec.code || ''),
                    });
                    if (resolved2 && resolved2.steps) {
                        [219, 220].forEach(function (sid) {
                            if (resolved2.steps[sid] != null) {
                                setStepValue(String(sid), String(resolved2.steps[sid]));
                            }
                        });
                    }
                }
                if (limits && typeof limits.standardStepsFromWorking === 'function') {
                    const std2 = limits.standardStepsFromWorking(readStepVal(119), readStepVal(120));
                    if (std2) {
                        setStepValue('225', std2[225]);
                        setStepValue('226', std2[226]);
                    }
                }
                hint.textContent = volOv && volOv.meter
                    ? 'Счётчик п.119/120 = ' +
                      volOv.meter.qminQt +
                      '/' +
                      volOv.meter.qtQmax +
                      ' (паспорт); п.225/226 = 119/120+0.1; п.219/220 табл.15. п.227 — только при .БТ.'
                    : 'Заполнены счётчик и зеркала комплекса (без п.200). Погрешности: табл.15 → 119/120/219/220, п.225/226 = 119/120+0.1. п.227 — только при .БТ.';
            } else {
                hint.textContent =
                    'Заполнены параметры счётчика п.100–122, серийник=0, п.27=Qstart, расход п.28–33 и погрешности п.119/120. Параметры комплекса не трогаем.';
            }
        }
        applyComplexNameSkipUi();
        applyTelemetryNameSkipUi();
        if (typeof updateParamPercent === 'function') updateParamPercent();
    }

    function initCorrectorTemplatePanel() {
        const famSel = $('paramCorrectorMeterFamily');
        const sel = $('paramCorrectorMeterTemplate');
        if (!sel || sel.dataset.wired === '1') return;
        sel.dataset.wired = '1';
        if (famSel) {
            famSel.addEventListener('change', function () {
                fillCorrectorTypeSelect(famSel.value);
                applyCorrectorMeterTemplate('');
                const hint = $('paramCorrectorTemplateHint');
                if (hint && famSel.value) {
                    hint.textContent = 'Выберите типоразмер.';
                }
            });
        }
        sel.addEventListener('change', function () {
            applyCorrectorMeterTemplate(sel.value);
        });
        const btnMeter = $('wbParamModeMeter');
        const btnComplex = $('wbParamModeComplex');
        if (btnMeter && btnMeter.dataset.wired !== '1') {
            btnMeter.dataset.wired = '1';
            btnMeter.addEventListener('click', function () {
                setCorrectorParamMode('meter');
            });
        }
        if (btnComplex && btnComplex.dataset.wired !== '1') {
            btnComplex.dataset.wired = '1';
            btnComplex.addEventListener('click', function () {
                setCorrectorParamMode('with-complex');
            });
        }
    }

    /** Скрыть/показать блоки счётчика и комплекса + строки перепада/TT в таблице. */
    function updateOrderScopeUi() {
        const complexOrder = isComplexOrder();
        const writeComplex = shouldWriteComplexParams();
        const equip = getEquipmentFromOrder();
        const meterPanel = $('wbMeterParamsItem');
        const complexPanel = $('wbComplexParamsItem');
        const meterSerialCard = $('wbMeterCard') || ($('paramMeterSerial') && $('paramMeterSerial').closest('.card'));
        const complexCard = $('wbComplexCard');
        // Параметры счётчика (п.100–122) нужны и для заказа только на корректор (шаблон типоразмера).
        if (meterPanel) {
            meterPanel.classList.remove('d-none');
        }
        // S/N счётчика/комплекса — только для заказа на комплекс.
        if (meterSerialCard) {
            meterSerialCard.classList.toggle('d-none', !complexOrder);
        }
        if (complexPanel) {
            complexPanel.classList.toggle('d-none', !writeComplex);
        }
        if (complexCard) {
            // Карточка S/N комплекса — только реальный заказ на комплекс.
            complexCard.classList.toggle('d-none', !complexOrder);
            if (complexOrder && typeof syncComplexVerifFieldsFromSteps === 'function') {
                syncComplexVerifFieldsFromSteps();
            }
        }
        const tplCard = $('wbCorrectorTemplateCard');
        if (tplCard) {
            const showTpl = !complexOrder && hasLoadedOrderFrom1c();
            tplCard.classList.toggle('d-none', !showTpl);
            if (showTpl) {
                fillCorrectorTemplateSelect();
            }
        }
        paintCorrectorParamModeBar();
        applyComplexNameSkipUi();
        applyTelemetryNameSkipUi();
        if (typeof syncCorrectorVerifFieldsFromSteps === 'function') {
            syncCorrectorVerifFieldsFromSteps();
        }
        // Перепад / TT: скрыть строки, если датчика нет в заказе.
        document
            .querySelectorAll(
                '#paramTbody tr[data-step-id], #paramMeterTbody tr[data-step-id], #paramComplexTbody tr[data-step-id]'
            )
            .forEach(function (tr) {
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
        const qrHintEl = $('wbSensorCardsHint');
        if (qrHintEl) {
            const need = requiredSensorsHint();
            let tip = 'По заказу: ' + need + '. ';
            tip += 'DA/DD — полный QR MIDA; DT/TT — 4 цифры. Чужой тип или другой диапазон из QR будет отклонён.';
            qrHintEl.textContent = tip;
        }
        renderSensorScanCards();
    }

    function escHtmlLite(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    /** Отдельные плашки ввода по датчикам, которые есть в заказе. */
    function renderSensorScanCards() {
        const host = $('wbSensorCardsHost');
        if (!host) {
            return;
        }
        const required = getRequiredSensorKeys();
        const sig = required.join(',');
        const saved = {};
        host.querySelectorAll('.wb-sensor-qr-input').forEach(function (inp) {
            const k = inp.getAttribute('data-sensor-key');
            if (k) {
                saved[k] = inp.value;
            }
        });
        if (host.dataset.sensorSig === sig && host.querySelector('[data-wb-sensor-card]')) {
            required.forEach(function (key) {
                paintOneSensorCardBadge(key);
            });
            return;
        }
        host.dataset.sensorSig = sig;
        if (!required.length) {
            host.innerHTML =
                '<div class="col-12"><p class="text-body-secondary mb-0">Загрузите заказ — появятся плашки нужных датчиков.</p></div>';
            return;
        }
        host.innerHTML = required
            .map(function (key) {
                const meta = SENSOR_CARD_META[key] || {
                    title: SENSOR_LABELS[key] || key,
                    hint: '',
                    placeholder: '',
                    inputmode: 'text',
                    border: 'border-secondary',
                    headerBg: '',
                };
                const id = 'paramQrSensor_' + key;
                const stId = 'paramQrStatus_' + key;
                const badgeId = 'wbSensorCardBadge_' + key;
                return (
                    '<div class="col-md-6" data-wb-sensor-card="' +
                    key +
                    '">' +
                    '<div class="card h-100 ' +
                    meta.border +
                    '">' +
                    '<div class="card-header py-2 d-flex align-items-center gap-2 ' +
                    (meta.headerBg || '') +
                    '">' +
                    '<span class="fw-semibold">' +
                    escHtmlLite(meta.title) +
                    '</span>' +
                    '<span class="badge rounded-pill text-bg-warning text-dark ms-auto" id="' +
                    badgeId +
                    '">○</span>' +
                    '</div>' +
                    '<div class="card-body">' +
                    '<label class="form-label fw-semibold" for="' +
                    id +
                    '">' +
                    (key === 'DT' || key === 'TT' ? 'S/N (4 цифры)' : 'QR MIDA') +
                    '</label>' +
                    '<input type="text" class="form-control form-control-lg font-monospace wb-sensor-qr-input" id="' +
                    id +
                    '" data-sensor-key="' +
                    key +
                    '" placeholder="' +
                    escHtmlLite(meta.placeholder) +
                    '" autocomplete="off" spellcheck="false" inputmode="' +
                    escHtmlLite(meta.inputmode) +
                    '">' +
                    '<p class="small text-body-secondary mt-1 mb-0">' +
                    escHtmlLite(meta.hint) +
                    '</p>' +
                    '<p class="small text-body-secondary mt-2 mb-0" id="' +
                    stId +
                    '" role="status"></p>' +
                    '</div></div></div>'
                );
            })
            .join('');
        required.forEach(function (key) {
            const inp = $('paramQrSensor_' + key);
            if (inp && saved[key]) {
                inp.value = saved[key];
            }
            paintOneSensorCardBadge(key);
        });
    }

    function paintOneSensorCardBadge(key) {
        const badge = $('wbSensorCardBadge_' + key);
        if (!badge) {
            return;
        }
        const done = isSensorFilled(key);
        const sn =
            (window.__wbScannedSensors && window.__wbScannedSensors[key]) ||
            readStepVal(sensorStepIds(key)[0] || 0) ||
            '';
        badge.textContent = done ? '✓ ' + (sn && sn !== '1' ? sn : 'ок') : '○ нужен';
        badge.className =
            'badge rounded-pill ms-auto ' + (done ? 'text-bg-success' : 'text-bg-warning text-dark');
        const card = document.querySelector('[data-wb-sensor-card="' + key + '"] .card');
        if (card) {
            card.classList.toggle('border-success', done);
            card.classList.toggle('border-opacity-50', done);
        }
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
        const hint = $('paramMeterVerifyHint');
        if (hint) {
            const years = meterVerifyYearsForCurrent();
            const pass = meterPassportFromSteps();
            hint.textContent =
                'МПИ счётчика: ' +
                years +
                ' лет' +
                (pass ? ' (' + pass + ')' : '') +
                '. След. поверка = дата + МПИ − 1 день.';
        }
    }

    function getComplexSerial() {
        const ui = $('paramComplexSerial');
        const fromUi = ui ? String(ui.value || '').trim() : '';
        if (fromUi) {
            return fromUi;
        }
        return readStepVal(201);
    }

    function paintComplexBadge() {
        const badge = $('wbComplexBadge');
        if (!badge) {
            return;
        }
        const sn = getComplexSerial();
        const ok = !!sn;
        badge.textContent = ok ? '✓ ' + sn : 'не введён';
        badge.className =
            'badge rounded-pill ms-auto ' + (ok ? 'text-bg-success' : 'text-bg-warning text-dark');
    }

    function paintCorrectorVerifBadge() {
        const badge = $('wbCorrectorVerifBadge');
        if (!badge) {
            return;
        }
        const sn = correctorSerialFromSteps();
        const ok = !!sn && /^300\d{7}$/.test(sn);
        badge.textContent = ok ? '✓ ' + sn : sn ? sn : 'не введён';
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
    function applyMeterSerial(raw, opts) {
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
        if (!opts || opts.log !== false) {
            const le = $('paramLog');
            if (le) {
                const t = new Date().toLocaleTimeString();
                le.innerHTML += '[' + t + '] [METER] S/N счётчика ' + sn + ' → п.102<br>';
                le.scrollTop = le.scrollHeight;
            }
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
            setCardDate('paramMeterVerifyDate', '');
        }
        if (d104) {
            setCardDate('paramMeterVerifyNext', '');
        }
        setMeterSerialStatus('', false);
        paintMeterBadge();
    }

    function focusMeterInput() {
        const inp = $('paramMeterSerial');
        if (inp) {
            try {
                inp.focus({ preventScroll: true });
            } catch (_e) {
                inp.focus();
            }
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
        function runApply(selectAfter, quiet) {
            const r = applyMeterSerial(inp.value, quiet ? { log: false } : {});
            if (!r.ok) {
                setMeterSerialStatus(r.error || 'Ошибка', true);
                return;
            }
            if (selectAfter) {
                inp.select();
            }
        }
        inp.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                runApply(true, false);
            }
        });
        inp.addEventListener('input', function () {
            if (normalizeMeterSerial(inp.value).length >= METER_SERIAL_MIN) {
                runApply(false, true);
            }
        });
        inp.addEventListener('change', function () {
            if (normalizeMeterSerial(inp.value).length >= METER_SERIAL_MIN) {
                runApply(false, false);
            }
        });

        wireVerifyDatePair({
            lastId: 'paramMeterVerifyDate',
            nextId: 'paramMeterVerifyNext',
            kind: 'meter',
            years: function () {
                return meterVerifyYearsForCurrent();
            },
            applyToSteps: applyMeterDateFieldsToSteps,
            onStatus: function () {
                const a = cardDateToTDate('paramMeterVerifyDate');
                const b = cardDateToTDate('paramMeterVerifyNext');
                if (a && b) {
                    setMeterSerialStatus('✓ п.103/104 ← ' + a + ' / ' + b, false);
                }
            },
        });

        $('paramMeterDatesToday')?.addEventListener('click', function () {
            if (!isMeterSerialFilled()) {
                const r = applyMeterSerial(inp.value);
                if (!r.ok) {
                    setMeterSerialStatus(r.error || 'Сначала введите S/N счётчика', true);
                    return;
                }
            }
            applyMeterVerificationDates(true);
            const years = meterVerifyYearsForCurrent();
            const pass = meterPassportFromSteps();
            setMeterSerialStatus(
                '✓ п.103/104 подставлены, МПИ ' + years + ' лет' + (pass ? ' (' + pass + ')' : ''),
                false
            );
        });
    }

    function setComplexSerialStatus(text, isError) {
        const st = $('paramComplexStatus');
        if (!st) {
            return;
        }
        st.textContent = text || '';
        st.className = 'small mt-2 mb-0' + (isError ? ' text-danger' : text ? ' text-success' : ' text-body-secondary');
    }

    function initComplexSerialPanel() {
        const inp = $('paramComplexSerial');
        if (!inp) {
            return;
        }
        function runApply() {
            const r = applyComplexSerial(inp.value);
            if (!r.ok) {
                setComplexSerialStatus(r.error || 'Ошибка', true);
                return;
            }
            paintComplexBadge();
        }
        inp.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                runApply();
            }
        });
        inp.addEventListener('change', runApply);
        inp.addEventListener('input', function () {
            if (String(inp.value || '').trim().length >= 4) {
                runApply();
            }
        });

        wireVerifyDatePair({
            lastId: 'paramComplexVerifyDate',
            nextId: 'paramComplexVerifyNext',
            kind: 'complex',
            years: function () {
                return complexVerifyYearsEffective();
            },
            applyToSteps: applyComplexVerifFieldsToSteps,
            onStatus: function () {
                const a = cardDateToTDate('paramComplexVerifyDate');
                const b = cardDateToTDate('paramComplexVerifyNext');
                if (a && b) {
                    setComplexSerialStatus('✓ п.202/203 ← ' + a + ' / ' + b, false);
                }
            },
        });

        wireVerifyDatePair({
            lastId: 'paramCorrectorVerifyDate',
            nextId: 'paramCorrectorVerifyNext',
            kind: 'corrector',
            years: function () {
                return CORRECTOR_VERIFY_YEARS;
            },
            applyToSteps: applyCorrectorVerifFieldsToSteps,
            onStatus: function () {
                const st = $('paramCorrectorStatus');
                const a = cardDateToTDate('paramCorrectorVerifyDate');
                const b = cardDateToTDate('paramCorrectorVerifyNext');
                if (st && a && b) {
                    st.textContent = '✓ п.80/81 ← ' + a + ' / ' + b;
                    st.className = 'small mt-2 mb-0 text-success';
                }
            },
        });

        $('paramComplexSerialGenerate')?.addEventListener('click', async function () {
            if (!isComplexOrder()) {
                applyCorrectorOnlyComplexIdentity();
                setComplexSerialStatus('Заказ на корректор: п.201 = 0 (номер комплекса не выдаётся)', false);
                return;
            }
            const ui = window.TM07_SERIAL_REGISTRY_UI;
            if (!ui || typeof ui.ensureSerialNumbersAuto !== 'function') {
                setComplexSerialStatus('Реестр серийных номеров недоступен', true);
                return;
            }
            try {
                const sn = await ui.ensureSerialNumbersAuto({ force: true, includeComplex: true });
                if (sn && sn.complex) {
                    applyComplexSerial(sn.complex);
                    setComplexSerialStatus('✓ п.201 ← ' + sn.complex, false);
                } else {
                    const cur = getComplexSerial();
                    if (cur) {
                        applyComplexSerial(cur);
                        setComplexSerialStatus('✓ п.201 ← ' + cur, false);
                    } else {
                        setComplexSerialStatus('Не удалось выдать S/N комплекса из БД', true);
                    }
                }
            } catch (e) {
                setComplexSerialStatus(e.message || String(e), true);
            }
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
        void persistSensorBindingsToServer({ channel: key, sensorSerial: String(serial || '').trim() });
        return true;
    }

    function resolveCorrectorSerialForBind() {
        const sess =
            window.TM07_BENCH_EVENTS && typeof window.TM07_BENCH_EVENTS.getActiveSession === 'function'
                ? window.TM07_BENCH_EVENTS.getActiveSession()
                : null;
        const fromSession = sess && (sess.serialCorrector || sess.SERIAL_CORRECTOR);
        if (fromSession) {
            return String(fromSession).trim();
        }
        if (window.__wbAssemblyCorrectorSerial) {
            return String(window.__wbAssemblyCorrectorSerial).trim();
        }
        const el = document.getElementById('val_3');
        if (el && String(el.value || '').trim()) {
            return String(el.value).trim();
        }
        return '';
    }

    /**
     * Сохранить привязку датчик → корректор в PG.
     * Без S/N корректора (до сборки) — тихо пропускаем; повтор после сборки подхватит.
     */
    async function persistSensorBindingsToServer(opts) {
        const o = opts || {};
        const serialCorrector = resolveCorrectorSerialForBind();
        if (!/^\d{10}$/.test(serialCorrector)) {
            return { skipped: true, reason: 'no-corrector-serial' };
        }
        const scanned = window.__wbScannedSensors || {};
        const sensors = {};
        Object.keys(scanned).forEach(function (ch) {
            const sn = scanned[ch];
            if (sn) {
                sensors[ch] = String(sn).trim();
            }
        });
        if (o.channel && o.sensorSerial) {
            sensors[o.channel] = String(o.sensorSerial).trim();
        }
        if (!Object.keys(sensors).length) {
            return { skipped: true, reason: 'no-sensors' };
        }
        const events = window.TM07_BENCH_EVENTS;
        const orderNumber =
            (events && typeof events.getOrderNumber === 'function' && events.getOrderNumber()) ||
            (events && events.getActiveSession && events.getActiveSession() && events.getActiveSession().orderNumber) ||
            null;
        const sessionId =
            (events && events.getActiveSession && events.getActiveSession() && events.getActiveSession().id) || null;
        try {
            const r = await fetch('/api/tm07-sensor-bind.php', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'bindBatch',
                    serialCorrector: serialCorrector,
                    sensors: sensors,
                    orderNumber: orderNumber,
                    sessionId: sessionId,
                }),
            });
            const j = await r.json();
            if (!j.ok && Array.isArray(j.errors) && j.errors.length) {
                const msg = j.errors
                    .map(function (e) {
                        return (e.channel || '') + ': ' + (e.error || '');
                    })
                    .join('; ');
                try {
                    if (typeof window.showToast === 'function') {
                        window.showToast(msg, 'danger');
                    } else if (window.console) {
                        console.warn('[sensor-bind]', msg);
                    }
                } catch (_e) {}
            }
            return j;
        } catch (e) {
            if (window.console) {
                console.warn('[sensor-bind]', e);
            }
            return { ok: false, error: e.message || String(e) };
        }
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
        const qrSt = $('paramQrStatus');
        if (qrSt) {
            qrSt.textContent = '';
        }
        document.querySelectorAll('.wb-sensor-qr-input').forEach(function (inp) {
            inp.value = '';
        });
        document.querySelectorAll('[id^="paramQrStatus_"]').forEach(function (el) {
            el.textContent = '';
            el.className = 'small text-body-secondary mt-2 mb-0';
        });
        try {
            if (window.TM07_MIDA_QR && typeof window.TM07_MIDA_QR.setTelemetryPanelVisible === 'function') {
                window.TM07_MIDA_QR.setTelemetryPanelVisible(false);
            }
        } catch (_eBtReset) {}
        renderSensorScanCards();
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
            paintOneSensorCardBadge(key);
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
        const post = window.__wbPostWrite || {};
        const doneAll = stage === 'completed' || (post.writeOk && post.verifyOk);

        steps.forEach(function (el) {
            el.classList.remove('is-current', 'is-done');
        });

        // 0 = заказ, 1 = датчики/сборка, 2 = параметризация
        let current = 0;
        if (hasOrder) {
            current = 1;
        }
        if (hasOrder && (serial || assemblyDone)) {
            current = 1;
        }
        if (assemblyDone) {
            current = 2;
        }
        if (assemblyDone && connected) {
            current = 2;
        }
        if (doneAll) {
            current = 3; // past last → all done
        }

        steps.forEach(function (el, i) {
            if (el.classList.contains('d-none')) {
                return;
            }
            const num = el.querySelector('.bench-op-step-num');
            if (doneAll || i < current) {
                el.classList.add('is-done');
                if (num) {
                    num.classList.remove('is-muted');
                    num.textContent = '✓';
                }
            } else if (i === current) {
                el.classList.add('is-current');
                if (num) {
                    num.classList.remove('is-muted');
                    num.textContent = String(i + 1);
                }
            } else if (num) {
                num.classList.add('is-muted');
                num.textContent = String(i + 1);
            }
        });
    }

    function applyMeterVerificationDates(force) {
        const out = [];
        if (!isMeterSerialFilled() && !force) {
            return 0;
        }
        if (!force && verifyDatesAreManual('meter')) {
            syncMeterDateFieldsFromSteps();
            return 0;
        }
        if (force) {
            clearVerifyDatesManual('meter');
        }
        const today = todayTDate();
        const meterYears = meterVerifyYearsForCurrent();
        const nextMeter = nextVerifyDateFromToday(meterYears);
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
        if (inp103) {
            setCardDate('paramMeterVerifyDate', d103);
        }
        if (inp104) {
            setCardDate('paramMeterVerifyNext', d104);
        }
    }

    function applyMeterDateFieldsToSteps() {
        const d103 = cardDateToTDate('paramMeterVerifyDate');
        const d104 = cardDateToTDate('paramMeterVerifyNext');
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

    /** S/N корректора п.3 из шага или карточки сборки. */
    function correctorSerialFromSteps() {
        const v = readStepVal(3);
        if (v) {
            return v;
        }
        const wb = window.TM07_WORKBENCH;
        if (wb && typeof wb.correctorSerialValue === 'function') {
            return String(wb.correctorSerialValue() || '').trim();
        }
        const d = $('paramCorrectorSerialDisplay');
        return d ? String(d.value || '').trim() : '';
    }

    function syncCorrectorVerifFieldsFromSteps() {
        const d = $('paramCorrectorSerialDisplay');
        const serial = correctorSerialFromSteps();
        if (d) {
            d.value = serial;
        }
        const v80 = readStepVal(80);
        const v81 = readStepVal(81);
        setCardDate('paramCorrectorVerifyDate', v80);
        setCardDate('paramCorrectorVerifyNext', v81);
        paintCorrectorVerifBadge();
    }

    function applyCorrectorVerifFieldsToSteps() {
        const d80 = cardDateToTDate('paramCorrectorVerifyDate');
        const d81 = cardDateToTDate('paramCorrectorVerifyNext');
        if (d80 && /^\d{2}\.\d{2}\.\d{4}$/.test(d80)) {
            setStepValue(80, d80, null, 'дата поверки корректора');
        }
        if (d81 && /^\d{2}\.\d{2}\.\d{4}$/.test(d81)) {
            setStepValue(81, d81, null, 'след. дата поверки корректора');
        }
    }

    function validateCorrectorForWrite() {
        const errors = [];
        const serial = correctorSerialFromSteps();
        if (!serial) {
            errors.push('Нет S/N корректора (п.3) — сначала подтвердите сборку.');
        }
        applyCorrectorVerifFieldsToSteps();
        const d80 = readStepVal(80);
        const d81 = readStepVal(81);
        if (!d80 || !/^\d{2}\.\d{2}\.\d{4}$/.test(d80)) {
            errors.push('Укажите дату поверки корректора (п.80, ДД.ММ.ГГГГ).');
        }
        if (!d81 || !/^\d{2}\.\d{2}\.\d{4}$/.test(d81)) {
            errors.push('Укажите дату следующей поверки корректора (п.81, ДД.ММ.ГГГГ).');
        }
        return { ok: errors.length === 0, errors: errors };
    }

    function applyCorrectorVerificationDates(force) {
        const out = [];
        if (!correctorSerialFromSteps() && !force) {
            return 0;
        }
        if (!force && verifyDatesAreManual('corrector')) {
            syncCorrectorVerifFieldsFromSteps();
            return 0;
        }
        if (force) {
            clearVerifyDatesManual('corrector');
        }
        const today = todayTDate();
        const next = nextVerifyDateFromToday(CORRECTOR_VERIFY_YEARS);
        const setFn = force ? setStepValue : setStepIfEmpty;
        setFn(80, today, out, 'дата поверки корректора (сегодня)');
        setFn(81, next, out, '+' + CORRECTOR_VERIFY_YEARS + ' лет − 1 день (МПИ корректора)');
        syncCorrectorVerifFieldsFromSteps();
        return out.length;
    }

    function applyComplexSerial(raw) {
        const sn = String(raw || '').trim();
        if (!sn) {
            return { ok: false, error: 'Введите серийный номер комплекса.' };
        }
        const ui = $('paramComplexSerial');
        if (ui) {
            ui.value = sn;
        }
        setStepValue(201, sn, null, 'S/N комплекса');
        paintMeterBadge();
        paintComplexBadge();
        paintWorkflowSteps();
        syncComplexVerifFieldsFromSteps();
        const st = $('paramComplexStatus');
        if (st) {
            st.textContent = '✓ п.201 ← ' + sn;
            st.className = 'small mt-2 mb-0 text-success';
        }
        return { ok: true };
    }

    function syncComplexVerifFieldsFromSteps() {
        const ui = $('paramComplexSerial');
        const v = readStepVal(201);
        if (ui && !String(ui.value || '').trim()) {
            ui.value = v || '';
        }
        const v202 = readStepVal(202);
        const v203 = readStepVal(203);
        setCardDate('paramComplexVerifyDate', v202);
        setCardDate('paramComplexVerifyNext', v203);
    }

    function applyComplexVerifFieldsToSteps() {
        const d202 = cardDateToTDate('paramComplexVerifyDate');
        const d203 = cardDateToTDate('paramComplexVerifyNext');
        if (d202 && /^\d{2}\.\d{2}\.\d{4}$/.test(d202)) {
            setStepValue(202, d202, null, 'дата поверки комплекса');
        }
        if (d203 && /^\d{2}\.\d{2}\.\d{4}$/.test(d203)) {
            setStepValue(203, d203, null, 'след. дата поверки комплекса');
        }
    }

    function validateComplexForWrite() {
        const errors = [];
        const ui = $('paramComplexSerial');
        if (!ui || !String(ui.value || '').trim()) {
            errors.push('Введите серийный номер комплекса (п.201).');
        }
        applyComplexVerifFieldsToSteps();
        const d202 = readStepVal(202);
        const d203 = readStepVal(203);
        if (!d202 || !/^\d{2}\.\d{2}\.\d{4}$/.test(d202)) {
            errors.push('Укажите дату поверки комплекса (п.202, ДД.ММ.ГГГГ).');
        }
        if (!d203 || !/^\d{2}\.\d{2}\.\d{4}$/.test(d203)) {
            errors.push('Укажите дату следующей поверки комплекса (п.203, ДД.ММ.ГГГГ).');
        }
        return { ok: errors.length === 0, errors: errors };
    }

    function applyComplexVerificationDates(force) {
        const out = [];
        const ui = $('paramComplexSerial');
        if ((!ui || !String(ui.value || '').trim()) && !force) {
            return 0;
        }
        if (!force && verifyDatesAreManual('complex')) {
            syncComplexVerifFieldsFromSteps();
            return 0;
        }
        if (force) {
            clearVerifyDatesManual('complex');
        }
        const today = todayTDate();
        const years = complexVerifyYearsEffective();
        const next = nextVerifyDateFromToday(years);
        const setFn = force ? setStepValue : setStepIfEmpty;
        setFn(202, today, out, 'дата поверки комплекса (сегодня)');
        setFn(203, next, out, '+' + years + ' лет − 1 день (МПИ комплекса = min)');
        syncComplexVerifFieldsFromSteps();
        return out.length;
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
        if (
            !mechMax &&
            window.TM07_COMPLEX_METER_TYPES &&
            typeof window.TM07_COMPLEX_METER_TYPES.counterMechMaxForType === 'function' &&
            code101
        ) {
            mechMax = window.TM07_COMPLEX_METER_TYPES.counterMechMaxForType(code101);
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
        // п.228 не заполняем (по паспорту «-»). п.227 — только при .БТ в заказе.
        applyTelemetryNameSkipUi();

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
            warnings.push('Заказ не загружен или параметры пусты — нажмите «Войти в заказ».');
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

        if (isComplexOrder() || shouldWriteComplexParams()) {
            // Счётчик часто монтируют позже — не блокируем параметризацию корректора.
            if (isComplexOrder() && !isMeterSerialFilled()) {
                warnings.push(
                    'S/N счётчика пока нет — параметризация корректора продолжится. Введите п.102–104 позже и нажмите «Записать счётчик».'
                );
            }

            const dir122 = readStepVal(122);
            const dir229 = readStepVal(229);
            if (shouldWriteComplexParams()) {
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

    /**
     * Собрать список всех незаполненных строк параметризации (основные + счётчик + комплекс,
     * без финалов). Учитывает скрытые заказом строки/секции (d-none), а также шаги,
     * которые пишутся командами/масками/только чтением — они НЕ считаются «пустыми».
     * Возвращает массив { id, title }.
     */
    function collectEmptyRequiredSteps() {
        const missing = [];
        const doc = window.TM07_PARAMETRIZATION_DOC;
        const extra = window.TM07_PARAMETRIZATION_EXTRA;
        const packs = [];
        if (doc && Array.isArray(doc.steps)) {
            packs.push({ title: 'основные', steps: doc.steps });
        }
        if (extra && Array.isArray(extra.sections)) {
            extra.sections.forEach(function (sec) {
                if (sec && Array.isArray(sec.steps)) {
                    packs.push({ title: sec.title || sec.key || '', steps: sec.steps });
                }
            });
        }
        packs.forEach(function (pack) {
            pack.steps.forEach(function (step) {
                if (!step || step.reg == null) return; // п.1 — только ПК
                if (step.type === 'x' || step.writeOnly || step.readOnly) return;
                if (step.sensorMemoryCmd || step.hidden) return;
                // п.228 — серийный номер БПЭК: по паспорту «-», пуст для заказов без телеметрии.
                if (Number(step.id) === 228) return;
                // п.200 — для одиночного корректора в режиме «+ комплекс» не пишется.
                if (Number(step.id) === 200 && shouldSkipComplexName()) return;
                // п.227 — без .БТ не пишется.
                if (Number(step.id) === 227 && shouldSkipTelemetryName()) return;
                const inp = document.getElementById('val_' + step.id);
                if (!inp || inp.disabled) return;
                // Скрытая заказом строка/секция (перепад/TT вне заказа, счётчик/комплекс вне комплекса) — не пустая.
                if (inp.closest && inp.closest('.d-none')) return;
                const raw = String(inp.value || '').trim();
                // «00.00.0000» — заводской шаблон пустой даты.
                const isZeroDate = /^0+[./\-]?0+[./\-]?0+$/.test(raw.replace(/\s/g, ''));
                if (raw !== '' && !isZeroDate) return;
                missing.push({ id: step.id, title: step.title || 'п.' + step.id });
            });
        });
        return missing;
    }

    function focusQrInput() {
        const next = getNextRequiredSensor();
        const inp =
            (next && $('paramQrSensor_' + next)) ||
            document.querySelector('.wb-sensor-qr-input') ||
            null;
        if (inp) {
            try {
                inp.focus({ preventScroll: true });
            } catch (_e) {
                inp.focus();
            }
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
        initCorrectorTemplatePanel();
        initMeterSerialPanel();
        initComplexSerialPanel();
        syncMeterSerialFromStep();
        paintComplexBadge();
        syncCorrectorVerifFieldsFromSteps();
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
            // Не фокусируем QR автоматически — браузер прокручивает страницу вниз.
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
        persistSensorBindingsToServer: persistSensorBindingsToServer,
        resetScannedSensors: resetScannedSensors,
        clearParamFieldValues: clearParamFieldValues,
        resetAllForNewSession: resetAllForNewSession,
        paintSensorBadges: paintSensorBadges,
        renderSensorScanCards: renderSensorScanCards,
        paintWorkflowSteps: paintWorkflowSteps,
        applyVerificationAndDefaults: applyVerificationAndDefaults,
        resolveTelemetryBlockName: resolveTelemetryBlockName,
        validateBeforeParametrize: validateBeforeParametrize,
        collectEmptyRequiredSteps: collectEmptyRequiredSteps,
        focusQrInput: focusQrInput,
        focusMeterInput: focusMeterInput,
        isMeterSerialFilled: isMeterSerialFilled,
        isComplexOrder: isComplexOrder,
        getCorrectorParamMode: getCorrectorParamMode,
        setCorrectorParamMode: setCorrectorParamMode,
        shouldWriteComplexParams: shouldWriteComplexParams,
        shouldSkipComplexName: shouldSkipComplexName,
        orderHasTelemetryBlock: orderHasTelemetryBlock,
        shouldSkipTelemetryName: shouldSkipTelemetryName,
        applyTelemetryNameSkipUi: applyTelemetryNameSkipUi,
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
        correctorSerialFromSteps: correctorSerialFromSteps,
        syncCorrectorVerifFieldsFromSteps: syncCorrectorVerifFieldsFromSteps,
        applyCorrectorVerifFieldsToSteps: applyCorrectorVerifFieldsToSteps,
        applyCorrectorVerificationDates: applyCorrectorVerificationDates,
        validateCorrectorForWrite: validateCorrectorForWrite,
        applyComplexSerial: applyComplexSerial,
        applyCorrectorOnlyComplexIdentity: applyCorrectorOnlyComplexIdentity,
        paintComplexBadge: paintComplexBadge,
        paintCorrectorVerifBadge: paintCorrectorVerifBadge,
        getComplexSerial: getComplexSerial,
        syncComplexVerifFieldsFromSteps: syncComplexVerifFieldsFromSteps,
        applyComplexVerifFieldsToSteps: applyComplexVerifFieldsToSteps,
        applyComplexVerificationDates: applyComplexVerificationDates,
        validateComplexForWrite: validateComplexForWrite,
        paintLkgStatusBadge: paintLkgStatusBadge,
        refreshLkgStatusFromServer: refreshLkgStatusFromServer,
        shouldWriteSensorMemory: function (stepId) {
            const id = Number(stepId);
            if (id === 59) {
                return isSensorFilled('DA');
            }
            if (id === 66) {
                return isSensorFilled('DD');
            }
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
