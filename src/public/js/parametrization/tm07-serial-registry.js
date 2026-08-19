/**
 * Реестр серийных номеров ТМ-07 / ПК-ТМ.
 * Формат: PPP + YY + MM + NNN (10 цифр).
 *   300 — корректор (п.3), 400 — комплекс (п.201).
 *
 * Сейчас: счётчик в localStorage. Для Firebird: setBackend('firebird') → POST /api/tm07-serial-registry.php.
 */
(function () {
    'use strict';

    const STORAGE_KEY = 'tm07_serial_registry_v1';

    const KIND = {
        CORRECTOR: 'corrector',
        COMPLEX: 'complex',
    };

    const PREFIX_BY_KIND = {
        corrector: '300',
        complex: '400',
    };

    const KIND_BY_PREFIX = {
        '300': KIND.CORRECTOR,
        '400': KIND.COMPLEX,
    };

    const STEP_BY_KIND = {
        corrector: 3,
        complex: 201,
    };

    let backendName = 'local';
    /** @type {{ allocate?: Function, peek?: Function }|null} */
    let customBackend = null;

    function prefixForKind(kind) {
        const p = PREFIX_BY_KIND[kind];
        if (!p) {
            throw new Error('Неизвестный тип изделия: ' + kind);
        }
        return p;
    }

    function monthKey(date) {
        const d = date instanceof Date ? date : new Date(date);
        const yy = String(d.getFullYear() % 100).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        return yy + mm;
    }

    /**
     * @param {string} prefix
     * @param {Date} date
     * @param {number} seq 1…999
     */
    function formatSerial(prefix, date, seq) {
        const d = date instanceof Date ? date : new Date(date);
        const yy = String(d.getFullYear() % 100).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const nnn = String(seq).padStart(3, '0');
        return String(prefix) + yy + mm + nnn;
    }

    /**
     * @param {string} str
     * @returns {{ prefix:string, kind:string, yy:number, mm:number, seq:number, fullYear:number }|null}
     */
    function parseSerial(str) {
        const s = String(str || '').trim();
        if (!/^\d{10}$/.test(s)) {
            return null;
        }
        const prefix = s.slice(0, 3);
        const kind = KIND_BY_PREFIX[prefix];
        if (!kind) {
            return null;
        }
        const yy = parseInt(s.slice(3, 5), 10);
        const mm = parseInt(s.slice(5, 7), 10);
        const seq = parseInt(s.slice(7, 10), 10);
        if (!Number.isFinite(mm) || mm < 1 || mm > 12) {
            return null;
        }
        if (!Number.isFinite(seq) || seq < 1 || seq > 999) {
            return null;
        }
        return {
            prefix: prefix,
            kind: kind,
            yy: yy,
            mm: mm,
            seq: seq,
            fullYear: 2000 + yy,
        };
    }

    function loadState() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const o = JSON.parse(raw);
                if (o && typeof o === 'object') {
                    if (!o.counters || typeof o.counters !== 'object') {
                        o.counters = {};
                    }
                    if (!Array.isArray(o.issued)) {
                        o.issued = [];
                    }
                    return o;
                }
            }
        } catch (_e) {
            /* ignore */
        }
        return { counters: {}, issued: [] };
    }

    function saveState(state) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }

    function nextSeqForMonth(state, prefix, mk) {
        if (!state.counters[prefix]) {
            state.counters[prefix] = {};
        }
        const last = parseInt(state.counters[prefix][mk], 10);
        const next = (Number.isFinite(last) ? last : 0) + 1;
        if (next > 999) {
            throw new Error('Исчерпан лимит номеров в месяце (999) для префикса ' + prefix);
        }
        return next;
    }

    /**
     * @param {string} kind
     * @param {{ date?: Date|string, dryRun?: boolean }} [opts]
     */
    function localPeek(kind, opts) {
        const o = opts || {};
        const prefix = prefixForKind(kind);
        const date = o.date ? new Date(o.date) : new Date();
        const mk = monthKey(date);
        const state = loadState();
        const seq = nextSeqForMonth({ counters: JSON.parse(JSON.stringify(state.counters)) }, prefix, mk);
        return {
            ok: true,
            dryRun: true,
            serial: formatSerial(prefix, date, seq),
            kind: kind,
            prefix: prefix,
            stepId: STEP_BY_KIND[kind],
            seq: seq,
            monthKey: mk,
            fullYear: date.getFullYear(),
            mm: date.getMonth() + 1,
            backend: 'local',
        };
    }

    /**
     * @param {string} kind
     * @param {{ date?: Date|string }} [opts]
     */
    function localAllocate(kind, opts) {
        const o = opts || {};
        const prefix = prefixForKind(kind);
        const date = o.date ? new Date(o.date) : new Date();
        const mk = monthKey(date);
        const state = loadState();
        const seq = nextSeqForMonth(state, prefix, mk);
        state.counters[prefix][mk] = seq;
        const serial = formatSerial(prefix, date, seq);
        state.issued.push({
            serial: serial,
            kind: kind,
            prefix: prefix,
            monthKey: mk,
            seq: seq,
            at: new Date().toISOString(),
        });
        if (state.issued.length > 1000) {
            state.issued = state.issued.slice(-1000);
        }
        saveState(state);
        return {
            ok: true,
            serial: serial,
            kind: kind,
            prefix: prefix,
            stepId: STEP_BY_KIND[kind],
            seq: seq,
            monthKey: mk,
            fullYear: date.getFullYear(),
            mm: date.getMonth() + 1,
            backend: 'local',
        };
    }

    async function firebirdRequest(action, kind, opts) {
        const o = opts || {};
        const ctx = window.TM07_BENCH_EVENTS && typeof window.TM07_BENCH_EVENTS.contextPayload === 'function'
            ? window.TM07_BENCH_EVENTS.contextPayload()
            : {};
        const res = await fetch('/api/tm07-serial-registry.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(Object.assign({
                action: action,
                kind: kind,
                date: o.date || null,
                orderNumber: o.orderNumber || null,
                serialCorrector: o.serialCorrector || null,
                serialComplex: o.serialComplex || null,
            }, ctx)),
        });
        const text = await res.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch (_e) {
            throw new Error('Ответ реестра Firebird не JSON: ' + text.slice(0, 120));
        }
        if (!res.ok || !data || data.ok === false) {
            throw new Error((data && data.error) || 'Ошибка реестра Firebird (HTTP ' + res.status + ')');
        }
        return data;
    }

    /**
     * @param {string} kind — 'corrector' | 'complex'
     * @param {{ date?: Date|string, dryRun?: boolean }} [opts]
     * @returns {Promise<object>}
     */
    async function allocate(kind, opts) {
        const o = opts || {};
        if (o.dryRun) {
            return peek(kind, o);
        }
        if (backendName === 'firebird') {
            return firebirdRequest('allocate', kind, o);
        }
        if (customBackend && typeof customBackend.allocate === 'function') {
            return Promise.resolve(customBackend.allocate(kind, o));
        }
        return localAllocate(kind, o);
    }

    /**
     * @param {string} kind
     * @param {{ date?: Date|string }} [opts]
     * @returns {Promise<object>}
     */
    async function peek(kind, opts) {
        if (backendName === 'firebird') {
            return firebirdRequest('peek', kind, opts || {});
        }
        if (customBackend && typeof customBackend.peek === 'function') {
            return Promise.resolve(customBackend.peek(kind, opts || {}));
        }
        return localPeek(kind, opts || {});
    }

    /**
     * @param {'local'|'firebird'|string} name
     * @param {{ allocate?: Function, peek?: Function }} [backend]
     */
    function setBackend(name, backend) {
        backendName = String(name || 'local');
        customBackend = backend && typeof backend === 'object' ? backend : null;
    }

    function getBackend() {
        return backendName;
    }

    function getState() {
        return loadState();
    }

    function resetLocalState() {
        localStorage.removeItem(STORAGE_KEY);
    }

    /**
     * @param {string} str
     * @param {Date} [now]
     * @param {string|null} [expectedPrefix]
     */
    function validateSerial(str, now, expectedPrefix) {
        const K = window.KorrektorDevice;
        if (K && typeof K.validateTm07SerialNumber === 'function') {
            return K.validateTm07SerialNumber(str, now, expectedPrefix);
        }
        const parsed = parseSerial(str);
        if (!parsed) {
            return { ok: false, error: 'Серийный номер: 10 цифр, префикс 300 или 400.' };
        }
        if (expectedPrefix && parsed.prefix !== String(expectedPrefix)) {
            return { ok: false, error: 'Ожидается префикс ' + expectedPrefix + '.' };
        }
        return {
            ok: true,
            prefix: parsed.prefix,
            kind: parsed.kind,
            yy: parsed.yy,
            mm: parsed.mm,
            seq: parsed.seq,
            fullYear: parsed.fullYear,
        };
    }

    function describeKind(kind) {
        if (kind === KIND.CORRECTOR) {
            return 'корректор ТМ-07 (300)';
        }
        if (kind === KIND.COMPLEX) {
            return 'комплекс ПК-ТМ (400)';
        }
        return kind;
    }

    window.TM07_SERIAL_REGISTRY = {
        STORAGE_KEY: STORAGE_KEY,
        KIND: KIND,
        PREFIX_BY_KIND: PREFIX_BY_KIND,
        STEP_BY_KIND: STEP_BY_KIND,
        formatSerial: formatSerial,
        parseSerial: parseSerial,
        validateSerial: validateSerial,
        allocate: allocate,
        peek: peek,
        setBackend: setBackend,
        getBackend: getBackend,
        getState: getState,
        resetLocalState: resetLocalState,
        describeKind: describeKind,
        monthKey: monthKey,
    };
})();
