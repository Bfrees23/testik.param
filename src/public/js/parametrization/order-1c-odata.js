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
            wbBtn.href = '/tm07-workbench.html?order=' + encodeURIComponent(String(n));
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
    }

    window.Order1cOdata = {
        escapeODataString: escapeODataString,
        normalizeOrderNumber: normalizeOrderNumber,
        orderNumbersEqual: orderNumbersEqual,
        normalizeOdataBase: normalizeOdataBase,
        buildOdataPath: buildOdataPath,
        buildOdataStatusPath: buildOdataStatusPath,
        buildOrderCharacteristicLookupPath: buildOrderCharacteristicLookupPath,
        formatOrderStatus: formatOrderStatus,
        fetchOrderStatus: fetchOrderStatus,
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
        STORAGE_BASE: STORAGE_BASE
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
