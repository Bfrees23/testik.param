/**
 * Заказ 1С · OData: автозагрузка JSON через прокси /api/odata-1c.php (Docker / PHP).
 * Резерв: вставка JSON вручную (без прокси).
 */
(function () {
    'use strict';

    const DEFAULT_ENTITY = 'Document_ЗаказНаПроизводство2_2';
    const STORAGE_BASE = 'order1c_odataBase';
    const STORAGE_JSON = 'order1c_pastedJson';
    const STORAGE_PROXY_ROOT = 'order1c_proxyRoot';
    const STORAGE_LAN_HOST = 'order1c_lanHost';
    const STORAGE_ODATA_USER = 'order1c_odataUser';

    function $(id) {
        return document.getElementById(id);
    }

    function escapeODataString(s) {
        return String(s).replace(/'/g, "''");
    }

    /** Префикс номера заказа в 1С (кириллица ТМ). */
    const ORDER_NUMBER_PREFIX = 'ТМ00-';

    /**
     * «539» / «000539» / «ТМ00-539» / «TM00-000539» → «ТМ00-000539».
     * @param {string} raw
     * @returns {string}
     */
    function normalizeOrderNumber(raw) {
        let s = String(raw || '').trim();
        if (!s) {
            return '';
        }
        s = s.replace(/^[TТ][MМ]00-/i, ORDER_NUMBER_PREFIX);
        const full = s.match(/^ТМ00-(\d+)$/i);
        if (full) {
            const digits = full[1].replace(/^0+/, '') || '0';
            return ORDER_NUMBER_PREFIX + digits.padStart(6, '0');
        }
        if (/^\d+$/.test(s)) {
            const digits = s.replace(/^0+/, '') || '0';
            return ORDER_NUMBER_PREFIX + digits.padStart(6, '0');
        }
        return s;
    }

    function orderNumbersEqual(a, b) {
        const na = normalizeOrderNumber(a);
        const nb = normalizeOrderNumber(b);
        if (na && nb) {
            return na === nb;
        }
        return String(a || '').trim() === String(b || '').trim();
    }

    const STANDARD_ODATA_MARK = '/standard.odata';

    /**
     * Разбор полного URL OData вида …/standard.odata/Document_…?$format=…&$filter=Number eq '…'
     * @returns {null | { base: string, entity: string, number: string }}
     */
    function parseFullOdataUrl(raw) {
        let s = (raw || '').trim();
        if (!s) {
            return null;
        }
        if (!/^https?:\/\//i.test(s)) {
            s = 'http://' + s.replace(/^\/+/, '');
        }
        let u;
        try {
            u = new URL(s);
        } catch {
            return null;
        }
        const pathname = u.pathname || '';
        const low = pathname.toLowerCase();
        const idx = low.indexOf(STANDARD_ODATA_MARK);
        if (idx === -1) {
            return null;
        }
        const baseEnd = idx + STANDARD_ODATA_MARK.length;
        let nu;
        try {
            nu = new URL(u.href);
        } catch {
            return null;
        }
        nu.pathname = pathname.slice(0, baseEnd);
        nu.search = '';
        nu.hash = '';
        const base = nu.toString().replace(/\/+$/, '');
        const pathRemain = pathname.slice(baseEnd).replace(/^\/+/, '');
        const entity = (pathRemain.split('/')[0] || '').trim();
        if (!entity) {
            return null;
        }
        let filter = u.searchParams.get('$filter');
        if (filter === null || filter === '') {
            const sp = u.search.replace(/^\?/, '');
            const m = sp.match(/(?:^|[&])(?:%24filter|\$filter)=([^&]*)/i);
            if (m) {
                try {
                    filter = decodeURIComponent(m[1].replace(/\+/g, ' '));
                } catch {
                    filter = m[1].replace(/\+/g, ' ');
                }
            } else {
                filter = '';
            }
        }
        let number = '';
        if (filter) {
            const fm = filter.match(/Number\s+eq\s+'((?:''|[^'])*)'/i);
            if (fm) {
                number = fm[1].replace(/''/g, "'");
            }
        }
        return { base, entity, number };
    }

    function normalizeOdataBase(base, entity) {
        let s = (base || '').trim();
        if (!s) {
            return '';
        }
        s = s.split('#')[0].split('?')[0].trim();
        if (!/^https?:\/\//i.test(s)) {
            s = 'http://' + s.replace(/^\/+/, '');
        }
        const e = (entity || '').trim();
        try {
            const u = new URL(s);
            let p = u.pathname.replace(/\/+$/, '');
            const low = p.toLowerCase();
            const idx = low.indexOf(STANDARD_ODATA_MARK);
            if (idx !== -1) {
                p = p.slice(0, idx + STANDARD_ODATA_MARK.length);
            }
            u.pathname = p;
            u.search = '';
            u.hash = '';
            let out = u.toString().replace(/\/+$/, '');
            if (e) {
                const tryStrip = (baseStr, ent) => {
                    const suf = '/' + ent;
                    if (baseStr.endsWith(suf)) {
                        return baseStr.slice(0, -suf.length);
                    }
                    try {
                        const lastSeg = baseStr.split('/').pop() || '';
                        const entSeg = ent.split('/').pop() || '';
                        if (
                            lastSeg &&
                            entSeg &&
                            decodeURIComponent(lastSeg) === decodeURIComponent(entSeg)
                        ) {
                            return baseStr.slice(0, -(lastSeg.length + 1));
                        }
                    } catch {
                        /* ignore */
                    }
                    return baseStr;
                };
                out = tryStrip(out, e);
            }
            return out;
        } catch {
            let t = s.replace(/\/+$/, '');
            const low = t.toLowerCase();
            const idx = low.indexOf(STANDARD_ODATA_MARK);
            if (idx !== -1) {
                t = t.slice(0, idx + STANDARD_ODATA_MARK.length);
            }
            if (e && t.endsWith('/' + e)) {
                t = t.slice(0, -(e.length + 1));
            }
            return t;
        }
    }

    /**
     * Если вводят логин/пароль отдельно — включаются в базовый URL (Basic для прокси; на сервере см. .env ODATA_1C_*).
     */
    function mergeOdataBaseWithAuth(normalizedBase) {
        const raw = (normalizedBase || '').trim();
        if (!raw) {
            return raw;
        }
        const userEl = $('orderOdataUser');
        const pwdEl = $('orderOdataPassword');
        const login = userEl && userEl.value.trim();
        if (!login) {
            return raw;
        }
        const pwd = (pwdEl && pwdEl.value) || '';
        try {
            const hasScheme = /^https?:\/\//i.test(raw);
            const s = hasScheme ? raw : 'http://' + raw.replace(/^\/+/, '');
            const parsed = new URL(s);
            parsed.username = login;
            parsed.password = pwd;
            return parsed.toString().replace(/\/+$/, '');
        } catch {
            return raw;
        }
    }

    /** Поле «просмотра» без user:password. */
    function stripUrlUserinfoDisplay(str) {
        if (!str || !String(str).trim()) {
            return str;
        }
        try {
            const t = String(str).trim();
            const x = new URL(/^https?:\/\//i.test(t) ? t : 'http://' + t.replace(/^\/+/, ''));
            if (!x.username && !x.password) {
                return str;
            }
            x.username = '';
            x.password = '';
            return x.toString();
        } catch {
            return str;
        }
    }

    function buildOrderYearFilterQuery(number) {
        const n = normalizeOrderNumber(number);
        const year = new Date().getFullYear();
        const from = year + '-01-01T00:00:00';
        const to = year + 1 + '-01-01T00:00:00';
        return (
            '$format=json&$filter=Number eq \'' +
            escapeODataString(n) +
            "' and Date ge datetime'" +
            from +
            "' and Date lt datetime'" +
            to +
            "'"
        );
    }

    function buildOdataPath(number, entity) {
        return entity + '?' + buildOrderYearFilterQuery(number);
    }

    /** Имя элемента перечисления 1С СтатусыЗаказовНаПроизводство2_2 (регистр важен для OData). */
    const ACTIVE_ORDER_STATUS = 'КПроизводству';
    /** Если 1С отклонила $filter по Статус — больше не долбим 400, сразу client-side отбор. */
    const STORAGE_STATUS_FILTER_MODE = 'tm07_odata_status_filter_mode_v2';
    const STORAGE_KNOWN_ORDERS = 'tm07_known_active_orders_v1';
    const STORAGE_PENDING_NOTIFY = 'tm07_pending_notify_orders_v1';
    /** В рабочее время (МСК) опрос чаще — чтобы оператор быстрее увидел новый заказ. */
    const ACTIVE_ORDERS_POLL_MS = 60000;
    const ACTIVE_ORDERS_POLL_OFFHOURS_MS = 5 * 60000;
    const WORKDAY_MSK_FROM = 8;
    const WORKDAY_MSK_TO = 17;

    /**
     * Рабочий день стенда: 08:00–17:00 Europe/Moscow (до 17:00, в 17:00 уже не уведомляем).
     */
    function isMoscowWorkHours(date) {
        const d = date || new Date();
        try {
            const parts = new Intl.DateTimeFormat('en-GB', {
                timeZone: 'Europe/Moscow',
                hour: 'numeric',
                hour12: false,
                weekday: 'short',
            }).formatToParts(d);
            let hour = null;
            let weekday = '';
            parts.forEach(function (p) {
                if (p.type === 'hour') hour = parseInt(p.value, 10);
                if (p.type === 'weekday') weekday = p.value;
            });
            if (hour == null || Number.isNaN(hour)) {
                return false;
            }
            // Пн–Пт (английские short в en-GB: Mon…Fri)
            const workDays = { Mon: 1, Tue: 1, Wed: 1, Thu: 1, Fri: 1 };
            if (!workDays[weekday]) {
                return false;
            }
            return hour >= WORKDAY_MSK_FROM && hour < WORKDAY_MSK_TO;
        } catch (_e) {
            // запасной вариант без Intl timezone
            const utc = d.getTime() + d.getTimezoneOffset() * 60000;
            const msk = new Date(utc + 3 * 3600000);
            const day = msk.getDay(); // 0=вс
            if (day === 0 || day === 6) return false;
            const h = msk.getHours();
            return h >= WORKDAY_MSK_FROM && h < WORKDAY_MSK_TO;
        }
    }

    function loadPendingNotifyOrders() {
        try {
            const raw = localStorage.getItem(STORAGE_PENDING_NOTIFY);
            const arr = raw ? JSON.parse(raw) : [];
            return Array.isArray(arr) ? arr : [];
        } catch (_e) {
            return [];
        }
    }

    function savePendingNotifyOrders(orders) {
        try {
            localStorage.setItem(STORAGE_PENDING_NOTIFY, JSON.stringify((orders || []).slice(0, 100)));
        } catch (_e) {}
    }

    function mergePendingNotify(newOrders) {
        const pending = loadPendingNotifyOrders();
        const byNum = Object.create(null);
        pending.forEach(function (o) {
            if (o && o.number) byNum[o.number] = o;
        });
        (newOrders || []).forEach(function (o) {
            if (o && o.number) byNum[o.number] = o;
        });
        const merged = Object.keys(byNum).map(function (k) {
            return byNum[k];
        });
        savePendingNotifyOrders(merged);
        return merged;
    }

    function isActiveProductionStatus(raw) {
        const s = formatOrderStatus(raw)
            .toLowerCase()
            .replace(/\s+/g, '')
            .replace(/ё/g, 'е');
        return s === 'кпроизводству' || s.indexOf('кпроизводству') >= 0;
    }

    function currentYearBounds() {
        const year = new Date().getFullYear();
        return {
            from: year + '-01-01T00:00:00',
            to: year + 1 + '-01-01T00:00:00',
            year: year,
        };
    }

    /**
     * Список заказов текущего года со статусом кПроизводству.
     * $filter по Статус; при ошибке 1С — запасной запрос без статуса и отбор на клиенте.
     */
    function buildActiveOrdersPath(entity, opts) {
        const ent = String(entity || DEFAULT_ENTITY).trim() || DEFAULT_ENTITY;
        const bounds = currentYearBounds();
        const top = (opts && opts.top) || 150;
        const status = (opts && opts.status) || ACTIVE_ORDER_STATUS;
        const filter =
            "Date ge datetime'" +
            bounds.from +
            "' and Date lt datetime'" +
            bounds.to +
            "' and Статус eq '" +
            escapeODataString(status) +
            "'";
        return (
            ent +
            '?$format=json&$filter=' +
            filter +
            '&$select=Ref_Key,Number,Date,Статус&$orderby=Date desc&$top=' +
            String(top)
        );
    }

    function buildRecentOrdersPath(entity, opts) {
        const ent = String(entity || DEFAULT_ENTITY).trim() || DEFAULT_ENTITY;
        const bounds = currentYearBounds();
        const top = (opts && opts.top) || 200;
        const filter =
            "Date ge datetime'" +
            bounds.from +
            "' and Date lt datetime'" +
            bounds.to +
            "'";
        return (
            ent +
            '?$format=json&$filter=' +
            filter +
            '&$select=Ref_Key,Number,Date,Статус&$orderby=Date desc&$top=' +
            String(top)
        );
    }

    function mapOrderListRow(row) {
        const number = normalizeOrderNumber(row && row.Number);
        return {
            number: number,
            rawNumber: row && row.Number != null ? String(row.Number) : number,
            date: row && row.Date != null ? String(row.Date) : '',
            status: formatOrderStatus(row && row['Статус']),
            refKey: row && row.Ref_Key != null ? String(row.Ref_Key) : '',
            raw: row,
        };
    }

    /**
     * Классификация по номенклатуре/характеристике заказа.
     * relevant: комплекс ПК-ТМ или корректор ТМ-07; иначе — не для стенда.
     */
    function classifyOrderNomenclatureKind(text) {
        const t = String(text || '');
        if (!t.trim()) {
            return 'other';
        }
        if (/ПК-ТМ-/i.test(t) || /комплекс\s+промышленного/i.test(t)) {
            return 'complex';
        }
        if (/Корректор\s+объ[её]ма\s+газа\s+ТМ-07/i.test(t)) {
            return 'corrector';
        }
        if (/корректор/i.test(t) && /ТМ[\s\-]?07/i.test(t) && !/комплекс\s+промышленного/i.test(t)) {
            return 'corrector';
        }
        return 'other';
    }

    function isTm07RelevantNomenclature(text) {
        const kind = classifyOrderNomenclatureKind(text);
        return kind === 'complex' || kind === 'corrector';
    }

    const STORAGE_NOM_KIND = 'tm07_order_nom_kind_v1';
    const nomKindMemory = Object.create(null);

    function loadNomKindStore() {
        try {
            const raw = localStorage.getItem(STORAGE_NOM_KIND);
            const obj = raw ? JSON.parse(raw) : {};
            return obj && typeof obj === 'object' ? obj : {};
        } catch (_e) {
            return {};
        }
    }

    function saveNomKindStore(store) {
        try {
            const keys = Object.keys(store || {});
            // не раздувать localStorage
            const keep = keys.slice(-400);
            const slim = Object.create(null);
            keep.forEach(function (k) {
                slim[k] = store[k];
            });
            localStorage.setItem(STORAGE_NOM_KIND, JSON.stringify(slim));
        } catch (_e) {}
    }

    function getCachedNomKind(number) {
        const n = normalizeOrderNumber(number);
        if (!n) return null;
        if (nomKindMemory[n]) return nomKindMemory[n];
        const store = loadNomKindStore();
        const hit = store[n];
        if (hit && hit.kind) {
            nomKindMemory[n] = hit;
            return hit;
        }
        return null;
    }

    function setCachedNomKind(number, entry) {
        const n = normalizeOrderNumber(number);
        if (!n || !entry) return;
        nomKindMemory[n] = entry;
        const store = loadNomKindStore();
        store[n] = {
            kind: entry.kind,
            label: entry.label,
            name: entry.name || '',
            ts: Date.now(),
        };
        saveNomKindStore(store);
    }

    async function mapPool(items, limit, worker) {
        const list = items || [];
        const out = new Array(list.length);
        let cursor = 0;
        async function run() {
            while (cursor < list.length) {
                const idx = cursor;
                cursor += 1;
                out[idx] = await worker(list[idx], idx);
            }
        }
        const n = Math.max(1, Math.min(limit || 4, list.length || 1));
        const runners = [];
        for (let i = 0; i < n; i += 1) {
            runners.push(run());
        }
        await Promise.all(runners);
        return out;
    }

    /**
     * Подтянуть номенклатуру и отбросить заказы не на комплекс/корректор ТМ-07.
     */
    async function filterOrdersByTm07Nomenclature(orders, entity, baseOverride) {
        const list = orders || [];
        if (!list.length) {
            return [];
        }
        const ent = String(entity || DEFAULT_ENTITY).trim() || DEFAULT_ENTITY;
        const base = baseOverride || null;
        const enriched = await mapPool(list, 4, async function (order) {
            const cached = getCachedNomKind(order.number);
            if (cached && (cached.kind === 'complex' || cached.kind === 'corrector' || cached.kind === 'other')) {
                return Object.assign({}, order, {
                    kind: cached.kind,
                    kindLabel: cached.label,
                    nomenclatureName: cached.name || '',
                });
            }
            try {
                const info = await fetchOrderProductInfoByOrderNumber(order.number, ent, base);
                const text = [
                    info.nomenclature && info.nomenclature.fullName,
                    info.characteristic && info.characteristic.fullName,
                ]
                    .filter(Boolean)
                    .join(' ');
                const kind = classifyOrderNomenclatureKind(text);
                const label =
                    kind === 'complex' ? 'комплекс' : kind === 'corrector' ? 'корректор' : 'прочее';
                setCachedNomKind(order.number, { kind: kind, label: label, name: text });
                return Object.assign({}, order, {
                    kind: kind,
                    kindLabel: label,
                    nomenclatureName: text,
                });
            } catch (e) {
                console.warn('[order-1c] nom-filter:skip', order.number, e);
                // без номенклатуры не показываем — иначе в список попадут чужие заказы
                setCachedNomKind(order.number, { kind: 'other', label: 'прочее', name: '' });
                return Object.assign({}, order, { kind: 'other', kindLabel: 'прочее', nomenclatureName: '' });
            }
        });
        const kept = enriched.filter(function (o) {
            return o && (o.kind === 'complex' || o.kind === 'corrector');
        });
        console.log('[order-1c] nom-filter:done', {
            before: list.length,
            after: kept.length,
            dropped: list.length - kept.length,
        });
        return kept;
    }

    async function listActiveOrders(entity, baseOverride, opts) {
        const ent = String(entity || DEFAULT_ENTITY).trim() || DEFAULT_ENTITY;
        const base = baseOverride || null;
        let rows = [];
        let usedFallback = false;
        let filterMode = 'unknown';
        try {
            filterMode = sessionStorage.getItem(STORAGE_STATUS_FILTER_MODE) || 'unknown';
        } catch (_e) {}

        const tryStatusFilter = filterMode !== 'off';
        if (tryStatusFilter) {
            try {
                const path = buildActiveOrdersPath(ent, opts);
                console.log('[order-1c] listActiveOrders:path', { path: path });
                const data = await fetchViaProxy(path, base);
                rows = data && Array.isArray(data.value) ? data.value : [];
                try {
                    sessionStorage.setItem(STORAGE_STATUS_FILTER_MODE, 'on');
                } catch (_e) {}
            } catch (e) {
                console.warn('[order-1c] listActiveOrders:status-filter-failed', e);
                try {
                    sessionStorage.setItem(STORAGE_STATUS_FILTER_MODE, 'off');
                } catch (_e2) {}
                usedFallback = true;
            }
        } else {
            usedFallback = true;
        }

        if (usedFallback) {
            const path = buildRecentOrdersPath(ent, opts);
            console.log('[order-1c] listActiveOrders:fallback-path', { path: path });
            const data = await fetchViaProxy(path, base);
            const all = data && Array.isArray(data.value) ? data.value : [];
            rows = all.filter(function (r) {
                return isActiveProductionStatus(r && r['Статус']);
            });
        }
        const mapped = rows
            .map(mapOrderListRow)
            .filter(function (r) {
                return !!r.number;
            });
        // Уникальные номера (на всякий случай)
        const seen = Object.create(null);
        const unique = [];
        mapped.forEach(function (r) {
            if (seen[r.number]) {
                return;
            }
            seen[r.number] = true;
            unique.push(r);
        });
        const skipNom = opts && opts.skipNomenclatureFilter;
        const filtered = skipNom
            ? unique
            : await filterOrdersByTm07Nomenclature(unique, ent, base);
        console.log('[order-1c] listActiveOrders:done', {
            count: filtered.length,
            usedFallback: usedFallback,
            beforeNomFilter: unique.length,
        });
        return filtered;
    }

    function loadKnownOrderNumbers() {
        try {
            const raw = localStorage.getItem(STORAGE_KNOWN_ORDERS);
            const arr = raw ? JSON.parse(raw) : [];
            return Array.isArray(arr) ? arr.map(String) : [];
        } catch (_e) {
            return [];
        }
    }

    function saveKnownOrderNumbers(numbers) {
        try {
            localStorage.setItem(STORAGE_KNOWN_ORDERS, JSON.stringify(numbers.slice(0, 500)));
        } catch (_e) {}
    }

    function ensureNotificationPermission() {
        if (typeof Notification === 'undefined') {
            return Promise.resolve('unsupported');
        }
        if (Notification.permission === 'granted' || Notification.permission === 'denied') {
            return Promise.resolve(Notification.permission);
        }
        return Notification.requestPermission().catch(function () {
            return 'denied';
        });
    }

    function showNewOrdersBrowserNotification(newOrders) {
        if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
            return;
        }
        if (!newOrders || !newOrders.length) {
            return;
        }
        // Отдельный toast на каждый заказ: одинаковый tag затирает предыдущее уведомление ОС
        newOrders.forEach(function (o, idx) {
            const test = !!o.test;
            const number = o.number || '';
            const title = (test ? 'ТЕСТ: заказ ' : 'Новый заказ в 1С: ') + (number || '—');
            const body =
                (o.message || 'Статус: ' + (o.status || ACTIVE_ORDER_STATUS)) +
                (o.kindLabel ? ' · ' + o.kindLabel : '');
            const tag =
                'tm07-order-' +
                (number || 'x') +
                '-' +
                Date.now() +
                '-' +
                idx +
                '-' +
                Math.random().toString(36).slice(2, 7);
            try {
                const n = new Notification(title, {
                    body: body,
                    tag: tag,
                    renotify: true,
                });
                n.onclick = function () {
                    try {
                        window.focus();
                        if (
                            !/\/index\.html\/?$/.test(window.location.pathname) &&
                            window.location.pathname !== '/'
                        ) {
                            window.location.href = number
                                ? (window.TM07_BENCH_EVENTS &&
                                  typeof window.TM07_BENCH_EVENTS.withWorkstationQuery === 'function'
                                      ? window.TM07_BENCH_EVENTS.withWorkstationQuery(
                                            '/tm07-workbench.html?order=' + encodeURIComponent(number)
                                        )
                                      : '/tm07-workbench.html?order=' + encodeURIComponent(number))
                                : '/index.html';
                        }
                    } catch (_e) {}
                    n.close();
                };
            } catch (_e2) {}
        });
    }

    const STORAGE_NOTIFY_SINCE = 'tm07_bench_notify_since_v1';
    const SERVER_NOTIFY_POLL_MS = 5000;

    function readNotifySince() {
        try {
            return parseInt(localStorage.getItem(STORAGE_NOTIFY_SINCE) || '0', 10) || 0;
        } catch (_e) {
            return 0;
        }
    }

    function ackServerOperatorNotifications(latestId) {
        if (latestId == null) {
            return;
        }
        try {
            localStorage.setItem(STORAGE_NOTIFY_SINCE, String(latestId));
        } catch (_e) {}
    }

    /**
     * Опрос очереди bench-notify. Курсор since обновляет только вызывающий код
     * через ackServerOperatorNotifications после успешной доставки в UI.
     * @returns {Promise<{items:Array, latestId:number|null, error:string|null, status:number}>}
     */
    async function pollServerOperatorNotifications() {
        const since = readNotifySince();
        let res;
        try {
            res = await fetch(
                '/api/bench-notify.php?action=poll&since=' + encodeURIComponent(String(since)),
                {
                    credentials: 'same-origin',
                    headers: { Accept: 'application/json' },
                }
            );
        } catch (e) {
            return {
                items: [],
                latestId: null,
                error: e && e.message ? e.message : 'network',
                status: 0,
            };
        }
        let data = null;
        try {
            data = await res.json();
        } catch (_e) {
            return { items: [], latestId: null, error: 'bad_json', status: res.status };
        }
        if (!res.ok || !data || !data.ok) {
            return {
                items: [],
                latestId: null,
                error: (data && (data.error || data.message)) || 'poll_failed',
                status: res.status,
            };
        }
        const items = (Array.isArray(data.items) ? data.items : []).map(function (it) {
            const num = normalizeOrderNumber(it.orderNumber) || String(it.orderNumber || '');
            return {
                number: num,
                rawNumber: String(it.orderNumber || num),
                status: ACTIVE_ORDER_STATUS,
                kind: it.kind === 'complex' ? 'complex' : 'corrector',
                kindLabel: it.kindLabel || (it.kind === 'complex' ? 'комплекс' : 'корректор'),
                test: !!it.test,
                message: it.message || 'Тестовое уведомление администратора',
                date: it.ts || '',
            };
        });
        return {
            items: items,
            latestId: data.latestId != null ? Number(data.latestId) : null,
            error: null,
            status: res.status,
        };
    }

    /**
     * Отдельный poller серверных push (тест из админки и будущие события).
     * Не зависит от OData / списка заказов.
     */
    function startOperatorNotifyPoller(opts) {
        const o = opts || {};
        let stopped = false;
        let timer = null;
        const intervalMs =
            typeof o.intervalMs === 'number' && o.intervalMs > 0
                ? o.intervalMs
                : SERVER_NOTIFY_POLL_MS;

        function emitNew(newOrders) {
            if (!newOrders || !newOrders.length) {
                return;
            }
            void ensureNotificationPermission().then(function () {
                showNewOrdersBrowserNotification(newOrders);
            });
            if (typeof o.onNew === 'function') {
                o.onNew(newOrders);
            }
        }

        async function tick() {
            if (stopped) {
                return;
            }
            try {
                const result = await pollServerOperatorNotifications();
                if (result.error) {
                    if (typeof o.onError === 'function') {
                        o.onError(new Error(result.error), result);
                    } else {
                        console.warn('[order-1c] server notify poll', result.error, result.status);
                    }
                    // Не двигаем since при ошибке — иначе «съедим» уведомление без показа
                    return;
                }
                if (result.items.length) {
                    emitNew(result.items);
                }
                // Курсор двигаем после попытки доставки (в т.ч. пустой ответ)
                if (result.latestId != null) {
                    ackServerOperatorNotifications(result.latestId);
                }
            } catch (e) {
                console.warn('[order-1c] server notify poll', e);
                if (typeof o.onError === 'function') {
                    o.onError(e);
                }
            }
        }

        function onVisibility() {
            if (!stopped && document.visibilityState === 'visible') {
                void tick();
            }
        }

        void ensureNotificationPermission();
        void tick();
        timer = setInterval(function () {
            void tick();
        }, intervalMs);
        document.addEventListener('visibilitychange', onVisibility);

        return {
            stop: function () {
                stopped = true;
                if (timer) {
                    clearInterval(timer);
                    timer = null;
                }
                document.removeEventListener('visibilitychange', onVisibility);
            },
            refresh: function () {
                return tick();
            },
        };
    }

    /**
     * Заполняет <select> списком активных заказов.
     * @returns {Promise<Array>}
     */
    async function fillActiveOrdersSelect(selectEl, opts) {
        const sel = typeof selectEl === 'string' ? $(selectEl) : selectEl;
        if (!sel) {
            return [];
        }
        const o = opts || {};
        const prev = sel.value;
        const keepManual = o.keepManualOption !== false;
        sel.disabled = true;
        const loading = document.createElement('option');
        loading.value = '';
        loading.textContent = '— Загрузка заказов кПроизводству… —';
        sel.innerHTML = '';
        sel.appendChild(loading);
        try {
            const list = await listActiveOrders(o.entity, o.baseOverride, o);
            sel.innerHTML = '';
            const empty = document.createElement('option');
            empty.value = '';
                empty.textContent =
                    list.length > 0
                        ? '— Выберите заказ ТМ-07 / ПК-ТМ (' + list.length + ') —'
                        : '— Нет заказов кПроизводству на корректор/комплекс —';
            sel.appendChild(empty);
            list.forEach(function (item) {
                const opt = document.createElement('option');
                opt.value = item.number;
                const dateShort = item.date ? String(item.date).slice(0, 10) : '';
                const kindBit = item.kindLabel ? ' · ' + item.kindLabel : '';
                opt.textContent =
                    item.number + kindBit + (dateShort ? ' · ' + dateShort : '');
                opt.title =
                    (item.nomenclatureName || item.status || ACTIVE_ORDER_STATUS) +
                    (item.kindLabel ? ' (' + item.kindLabel + ')' : '');
                sel.appendChild(opt);
            });
            if (keepManual) {
                const man = document.createElement('option');
                man.value = '__manual__';
                man.textContent = '— Ввести номер вручную —';
                sel.appendChild(man);
            }
            if (prev && prev !== '__manual__') {
                const found = list.some(function (x) {
                    return x.number === prev;
                });
                if (found) {
                    sel.value = prev;
                }
            }
            if (typeof o.onLoaded === 'function') {
                o.onLoaded(list);
            }
            return list;
        } catch (e) {
            sel.innerHTML = '';
            const err = document.createElement('option');
            err.value = '';
            err.textContent = '— Ошибка загрузки списка —';
            sel.appendChild(err);
            if (keepManual) {
                const man = document.createElement('option');
                man.value = '__manual__';
                man.textContent = '— Ввести номер вручную —';
                sel.appendChild(man);
            }
            throw e;
        } finally {
            sel.disabled = false;
        }
    }

    /**
     * Периодический опрос активных заказов + уведомление о новых.
     * Уведомления только в рабочее время 08:00–17:00 МСК (Пн–Пт).
     * Вне часов новые заказы копятся и показываются при первом опросе в рабочее время.
     * Первый проход только запоминает номера (без notify).
     */
    function startActiveOrdersWatcher(opts) {
        const o = opts || {};
        let timer = null;
        let stopped = false;
        let primed = false;
        // Серверные push — отдельным poller’ом (не ждём OData)
        const pushPoller =
            o.skipServerPush === true
                ? null
                : startOperatorNotifyPoller({
                      intervalMs: o.pushIntervalMs,
                      onNew: function (items) {
                          // Browser notify уже в poller; здесь только UI-колбэк (без окна 8–17 МСК)
                          if (typeof o.onNew === 'function') {
                              o.onNew(items, null);
                          }
                      },
                      onError: function (e, result) {
                          if (typeof o.onPushError === 'function') {
                              o.onPushError(e, result);
                          } else {
                              console.warn('[order-1c] server notify poll', e);
                          }
                      },
                  });

        function currentIntervalMs() {
            if (typeof o.intervalMs === 'number' && o.intervalMs > 0) {
                return o.intervalMs;
            }
            return isMoscowWorkHours() ? ACTIVE_ORDERS_POLL_MS : ACTIVE_ORDERS_POLL_OFFHOURS_MS;
        }

        function scheduleNext() {
            if (stopped) return;
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
            timer = setTimeout(function () {
                void tick();
            }, currentIntervalMs());
        }

        function emitNew(newOrders, list) {
            if (!newOrders || !newOrders.length) {
                return;
            }
            void ensureNotificationPermission().then(function () {
                showNewOrdersBrowserNotification(newOrders);
            });
            if (typeof o.onNew === 'function') {
                o.onNew(newOrders, list);
            }
        }

        async function tick() {
            if (stopped) {
                return;
            }
            try {
                const list = await listActiveOrders(o.entity, o.baseOverride, o);
                const numbers = list.map(function (x) {
                    return x.number;
                });
                const known = loadKnownOrderNumbers();
                const knownSet = Object.create(null);
                known.forEach(function (n) {
                    knownSet[n] = true;
                });
                if (!primed) {
                    primed = true;
                    numbers.forEach(function (n) {
                        knownSet[n] = true;
                    });
                    saveKnownOrderNumbers(Object.keys(knownSet));
                    // Если страница открыта в рабочее время и есть отложенные — показать сразу
                    if (isMoscowWorkHours()) {
                        const pending = loadPendingNotifyOrders().filter(function (p) {
                            return p && p.number && numbers.indexOf(p.number) >= 0;
                        });
                        if (pending.length) {
                            savePendingNotifyOrders([]);
                            emitNew(pending, list);
                        }
                    }
                    if (typeof o.onList === 'function') {
                        o.onList(list, {
                            primed: true,
                            newOrders: [],
                            workHours: isMoscowWorkHours(),
                        });
                    }
                    scheduleNext();
                    return;
                }

                const fresh = list.filter(function (item) {
                    return !knownSet[item.number];
                });
                fresh.forEach(function (item) {
                    knownSet[item.number] = true;
                });
                const activeSet = Object.create(null);
                numbers.forEach(function (n) {
                    activeSet[n] = true;
                });
                saveKnownOrderNumbers(
                    Object.keys(Object.assign(Object.create(null), knownSet, activeSet))
                );

                let notified = [];
                if (fresh.length) {
                    if (isMoscowWorkHours()) {
                        const pending = mergePendingNotify(fresh);
                        savePendingNotifyOrders([]);
                        notified = pending;
                        emitNew(notified, list);
                    } else {
                        // Вне 9–17 МСК только запоминаем — покажем с 9:00
                        mergePendingNotify(fresh);
                        console.log(
                            '[order-1c] новый заказ вне рабочего времени МСК, уведомление отложено',
                            fresh.map(function (x) {
                                return x.number;
                            })
                        );
                    }
                } else if (isMoscowWorkHours()) {
                    const pending = loadPendingNotifyOrders().filter(function (p) {
                        return p && p.number && activeSet[p.number];
                    });
                    if (pending.length) {
                        savePendingNotifyOrders([]);
                        notified = pending;
                        emitNew(notified, list);
                    }
                }

                if (typeof o.onList === 'function') {
                    o.onList(list, {
                        primed: false,
                        newOrders: notified,
                        workHours: isMoscowWorkHours(),
                    });
                }
            } catch (e) {
                console.warn('[order-1c] activeOrdersWatcher', e);
                if (typeof o.onError === 'function') {
                    o.onError(e);
                }
            }
            scheduleNext();
        }

        void ensureNotificationPermission();
        void tick();
        return {
            stop: function () {
                stopped = true;
                if (timer) {
                    clearTimeout(timer);
                    timer = null;
                }
                if (pushPoller && typeof pushPoller.stop === 'function') {
                    pushPoller.stop();
                }
            },
            refresh: function () {
                if (pushPoller && typeof pushPoller.refresh === 'function') {
                    void pushPoller.refresh();
                }
                return tick();
            },
            isWorkHours: isMoscowWorkHours,
        };
    }

    /** Запрос только поля Статус заказа на производство. */
    function buildOdataStatusPath(number, entity) {
        return entity + '?' + buildOrderYearFilterQuery(number) + '&$select=Статус';
    }

    function buildOrderCharacteristicLookupPath(number, entity) {
        return entity + '?' + buildOrderYearFilterQuery(number) + '&$select=Продукция';
    }

    function formatOrderStatus(raw) {
        if (raw == null || raw === '') {
            return '';
        }
        if (typeof raw === 'string') {
            return raw.trim();
        }
        if (typeof raw === 'object' && !Array.isArray(raw)) {
            const pick =
                raw.Presentation ||
                raw.Description ||
                raw.Наименование ||
                raw.Value ||
                raw.Статус;
            if (pick != null && String(pick).trim()) {
                return String(pick).trim();
            }
            if (raw.Ref_Key) {
                return String(raw.Ref_Key).trim();
            }
        }
        return String(raw).trim();
    }

    async function fetchOrderStatus(number, entity, baseOverride) {
        const n = normalizeOrderNumber(number);
        if (!n) {
            return null;
        }
        const ent = String(entity || DEFAULT_ENTITY).trim() || DEFAULT_ENTITY;
        const path = buildOdataStatusPath(n, ent);
        const data = await fetchViaProxy(path, baseOverride || null);
        const arr = data && Array.isArray(data.value) ? data.value : null;
        if (!arr || !arr.length) {
            return null;
        }
        const eq = orderNumbersEqual;
        let row = arr.find((r) => eq(r.Number, n));
        if (!row && arr.length === 1) {
            row = arr[0];
        }
        if (!row) {
            return null;
        }
        return formatOrderStatus(row['Статус']);
    }

    function extractNomenclatureKey(row) {
        function isEmptyGuid(v) {
            const s = String(v || '').trim().toLowerCase();
            return s === '' || s === '00000000-0000-0000-0000-000000000000';
        }
        function pickFromObject(obj) {
            if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
                return '';
            }
            const direct =
                obj['Номенклатура_Key'] ||
                obj['Nomenclature_Key'] ||
                obj['NomenclatureKey'] ||
                obj['Продукция_Key'] ||
                obj['Product_Key'];
            if (direct && !isEmptyGuid(direct)) {
                return String(direct).trim();
            }
            for (const k of Object.keys(obj)) {
                if (!/_key$/i.test(k) || !/номенк|nomencl|продук|product/i.test(k)) {
                    continue;
                }
                if (/характер|character/i.test(k)) {
                    continue;
                }
                const v = obj[k];
                if (!isEmptyGuid(v)) {
                    return String(v).trim();
                }
            }
            return '';
        }
        if (!row || typeof row !== 'object') {
            return '';
        }
        const product = row['Продукция'];
        if (Array.isArray(product)) {
            for (const line of product) {
                const key = pickFromObject(line);
                if (key) {
                    return key;
                }
            }
            return '';
        }
        if (product && typeof product === 'object') {
            const key = pickFromObject(product);
            if (key) {
                return key;
            }
        }
        return '';
    }

    function extractCharacteristicKey(row) {
        function isEmptyGuid(v) {
            const s = String(v || '').trim().toLowerCase();
            return s === '' || s === '00000000-0000-0000-0000-000000000000';
        }
        function pickFromObject(obj) {
            if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
                return '';
            }
            const direct =
                obj['Характеристика_Key'] ||
                obj['Characteristic_Key'] ||
                obj['CharacteristicKey'];
            if (direct && !isEmptyGuid(direct)) {
                return String(direct).trim();
            }
            for (const k of Object.keys(obj)) {
                if (!/_key$/i.test(k) || !/характер|character/i.test(k)) {
                    continue;
                }
                const v = obj[k];
                if (!isEmptyGuid(v)) {
                    return String(v).trim();
                }
            }
            return '';
        }
        if (!row || typeof row !== 'object') {
            return '';
        }
        const product = row['Продукция'];
        if (Array.isArray(product)) {
            for (const line of product) {
                const key = pickFromObject(line);
                if (key) {
                    return key;
                }
            }
            return '';
        }
        if (product && typeof product === 'object') {
            const key = pickFromObject(product);
            if (key) {
                return key;
            }
        }
        return '';
    }

    function buildNomenclaturePath(nomenclatureKey) {
        const key = String(nomenclatureKey || '').trim();
        if (!key) {
            return '';
        }
        return (
            "Catalog_Номенклатура(guid'" +
            escapeODataString(key) +
            "')?$format=json&$select=НаименованиеПолное"
        );
    }

    function buildCharacteristicPath(characteristicKey) {
        const key = String(characteristicKey || '').trim();
        if (!key) {
            return '';
        }
        return (
            "Catalog_ХарактеристикиНоменклатуры(guid'" +
            escapeODataString(key) +
            "')?$format=json&$select=НаименованиеПолное"
        );
    }

    function buildAbsoluteOdataUrl(baseRaw, number, entity) {
        const b = normalizeOdataBase(baseRaw, entity).replace(/\/$/, '');
        if (!b) {
            return '';
        }
        const path = buildOdataPath(number, entity);
        const qi = path.indexOf('?');
        const entityPart = qi === -1 ? path : path.slice(0, qi);
        const query = qi === -1 ? '' : path.slice(qi + 1);
        return b + '/' + encodeURIComponent(entityPart) + '?' + query;
    }

    /** Только хост:порт без схемы и пути (порт можно указать: srv-1c:8080). */
    function cleanLanHostString(raw) {
        let t = (raw || '').trim();
        if (!t) {
            return '';
        }
        t = t.replace(/^https?:\/\//i, '');
        t = t.split('/')[0] || '';
        return t;
    }

    /**
     * Справочная ссылка «Открыть» / копирование: если в базе localhost виртуалки,
     * подставляем имя сервера 1С в общей сети (поле или srv-1c по умолчанию).
     */
    function rewriteLocalhostToLanHost(urlString) {
        if (!urlString) {
            return '';
        }
        try {
            const u = new URL(urlString);
            const h = u.hostname.toLowerCase();
            if (h !== 'localhost' && h !== '127.0.0.1') {
                return urlString;
            }
            const input = $('orderLanHostInput');
            const fromInput = input && input.value.trim();
            const fromStore = localStorage.getItem(STORAGE_LAN_HOST);
            const lan =
                cleanLanHostString(fromInput) ||
                cleanLanHostString(fromStore || '') ||
                'srv-1c';
            const uHost = new URL('http://' + lan);
            u.hostname = uHost.hostname;
            u.port = uHost.port;
            return u.toString();
        } catch {
            return urlString;
        }
    }

    /** URL прокси: same-origin в Docker; при file:// — поле orderProxyRoot или localStorage. */
    function getOdataProxyScriptUrl() {
        const p = window.location.protocol;
        if (p === 'http:' || p === 'https:') {
            return '/api/odata-1c.php';
        }
        const input = $('orderProxyRoot');
        const root = (input && input.value.trim()) || localStorage.getItem(STORAGE_PROXY_ROOT) || '';
        if (!root) {
            return '';
        }
        return root.replace(/\/$/, '') + '/api/odata-1c.php';
    }

    function fieldKeysInRange(row) {
        const keys = Object.keys(row);
        const iRef = keys.indexOf('Ref_Key');
        const start = iRef >= 0 ? iRef : 0;
        let end = keys.length - 1;
        for (let i = keys.length - 1; i >= start; i--) {
            if (/Ответственн/i.test(keys[i])) {
                end = i;
                break;
            }
        }
        if (end < start) {
            end = keys.length - 1;
        }
        return keys.slice(start, end + 1);
    }

    function formatValue(v) {
        if (v === null || v === undefined) {
            return '—';
        }
        if (typeof v === 'object') {
            return JSON.stringify(v, null, 0);
        }
        return String(v);
    }

    function renderTable(row, keys) {
        const tbody = $('orderResultBody');
        tbody.innerHTML = '';
        for (const k of keys) {
            const tr = document.createElement('tr');
            const th = document.createElement('th');
            th.scope = 'row';
            th.className = 'text-break';
            th.textContent = k;
            const td = document.createElement('td');
            td.className = 'text-break small';
            td.textContent = formatValue(row[k]);
            tr.appendChild(th);
            tr.appendChild(td);
            tbody.appendChild(tr);
        }
    }

    function setStatus(text, isError) {
        const el = $('orderStatus');
        if (!el) {
            return;
        }
        el.textContent = text;
        el.className = 'small ' + (isError ? 'text-danger' : 'text-body-secondary');
    }

    function extractValueArray(parsed) {
        if (Array.isArray(parsed)) {
            return parsed;
        }
        if (parsed && Array.isArray(parsed.value)) {
            return parsed.value;
        }
        if (parsed && typeof parsed === 'object' && parsed.Ref_Key !== undefined) {
            return [parsed];
        }
        return null;
    }

    function showRowFromValueArray(value, number) {
        if (!value || value.length === 0) {
            setStatus('В ответе нет записей (value пуст).', true);
            return;
        }
        const n = normalizeOrderNumber(number);
        let row = value.find((r) => orderNumbersEqual(r.Number, n));
        if (!row && value.length === 1) {
            row = value[0];
        }
        if (!row) {
            setStatus(
                'Запись с номером «' + n + '» не найдена (в ответе ' + value.length + ' строк).',
                true
            );
            return;
        }
        const keys = fieldKeysInRange(row);
        renderTable(row, keys);
        const pre = $('orderJsonPre');
        if (pre) {
            pre.textContent = JSON.stringify(row, null, 2);
        }
        const orc = $('orderResultCard');
        if (orc) {
            orc.classList.remove('d-none');
        }
        if (pre) {
            pre.classList.remove('d-none');
        }
        try {
            const payload = JSON.stringify({ row: row, number: String(n), savedAt: Date.now() });
            sessionStorage.setItem('order1c_param_lastOrder', payload);
            localStorage.setItem('order1c_param_lastOrder', payload);
        } catch {
            /* ignore */
        }
        const wbBtn = $('orderGoWorkbenchBtn');
        if (wbBtn && n) {
            const raw = '/tm07-workbench.html?order=' + encodeURIComponent(String(n));
            wbBtn.href =
                window.TM07_BENCH_EVENTS &&
                typeof window.TM07_BENCH_EVENTS.withWorkstationQuery === 'function'
                    ? window.TM07_BENCH_EVENTS.withWorkstationQuery(raw)
                    : raw;
            wbBtn.classList.remove('d-none');
        }
        setStatus('Загружено: ' + keys.length + ' полей (Ref_Key … Ответственный).', false);
    }

    function curlErrnoHint(n) {
        if (n === 6) {
            return (
                ' Имя хоста 1С не резолвится из контейнера: в .env задайте ODATA_1C_HOST_IP (см. .env.example), ' +
                'перезапустите compose; либо extra_hosts srv-1c:IP у php; либо в «Базе» укажите http://IP/…/standard.odata.'
            );
        }
        if (n === 7) {
            return ' Нет TCP-соединения с 1С (порт, firewall, публикация IIS/веб-сервера).';
        }
        if (n === 28) {
            return ' Таймаут до 1С.';
        }
        return '';
    }

    async function ensureOperatorForOdata() {
        const E = window.TM07_BENCH_EVENTS;
        if (E && typeof E.ensureOperator === 'function') {
            await E.ensureOperator();
        }
    }

    async function fetchViaProxy(path, baseOverride) {
        console.log('[order-1c] fetchViaProxy:start', { path: path, baseOverride: baseOverride || null });
        await ensureOperatorForOdata();
        const script = getOdataProxyScriptUrl();
        if (!script) {
            throw new Error(
                'Прокси недоступен. Откройте страницу через Docker (http://localhost:8081/…) или укажите «URL стенда» для file://.'
            );
        }
        let url = script + '?path=' + encodeURIComponent(path);
        if (baseOverride) {
            url += '&base=' + encodeURIComponent(baseOverride);
        }
        const cred =
            window.location.protocol === 'file:' || window.location.protocol === ''
                ? 'omit'
                : 'same-origin';
        const res = await fetch(url, { credentials: cred });
        const text = await res.text();
        const tried = res.headers.get('X-OData-Request-URL');
        console.log('[order-1c] fetchViaProxy:raw-response', {
            path: path,
            status: res.status,
            requestUrl: tried || url,
            text: text
        });
        let data;
        try {
            data = JSON.parse(text);
        } catch {
            let extra = '';
            if (res.status === 404) {
                extra =
                    ' Запущен ли Docker (nginx+php)? Статический http-server не отдаёт /api/odata-1c.php.';
            }
            throw new Error(
                (res.ok ? 'Ответ не JSON: ' : 'HTTP ' + res.status + ': ') +
                    text.slice(0, 300) +
                    (tried ? ' — URL: ' + tried : '') +
                    extra
            );
        }
        if (!res.ok) {
            const odata = data && data['odata.error'];
            let msg =
                (data && data.error) ||
                (odata && (odata.message?.value || odata.message)) ||
                (data && data.message) ||
                'HTTP ' + res.status;
            const line = typeof msg === 'string' ? msg : JSON.stringify(msg);
            let err = line;
            if (data && typeof data.detail === 'string' && data.detail) {
                err += ' — ' + data.detail;
            }
            if (data && data.curl_errno !== undefined && data.curl_errno !== null) {
                const ce = Number(data.curl_errno);
                err += ' (curl_errno ' + ce + ')' + curlErrnoHint(ce);
            }
            if (tried) {
                err += ' — запрос к 1С: ' + tried;
            }
            if (res.status === 404) {
                err += ' Проверьте /api/odata-1c.php и PHP в Docker (для dev обычно порт 8081).';
            }
            throw new Error(err);
        }
        console.log('[order-1c] fetchViaProxy:ok', { path: path, status: res.status, data: data });
        return data;
    }

    async function fetchOrderProductRow(number, entity, baseOverride) {
        const n = normalizeOrderNumber(number);
        if (!n) {
            return null;
        }
        const ent = String(entity || DEFAULT_ENTITY).trim() || DEFAULT_ENTITY;
        const firstPath = buildOrderCharacteristicLookupPath(n, ent);
        console.log('[order-1c] productLookup:path', { firstPath: firstPath });
        const firstData = await fetchViaProxy(firstPath, baseOverride || null);
        const arr = firstData && Array.isArray(firstData.value) ? firstData.value : null;
        if (!arr || !arr.length) {
            return null;
        }
        return arr[0];
    }

    async function fetchCatalogFullName(catalogPath, baseOverride) {
        if (!catalogPath) {
            return '';
        }
        const data = await fetchViaProxy(catalogPath, baseOverride || null);
        const fullName = data && typeof data === 'object' ? data['НаименованиеПолное'] : null;
        return fullName == null ? '' : String(fullName);
    }

    async function fetchOrderProductInfoByOrderNumber(number, entity, baseOverride) {
        const firstRow = await fetchOrderProductRow(number, entity, baseOverride);
        if (!firstRow) {
            return { nomenclature: null, characteristic: null, productRow: null };
        }
        const nomenclatureKey = extractNomenclatureKey(firstRow);
        const characteristicKey = extractCharacteristicKey(firstRow);
        const base = baseOverride || null;
        let nomenclature = null;
        let characteristic = null;
        if (nomenclatureKey) {
            const path = buildNomenclaturePath(nomenclatureKey);
            console.log('[order-1c] nomenclature:path', { path: path, key: nomenclatureKey });
            const fullName = await fetchCatalogFullName(path, base);
            nomenclature = { key: nomenclatureKey, fullName: fullName, rawPath: path };
            console.log('[order-1c] nomenclature:response', { fullName: fullName });
        } else {
            console.warn('[order-1c] nomenclature:no-key', {
                product: firstRow['Продукция'],
            });
        }
        if (characteristicKey) {
            const path = buildCharacteristicPath(characteristicKey);
            console.log('[order-1c] characteristic:path', { path: path, key: characteristicKey });
            const fullName = await fetchCatalogFullName(path, base);
            characteristic = { key: characteristicKey, fullName: fullName, rawPath: path };
            console.log('[order-1c] characteristic:response', { fullName: fullName });
        }
        return { nomenclature: nomenclature, characteristic: characteristic, productRow: firstRow };
    }

    async function fetchNomenclatureByOrderNumber(number, entity, baseOverride) {
        const info = await fetchOrderProductInfoByOrderNumber(number, entity, baseOverride);
        return info.nomenclature;
    }

    async function fetchCharacteristicByOrderNumber(number, entity, baseOverride) {
        const info = await fetchOrderProductInfoByOrderNumber(number, entity, baseOverride);
        const ch = info.characteristic;
        if (!ch) {
            return null;
        }
        return {
            key: ch.key,
            fullName: ch.fullName,
            raw: ch,
        };
    }

    async function loadOrder() {
        const rawNumber = $('orderNumberInput').value.trim();
        const number = normalizeOrderNumber(rawNumber);
        if (!number) {
            setStatus('Введите номер заказа.', true);
            return;
        }
        const numEl = $('orderNumberInput');
        if (numEl && number !== rawNumber) {
            numEl.value = number;
            updateLinkField();
        }
        const entity = ($('orderEntityInput').value || DEFAULT_ENTITY).trim();
        let baseUrl = normalizeOdataBase(($('orderBaseUrlInput').value || '').trim(), entity);
        if (baseUrl) {
            $('orderBaseUrlInput').value = baseUrl;
        }
        baseUrl = mergeOdataBaseWithAuth(baseUrl);
        const proxyRoot = $('orderProxyRoot');
        if (proxyRoot && proxyRoot.value.trim()) {
            localStorage.setItem(STORAGE_PROXY_ROOT, proxyRoot.value.trim());
        }

        $('orderResultCard')?.classList.add('d-none');
        $('orderJsonPre')?.classList.add('d-none');
        setStatus('Загрузка через прокси…', false);
        console.log('[order-1c] loadOrder:start', { number: number, entity: entity, baseUrl: baseUrl || null });

        try {
            const path = buildOdataPath(number, entity);
            const data = await fetchViaProxy(path, baseUrl || null);
            const value = extractValueArray(data);
            if (!value || !value.length) {
                throw new Error('Пустой ответ OData (value). Проверьте номер и год (' + new Date().getFullYear() + ').');
            }
            let row = value.find((r) => orderNumbersEqual(r.Number, number));
            if (!row && value.length === 1) {
                row = value[0];
            }
            if (!row) {
                throw new Error('Номер «' + number + '» не найден в ответе (' + value.length + ' строк).');
            }
            try {
                const info = await fetchOrderProductInfoByOrderNumber(number, entity, baseUrl || null);
                if (info.nomenclature && info.nomenclature.fullName) {
                    row['НаименованиеПолное_Номенклатуры'] = info.nomenclature.fullName;
                }
                if (info.characteristic && info.characteristic.fullName) {
                    row['НаименованиеПолное_Характеристики'] = info.characteristic.fullName;
                }
            } catch (enrichErr) {
                console.warn('[order-1c] loadOrder:enrich-warn', enrichErr);
            }
            const idx = value.indexOf(row);
            if (idx >= 0) {
                value[idx] = row;
            }
            showRowFromValueArray(value, number);
            console.log('[order-1c] loadOrder:done', {
                number: number,
                fields: Object.keys(row).length,
            });
        } catch (e) {
            console.error('[order-1c] loadOrder:error', e);
            setStatus(e.message || String(e), true);
        }
    }

    function parseAndShowManual() {
        const number = $('orderNumberInput').value.trim();
        if (!number) {
            setStatus('Введите номер заказа.', true);
            return;
        }
        let parsed;
        try {
            const t = $('orderJsonInput').value.trim();
            if (!t) {
                throw new Error('Вставьте JSON.');
            }
            parsed = JSON.parse(t);
        } catch (e) {
            setStatus('JSON: ' + (e.message || String(e)), true);
            return;
        }
        const value = extractValueArray(parsed);
        if (!value || value.length === 0) {
            setStatus('В JSON нет массива value или он пуст.', true);
            return;
        }
        showRowFromValueArray(value, number);
    }

    function updateLinkField() {
        const nEl = $('orderNumberInput');
        const eEl = $('orderEntityInput');
        const bEl = $('orderBaseUrlInput');
        if (!nEl || !eEl || !bEl) {
            return;
        }
        const number = nEl.value.trim();
        const entity = (eEl.value || DEFAULT_ENTITY).trim();
        const baseTrim = (bEl.value || '').trim();
        const baseNorm = normalizeOdataBase(baseTrim, entity);
        const baseForOd = mergeOdataBaseWithAuth(baseNorm) || baseNorm || baseTrim;
        const raw = buildAbsoluteOdataUrl(baseForOd, number, entity);
        const full = rewriteLocalhostToLanHost(raw);
        const el = $('orderOdataLink');
        if (!el) {
            return;
        }
        el.value = stripUrlUserinfoDisplay(full) || full;
        const a = $('orderOpenLink');
        if (a) {
            if (full) {
                a.setAttribute('href', stripUrlUserinfoDisplay(full) || full);
                a.classList.remove('disabled', 'text-muted', 'pe-none');
            } else {
                a.setAttribute('href', '#');
                a.classList.add('disabled', 'text-muted', 'pe-none');
            }
        }
    }

    async function fetchServerOdataConfig() {
        const script = getOdataProxyScriptUrl();
        if (!script) {
            return null;
        }
        try {
            if (window.TM07_SETTINGS && window.TM07_SETTINGS.getOdataConfig) {
                return await window.TM07_SETTINGS.getOdataConfig();
            }
            const res = await fetch(script + '?action=config', { credentials: 'same-origin' });
            const data = await res.json();
            if (!res.ok || !data || !data.ok) {
                return null;
            }
            return data;
        } catch (_e) {
            return null;
        }
    }

    /**
     * Подставляет defaultBase из .env (PHP) в localStorage и поля формы, если база ещё не задана.
     */
    async function bootstrapOdataConfig() {
        const cfg = await fetchServerOdataConfig();
        if (!cfg || !cfg.defaultBase) {
            return cfg;
        }
        let saved = '';
        try {
            saved = localStorage.getItem(STORAGE_BASE) || '';
        } catch (_e) {
            saved = '';
        }
        if (!saved.trim()) {
            try {
                localStorage.setItem(STORAGE_BASE, cfg.defaultBase);
            } catch (_e) {}
        }
        const baseInput = $('orderBaseUrlInput');
        if (baseInput && !baseInput.value.trim()) {
            baseInput.value = cfg.defaultBase;
        }
        const paramBase = document.getElementById('paramOrder1cBase');
        if (paramBase && !paramBase.value.trim()) {
            paramBase.value = cfg.defaultBase;
        }
        const entInput = $('orderEntityInput');
        if (entInput && cfg.defaultEntity && !entInput.value.trim()) {
            entInput.value = cfg.defaultEntity;
        }
        const paramEnt = document.getElementById('paramOrder1cEntity');
        if (paramEnt && cfg.defaultEntity && !paramEnt.value.trim()) {
            paramEnt.value = cfg.defaultEntity;
        }
        const lanInput = $('orderLanHostInput');
        if (lanInput && cfg.lanHost && !lanInput.value.trim()) {
            lanInput.value = cfg.lanHost;
        }
        updateLinkField();
        return cfg;
    }

    function init() {
        void bootstrapOdataConfig();
        const baseInput = $('orderBaseUrlInput');
        const jsonInput = $('orderJsonInput');
        const savedBase = localStorage.getItem(STORAGE_BASE);
        if (savedBase && baseInput) {
            baseInput.value = savedBase;
        }
        const savedJson = localStorage.getItem(STORAGE_JSON);
        if (savedJson && jsonInput) {
            jsonInput.value = savedJson;
        }
        const lanInput = $('orderLanHostInput');
        if (lanInput) {
            const sl = localStorage.getItem(STORAGE_LAN_HOST);
            if (sl) {
                lanInput.value = sl;
            }
            lanInput.addEventListener('input', () => {
                localStorage.setItem(STORAGE_LAN_HOST, lanInput.value.trim());
                updateLinkField();
            });
            lanInput.addEventListener('change', updateLinkField);
        }
        const proxyEl = $('orderProxyRoot');
        if (proxyEl) {
            const pr = localStorage.getItem(STORAGE_PROXY_ROOT);
            if (pr) {
                proxyEl.value = pr;
            }
            proxyEl.addEventListener('input', () => {
                localStorage.setItem(STORAGE_PROXY_ROOT, proxyEl.value.trim());
            });
            if (window.location.protocol === 'file:' || window.location.protocol === '') {
                const row = $('orderProxyRow');
                if (row) {
                    row.classList.remove('d-none');
                }
            }
        }

        const odataUserEl = $('orderOdataUser');
        if (odataUserEl) {
            try {
                const ou = localStorage.getItem(STORAGE_ODATA_USER);
                if (ou) {
                    odataUserEl.value = ou;
                }
            } catch {
                /* ignore */
            }
        }

        ['orderNumberInput', 'orderEntityInput', 'orderBaseUrlInput', 'orderOdataUser', 'orderOdataPassword'].forEach((id) => {
            const el = $(id);
            if (el) {
                el.addEventListener('input', () => {
                    if (id === 'orderOdataUser') {
                        try {
                            localStorage.setItem(STORAGE_ODATA_USER, el.value.trim());
                        } catch {
                            /* ignore */
                        }
                    }
                    updateLinkField();
                });
                el.addEventListener('change', updateLinkField);
            }
        });

        const fullUrlInput = $('orderFullUrlInput');
        const parseFullUrlBtn = $('orderParseFullUrlBtn');
        function applyParsedFullUrl() {
            const raw = fullUrlInput && fullUrlInput.value.trim();
            if (!raw) {
                setStatus('Вставьте полную ссылку OData.', true);
                return;
            }
            const p = parseFullOdataUrl(raw);
            if (!p) {
                setStatus(
                    'Не удалось разобрать ссылку: нужен путь …/standard.odata/ИмяСущности и параметр $filter с Number eq \'…\'.',
                    true
                );
                return;
            }
            if (baseInput) {
                let baseVal = normalizeOdataBase(p.base, p.entity) || p.base;
                try {
                    const t = baseVal.includes('://') ? baseVal : 'http://' + baseVal.replace(/^\/+/, '');
                    const bu = new URL(t);
                    const ue = $('orderOdataUser');
                    const pe = $('orderOdataPassword');
                    if (bu.username && ue) {
                        ue.value = decodeURIComponent(bu.username);
                        try {
                            localStorage.setItem(STORAGE_ODATA_USER, ue.value);
                        } catch {
                            /* ignore */
                        }
                    }
                    if (bu.password !== '' && pe) {
                        pe.value = bu.password;
                    }
                    if (bu.username || bu.password) {
                        bu.username = '';
                        bu.password = '';
                        baseVal = bu.toString().replace(/\/+$/, '');
                    }
                } catch {
                    /* ignore */
                }
                baseInput.value = baseVal;
            }
            const entEl = $('orderEntityInput');
            if (entEl) {
                entEl.value = p.entity || DEFAULT_ENTITY;
            }
            const numEl = $('orderNumberInput');
            if (numEl) {
                numEl.value = p.number || numEl.value;
            }
            localStorage.setItem(STORAGE_BASE, baseInput ? baseInput.value.trim() : '');
            updateLinkField();
            setStatus(
                p.number
                    ? 'Поля заполнены из ссылки. Нажмите «Загрузить».'
                    : 'База и сущность из ссылки; номер в $filter не найден — введите номер вручную.',
                !p.number
            );
        }
        if (parseFullUrlBtn) {
            parseFullUrlBtn.addEventListener('click', applyParsedFullUrl);
        }
        if (fullUrlInput) {
            fullUrlInput.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter') {
                    ev.preventDefault();
                    applyParsedFullUrl();
                }
            });
        }
        updateLinkField();

        const openLink = $('orderOpenLink');
        if (openLink) {
            openLink.addEventListener('click', (ev) => {
                const el = $('orderOdataLink');
                if (el && !el.value.trim()) {
                    ev.preventDefault();
                }
            });
        }

        const copyBtn = $('orderCopyLinkBtn');
        if (copyBtn) {
            copyBtn.addEventListener('click', async () => {
                const el = $('orderOdataLink');
                const full = el && el.value.trim();
                if (!full) {
                    setStatus('Укажите базу OData и номер.', true);
                    return;
                }
                try {
                    await navigator.clipboard.writeText(full);
                    setStatus('Ссылка скопирована (для справки).', false);
                } catch {
                    if (el) {
                        el.select();
                    }
                    setStatus('Ctrl+C по полю со ссылкой.', false);
                }
            });
        }

        const loadBtn = $('orderLoadBtn');
        if (loadBtn) {
            loadBtn.addEventListener('click', () => {
                if (baseInput) {
                    localStorage.setItem(STORAGE_BASE, baseInput.value.trim());
                }
                try {
                    const ou = $('orderOdataUser');
                    if (ou) {
                        localStorage.setItem(STORAGE_ODATA_USER, ou.value.trim());
                    }
                } catch {
                    /* ignore */
                }
                if (lanInput) {
                    localStorage.setItem(STORAGE_LAN_HOST, lanInput.value.trim());
                }
                loadOrder();
            });
        }

        const parseBtn = $('orderParseBtn');
        if (parseBtn) {
            parseBtn.addEventListener('click', () => {
                localStorage.setItem(STORAGE_BASE, baseInput.value.trim());
                if (jsonInput) {
                    localStorage.setItem(STORAGE_JSON, jsonInput.value);
                }
                parseAndShowManual();
            });
        }

        const exportBtn = $('orderExportExcelBtn');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => {
                const table = $('orderResultTable');
                if (!table) {
                    setStatus('Таблица для экспорта не найдена.', true);
                    return;
                }
                if (!window.TableToExcel || typeof window.TableToExcel.convert !== 'function') {
                    setStatus('Библиотека экспорта в Excel не загружена.', true);
                    return;
                }
                window.TableToExcel.convert(table);
            });
        }

        const numInput = $('orderNumberInput');
        if (numInput) {
            numInput.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter') {
                    ev.preventDefault();
                    loadOrder();
                }
            });
        }

        const activeSelect = $('orderActiveSelect');
        const newAlert = $('orderNewAlert');
        async function refreshOrderPageList() {
            if (!activeSelect || typeof fillActiveOrdersSelect !== 'function') {
                return;
            }
            try {
                await fillActiveOrdersSelect(activeSelect, { keepManualOption: true });
            } catch (e) {
                setStatus('Список заказов: ' + (e.message || String(e)), true);
            }
        }
        if (activeSelect) {
            activeSelect.addEventListener('change', function () {
                const v = activeSelect.value;
                if (!v || v === '__manual__') {
                    return;
                }
                if (numInput) {
                    numInput.value = v;
                    updateLinkField();
                }
            });
            $('orderRefreshListBtn')?.addEventListener('click', function () {
                void refreshOrderPageList();
            });
            void bootstrapOdataConfig().then(function () {
                return refreshOrderPageList();
            }).then(function () {
                window.__order1cActiveWatcher = startActiveOrdersWatcher({
                    intervalMs: 60000,
                    onNew: function (newOrders) {
                        if (newAlert && newOrders && newOrders.length) {
                            newAlert.classList.remove('d-none');
                            const prev = newAlert.getAttribute('data-stack') || '';
                            const lines = prev ? prev.split('\n').filter(Boolean) : [];
                            newOrders.forEach(function (o) {
                                const bit = (o.test ? '[ТЕСТ] ' : '') + (o.number || '');
                                if (bit && lines.indexOf(bit) < 0) {
                                    lines.push(bit);
                                } else if (bit) {
                                    lines.push(bit);
                                }
                            });
                            newAlert.setAttribute('data-stack', lines.join('\n'));
                            newAlert.innerHTML =
                                '<i class="bi bi-bell me-1"></i>Новые заказы:<br>' +
                                lines
                                    .map(function (n) {
                                        return '<strong>' + n + '</strong>';
                                    })
                                    .join('<br>');
                        }
                        void refreshOrderPageList();
                    },
                });
            });
        }
    }

    window.Order1cOdata = {
        escapeODataString: escapeODataString,
        normalizeOrderNumber: normalizeOrderNumber,
        orderNumbersEqual: orderNumbersEqual,
        normalizeOdataBase: normalizeOdataBase,
        buildOdataPath: buildOdataPath,
        buildOdataStatusPath: buildOdataStatusPath,
        buildActiveOrdersPath: buildActiveOrdersPath,
        buildOrderCharacteristicLookupPath: buildOrderCharacteristicLookupPath,
        formatOrderStatus: formatOrderStatus,
        isActiveProductionStatus: isActiveProductionStatus,
        fetchOrderStatus: fetchOrderStatus,
        listActiveOrders: listActiveOrders,
        filterOrdersByTm07Nomenclature: filterOrdersByTm07Nomenclature,
        classifyOrderNomenclatureKind: classifyOrderNomenclatureKind,
        isTm07RelevantNomenclature: isTm07RelevantNomenclature,
        fillActiveOrdersSelect: fillActiveOrdersSelect,
        startActiveOrdersWatcher: startActiveOrdersWatcher,
        startOperatorNotifyPoller: startOperatorNotifyPoller,
        pollServerOperatorNotifications: pollServerOperatorNotifications,
        ackServerOperatorNotifications: ackServerOperatorNotifications,
        ensureNotificationPermission: ensureNotificationPermission,
        isMoscowWorkHours: isMoscowWorkHours,
        buildNomenclaturePath: buildNomenclaturePath,
        buildCharacteristicPath: buildCharacteristicPath,
        extractNomenclatureKey: extractNomenclatureKey,
        extractCharacteristicKey: extractCharacteristicKey,
        fetchOrderProductInfoByOrderNumber: fetchOrderProductInfoByOrderNumber,
        fetchNomenclatureByOrderNumber: fetchNomenclatureByOrderNumber,
        fetchCharacteristicByOrderNumber: fetchCharacteristicByOrderNumber,
        fetchViaProxy: fetchViaProxy,
        getOdataProxyScriptUrl: getOdataProxyScriptUrl,
        fetchServerOdataConfig: fetchServerOdataConfig,
        bootstrapOdataConfig: bootstrapOdataConfig,
        DEFAULT_ENTITY: DEFAULT_ENTITY,
        ACTIVE_ORDER_STATUS: ACTIVE_ORDER_STATUS,
        STORAGE_BASE: STORAGE_BASE
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
