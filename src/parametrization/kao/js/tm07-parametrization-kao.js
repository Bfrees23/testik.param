/**
 * Страница «Параметризация ТМ-07» через КАО (по шагам из tm07-parametrization-data.js).
 */
(function () {
    const K = window.KorrektorDevice;
    const DOC = window.TM07_PARAMETRIZATION_DOC;
    const EXTRA = window.TM07_PARAMETRIZATION_EXTRA;
    if (typeof K !== 'function' || !DOC || !Array.isArray(DOC.steps)) {
        console.error('[TM07-param] Не загружены KorrektorDevice или таблица параметров — подключение КАО недоступно.');
        const st = document.getElementById('paramConnStatus');
        if (st) {
            st.textContent = 'ошибка JS: перезагрузите страницу (Ctrl+F5)';
            st.classList.remove('text-bg-secondary');
            st.classList.add('text-bg-danger');
        }
        return;
    }

    const el = (id) => document.getElementById(id);
    const LOG_PREFIX = '[TM07-param]';

    const READ_DATETIME_TOLERANCE_SEC = 120;

    function expectedInputForOut(out) {
        if (!out || !out.id) {
            return null;
        }
        if (out.id.indexOf('out_final_') === 0) {
            return el('val_final_' + out.id.slice('out_final_'.length));
        }
        if (out.id.indexOf('out_') === 0) {
            return el('val_' + out.id.slice(4));
        }
        return null;
    }

    function stepIdFromOut(out) {
        if (!out || !out.id) {
            return '';
        }
        return String(out.id.replace(/^out_(final_)?/, ''));
    }

    function normalizeReadCompareValue(val) {
        const s = String(val ?? '')
            .trim()
            .replace(/\s+/g, ' ');
        if (!s) {
            return '';
        }
        if (/^0x[0-9a-f]+$/i.test(s)) {
            return String(parseInt(s, 16));
        }
        const n = Number(s.replace(',', '.'));
        if (Number.isFinite(n) && /^-?\d+([.,]\d+)?$/.test(s.replace(/\s/g, ''))) {
            return String(Number(n.toFixed(4)));
        }
        return s.toLowerCase();
    }

    function parseReadUnixSeconds(val) {
        // parseDatetimeInputToUnix объявлен ниже (function declaration — hoisted).
        if (typeof parseDatetimeInputToUnix === 'function') {
            return parseDatetimeInputToUnix(val);
        }
        const s = String(val ?? '').trim();
        if (!s) {
            return null;
        }
        if (/^\d{9,12}$/.test(s)) {
            const n = Number(s);
            return Number.isFinite(n) ? n : null;
        }
        const m = /\(unix\s+(\d+)\)/i.exec(s);
        if (m) {
            const n = Number(m[1]);
            return Number.isFinite(n) ? n : null;
        }
        const t = Date.parse(s);
        if (Number.isFinite(t)) {
            return Math.floor(t / 1000);
        }
        return null;
    }

    function readValueMatchesExpected(stepId, expected, actual) {
        if (String(stepId) === '20') {
            const a = parseReadUnixSeconds(expected);
            const b = parseReadUnixSeconds(actual);
            if (a != null && b != null) {
                return Math.abs(a - b) <= READ_DATETIME_TOLERANCE_SEC;
            }
            // Живые часы: если в приборе валидное время — не считаем «расхождением с заказом».
            return b != null;
        }
        if (window.TM07_WORKBENCH && typeof window.TM07_WORKBENCH.valuesMatchForVerify === 'function') {
            return window.TM07_WORKBENCH.valuesMatchForVerify(stepId, expected, actual);
        }
        return normalizeReadCompareValue(expected) === normalizeReadCompareValue(actual);
    }

    function clearReadComparePaint(out) {
        if (!out) {
            return;
        }
        out.classList.remove('param-read-mismatch-val');
        out.removeAttribute('title');
        const row = out.closest('tr');
        if (row) {
            row.classList.remove('param-read-mismatch', 'param-read-match');
        }
    }

    /** После опроса: совпало с полем «Значение» (заказ) — зелёный; расхождение — красный. */
    function applyReadComparePaint(out, actualText) {
        if (!out) {
            return;
        }
        clearReadComparePaint(out);
        const actual = String(actualText == null ? out.textContent : actualText).trim();
        if (!actual || actual === '—' || actual === '…' || actual === 'ошибка' || actual === '✓') {
            return;
        }
        const sid = stepIdFromOut(out);
        const step = sid != null ? findStep(sid) : null;
        // п.59/66: в поле команда «1», справа — запомненный S/N ЧЭ; сравнивать с полем нельзя.
        if (isSensorMemoryCmd(step)) {
            return;
        }
        // Маски staging в основной таблице: реальные И1…И4 пишутся в финале.
        if (step && step.paramMask) {
            return;
        }
        // п.20 — часы прибора «сейчас»; поле заказа устаревает за время опроса → не красим в красный.
        if (step && (step.type === 't' || String(sid) === '20')) {
            const unix = parseReadUnixSeconds(actual);
            const row = out.closest('tr');
            const inp = expectedInputForOut(out);
            if (unix != null && inp) {
                const human = typeof formatUnixMoscow === 'function' ? formatUnixMoscow(unix) : '';
                if (human) {
                    inp.value = human;
                    if (typeof updateDatetimeHint === 'function') {
                        updateDatetimeHint(sid);
                    }
                }
            }
            out.classList.remove('text-success', 'text-danger', 'text-body-secondary', 'text-warning');
            out.classList.add('text-success');
            if (row) {
                row.classList.add('param-read-match');
                row.classList.remove('param-read-mismatch');
            }
            return;
        }
        const inp = expectedInputForOut(out);
        const expected = inp ? String(inp.value || '').trim() : '';
        if (!expected) {
            return;
        }
        const row = out.closest('tr');
        const ok = readValueMatchesExpected(sid, expected, actual);
        out.classList.remove('text-success', 'text-danger', 'text-body-secondary', 'text-warning');
        if (ok) {
            out.classList.add('text-success');
            if (row) {
                row.classList.add('param-read-match');
            }
            return;
        }
        out.classList.add('text-danger', 'param-read-mismatch-val');
        out.title = 'Заказ: ' + expected + ' · в корректоре: ' + actual;
        if (row) {
            row.classList.add('param-read-mismatch');
        }
    }

    /** Статус справа от Прочитать/Записать: ok → зелёный, err → красный; расхождение с заказом → красный. */
    function setOutStatus(out, text, status) {
        if (!out) {
            return;
        }
        out.textContent = text == null ? '' : String(text);
        out.classList.remove('text-success', 'text-danger', 'text-body-secondary', 'text-warning');
        clearReadComparePaint(out);
        if (status === 'ok') {
            out.classList.add('text-success');
            const isCheck = !text || String(text).toLowerCase() === 'ok';
            if (isCheck) {
                out.textContent = '✓';
                const row = out.closest('tr');
                if (row) {
                    row.classList.add('param-write-ok');
                    if (row.getAttribute('data-step-id') === '228') {
                        row.classList.add('param-write-ok-228');
                    }
                    if (row.closest('#paramFinalTbody')) {
                        row.classList.add('param-write-ok-final');
                    }
                }
            } else {
                applyReadComparePaint(out, text);
            }
        } else if (status === 'err') {
            out.classList.add('text-danger');
            const row = out.closest('tr');
            if (row) {
                row.classList.remove('param-write-ok', 'param-write-ok-228', 'param-write-ok-final');
            }
        } else if (status === 'pending') {
            out.classList.add('text-warning');
            const row = out.closest('tr');
            if (row) {
                row.classList.remove('param-write-ok', 'param-write-ok-228', 'param-write-ok-final');
            }
        } else {
            out.classList.add('text-body-secondary');
            const row = out.closest('tr');
            if (row) {
                row.classList.remove('param-write-ok', 'param-write-ok-228', 'param-write-ok-final');
            }
        }
    }

    const log = (m) => {
        const le = el('paramLog');
        if (!le) return;
        const t = new Date().toLocaleTimeString();
        le.innerHTML += `[${t}] ${m}<br>`;
        le.scrollTop = le.scrollHeight;
    };
    const clog = (...args) => console.log(LOG_PREFIX, ...args);
    const clogErr = (...args) => console.error(LOG_PREFIX, ...args);

    let dev = null;
    /** Пока true — идёт connect/паспорт; Modbus занят, чтение/запись блокируются. */
    let connectBusy = false;
    /** Версия карты регистров с прибора (identify / паспорт). */
    let deviceMapVersion = null;
    const UI_MAP_VERSION = 50;
    /** Карты, совместимые с текущими таблицами UI / REG_LKG 0x07B6. */
    const ALLOWED_DEVICE_MAP_VERSIONS = [49, 50];

    /**
     * П.20 / 0x008C: прошивка ТМ-07 хранит «стену» как unix без часового пояса
     * (gmtime(Д/М/Ч) = то, что на дисплее). Для Москвы пишем 17:xx как UTC-компоненты 17:xx,
     * а не настоящий UTC 14:xx — иначе на приборе будет 14 при реальных 17.
     * AutoPass (0x06A7) тоже берёт UTC-компоненты этого unix.
     */
    const DEVICE_TIME_TZ = 'Europe/Moscow';

    /** Текущая московская стена → unix «как на дисплее прибора» (naive UTC). */
    function nowUnixForDevice() {
        const p = moscowWallPartsNow();
        return Math.floor(Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) / 1000);
    }

    function pad2(n) {
        return String(n).padStart(2, '0');
    }

    /** Московская стена «сейчас» (для записи в прибор). */
    function moscowWallPartsNow() {
        const fmt = new Intl.DateTimeFormat('en-GB', {
            timeZone: DEVICE_TIME_TZ,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hourCycle: 'h23',
        });
        const map = {};
        fmt.formatToParts(new Date()).forEach(function (p) {
            if (p.type !== 'literal') {
                map[p.type] = p.value;
            }
        });
        return {
            y: parseInt(map.year, 10),
            m: parseInt(map.month, 10),
            d: parseInt(map.day, 10),
            h: parseInt(map.hour, 10),
            mi: parseInt(map.minute, 10),
            s: parseInt(map.second, 10),
        };
    }

    /**
     * Д/М/ЧЧ из unix 0x008C так, как их видит прошивка (UTC-компоненты = дисплей).
     * @returns {{ y:number, m:number, d:number, h:number, mi:number, s:number }|null}
     */
    function deviceWallPartsFromUnix(unixSec) {
        const n = Number(unixSec);
        if (!Number.isFinite(n) || n <= 0) {
            return null;
        }
        const dt = new Date(n * 1000);
        if (Number.isNaN(dt.getTime())) {
            return null;
        }
        return {
            y: dt.getUTCFullYear(),
            m: dt.getUTCMonth() + 1,
            d: dt.getUTCDate(),
            h: dt.getUTCHours(),
            mi: dt.getUTCMinutes(),
            s: dt.getUTCSeconds(),
        };
    }

    /** Человекочитаемо: то же время, что на дисплее корректора. */
    function formatUnixMoscow(unixSec) {
        const p = deviceWallPartsFromUnix(unixSec);
        if (!p) {
            return '';
        }
        return (
            pad2(p.d) +
            '.' +
            pad2(p.m) +
            '.' +
            p.y +
            ', ' +
            pad2(p.h) +
            ':' +
            pad2(p.mi) +
            ':' +
            pad2(p.s)
        );
    }

    /**
     * Ввод ДД.ММ.ГГГГ[, ]ЧЧ:ММ[:СС] = стена на приборе → naive unix (Date.UTC).
     * Не сдвигать на −3 ч: прошивка не знает Europe/Moscow.
     */
    function parseDatetimeInputToUnix(val) {
        if (val instanceof Date && !Number.isNaN(val.getTime())) {
            // Date из браузера — взять московскую стену этого момента.
            const fmt = new Intl.DateTimeFormat('en-GB', {
                timeZone: DEVICE_TIME_TZ,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hourCycle: 'h23',
            });
            const map = {};
            fmt.formatToParts(val).forEach(function (p) {
                if (p.type !== 'literal') {
                    map[p.type] = p.value;
                }
            });
            return Math.floor(
                Date.UTC(
                    parseInt(map.year, 10),
                    parseInt(map.month, 10) - 1,
                    parseInt(map.day, 10),
                    parseInt(map.hour, 10),
                    parseInt(map.minute, 10),
                    parseInt(map.second, 10)
                ) / 1000
            );
        }
        const s = String(val ?? '').trim();
        if (!s) {
            return null;
        }
        const mUnix = /\(unix\s+(\d+)\)/i.exec(s);
        if (mUnix) {
            return parseInt(mUnix[1], 10);
        }
        if (/^\d{9,12}$/.test(s)) {
            return parseInt(s, 10);
        }
        const m = /^(\d{2})\.(\d{2})\.(\d{4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
        if (m) {
            const dd = parseInt(m[1], 10);
            const mm = parseInt(m[2], 10);
            const yyyy = parseInt(m[3], 10);
            const hh = m[4] != null ? parseInt(m[4], 10) : 0;
            const mi = m[5] != null ? parseInt(m[5], 10) : 0;
            const ss = m[6] != null ? parseInt(m[6], 10) : 0;
            return Math.floor(Date.UTC(yyyy, mm - 1, dd, hh, mi, ss) / 1000);
        }
        const t = Date.parse(s);
        if (Number.isFinite(t)) {
            return parseDatetimeInputToUnix(new Date(t));
        }
        return null;
    }

    const REG_STATUS_LOCK = 0x0028;
    /** Эталон «хорошей» сессии: калибр. + произв. опт. */
    const LOCK_RAW_WRITE_READY = 0x0005;
    /** После открытия только замка поставщика (0x06A4) часто raw=0x0003 — LKG поставщика даёт 0x0B. */
    const LOCK_RAW_SUPPLIER_OPT_ONLY = 0x0003;
    /** Пароль AutoPass по умолчанию (CorrReader: запись "-22" в 0x06A4). */
    const DEFAULT_LOCK_PASSWORD = '-22';
    const lockPasswords = {
        supplier: DEFAULT_LOCK_PASSWORD,
        manufacturer: DEFAULT_LOCK_PASSWORD,
    };

    function applyDeviceMapVersion(mapV) {
        if (mapV == null || !Number.isFinite(Number(mapV))) return;
        deviceMapVersion = Number(mapV);
        const regEl = el('paramLkgReg');
        if (regEl) {
            regEl.value = (lkgConfig.reg & 0xffff).toString(16).toUpperCase().padStart(4, '0');
        }
        clog('map version', deviceMapVersion, 'REG_LKG', formatHoldingAddr(lkgConfig.reg));
    }

    /** @returns {{ ok: boolean, mapVersion: number|null, message?: string }} */
    function assertDeviceMapCompatible(mapV) {
        if (mapV == null || !Number.isFinite(Number(mapV))) {
            return {
                ok: false,
                mapVersion: null,
                message: 'Версия карты регистров прибора неизвестна — identify не вернул mapVersion.',
            };
        }
        const mv = Number(mapV);
        if (!ALLOWED_DEVICE_MAP_VERSIONS.includes(mv)) {
            return {
                ok: false,
                mapVersion: mv,
                message:
                    'Карта прибора v' +
                    mv +
                    ' несовместима с таблицами UI v' +
                    UI_MAP_VERSION +
                    ' (допустимы: ' +
                    ALLOWED_DEVICE_MAP_VERSIONS.join(', ') +
                    '). Запись остановлена.',
            };
        }
        return { ok: true, mapVersion: mv };
    }
    const DEFAULT_KAO_PID = 0x6015;
    /** Ключи ЛКГ только из /api/admin-settings.php — без hardcoded fallback. */
    const lkgConfig = {
        supplierKey: null,
        manufacturerKey: null,
        manufacturerSaveLkg: 0n,
        reg: 0x07b6,
        initReg: 0x07b8,
        delayMs: 150,
    };
    /** Последний сбой пакетной записи — для «Продолжить с п.N». */
    let lastWriteAbort = null;
    /** Резолвер паузы финального прогона перед закрытием калибровочного замка (п.317). */
    let finalContinueResolver = null;

    function waitForFinalContinue() {
        const btn = el('paramFinalContinue');
        if (btn) {
            btn.classList.remove('d-none');
        }
        return new Promise((resolve) => {
            finalContinueResolver = resolve;
        });
    }

    function clearFinalContinue() {
        const btn = el('paramFinalContinue');
        if (btn) {
            btn.classList.add('d-none');
        }
        finalContinueResolver = null;
    }

    function noteWriteAbort(stepId, label) {
        lastWriteAbort = {
            stepId: stepId != null && stepId !== '' ? Number(stepId) : null,
            label: label || '',
            ts: Date.now(),
        };
        try {
            window.dispatchEvent(new CustomEvent('tm07-write-abort', { detail: lastWriteAbort }));
        } catch (_e) {}
    }

    function clearLastWriteAbort() {
        if (!lastWriteAbort) {
            return;
        }
        lastWriteAbort = null;
        try {
            window.dispatchEvent(new CustomEvent('tm07-write-abort', { detail: null }));
        } catch (_e) {}
    }

    function isStepWriteMarkedOk(stepId) {
        const out = el('out_' + stepId);
        if (!out) {
            return false;
        }
        const t = String(out.textContent || '').trim().toLowerCase();
        return t === 'ok' || t === '✓' || t === '✔' || out.classList.contains('text-success');
    }

    function u32leBytes(n) {
        const u = n >>> 0;
        return [u & 0xff, (u >> 8) & 0xff, (u >> 16) & 0xff, (u >> 24) & 0xff];
    }

    function bytesToU32le(b4) {
        return b4[0] | (b4[1] << 8) | (b4[2] << 16) | (b4[3] << 24) >>> 0;
    }

    function toUnix64LE(d8) {
        let v = 0n;
        for (let i = 7; i >= 0; i -= 1) v = (v << 8n) | BigInt(d8[i]);
        return v;
    }

    function bytesToHex(u8) {
        return Array.from(u8, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
    }

    /** Текстовые поля ТМ-07 в регистрах — Windows-1251 (как в CorrReader / карте 50). */
    const CP1251_DECODER = (() => {
        try {
            return new TextDecoder('windows-1251');
        } catch (_e) {
            return new TextDecoder('iso-8859-5');
        }
    })();

    const CP1251_CHAR_TO_BYTE = (() => {
        const map = new Map();
        for (let b = 0; b < 256; b += 1) {
            const ch = CP1251_DECODER.decode(new Uint8Array([b]));
            if (ch.length === 1 && !map.has(ch)) map.set(ch, b);
        }
        return map;
    })();

    function decodeCp1251(bytes) {
        return CP1251_DECODER.decode(bytes).replace(/\0/g, ' ').trim();
    }

    function encodeCp1251(str, byteLen) {
        const buf = new Uint8Array(byteLen);
        let pos = 0;
        for (const ch of String(str ?? '')) {
            if (pos >= byteLen) break;
            const code = ch.codePointAt(0);
            if (code < 0x80) {
                buf[pos++] = code;
                continue;
            }
            const b = CP1251_CHAR_TO_BYTE.get(ch);
            if (b === undefined) throw new Error(`Символ «${ch}» недоступен в CP1251`);
            buf[pos++] = b;
        }
        return buf;
    }

    function modbusFnLabel(frame) {
        if (!frame || frame.length < 2) return '';
        const fn = frame[1];
        if (fn & 0x80) {
            const code = frame.length >= 3 ? frame[2] : 0;
            return `exc 0x${code.toString(16).toUpperCase()}`;
        }
        const names = { 0x03: 'read 0x03', 0x04: 'input 0x04', 0x10: 'write 0x10', 0x11: 'ident 0x11', 0x17: 'rw 0x17' };
        return names[fn] || `fn 0x${fn.toString(16).toUpperCase().padStart(2, '0')}`;
    }

    function formatFrameForLog(frame) {
        if (!frame || frame.length < 8) return bytesToHex(frame);
        if (frame[1] === 0x10) {
            const reg = ((frame[2] & 0xff) << 8) | (frame[3] & 0xff);
            const byteCount = frame[6];
            if (reg === (lkgConfig.reg & 0xffff) && byteCount === 4 && frame.length >= 13) {
                return (
                    bytesToHex(frame.slice(0, 7)) +
                    ' [ключ] ' +
                    bytesToHex(frame.slice(frame.length - 2))
                );
            }
        }
        return bytesToHex(frame);
    }

    function attachModbusTrace(device) {
        if (!device) return;
        device.onFrameExchange = (dir, frame) => {
            const tag = dir === 'tx' ? 'TX' : 'RX';
            const fn = modbusFnLabel(frame);
            const hex = formatFrameForLog(frame);
            clog(tag, fn, bytesToHex(frame));
            log(`<span class="font-monospace">${tag} ${fn}:</span> <span class="font-monospace">${hex}</span>`);
        };
    }

    function detachModbusTrace(device) {
        if (device) device.onFrameExchange = null;
    }

    /** Адрес holding-регистра Modbus (0…65535), как в xlsx: 0x0000, не 0x0. */
    function formatHoldingAddr(reg) {
        if (reg == null || !Number.isFinite(reg)) return '—';
        const n = reg & 0xffff;
        return `0x${n.toString(16).toUpperCase().padStart(4, '0')}`;
    }

    function parseLkgHexString(raw) {
        const arr = String(raw || '')
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .map((x) => parseInt(x, 16));
        if (arr.length !== 4 || arr.some((a) => !Number.isFinite(a) || a < 0 || a > 255)) {
            return null;
        }
        return arr;
    }

    /** 4 / 8 / 12 байт: accessKey, SaveLkg (Uint64), опционально CryptLkg. */
    function parseManufacturerLkgHex(raw) {
        const arr = String(raw || '')
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .map((x) => parseInt(x, 16));
        if (!arr.length || arr.some((a) => !Number.isFinite(a) || a < 0 || a > 255)) {
            return { accessKey: null, saveLkg: 0n };
        }
        if (arr.length === 4) {
            return { accessKey: arr, saveLkg: 0n };
        }
        if (arr.length === 8) {
            let saveLkg = 0n;
            for (let i = 0; i < 8; i += 1) {
                saveLkg |= BigInt(arr[i]) << BigInt(8 * i);
            }
            return { accessKey: arr.slice(0, 4), saveLkg };
        }
        if (arr.length >= 12) {
            let saveLkg = 0n;
            for (let i = 0; i < 8; i += 1) {
                saveLkg |= BigInt(arr[i]) << BigInt(8 * i);
            }
            return { accessKey: arr.slice(0, 4), saveLkg };
        }
        return { accessKey: null, saveLkg: 0n };
    }

    function ensureLkgConfigReady(opts) {
        if (lkgConfig.supplierKey) {
            return;
        }
        const allowMfg = !!(opts && opts.allowManufacturer);
        if (allowMfg && lkgConfig.manufacturerKey) {
            return;
        }
        // Открытый замок производителя (AutoPass) — Access/INIT можно обойти для FABRIC|CALIB.
        if (allowMfg && isMfgOptLockOpen()) {
            return;
        }
        throw new Error('Ключ ЛКГ поставщика не настроен (админка → ТМ-07). Запись без ключа запрещена.');
    }

    function applyLkgSettingsFromServer(settings) {
        const t = settings?.tm07 || {};
        const br = settings?.benchRegisters || {};
        const supplierRaw = t.supplierLkgHex || br.corrLkgHex || '';
        lkgConfig.supplierKey = parseLkgHexString(supplierRaw);
        const mfg = parseManufacturerLkgHex(t.manufacturerLkgHex || '');
        lkgConfig.manufacturerKey = mfg.accessKey;
        lkgConfig.manufacturerSaveLkg = mfg.saveLkg;
        if (t.regLkgHex) {
            const v = parseInt(String(t.regLkgHex).replace(/^0x/i, ''), 16);
            if (Number.isFinite(v) && v >= 0 && v <= 0xffff) {
                lkgConfig.reg = v & 0xffff;
            }
        }
        lkgConfig.initReg = K.REG_INIT_LKG;
        if (t.lkgDelayMs != null) {
            const d = parseInt(String(t.lkgDelayMs), 10);
            if (Number.isFinite(d) && d >= 0) lkgConfig.delayMs = d;
        }
        if (t.supplierLockPassword != null && String(t.supplierLockPassword).trim() !== '') {
            lockPasswords.supplier = String(t.supplierLockPassword);
        }
        if (t.manufacturerLockPassword != null && String(t.manufacturerLockPassword).trim() !== '') {
            lockPasswords.manufacturer = String(t.manufacturerLockPassword);
        }
        window.__paramLkgSupplierReady = !!lkgConfig.supplierKey;
        window.__paramLkgManufacturerReady = !!lkgConfig.manufacturerKey;
        const hexEl = el('paramLkgHex');
        if (hexEl) {
            hexEl.dataset.supplierReady = lkgConfig.supplierKey ? '1' : '0';
            hexEl.dataset.mfgReady = lkgConfig.manufacturerKey ? '1' : '0';
        }
        try {
            window.dispatchEvent(
                new CustomEvent('tm07-lkg-ready', {
                    detail: {
                        supplier: !!lkgConfig.supplierKey,
                        manufacturer: !!lkgConfig.manufacturerKey,
                    },
                })
            );
        } catch (_e) {}
    }

    function parseLkgReg() {
        const hidden = el('paramLkgReg')?.value;
        if (hidden && String(hidden).trim()) {
            const v = parseInt(String(hidden).replace(/^0x/i, ''), 16);
            if (!Number.isNaN(v) && v >= 0 && v <= 0xffff) {
                lkgConfig.reg = v & 0xffff;
            }
        }
        return lkgConfig.reg & 0xffff;
    }

    /** п.3 — при открытом опт. замке производителя batch не требует ключа в админке; LKG всё равно нужен. */
    const MFG_OPT_DIRECT_WRITE_IDS = new Set([3]);
    const MANUFACTURER_CALIB_WRITE_IDS = new Set([3, 4, 5]);

    function isMfgOptDirectWriteStep(step) {
        return !!(step && MFG_OPT_DIRECT_WRITE_IDS.has(step.id));
    }

    function isMfgOptLockOpen() {
        const lock = window.__paramLockStatus;
        if (!lock || lock.raw == null) {
            return false;
        }
        const raw = lock.raw & 0xffff;
        if (raw === LOCK_RAW_WRITE_READY) {
            return true;
        }
        // Bit2 — произв. опт.; bit4 — произв. RS485 (после AutoPass через КАО).
        return isLockBitOpen(raw, 2) || isLockBitOpen(raw, 4);
    }

    function isCalibLockOpen(raw) {
        return isLockBitOpen(raw, 0);
    }

    function isLockWriteReady(raw) {
        const r = raw & 0xffff;
        if (r === LOCK_RAW_WRITE_READY) {
            return true;
        }
        // Готово: калибр. + замок производителя (оптика или RS485).
        return isCalibLockOpen(r) && (isLockBitOpen(r, 2) || isLockBitOpen(r, 4));
    }

    function isManufacturerCalibWriteStep(step) {
        return !!(step && MANUFACTURER_CALIB_WRITE_IDS.has(step.id));
    }

    /** Запись без Access-ЛКГ: только при открытом замке производителя и FABRIC|CALIB шагах. */
    function canSkipLkgForStep(step) {
        if (!step) {
            return false;
        }
        if (!isMfgOptLockOpen()) {
            return false;
        }
        return !!(step.manufacturerOnly || isManufacturerCalibWriteStep(step));
    }

    function isManufacturerWriteUnlocked(step) {
        if (!step || !step.manufacturerOnly) {
            return false;
        }
        if (isMfgOptLockOpen()) {
            return true;
        }
        // п.3/4/5 в прошивке — WRITE_ACCESS_CALIB: достаточно открытого SA2.
        if (isManufacturerCalibWriteStep(step)) {
            const raw = window.__paramLockStatus && window.__paramLockStatus.raw;
            return raw != null && isCalibLockOpen(raw);
        }
        return false;
    }

    function hasManufacturerSaveLkg() {
        const v = lkgConfig.manufacturerSaveLkg;
        return v != null && v !== 0n && v !== 0;
    }

    /**
     * Состояние сессии ЛКГ на приборе.
     * CryptLkg (0x07B8) зависит от S/N и даты прибора; AccessLkg (0x07B6) сбрасывается после каждой записи.
     */
    const lkgSession = {
        sn: null,
        dateKey: null,
        saveLkg: null,
        crypt: null,
        inited: false,
        busy: false,
    };

    function invalidateLkgSession(why) {
        if (lkgSession.inited) {
            clog('LKG session invalidate', why || '', 'was SN', lkgSession.sn, 'date', lkgSession.dateKey);
        }
        lkgSession.sn = null;
        lkgSession.dateKey = null;
        lkgSession.saveLkg = null;
        lkgSession.crypt = null;
        lkgSession.inited = false;
    }

    function lkgDateKeyFromDate(d) {
        const pad2 = (n) => String(n).padStart(2, '0');
        return pad2(d.getUTCDate()) + pad2(d.getUTCMonth() + 1) + String(d.getUTCFullYear());
    }

    /**
     * SaveLkg для INIT 0x07B8: из админки или синтетика из ключа поставщика
     * (прошивка отвергает SaveLkg=0).
     */
    function resolveSaveLkgForInit() {
        if (hasManufacturerSaveLkg()) {
            return BigInt(lkgConfig.manufacturerSaveLkg);
        }
        if (!lkgConfig.supplierKey) {
            // Синтетика из ключа производителя (4 байта Access), если поставщика нет.
            if (lkgConfig.manufacturerKey) {
                let v = 0n;
                for (let i = 0; i < 4; i += 1) {
                    v |= BigInt(lkgConfig.manufacturerKey[i] & 0xff) << BigInt(8 * i);
                }
                v |= BigInt(0x54) << 32n;
                v |= BigInt(0x4d) << 40n;
                v |= BigInt(0x30) << 48n;
                v |= BigInt(0x37) << 56n;
                return v;
            }
            throw new Error('Нет SaveLkg: задайте ключ производителя или поставщика в админке → ТМ-07');
        }
        const key = lkgConfig.supplierKey;
        let v = 0n;
        for (let i = 0; i < 4; i += 1) {
            v |= BigInt(key[i] & 0xff) << BigInt(8 * i);
        }
        v |= BigInt(0x54) << 32n;
        v |= BigInt(0x4d) << 40n;
        v |= BigInt(0x30) << 48n;
        v |= BigInt(0x37) << 56n;
        return v;
    }

    async function readDeviceDateForLkg() {
        const dt = await dev.readDeviceDateTime(4000);
        if (!dt || !(dt.date instanceof Date) || Number.isNaN(dt.date.getTime())) {
            throw new Error('Дата/время прибора (0x008C) недоступны — ЛКГ не считаем с часов ПК');
        }
        return dt.date;
    }

    /**
     * INIT 0x07B8 под текущие S/N+дату прибора. Повторно не шлёт, если сессия ещё валидна.
     * @param {string} reason
     * @param {{ force?: boolean }} [opts]
     */
    async function beginLkgSession(reason, opts) {
        if (!dev || !dev.port) {
            throw new Error('КАО не подключён');
        }
        while (lkgSession.busy) {
            await new Promise((r) => setTimeout(r, 30));
        }
        lkgSession.busy = true;
        try {
            const allowManufacturer = !!(opts && opts.allowManufacturer);
            const saveOverride = opts && opts.saveLkg != null ? opts.saveLkg : null;
            const accessOverride = opts && opts.accessKey ? opts.accessKey : null;
            if (saveOverride == null && !accessOverride) {
                ensureLkgConfigReady({ allowManufacturer: allowManufacturer });
            }
            const force = !!(opts && opts.force);
            const sn = await readCurrentCorrectorSerialForLkg();
            const now = await readDeviceDateForLkg();
            const dateKey = lkgDateKeyFromDate(now);
            if (
                !force &&
                lkgSession.inited &&
                lkgSession.sn === sn &&
                lkgSession.dateKey === dateKey &&
                lkgSession.crypt
            ) {
                clog('LKG session reuse', reason || '', 'SN', sn, 'date', dateKey);
                return lkgSession;
            }

            let saveLkg = saveOverride != null ? BigInt(saveOverride) : resolveSaveLkgForInit();
            let crypt = K.computeCryptLkg(saveLkg, sn, now);
            if (!crypt) {
                saveLkg = (saveLkg + 1n) & 0xffffffffffffffffn;
                if (saveLkg === 0n) saveLkg = 1n;
                crypt = K.computeCryptLkg(saveLkg, sn, now);
            }
            if (!crypt) {
                throw new Error('CryptLkg=0 — прошивка отклонит INIT 0x07B8');
            }

            const accessKey = accessOverride || lkgConfig.supplierKey || lkgConfig.manufacturerKey;
            const reg = parseLkgReg();
            const initReg = lkgConfig.initReg & 0xffff;
            const dly = lkgConfig.delayMs;
            clog(
                'LKG session begin',
                reason || '',
                force ? 'force' : '',
                allowManufacturer ? 'mfg-ok' : '',
                'SN',
                sn,
                'date',
                dateKey,
                'SaveLkg',
                '0x' + saveLkg.toString(16),
                'CryptLkg',
                '0x' + crypt.toString(16)
            );
            log(
                'ЛКГ-сессия' +
                    (reason ? ' (' + reason + ')' : '') +
                    ': S/N ' +
                    sn +
                    ', дата ' +
                    dateKey +
                    ', Crypt 0x' +
                    crypt.toString(16)
            );

            // Только INIT — ключ Access пишем перед каждой записью параметра.
            const saveBytes = [...K.uint64BytesLE(saveLkg)];
            const cryptBytes = K.u32leBytes(crypt);
            await dev.writeMultiple(initReg & 0xffff, saveBytes.concat(cryptBytes), 4000);
            await new Promise((r) => setTimeout(r, dly));
            // Прогрев Access (не обязателен, но CorrReader так делает после init).
            if (accessKey) {
                await dev.writeLkgKey(accessKey, reg, 4000);
                await new Promise((r) => setTimeout(r, dly));
            }

            lkgSession.sn = sn;
            lkgSession.dateKey = dateKey;
            lkgSession.saveLkg = saveLkg;
            lkgSession.crypt = crypt;
            lkgSession.inited = true;
            return lkgSession;
        } finally {
            lkgSession.busy = false;
        }
    }

    /** @deprecated используйте beginLkgSession */
    async function ensureRuntimeLkgInit(reason) {
        return beginLkgSession(reason, { force: true });
    }

    function manufacturerAccessKeyForStep(step) {
        if (lkgConfig.manufacturerKey) return lkgConfig.manufacturerKey;
        if (step && step.manufacturerOnly && (isMfgOptLockOpen() || isManufacturerWriteUnlocked(step))) {
            return lkgConfig.supplierKey || null;
        }
        return null;
    }

    async function readCurrentCorrectorSerialForLkg() {
        const step3 = findStep(3);
        const reg = step3 && step3.reg != null ? step3.reg & 0xffff : 0x000f;
        const resp = await dev.readHolding(reg, 4, 3000);
        const b = resp.slice(3, 3 + resp[2]);
        if (b.length < 8) {
            throw new Error('Не удалось прочитать текущий S/N для ЛКГ (0x000F)');
        }
        return String(toUnix64LE(new Uint8Array(b.slice(0, 8))));
    }

    function isLockBitOpen(raw, bit) {
        return ((raw >>> bit) & 1) === 1;
    }

    function describeLockStatus(raw) {
        const labels = [
            { bit: 0, name: 'Калибровочный (SA2)', short: 'К' },
            { bit: 1, name: 'Поставщик (оптика)', short: 'По' },
            { bit: 2, name: 'Производитель (оптика)', short: 'Мо' },
            { bit: 3, name: 'Поставщик (RS485)', short: 'Пр' },
            { bit: 4, name: 'Производитель (RS485)', short: 'Мр' },
        ];
        return labels
            .map(function (item) {
                return item.name + ': ' + (isLockBitOpen(raw, item.bit) ? 'ОТКР' : 'закр');
            })
            .join(' · ');
    }

    function lockRawHex(raw) {
        return '0x' + (raw & 0xffff).toString(16).padStart(4, '0');
    }

    function lockWriteHint(raw) {
        const cur = lockRawHex(raw);
        const r = raw & 0xffff;
        if (isLockWriteReady(r)) {
            return '';
        }
        if (r === LOCK_RAW_SUPPLIER_OPT_ONLY && !isMfgOptLockOpen()) {
            return (
                `Состояние ${cur} (открыт только замок поставщика) — запись с LKG даёт 0x0B. ` +
                'Нужен замок производителя: AutoPass откроет 0x06A7 через КАО.'
            );
        }
        if (r === 0x0001) {
            return (
                `Состояние: открыт только калибровочный замок. ` +
                `Нужен калибровочный + производитель. AutoPass откроет замок через КАО (0x06A7).`
            );
        }
        if (!isCalibLockOpen(r)) {
            return 'Калибровочный замок закрыт — запись может быть недоступна (удерживайте SA2 ≥6 с на приборе).';
        }
        return (
            `Состояние ${cur} — для пакетной записи нужен замок производителя. ` +
            'Нажмите «Проверить замки» или повторите запись — AutoPass откроет 0x06A7 через КАО.'
        );
    }

    function lockPreflightHtml(raw) {
        const hint = lockWriteHint(raw) || '';
        return (
            `<strong>Запись остановлена: замки ${lockRawHex(raw)}, нужен замок производителя.</strong> ` +
            (hint ||
                'AutoPass через КАО (0x06A7) не открыл доступ. Проверьте калибровочный замок (SA2) и пароль замка в админке.')
        );
    }

    /** Краткие метки битов замка (только для title/tooltip). */
    function lockBitsShortLabel(raw) {
        const bits = [
            ['К', 0],
            ['По', 1],
            ['Мо', 2],
            ['Пр', 3],
            ['Мр', 4],
        ];
        return bits
            .map(function (pair) {
                const open = isLockBitOpen(raw, pair[1]);
                return pair[0] + (open ? '✓' : '·');
            })
            .join(' ');
    }

    function updateLockStatusUi(lock) {
        const badge = el('paramLockStatus');
        const banner = el('paramLockBanner');
        if (!lock || lock.raw == null) {
            if (badge) {
                badge.textContent = 'Закрыт*';
                badge.className = 'badge rounded-pill text-bg-secondary param-lock-badge';
                badge.title = '';
            }
            if (banner) {
                banner.classList.add('d-none');
                banner.innerHTML = '';
            }
            return;
        }
        const raw = lock.raw & 0xffff;
        const ready = isLockWriteReady(raw);
        if (badge) {
            // Без «К По Мо Пр · готово» — только статус.
            badge.textContent = ready ? 'Открыт' : 'Закрыт*';
            badge.className =
                'badge rounded-pill param-lock-badge ' + (ready ? 'text-bg-success' : 'text-bg-danger');
            badge.title = describeLockStatus(raw) + ' · ' + lockBitsShortLabel(raw);
        }
        if (banner) {
            if (ready) {
                banner.classList.remove('d-none', 'alert-warning');
                banner.classList.add('alert', 'alert-success');
                banner.innerHTML =
                    '<i class="bi bi-unlock me-1"></i><strong>Замки готовы к записи</strong>: ' +
                    escHtml(describeLockStatus(raw));
            } else {
                banner.classList.remove('d-none', 'alert-success');
                banner.classList.add('alert', 'alert-warning');
                banner.innerHTML =
                    '<i class="bi bi-lock me-1"></i><strong>Замки</strong>: ' +
                    escHtml(describeLockStatus(raw)) +
                    '. Для записи нужен замок производителя — AutoPass откроет его через КАО.';
            }
        }
    }

    function escHtml(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    async function refreshLockStatus() {
        const lock = await dev.readLockStatus(REG_STATUS_LOCK);
        window.__paramLockStatus = lock;
        clog('lock', formatHoldingAddr(lock.reg), 'raw=0x' + lock.raw.toString(16), describeLockStatus(lock.raw));
        updateLockStatusUi(lock);
        return lock;
    }

    /**
     * AutoPass как в CorrReader: замок производителя через 0x06A7
     * (пароль = ДДММЧЧ прибора +0x20, не строка «-22»).
     * Поставщик (0x06A4) — только если производитель уже открыт.
     * @param {{force?:boolean}} [opts] force=true — открывать даже если уже «готово».
     */
    async function runAutoPassLocks(opts) {
        const force = !!(opts && opts.force);
        // Не использовать isKaoConnected(): во время doConnect connectBusy=true, а AutoPass как раз нужен в startup.
        if (!dev || !dev.port) {
            throw new Error('КАО не подключён');
        }
        let lock = await refreshLockStatus();
        if (!force && isLockWriteReady(lock.raw)) {
            clog('AutoPass skip', 'already ready', lockRawHex(lock.raw));
            return lock;
        }
        const mfgReg = K.REG_OPEN_MANUFACTURER_LOCK;
        log('AutoPass: открытие замка производителя через КАО (' + formatHoldingAddr(mfgReg) + ')…');
        try {
            const opened = await dev.openManufacturerLock(4000);
            const stamp =
                formatUnixMoscow(opened.unix).replace(', ', ' ').replace(/:\d{2}$/, ':xx') +
                ' (unix ' +
                opened.unix +
                ')';
            const mode = opened.mode || 'utc';
            clog('AutoPass TX', formatHoldingAddr(mfgReg), 'dt', stamp, 'pwdMode', mode, 'pwd', bytesToHex(opened.bytes));
            log(
                'AutoPass: пароль по дате/времени прибора ' +
                    stamp +
                    ' [' +
                    mode +
                    '], кадр ' +
                    bytesToHex(opened.bytes)
            );
            await new Promise((r) => setTimeout(r, 200));
            lock = await refreshLockStatus();
            if (isMfgOptLockOpen()) {
                log('Замок производителя удачно открыт. (' + lockRawHex(lock.raw) + ')');
            } else {
                log(
                    '<strong>AutoPass:</strong> ответ на 0x06A7 принят, но бит производителя ещё закрыт (' +
                        lockRawHex(lock.raw) +
                        '). Проверьте калибровочный замок (SA2) и часы прибора (0x008C).'
                );
            }
        } catch (e) {
            const msg = e.message || String(e);
            clogErr('AutoPass mfg', e);
            log('<strong>AutoPass 0x06A7:</strong> ' + msg);
        }

        // Поставщик (0x06A4) нужен только если производитель ещё закрыт.
        // При уже открытом mfg (типичный путь записи PRM) "-22" часто даёт Modbus 0x3 — не шумим.
        if (
            (!isMfgOptLockOpen() || force) &&
            !isLockBitOpen(lock.raw, 1) &&
            !isLockBitOpen(lock.raw, 3)
        ) {
            const supPwd = lockPasswords.supplier || DEFAULT_LOCK_PASSWORD;
            const supReg = K.REG_OPEN_SUPPLIER_LOCK;
            try {
                clog('AutoPass TX', formatHoldingAddr(supReg), 'pwd', supPwd);
                await dev.openAccessLock(supReg, supPwd, 4000);
                await new Promise((r) => setTimeout(r, 150));
                lock = await refreshLockStatus();
                if (isLockBitOpen(lock.raw, 1) || isLockBitOpen(lock.raw, 3)) {
                    log('Замок поставщика открыт. (' + lockRawHex(lock.raw) + ')');
                }
            } catch (e) {
                clog('AutoPass supplier skip', e && e.message ? e.message : e);
            }
        } else if (isMfgOptLockOpen() && !isLockBitOpen(lock.raw, 1) && !isLockBitOpen(lock.raw, 3)) {
            clog('AutoPass supplier skip — производитель уже открыт (' + lockRawHex(lock.raw) + ')');
        }

        return lock;
    }

    /** Закрыть калибровочный замок (0x06AA ← 0). */
    async function runCloseLocks() {
        if (!dev || !dev.port) {
            throw new Error('КАО не подключён');
        }
        log('Закрытие калибровочного замка (0x06AA ← 0)…');
        if (typeof dev.closeCalibrationLock !== 'function') {
            throw new Error('Драйвер КАО без closeCalibrationLock — обновите страницу (Ctrl+F5)');
        }
        await dev.closeCalibrationLock(4000);
        await new Promise((r) => setTimeout(r, 150));
        const lock = await refreshLockStatus();
        if (isCalibLockOpen(lock.raw)) {
            log(
                '<strong>Калибровочный замок всё ещё открыт</strong> (' +
                    lockRawHex(lock.raw) +
                    '). Закройте SA2 на приборе или повторите.'
            );
        } else {
            log('Калибровочный замок закрыт. (' + lockRawHex(lock.raw) + ')');
        }
        log(
            'Замки поставщика/производителя сессионные — сбрасываются при отключении КАО (кнопка «Отключить»).'
        );
        return lock;
    }

    /**
     * Preflight перед WRITE ALL: AutoPass через КАО, затем проверка замка производителя.
     * @returns {{ ok: boolean, lock: object|null, forced?: boolean }}
     */
    async function ensureLockWriteReady(opts) {
        const o = opts || {};
        let lock;
        try {
            lock = await refreshLockStatus();
        } catch (e) {
            const msg = e.message || String(e);
            log('<strong>Не удалось прочитать замки 0x0028:</strong> ' + msg);
            clogErr('lock preflight', e);
            updateLockStatusUi(null);
            return { ok: false, lock: null };
        }
        if (!isLockWriteReady(lock.raw) && o.skipAutoPass !== true) {
            try {
                lock = await runAutoPassLocks();
            } catch (e) {
                clogErr('AutoPass', e);
                log('<strong>AutoPass:</strong> ' + (e.message || String(e)));
            }
        }
        if (isLockWriteReady(lock.raw)) {
            clog('lock ok', lockRawHex(lock.raw), describeLockStatus(lock.raw));
            return { ok: true, lock };
        }
        const html = lockPreflightHtml(lock.raw);
        log(html);
        clog('lock block', lockRawHex(lock.raw), describeLockStatus(lock.raw));
        return { ok: false, lock };
    }

    async function warnLockBeforeWrite() {
        const lock = window.__paramLockStatus || (await refreshLockStatus());
        updateLockStatusUi(lock);
        const hint = lockWriteHint(lock.raw);
        if (hint) {
            log('<strong>Внимание по замкам:</strong> ' + hint);
            clog('lock warn', lockRawHex(lock.raw), describeLockStatus(lock.raw));
        } else if (lock.raw === LOCK_RAW_WRITE_READY) {
            clog('lock ok', lockRawHex(lock.raw), describeLockStatus(lock.raw));
        } else {
            clog('lock', lockRawHex(lock.raw), describeLockStatus(lock.raw));
        }
        return lock;
    }

    function isLockBlocked0b(msg, lock) {
        if (!/0xb|недопустимое значение лкг/i.test(String(msg ?? ''))) {
            return false;
        }
        const raw = lock && lock.raw != null ? lock.raw & 0xffff : null;
        return raw === 0x0001 || raw === LOCK_RAW_SUPPLIER_OPT_ONLY || (raw != null && !isLockWriteReady(raw));
    }

    function isModbusLockError(msg) {
        return /0x5|замок|доступ закрыт|exception\s+0x5/i.test(String(msg ?? ''));
    }

    function isModbusWriteAccessError(msg) {
        const s = String(msg ?? '');
        return isModbusLockError(s) || /exception\s+0x0?b\b|недопустимое значение лкг/i.test(s);
    }

    async function doWriteStepWithLockRetry(step, val, regOverride) {
        try {
            await doWriteStep(step, val, regOverride);
        } catch (e) {
            if (isModbusWriteAccessError(e.message)) {
                await refreshLockStatus();
                const lock = window.__paramLockStatus;
                const hint = lock ? lockWriteHint(lock.raw) : '';
                if (hint) log('Подсказка по замкам: ' + hint);
            }
            throw e;
        }
    }

    function lkgKeyForStep(step) {
        if (step.manufacturerOnly) {
            if (lkgConfig.manufacturerKey) {
                return lkgConfig.manufacturerKey;
            }
            if (isManufacturerWriteUnlocked(step) && lkgConfig.supplierKey) {
                // Замок производителя открыт — Access поставщика часто достаточно.
                return lkgConfig.supplierKey;
            }
            if (isManufacturerWriteUnlocked(step)) {
                return null;
            }
            throw new Error(
                'Регистр производителя — задайте ключ производителя в админке (ТМ-07) или откройте замок через AutoPass КАО (0x06A7).'
            );
        }
        ensureLkgConfigReady();
        /** п.78 — переключение уровня доступа; на приборе часто только ключом производителя. */
        if (step.id === 78 && lkgConfig.manufacturerKey) {
            return lkgConfig.manufacturerKey;
        }
        return lkgConfig.supplierKey;
    }

    /** п.2 — DEFAULT_SETTINGS (0x06B4): команда 2 без LKG; не в автопакете PRM. */
    const DEFAULT_SETTINGS_REG = 0x06b4;
    const DEFAULT_SETTINGS_CMD_VALUE = 2;
    /** Финал (п.321) — DEFAULT_SETTINGS команда 3 (сохранить во Flash): строго один раз за сессию. */
    const DEFAULT_SETTINGS_CMD3_VALUE = 3;
    /** CorrReader: ответ на 0x06B4 ~1,5–2 с. */
    const DEFAULT_SETTINGS_TIMEOUT_MS = 8000;
    /** Команда 3 (Flash): эха 0x10 может не быть, повтор опасен. */
    const DEFAULT_SETTINGS_CMD3_TIMEOUT_MS = 25000;
    const DEFAULT_SETTINGS_POST_DELAY_MS = 1500;
    const DEFAULT_SETTINGS_CMD3_POST_DELAY_MS = 4000;

    /** Сброс в начале (п.2) — входит в автопакет «Параметризировать» первым по порядку. */
    function isBootstrapDefaultSettings(step) {
        return step && step.id === 2;
    }

    /** Любая команда DEFAULT_SETTINGS (п.2 или финал команда 3). */
    function isDefaultSettingsCmd(step) {
        return (
            isBootstrapDefaultSettings(step) ||
            (step && step.defaultSettingsCmd != null && Number(step.defaultSettingsCmd) > 0)
        );
    }

    function defaultSettingsCmdValue(step) {
        if (step && step.defaultSettingsCmd != null && Number.isFinite(Number(step.defaultSettingsCmd))) {
            return Number(step.defaultSettingsCmd) | 0;
        }
        return DEFAULT_SETTINGS_CMD_VALUE;
    }

    /** Кадр как CorrReader: 01 10 06 B4 00 01 02 02 00 … (u16 LE). */
    function defaultSettingsPayloadBytes(val) {
        const n = val & 0xffff;
        return [n & 0xff, (n >> 8) & 0xff];
    }

    function assertDefaultSettingsWriteResponse(resp, reg) {
        if (!resp || resp.length < 8) {
            throw new Error('Короткий ответ DEFAULT_SETTINGS');
        }
        if (resp[1] !== 0x10) {
            throw new Error(`DEFAULT_SETTINGS: ожидался ответ 0x10, получен 0x${resp[1].toString(16)}`);
        }
        const addr = ((resp[2] & 0xff) << 8) | (resp[3] & 0xff);
        const cnt = ((resp[4] & 0xff) << 8) | (resp[5] & 0xff);
        if (addr !== (reg & 0xffff)) {
            throw new Error(
                `DEFAULT_SETTINGS: адрес ответа ${formatHoldingAddr(addr)}, ожидался ${formatHoldingAddr(reg)}`
            );
        }
        if (cnt !== 1) {
            throw new Error(`DEFAULT_SETTINGS: в ответе ${cnt} рег., ожидался 1`);
        }
    }

    function defaultSettingsLockReady(lock) {
        if (!lock || lock.raw == null) {
            return false;
        }
        return isMfgOptLockOpen();
    }

    function defaultSettingsLockError(lock) {
        const raw = lock && lock.raw != null ? lock.raw & 0xffff : 0;
        const hint = lockWriteHint(raw);
        return (
            `DEFAULT_SETTINGS (п.2, команда ${DEFAULT_SETTINGS_CMD_VALUE}): замки ${lockRawHex(raw)} — нужен замок производителя. ` +
            'Подключите КАО — AutoPass откроет 0x06A7 автоматически.' +
            (hint ? ' ' + hint : '')
        );
    }

    /** Паспорт (опционально) + замки перед командой (как CorrReader перед записью 0x06B4). */
    async function ensureDeviceContextForDefaultSettings(options) {
        const skipPassport = !!(options && options.skipPassport);
        if (!skipPassport && !window.__paramDevicePassport) {
            log('Считывание электронного паспорта устройства');
            const passport = await probeModbusLink(4500);
            if (!passport) {
                throw new Error('Нет ответа на identify');
            }
            window.__paramDevicePassport = passport;
            applyDeviceMapVersion(passport.mapVersion);
            if (passport.name) log('Наименование: ' + passport.name);
            if (passport.fwVersion) log('Версия ПО: ' + passport.fwVersion);
            if (passport.serial) log('Заводской номер: ' + passport.serial);
            log('Версия карты регистров: ' + passport.mapVersion);
            log('Карта регистров удачно загружена.');
        }
        log('Проверка статуса замков.');
        const lock = await refreshLockStatus();
        log('Статус замков: ' + describeLockStatus(lock.raw) + ' (' + lockRawHex(lock.raw) + ')');
        log('Статус замков считан удачно.');
        return lock;
    }

    async function waitModbusIdle(timeoutMs) {
        const deadline = Date.now() + (timeoutMs || 120000);
        while (batchParamRunning || connectBusy) {
            if (Date.now() > deadline) {
                throw new Error('КАО занят другой операцией — повторите через несколько секунд');
            }
            await new Promise((r) => setTimeout(r, 120));
        }
    }

    async function waitForDeviceAfterSettingsFlash(maxMs) {
        const deadline = Date.now() + (maxMs || 20000);
        await new Promise((r) => setTimeout(r, 1500));
        let lastErr = null;
        while (Date.now() < deadline) {
            try {
                await recoverAfterCommError();
                const passport = await probeModbusLink(3500);
                if (passport) {
                    window.__paramDevicePassport = passport;
                    log('Связь после DEFAULT_SETTINGS (команда 3) восстановлена.');
                    return passport;
                }
            } catch (e) {
                lastErr = e;
            }
            await new Promise((r) => setTimeout(r, 700));
        }
        throw new Error(
            'DEFAULT_SETTINGS (команда 3): прибор не ответил после сохранения во Flash' +
                (lastErr && lastErr.message ? ' (' + lastErr.message + ')' : '')
        );
    }

    async function doWriteDefaultSettingsCmd(step, options) {
        const s = step || findStep(2);
        if (!s || !s.reg) {
            throw new Error('DEFAULT_SETTINGS: шаг не найден');
        }
        assertModbusReady();
        const opts = options || {};
        const cmdVal = opts.cmdValue != null ? Number(opts.cmdValue) | 0 : defaultSettingsCmdValue(s);
        const nested = !!opts.nested || batchParamRunning;
        // Команда 2 (сброс) — один раз за сессию (ручной запуск, force=false);
        // команда 3 (save flash) — строго один раз за сессию, независимо от force.
        if (cmdVal === DEFAULT_SETTINGS_CMD_VALUE && window.__tm07DefaultSettingsApplied && !opts.force) {
            log('DEFAULT_SETTINGS уже выполнена в этой сессии — пропуск.');
            return { ok: true, value: cmdVal, skipped: true };
        }
        if (cmdVal === DEFAULT_SETTINGS_CMD3_VALUE && window.__tm07DefaultSettingsCmd3Applied) {
            log('DEFAULT_SETTINGS (команда 3, сохранение во Flash) уже выполнена в этой сессии — пропуск.');
            return { ok: true, value: cmdVal, skipped: true };
        }
        if (!nested) {
            await waitModbusIdle(60000);
            batchParamRunning = true;
            setBatchParamButtonsDisabled(true);
        }
        try {
            const lock = await ensureDeviceContextForDefaultSettings({ skipPassport: !!opts.skipPassport });
            if (!defaultSettingsLockReady(lock)) {
                throw new Error(defaultSettingsLockError(lock));
            }

            // DEFAULT_SETTINGS — без LKG. На чистом корректоре CryptLkg часто недоступен.
            try {
                await beginLkgSession('DEFAULT_SETTINGS');
            } catch (e) {
                clog('LKG session before DEFAULT_SETTINGS skipped', e && e.message ? e.message : e);
                log(
                    '<strong>DEFAULT_SETTINGS без ЛКГ-сессии</strong> (нормально для чистого корректора): ' +
                        (e.message || String(e))
                );
            }

            const r = (s.reg != null ? s.reg : DEFAULT_SETTINGS_REG) & 0xffff;
            const val = cmdVal;
            const title = s.title || 'DEFAULT_SETTINGS';
            const dataBytes = defaultSettingsPayloadBytes(val);
            const isCmd3 = cmdVal === DEFAULT_SETTINGS_CMD3_VALUE;
            const timeoutMs = isCmd3 ? DEFAULT_SETTINGS_CMD3_TIMEOUT_MS : DEFAULT_SETTINGS_TIMEOUT_MS;
            const writeRetries = isCmd3 ? 0 : 1;

            log(`<<< - Send data. [${formatHoldingAddr(r)}](${title})`);
            log(`Запись значения: ${val}`);
            clog(
                'WRITE →',
                'п.' + s.id,
                formatHoldingAddr(r),
                'DEFAULT_SETTINGS',
                val,
                bytesToHex(new Uint8Array(dataBytes))
            );

            let resp;
            let noEcho = false;
            try {
                resp = await dev.writeMultiple(r, dataBytes, timeoutMs, writeRetries);
            } catch (e) {
                if (isCmd3 && /нет ответа|timeout|время/i.test(String(e.message || e))) {
                    noEcho = true;
                    log(
                        '[' +
                            s.id +
                            '] DEFAULT_SETTINGS (команда 3): нет эха 0x10 — прибор сохраняет настройки во Flash. Ждём связь…'
                    );
                    clog('WRITE', 'п.' + s.id, 'DEFAULT_SETTINGS cmd3 no echo — wait device');
                    await recoverAfterCommError();
                    await waitForDeviceAfterSettingsFlash();
                } else if (isModbusWriteAccessError(e.message) || isLkgValueError(e.message)) {
                    await refreshLockStatus();
                    if (defaultSettingsLockReady(window.__paramLockStatus || lock)) {
                        log('DEFAULT_SETTINGS: повтор после обновления ЛКГ-сессии…');
                        invalidateLkgSession('DEFAULT_SETTINGS retry');
                        try {
                            await beginLkgSession('DEFAULT_SETTINGS retry', { force: true });
                        } catch (_e) {}
                        await new Promise((resolve) => setTimeout(resolve, 600));
                        try {
                            resp = await dev.writeMultiple(r, dataBytes, timeoutMs);
                        } catch (e2) {
                            if (isLkgValueError(e2.message)) {
                                throw new Error(
                                    'DEFAULT_SETTINGS: 0x0B (ЛКГ). Повторите запись после обновления страницы; S/N прибора мог смениться.'
                                );
                            }
                            throw e2;
                        }
                    } else {
                        throw new Error(defaultSettingsLockError(window.__paramLockStatus || lock));
                    }
                } else {
                    throw e;
                }
            }
            if (!noEcho) {
                assertDefaultSettingsWriteResponse(resp, r);
                log(`>>> - Received data. [${formatHoldingAddr(r)}](${title})`);
                log(`Записано значение: ${val}`);
            } else {
                log(`Записано значение: ${val} (эхо не пришло — Flash)`);
            }

            const vin = el(stepInputId(s));
            if (vin) {
                vin.value = String(val);
            }
            const out = el(stepOutId(s));
            if (out) {
                setOutStatus(out, 'ok', 'ok');
            }

            const postMs = isCmd3 ? DEFAULT_SETTINGS_CMD3_POST_DELAY_MS : DEFAULT_SETTINGS_POST_DELAY_MS;
            if (postMs > 0) {
                await new Promise((resolve) => setTimeout(resolve, postMs));
            }

            clog('WRITE ←', 'п.' + s.id, 'DEFAULT_SETTINGS ok', noEcho ? 'no echo' : formatFrameForLog(resp));
            if (cmdVal === DEFAULT_SETTINGS_CMD_VALUE) {
                window.__tm07DefaultSettingsApplied = true;
                // После сброса CryptLkg/S/N могут смениться.
                invalidateLkgSession('после DEFAULT_SETTINGS');
            } else if (cmdVal === DEFAULT_SETTINGS_CMD3_VALUE) {
                window.__tm07DefaultSettingsCmd3Applied = true;
            }
            return { ok: true, value: val };
        } finally {
            if (!nested) {
                batchParamRunning = false;
                setBatchParamButtonsDisabled(false);
            }
        }
    }
    function batchWriteSkipReason(step) {
        // п.2 DEFAULT_SETTINGS пишется в автопакете (см. isDefaultSettingsCmd в runWriteAllSteps).
        // После прошивки — не сбрасываем настройки повторно.
        if (isBootstrapDefaultSettings(step) && window.__tm07SkipDefaultSettingsAfterFlash) {
            return 'DEFAULT_SETTINGS после прошивки не выполняем';
        }
        if (isSensorMemoryCmd(step) && !shouldWriteSensorMemoryCmd(step)) {
            return 'sensor memory cmd (нет S/N датчика / QR)';
        }
        // п.78 пишем из формы (самост./комплекс). Временный доступ к меню 2/3 — отдельно в ensureSupplierAccessLevel.
        // Каналы перепада / TT — не пишем, если в заказе нет соответствующего датчика.
        const Ops = window.TM07_WORKBENCH_OPS;
        const equip =
            Ops && typeof Ops.getEquipmentFromOrder === 'function'
                ? Ops.getEquipmentFromOrder()
                : { hasPpd: false, hasPttp: false };
        // п.62 тип перепадника: только 1|2|3. Без ППД не пишем (0 → exception 0x03).
        // п.63=0 пишем — выключить канал. п.67=0 — выключить TT.
        const dpIds = [10, 11, 18, 46, 47, 48, 49, 62, 64, 65, 66, 215, 216, 223];
        const ttIds = [12, 13, 19, 50, 51, 52, 53, 68, 217, 218, 224];
        if (!equip.hasPpd && dpIds.indexOf(step.id) >= 0) {
            return 'перепад не в заказе';
        }
        if (!equip.hasPttp && ttIds.indexOf(step.id) >= 0) {
            return 'температура ТП не в заказе';
        }
        if (step.id === 62) {
            const v = String((el('val_62') && el('val_62').value) || '').trim();
            if (!/^[123]$/.test(v)) {
                return 'п.62 тип перепадника только 1|2|3';
            }
        }
        // п.228 (S/N блока телеметрии) пишем, только если заполнено (штрихкод БПЭК при .БТ или из 1С).
        if (step.id === 228) {
            const v228 = String((el('val_228') && el('val_228').value) || '').trim().replace(/\D/g, '');
            if (!v228) {
                return 'п.228 пусто (нет штрихкода БПЭК / значения из заказа)';
            }
        }
        // п.200 — для одиночного корректора в режиме «+ комплекс» наименование не пишем.
        if (
            step.id === 200 &&
            Ops &&
            typeof Ops.shouldSkipComplexName === 'function' &&
            Ops.shouldSkipComplexName()
        ) {
            return 'п.200 наименование комплекса не пишется (заказ только на корректор)';
        }
        // п.227 — без .БТ в заказе не пишем.
        if (
            step.id === 227 &&
            Ops &&
            typeof Ops.shouldSkipTelemetryName === 'function' &&
            Ops.shouldSkipTelemetryName()
        ) {
            return 'п.227 без .БТ в заказе не пишется';
        }
        if (step.readOnly) {
            return 'только чтение';
        }
        return null;
    }

    async function writeLkgKeyForStep(step) {
        const lkg = lkgKeyForStep(step);
        if (!lkg) {
            clog('LKG arm skip', `п.${step.id}`, 'нет Access-ключа, замок открыт');
            return;
        }
        const reg = parseLkgReg();
        const dly = lkgConfig.delayMs;
        clog('LKG arm', `п.${step.id}`, formatHoldingAddr(reg));
        await dev.writeLkgKey(lkg, reg, writeTimeoutMsForStep(step));
        await new Promise((r) => setTimeout(r, dly));
    }

    /**
     * Перед записью параметра: сессия CryptLkg актуальна + Access-ключ на 0x07B6.
     * Access сбрасывается прошивкой после каждой успешной записи — ключ пишем каждый раз.
     */
    async function ensureLkgIf(step) {
        if (!step.writeLkg) return;
        if (canSkipLkgForStep(step)) {
            clog('LKG skip', `п.${step.id}`, 'замок производителя открыт (FABRIC|CALIB)');
            return;
        }
        const raw = window.__paramLockStatus && window.__paramLockStatus.raw;
        const mfgStep = !!(step.manufacturerOnly || isManufacturerCalibWriteStep(step));
        if (isManufacturerCalibWriteStep(step) || step.manufacturerOnly) {
            if (!(raw != null && isCalibLockOpen(raw)) && !isMfgOptLockOpen()) {
                throw new Error(
                    `[${step.id}] нужен открытый калибровочный замок (SA2) или замок производителя (AutoPass)`
                );
            }
            try {
                await beginLkgSession('перед п.' + step.id, { allowManufacturer: true });
            } catch (e) {
                // Как CorrReader: при открытом SA2/производителе достаточно Access на 0x07B6.
                if ((raw != null && isCalibLockOpen(raw)) || isMfgOptLockOpen()) {
                    clog('LKG session init skip', `п.${step.id}`, 'lock open', e.message || e);
                } else {
                    throw e;
                }
            }
            await writeLkgKeyForStep(step);
            return;
        }
        await beginLkgSession('перед п.' + step.id, { allowManufacturer: mfgStep });
        await writeLkgKeyForStep(step);
    }

    function isLkgValueError(msg) {
        return /0x0?b\b|недопустимое значение лкг/i.test(String(msg ?? ''));
    }

    /**
     * Запись с одним автоповтором при 0x0B (устаревший CryptLkg / смена S/N или даты).
     */
    async function writeWithLkgRetry(step, writeFn) {
        await ensureLkgIf(step);
        try {
            return await writeFn();
        } catch (e) {
            if (!step.writeLkg || !isLkgValueError(e.message)) {
                throw e;
            }
            clog('LKG 0x0B retry', `п.${step.id}`, e.message);
            log(`[${step.id}] 0x0B — обновляю ЛКГ-сессию и повторяю…`);
            invalidateLkgSession('0x0B на п.' + step.id);
            await beginLkgSession('retry п.' + step.id, { force: true });
            await writeLkgKeyForStep(step);
            return await writeFn();
        }
    }

    function valuesRoughlyEqual(expected, actual) {
        const a = String(expected ?? '')
            .trim()
            .replace(',', '.');
        const b = String(actual ?? '')
            .trim()
            .replace(',', '.');
        if (!a || !b) {
            return false;
        }
        const na = Number(a);
        const nb = Number(b);
        if (Number.isFinite(na) && Number.isFinite(nb)) {
            return Math.abs(na - nb) < 0.011;
        }
        return a.toLowerCase() === b.toLowerCase();
    }

    /**
     * Отпечаток основных: диапазоны + состав газа/Q + S/N.
     * Все непустые поля из списка должны совпасть; минимум — п.6–9.
     */
    async function isMainSectionAlreadyOnDevice() {
        // 6–9 диапазоны; 23/24 CO2/N2; 28/29 Qmin/Qmax; 3 S/N (если задан)
        const fingerprintIds = [6, 7, 8, 9, 23, 24, 28, 29, 3];
        let compared = 0;
        let rangeCompared = 0;
        for (const sid of fingerprintIds) {
            const step = findStep(sid);
            const inp = el('val_' + sid);
            if (!step || !inp) {
                continue;
            }
            const expected = String(inp.value || '').trim();
            if (!expected) {
                continue;
            }
            if (sid === 6 || sid === 7) {
                const expectedNum = parseFloat(expected.replace(',', '.'));
                if (!Number.isFinite(expectedNum) || expectedNum <= 0) {
                    return false;
                }
            }
            try {
                const actual = await doReadStep(step, null, { updateInput: false });
                if (!valuesRoughlyEqual(expected, actual)) {
                    clog('main fingerprint miss', 'п.' + sid, 'ожид', expected, 'факт', actual);
                    return false;
                }
                compared += 1;
                if (sid >= 6 && sid <= 9) {
                    rangeCompared += 1;
                }
            } catch (e) {
                clog('main fingerprint read fail', 'п.' + sid, e && e.message ? e.message : e);
                return false;
            }
        }
        return rangeCompared >= 4 && compared >= 4;
    }

    function regCountForType(t) {
        if (t === 'f' || t === 'u' || t === 'dt') return 2;
        if (t === '6' || t === 't' || t === 'q' || t === 'd') return 4;
        if (t === 's') return 10;
        if (t === 'c32') return 16;
        if (t === 'w') return 1;
        return 2;
    }

    function regCountForStep(step) {
        if (step.regCount != null && Number.isFinite(step.regCount)) return step.regCount;
        return regCountForType(step.type);
    }

    function parseFloat64LE(data8) {
        if (data8.length < 8) throw new Error('Нужно 8 байт double');
        const buf = new ArrayBuffer(8);
        const view = new DataView(buf);
        for (let i = 0; i < 8; i += 1) view.setUint8(i, data8[i]);
        return view.getFloat64(0, true);
    }

    function float64BytesLE(value) {
        const buf = new ArrayBuffer(8);
        const view = new DataView(buf);
        view.setFloat64(0, value, true);
        return new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7].map((i) => view.getUint8(i)));
    }

    function formatDecimal2(n) {
        const x = Number(n);
        if (!Number.isFinite(x)) return String(n);
        return x.toFixed(2);
    }

    /** Единица для подписи справа от поля (в корректор не пишется). */
    function unitForStep(step) {
        if (!step) return '';
        if (step.unit) return String(step.unit);
        const hint = String(step.hint || '').trim();
        if (/^(кПа|°C|%|м3\/ч|м³\/ч|кг\/м3|кг\/м³|Па|бар|мс|мкА|мА|мм|с)$/i.test(hint)) {
            return hint.replace(/м3/g, 'м³');
        }
        const title = String(step.title || '');
        // Тип / режим / серийный номер / статусный вход — не измеряемая величина, единицу не показываем.
        if (/серийн|режим измерения|тип преобразователя|тип статусного/i.test(title)) {
            return '';
        }
        const m = title.match(/\((кПа|°C|°С|%|±\s*%|м3\/ч|м³\/ч|кг\/м3|кг\/м³|Па|бар|мс|мм|с)\)/i);
        if (m) {
            return m[1].replace(/°С/i, '°C').replace(/±\s*%/, '%').replace(/м3/g, 'м³');
        }
        if (/\(±\s*%\)/.test(title) || /погрешност/i.test(title)) return '%';
        if (/давлен/i.test(title)) return 'кПа';
        if (/температур/i.test(title)) return '°C';
        if (/расход|Qmax|Qmin|Qt|Qstart/i.test(title)) return 'м³/ч';
        return '';
    }

    function stripUnitFromValue(raw) {
        return String(raw ?? '')
            .trim()
            .replace(/\s*(кПа|°C|°С|%|м3\/ч|м³\/ч|кг\/м3|кг\/м³|Па|бар|мс|мм|с)\s*$/i, '')
            .trim();
    }

    function formatStepInputValue(stepOrId, val) {
        const step =
            typeof stepOrId === 'object' && stepOrId != null
                ? stepOrId
                : findStep(String(stepOrId));
        const s = stripUnitFromValue(val);
        if (!step || (step.type !== 'f' && step.type !== 'd')) return s;
        const n = Number(s.replace(',', '.'));
        if (!Number.isFinite(n)) return s;
        // п.113 РВГ: Па/1000 → до 3–4 знаков (80 → 0.08)
        if (step.id === 113) {
            return n
                .toFixed(4)
                .replace(/0+$/, '')
                .replace(/\.$/, '');
        }
        return formatDecimal2(n);
    }

    function decodeTDateBytes(b) {
        if (b.length < 4) return bytesToHex(b);
        const v = bytesToU32le([b[0], b[1], b[2], b[3]]) >>> 0;
        const day = v & 0xff;
        const month = (v >> 8) & 0xff;
        const year = (v >> 16) & 0xffff;
        if (!day && !month && !year) return '00.00.0000';
        return `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`;
    }

    function encodeTDateString(val) {
        const m = String(val ?? '').trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
        if (!m) throw new Error('Дата TDate: ДД.ММ.ГГГГ');
        const day = parseInt(m[1], 10);
        const month = parseInt(m[2], 10);
        const year = parseInt(m[3], 10);
        // 00.00.0000 — допустимая «пустая» дата (заводской шаблон / п.202–203).
        if (day === 0 && month === 0 && year === 0) {
            return u32leBytes(0);
        }
        if (day < 1 || day > 31 || month < 1 || month > 12 || year < 1900 || year > 2100) {
            throw new Error('Некорректная дата TDate');
        }
        const v = (day & 0xff) | ((month & 0xff) << 8) | ((year & 0xffff) << 16);
        return u32leBytes(v >>> 0);
    }

    function decodeRead(step, resp) {
        const t = step.type;
        const b = resp.slice(3, 3 + resp[2]);
        if (t === 'f') {
            if (b.length < 4) return bytesToHex(b);
            return formatDecimal2(K.parseFloat32LE(b.subarray(0, 4)));
        }
        if (t === 'w') {
            if (b.length < 2) return bytesToHex(b);
            if (step.u8) return String(b[0]);
            const v = b[0] | (b[1] << 8);
            return String(v);
        }
        if (t === 'u') {
            if (b.length < 4) return bytesToHex(b);
            const n = bytesToU32le([b[0], b[1], b[2], b[3]]) >>> 0;
            return String(n);
        }
        if (t === 'q') {
            if (b.length < 8) return bytesToHex(b);
            return String(toUnix64LE(new Uint8Array(b.slice(0, 8))));
        }
        if (t === '6') {
            if (b.length < 8) return bytesToHex(b);
            return String(toUnix64LE(new Uint8Array(b.slice(0, 8))));
        }
        if (t === 't') {
            if (b.length < 8) return bytesToHex(b);
            const u = toUnix64LE(new Uint8Array(b.slice(0, 8)));
            const n = Number(u);
            if (n > 0) {
                return formatUnixMoscow(n) + ' (unix ' + n + ')';
            }
            return `raw ${u}`;
        }
        if (t === 's') {
            const txt = decodeCp1251(b);
            return txt || bytesToHex(b);
        }
        if (t === 'c32' || t === 'chr') {
            const txt = decodeCp1251(b);
            return txt || bytesToHex(b);
        }
        if (t === 'd') {
            if (b.length < 8) return bytesToHex(b);
            return formatDecimal2(parseFloat64LE(b.subarray(0, 8)));
        }
        if (t === 'battery') {
            // п.315 0x071D: 1 регистр = 2 байта (Bat1% основной батареи, Bat2% телеметрии)
            if (b.length < 2) return bytesToHex(b);
            return `Bat1: ${b[0]}%, Bat2: ${b[1]}%`;
        }
        if (t === 'dt') {
            return decodeTDateBytes(b);
        }
        return bytesToHex(b);
    }

    /** Значение для поля «Записать» (не для колонки «прочитано»). */
    function decodeReadForInput(step, resp) {
        const t = step.type;
        const b = resp.slice(3, 3 + resp[2]);
        if (t === 'f') {
            if (b.length < 4) return null;
            const n = K.parseFloat32LE(b.subarray(0, 4));
            return formatStepInputValue(step, n);
        }
        if (t === 'w') {
            if (b.length < 2) return null;
            if (step.u8) return String(b[0]);
            return String(b[0] | (b[1] << 8));
        }
        if (t === 'u') {
            if (b.length < 4) return null;
            const n = bytesToU32le([b[0], b[1], b[2], b[3]]) >>> 0;
            return String(n);
        }
        if (t === 'q' || t === '6') {
            if (b.length < 8) return null;
            return String(toUnix64LE(new Uint8Array(b.slice(0, 8))));
        }
        if (t === 't') {
            if (b.length < 8) return null;
            const u = toUnix64LE(new Uint8Array(b.slice(0, 8)));
            const n = Number(u);
            return n > 0 ? formatUnixMoscow(n) : String(u);
        }
        if (t === 's' || t === 'c32' || t === 'chr') {
            return decodeCp1251(b) || null;
        }
        if (t === 'd') {
            if (b.length < 8) return null;
            return formatDecimal2(parseFloat64LE(b.subarray(0, 8)));
        }
        if (t === 'dt') {
            const s = decodeTDateBytes(b);
            // п.202/203/298/299 — оставляем 00.00.0000 в поле; остальные даты — пусто.
            if (s === '00.00.0000') {
                if (step.id === 202 || step.id === 203 || step.id === 298 || step.id === 299) {
                    return s;
                }
                return '';
            }
            return s;
        }
        if (t === 'battery') {
            return null;
        }
        return null;
    }

    function shouldFillInputFromRead(step) {
        if (step.readOnly || step.writeOnly || step.manufacturerOnly) return false;
        // п.59/66: в память пишется команда 1, а не серийник из регистра
        if (step.id === 59 || step.id === 66) return false;
        return true;
    }

    function fillInputFromRead(step, resp) {
        if (!shouldFillInputFromRead(step)) return;
        const vin = el(stepInputId(step));
        if (!vin) return;
        const v = decodeReadForInput(step, resp);
        if (v != null && v !== '') vin.value = v;
        if (step.type === 't') updateDatetimeHint(step.id);
    }

    /** Опрос датчика (п.58/65) — в CorrReader ответ ~400 мс. */
    function readTimeoutMsForStep(step) {
        if (step.readOnly && step.type === 'q') return 6000;
        return 2000;
    }

    /** Запись Uint64 / опрос датчика может занимать несколько секунд. */
    function writeTimeoutMsForStep(step) {
        if (isDefaultSettingsCmd(step)) {
            if (step.defaultSettingsCmd === DEFAULT_SETTINGS_CMD3_VALUE || Number(step.defaultSettingsCmd) === 3) {
                return DEFAULT_SETTINGS_CMD3_TIMEOUT_MS;
            }
            return DEFAULT_SETTINGS_TIMEOUT_MS;
        }
        if (step.id === 59 || step.id === 66) return 10000;
        if (step.settingsCrcCmd || step.id === 316) return DEFAULT_SETTINGS_TIMEOUT_MS;
        if (step.type === 'q' || step.type === '6' || step.type === 't' || step.type === 's') return 5000;
        if (step.type === 'c32' || step.type === 'chr' || step.type === 'd') return 4000;
        return 2000;
    }

    function isMotoHoursResetStep(step) {
        const id = step && Number(step.id);
        return id >= 302 && id <= 308;
    }

    function isZeroMotoHoursValue(text) {
        const s = String(text ?? '')
            .trim()
            .replace(',', '.');
        if (!s || s === '—' || s === '0' || s === '0.00') {
            return true;
        }
        const n = Number(s);
        return Number.isFinite(n) && n === 0;
    }

    /** п.59/66 — «запомнить S/N чувствительного элемента в памяти корректора». */
    function isSensorMemoryCmd(step) {
        return !!(step && (step.sensorMemoryCmd || step.id === 59 || step.id === 66));
    }

    function shouldWriteSensorMemoryCmd(step) {
        if (!isSensorMemoryCmd(step)) {
            return false;
        }
        const pair = SENSOR_MEMORY_PAIR[step.id];
        if (!pair) {
            return false;
        }
        const snInp = el('val_' + pair.snId);
        if (!snInp || !String(snInp.value || '').trim()) {
            return false;
        }
        const Ops = window.TM07_WORKBENCH_OPS;
        if (Ops && typeof Ops.shouldWriteSensorMemory === 'function') {
            return Ops.shouldWriteSensorMemory(step.id);
        }
        return true;
    }

    function paintSensorMemoryVerify(step, polled, remembered, match) {
        const pair = SENSOR_MEMORY_PAIR[step.id];
        const out = el(stepOutId(step));
        const pollStep = pair ? findStep(String(pair.pollId)) : null;
        const pollOut = pollStep ? el(stepOutId(pollStep)) : null;
        const shown = String(remembered || '').trim() || '—';
        const pollShown = String(polled || '').trim() || '—';
        if (pollOut) {
            setOutStatus(pollOut, pollShown, match ? 'ok' : 'err');
            if (match) {
                const prow = pollOut.closest('tr');
                if (prow) {
                    prow.classList.add('param-read-match', 'param-write-ok');
                }
            }
        }
        if (!out) {
            return;
        }
        clearReadComparePaint(out);
        out.textContent = shown;
        out.classList.remove('text-success', 'text-danger', 'text-body-secondary', 'text-warning');
        const row = out.closest('tr');
        if (match) {
            out.classList.add('text-success');
            out.title = 'п.' + (pair && pair.pollId) + ' = п.' + step.id + ' = ' + shown;
            if (row) {
                row.classList.add('param-write-ok', 'param-read-match');
                row.classList.remove('param-read-mismatch');
            }
            return;
        }
        out.classList.add('text-danger', 'param-read-mismatch-val');
        out.title =
            'п.' +
            (pair && pair.pollId) +
            ': ' +
            pollShown +
            ' · п.' +
            step.id +
            ': ' +
            shown;
        if (row) {
            row.classList.add('param-read-mismatch');
            row.classList.remove('param-write-ok', 'param-read-match');
        }
    }

    async function doWriteSensorMemoryCmd(step) {
        assertModbusReady();
        const pair = SENSOR_MEMORY_PAIR[step.id];
        if (!pair) {
            throw new Error('Неизвестная команда sensor memory');
        }
        const snVal = String(el('val_' + pair.snId)?.value || '').trim();
        if (!snVal) {
            throw new Error('Сначала запишите п.' + pair.snId + ' (S/N датчика)');
        }

        let polledStr = '';
        const pollStep = findStep(String(pair.pollId));
        if (pollStep) {
            log(`[${step.id}] опрос чувствительного элемента (${pair.label}), п.${pair.pollId}…`);
            clog('SENSOR MEM poll', `п.${pair.pollId}`, pair.label);
            try {
                const polled = await doReadStep(pollStep);
                polledStr = String(polled || '').trim();
                log(`[${pair.pollId}] опрос: ${polledStr || '—'}`);
                const polledNum = parseFloat(polledStr.replace(',', '.'));
                if (!polledStr || polledStr === '0' || (Number.isFinite(polledNum) && polledNum === 0)) {
                    throw new Error('ЧЭ вернул пустой/нулевой S/N — запоминание отменено');
                }
            } catch (e) {
                clogErr('SENSOR MEM poll', `п.${pair.pollId}`, e);
                throw new Error(
                    'Опрос ЧЭ п.' +
                        pair.pollId +
                        ' (' +
                        pair.label +
                        '): ' +
                        (e.message || String(e)) +
                        ' — команда запоминания не отправлена'
                );
            }
        }

        await new Promise((r) => setTimeout(r, BATCH_GAP_SENSOR_MEMORY_MS));

        const r = step.reg & 0xffff;
        const timeoutMs = writeTimeoutMsForStep(step);
        const armed = Object.assign({}, step, { writeLkg: true });
        clog('WRITE →', `п.${step.id}`, formatHoldingAddr(r), 'sensor memory cmd=1', 'с Access-ЛКГ');
        log(`[${step.id}] запоминание S/N в памяти (${pair.label}), команда 1 → ${formatHoldingAddr(r)}…`);
        try {
            await writeWithLkgRetry(armed, function () {
                return dev.writeUint64LE(r, 1n, timeoutMs);
            });
        } catch (e) {
            if (!isLkgValueError(e.message)) {
                throw e;
            }
            // Как DEFAULT_SETTINGS: 1 регистр, значение 1 (u16 LE) — если uint64 без Access даёт 0x0B.
            log(`[${step.id}] 0x0B на Uint64 — повтор командой u16=1 и Access-ЛКГ…`);
            invalidateLkgSession('п.' + step.id + ' sensor mem u16');
            await writeWithLkgRetry(armed, function () {
                return dev.writeMultiple(r, [0x01, 0x00], timeoutMs);
            });
        }
        await new Promise((r) => setTimeout(r, BATCH_GAP_SENSOR_MEMORY_MS));

        let remembered = '';
        try {
            remembered = String((await doReadStep(step, null, { updateInput: false })) || '').trim();
        } catch (e) {
            throw new Error(
                'Не удалось прочитать п.' + step.id + ' после записи: ' + (e.message || String(e))
            );
        }
        const match =
            !!polledStr &&
            !!remembered &&
            remembered !== '0' &&
            readValueMatchesExpected(step.id, polledStr, remembered);
        paintSensorMemoryVerify(step, polledStr, remembered, match);
        if (!match) {
            log(
                `[${step.id}] сверка с п.${pair.pollId}: ${remembered || '—'} ≠ ${polledStr || '—'}`
            );
            throw new Error(
                'п.' +
                    step.id +
                    ' в памяти (' +
                    (remembered || '—') +
                    ') не совпадает с п.' +
                    pair.pollId +
                    ' (' +
                    (polledStr || '—') +
                    ')'
            );
        }
        log(`[${step.id}] в памяти: ${remembered} = п.${pair.pollId} ✓`);
        clog('WRITE ←', `п.${step.id}`, 'sensor memory ok', remembered);
        return { painted: true, match: true, polled: polledStr, remembered: remembered };
    }

    async function doReadSensorMemoryCompare(step) {
        assertModbusReady();
        const pair = SENSOR_MEMORY_PAIR[step.id];
        if (!pair) {
            return doReadStep(step, null, { updateInput: false });
        }
        const pollStep = findStep(String(pair.pollId));
        let polledStr = '';
        if (pollStep) {
            log(`[${step.id}] сверка с п.${pair.pollId} (${pair.label})…`);
            try {
                polledStr = String((await doReadStep(pollStep, null, { updateInput: false })) || '').trim();
                log(`[${pair.pollId}] опрос ЧЭ: ${polledStr || '—'}`);
            } catch (e) {
                log(`[${pair.pollId}] опрос ЧЭ: ` + (e.message || String(e)));
            }
        }
        const remembered = String((await doReadStep(step, null, { updateInput: false })) || '').trim();
        const match =
            !!polledStr &&
            !!remembered &&
            remembered !== '0' &&
            readValueMatchesExpected(step.id, polledStr, remembered);
        paintSensorMemoryVerify(step, polledStr, remembered, match);
        if (match) {
            log(`[${step.id}] память ${remembered} = п.${pair.pollId} ✓`);
        } else {
            log(
                `[${step.id}] память ${remembered || '—'} ≠ п.${pair.pollId} ${polledStr || '—'}`
            );
        }
        return remembered;
    }

    async function recoverAfterCommError() {
        if (!dev) return;
        try {
            await dev.drainRxBuffer(500);
        } catch (_e) {}
        await new Promise((r) => setTimeout(r, BATCH_GAP_AFTER_ERR_MS));
    }

    function assertModbusReady() {
        if (!dev || !dev.port) throw new Error('Подключите КАО');
        if (connectBusy) throw new Error('Дождитесь завершения подключения КАО');
    }

    async function doReadStep(step, regOverride, options) {
        assertModbusReady();
        if (!step.reg) return;
        const r = regOverride != null ? regOverride : step.reg;
        const n = regCountForStep(step);
        const timeoutMs = readTimeoutMsForStep(step);
        const updateInput = !options || options.updateInput !== false;
        clog('READ →', `п.${step.id}`, step.title, formatHoldingAddr(r), `regs=${n}`, `type=${step.type}`);
        const resp = await dev.readHolding(r, n, timeoutMs);
        const decoded = decodeRead(step, resp);
        if (updateInput) {
            fillInputFromRead(step, resp);
        }
        const raw = resp.slice(3, 3 + resp[2]);
        clog(
            'READ ←',
            `п.${step.id}`,
            decoded,
            raw.length ? `raw ${bytesToHex(new Uint8Array(raw))}` : ''
        );
        return decoded;
    }

    function isIllegalDataValueError(msg) {
        return /0x0?3\b|недопустимое значение в запросе/i.test(String(msg ?? ''));
    }

    /**
     * п.316 (0x06B1): CRC калибровки Settings №1.
     * 1 регистр (01 00) даёт exception 0x03 — в карте UINT32 (2 рег.).
     */
    async function doWriteSettingsCrcCmd(step, val, regOverride) {
        const r = (regOverride != null ? regOverride : step.reg) & 0xffff;
        const timeoutMs = writeTimeoutMsForStep(step);
        const s = String(val ?? '1').trim();
        const parsed = s.startsWith('0x') || s.startsWith('0X') ? parseInt(s, 16) : parseInt(s, 10);
        const n = Number.isFinite(parsed) && parsed >= 0 ? parsed >>> 0 : 1;
        const payloads = [
            { name: 'uint32 LE', bytes: u32leBytes(n) },
            {
                name: 'uint64 LE',
                bytes: [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff, 0, 0, 0, 0],
            },
        ];
        let lastErr = null;
        for (let i = 0; i < payloads.length; i += 1) {
            const p = payloads[i];
            clog(
                'WRITE →',
                'п.' + step.id,
                formatHoldingAddr(r),
                'Settings CRC',
                p.name,
                bytesToHex(new Uint8Array(p.bytes))
            );
            try {
                return await writeWithLkgRetry(step, function () {
                    return dev.writeMultiple(r, p.bytes, timeoutMs);
                });
            } catch (e) {
                lastErr = e;
                if (i + 1 < payloads.length && isIllegalDataValueError(e.message)) {
                    log('[' + step.id + '] 0x03 на ' + p.name + ' — повтор ' + payloads[i + 1].name + '…');
                    continue;
                }
                throw e;
            }
        }
        throw lastErr || new Error('п.316: не удалось записать CRC Settings №1');
    }

    async function doWriteStep(step, val, regOverride) {
        assertModbusReady();
        if (step.readOnly) throw new Error('Параметр только для чтения');
        if (!step.reg) throw new Error('Нет регистра');
        if (step.settingsCrcCmd || step.id === 316) {
            val = stripUnitFromValue(val);
            const wrCrc = await doWriteSettingsCrcCmd(step, val, regOverride);
            clog('WRITE ←', `п.${step.id} ok`);
            return wrCrc;
        }
        const r = regOverride != null ? regOverride : step.reg;
        const t = step.type;
        const timeoutMs = writeTimeoutMsForStep(step);
        val = stripUnitFromValue(val);
        clog('WRITE →', `п.${step.id}`, step.title, formatHoldingAddr(r), `type=${t}`, 'val=', val);

        const wr = await writeWithLkgRetry(step, async () => {
            if (t === 'f') {
                const s = String(val ?? '')
                    .replace(/\s/g, '')
                    .replace(',', '.');
                const n = parseFloat(s);
                if (!Number.isFinite(n)) throw new Error('Введите число');
                if (step.id === 6 && n <= 0) {
                    throw new Error(
                        'Pmin (п.6) должен быть > 0 кПа — проверьте заказ 1С (ПАД…) или введите значение вручную'
                    );
                }
                return await dev.writeFloat32LE(r, n, timeoutMs);
            }
            if (t === 'w') {
                const s = String(val ?? '').trim();
                const w2 = s.startsWith('0x') || s.startsWith('0X') ? parseInt(s, 16) : parseInt(s, 10);
                if (!Number.isFinite(w2) || w2 < 0 || w2 > 0xffff) {
                    throw new Error('u16: целое 0..65535 или 0x…');
                }
                return await dev.writeMultiple(
                    r,
                    step.u8 ? [w2 & 0xff, 0] : [w2 & 0xff, (w2 >> 8) & 0xff],
                    timeoutMs
                );
            }
            if (t === 'u') {
                let num;
                if (typeof val === 'number') num = val >>> 0;
                else {
                    const s = String(val).trim();
                    num = s.startsWith('0x') || s.startsWith('0X') ? parseInt(s, 16) : parseInt(s, 10);
                }
                if (!Number.isFinite(num)) throw new Error('Введите uint32 (допускается 0x…)');
                return await dev.writeMultiple(r, u32leBytes(num >>> 0), timeoutMs);
            }
            if (t === '6') {
                const s = String(val ?? '').trim();
                if (!/^\d{10}$/.test(s)) throw new Error('10 цифр Uint64 (300YYMMNNN)');
                return await dev.writeUint64LE(r, BigInt(s), timeoutMs);
            }
            if (t === 't') {
                let sec;
                if (val instanceof Date) {
                    sec = Math.floor(val.getTime() / 1000);
                } else {
                    sec = parseDatetimeInputToUnix(val);
                }
                if (sec == null || !Number.isFinite(sec)) {
                    throw new Error('Дата/время: ДД.ММ.ГГГГ, ЧЧ:ММ:СС (Москва) или unix');
                }
                return await dev.writeUint64LE(r, BigInt(sec), timeoutMs);
            }
            if (t === 's') {
                return await dev.writeFactorySerialAscii(String(val ?? ''), r);
            }
            if (t === 'c32') {
                const buf = encodeCp1251(String(val ?? ''), 32);
                return await dev.writeMultiple(r, [...buf], timeoutMs);
            }
            if (t === 'q') {
                const s = String(val ?? '').trim();
                let bi;
                if (s.startsWith('0x') || s.startsWith('0X')) {
                    bi = BigInt(s);
                } else if (/^\d+$/.test(s)) {
                    bi = BigInt(s);
                } else {
                    throw new Error('Uint64: десятичное целое или 0x…');
                }
                if (bi < 0n || bi > 0xffffffffffffffffn) throw new Error('Uint64 вне 0…2⁶⁴−1');
                return await dev.writeUint64LE(r, bi, timeoutMs);
            }
            if (t === 'd') {
                const s = String(val ?? '').replace(/\s/g, '').replace(',', '.');
                const n = parseFloat(s);
                if (!Number.isFinite(n)) throw new Error('Введите число (double)');
                return await dev.writeMultiple(r, [...float64BytesLE(n)], timeoutMs);
            }
            if (t === 'dt') {
                return await dev.writeMultiple(r, encodeTDateString(val), timeoutMs);
            }
            if (t === 'chr') {
                const byteLen = regCountForStep(step) * 2;
                const buf = encodeCp1251(String(val ?? ''), byteLen);
                return await dev.writeMultiple(r, [...buf], timeoutMs);
            }
            throw new Error('Тип не поддержан для записи');
        });

        // CryptLkg зависит от S/N и даты прибора — после их смены сессию пересобираем.
        if (step.id === 3 || step.id === 20) {
            const why = step.id === 3 ? 'после п.3 S/N' : 'после п.20 дата/время';
            invalidateLkgSession(why);
            try {
                await beginLkgSession(why, { force: true });
            } catch (e) {
                clogErr('LKG reinit ' + why, e);
                log('<strong>ЛКГ-сессия ' + why + ':</strong> ' + (e.message || String(e)));
                throw e;
            }
        }

        clog('WRITE ←', `п.${step.id} ok`);
        return wr;
    }

    async function resolveKaoFilters() {
        let vid = 0x0403;
        let pid = DEFAULT_KAO_PID;
        try {
            const settings =
                window.TM07_SETTINGS && window.TM07_SETTINGS.getPublicSettings
                    ? await window.TM07_SETTINGS.getPublicSettings()
                    : await fetch('/api/admin-settings.php?action=public')
                          .then(function (r) {
                              return r.json();
                          })
                          .then(function (j) {
                              return j.success ? j.settings : null;
                          });
            if (settings) {
                const u = settings.usb && settings.usb.vendorIdHex;
                if (u) {
                    const v = parseInt(String(u).replace(/^0x/i, ''), 16);
                    if (Number.isFinite(v)) vid = v;
                }
                const t = settings.tm07;
                if (t && t.usbAdapterProductIdHex) {
                    const p = parseInt(String(t.usbAdapterProductIdHex).replace(/^0x/i, ''), 16);
                    if (Number.isFinite(p)) pid = p;
                }
            }
        } catch (_e) {}
        return [{ usbVendorId: vid, usbProductId: pid }];
    }

    function getAddrBaud() {
        const a = parseInt(el('paramAddr')?.value || '1', 10);
        if (a < 1 || a > 15) throw new Error('Modbus 1..15');
        const b = parseInt(el('paramBaud')?.value || '9600', 10);
        return { a, b };
    }

    window.__paramKorrektor = null;
    window.__paramDevicePassport = null;
    window.__paramLockStatus = null;

    /** Старт как CorrReader: identify → паспорт → замки. */
    async function probeModbusLink(timeoutMs = 4500) {
        if (!dev) return null;
        const resp = await dev.identify(timeoutMs);
        return K.parseIdentifyResponse(resp);
    }

    async function tryAlternateBaud(currentBaud) {
        const alt = currentBaud === 9600 ? 19200 : 9600;
        if (!dev || typeof dev.switchBaudRate !== 'function') return null;
        log(`Нет ответа на ${currentBaud} бод — пробую ${alt}…`);
        await dev.switchBaudRate(alt);
        if (el('paramBaud')) el('paramBaud').value = String(alt);
        return alt;
    }

    async function runCorrReaderConnectStartup(baud) {
        if (!dev) return false;
        log('Порт открыт.');
        window.__paramDevicePassport = null;
        window.__paramLockStatus = null;
        updateLockStatusUi(null);
        let linked = false;
        try {
            log('Проверка связи Modbus (0x11 identify)…');
            let passport = await probeModbusLink();
            linked = !!passport;
            if (!linked && baud) {
                const alt = await tryAlternateBaud(baud);
                if (alt) {
                    passport = await probeModbusLink();
                    linked = !!passport;
                    baud = alt;
                }
            }
            if (linked && passport) {
                window.__paramDevicePassport = passport;
                applyDeviceMapVersion(passport.mapVersion);
                if (passport.name) log('Наименование: ' + passport.name);
                if (passport.fwVersion) log('Версия ПО: ' + passport.fwVersion);
                if (passport.serial) log('Заводской номер: ' + passport.serial);
                log('Версия карты регистров: ' + passport.mapVersion);
                const mapCheck = assertDeviceMapCompatible(passport.mapVersion);
                if (passport.mapVersion && passport.mapVersion !== UI_MAP_VERSION) {
                    clog('map version', 'device', passport.mapVersion, 'ui tables', UI_MAP_VERSION);
                    log(
                        `Карта прибора ${passport.mapVersion}, таблицы UI — v${UI_MAP_VERSION}; REG_LKG ${formatHoldingAddr(lkgConfig.reg)}.`
                    );
                }
                if (!mapCheck.ok) {
                    log('<strong>' + mapCheck.message + '</strong>');
                    clogErr('map incompatible', mapCheck);
                }
                log('Связь с корректором установлена.');
                clog('identify', passport);
                void offerFirmwareAfterConnect().catch(function (e) {
                    clogErr('firmware', e);
                });
            } else {
                throw new Error('Нет ответа на identify');
            }
        } catch (e) {
            log('Ошибка связи: ' + (e.message || String(e)));
            log('Подсказка: проверьте скорость (9600/19200), Modbus-адрес (1–15), A/B RS485 и питание корректора.');
            clogErr('identify', e);
            return false;
        }
        try {
            log('Дополнительно: holding-паспорт (0x0001…)…');
            const p = await dev.readElectronicPassport();
            window.__paramDevicePassport = { ...window.__paramDevicePassport, ...p };
            clog('passport', p);
            void offerFirmwareAfterConnect().catch(function (e) {
                clogErr('firmware', e);
            });
        } catch (e) {
            clogErr('passport', e);
        }
        try {
            log('Проверка статуса замков.');
            let lock = await refreshLockStatus();
            log('Статус замков: ' + describeLockStatus(lock.raw) + ' (' + lockRawHex(lock.raw) + ')');
            if (!isLockWriteReady(lock.raw)) {
                lock = await runAutoPassLocks();
            }
            if (isLockWriteReady(lock.raw)) {
                log('Замки готовы к записи (' + lockRawHex(lock.raw) + ') — можно параметризовать.');
            } else {
                const hint = lockWriteHint(lock.raw);
                if (hint) {
                    log('<strong>Внимание:</strong> ' + hint);
                }
            }
            log('Статус замков считан удачно.');
        } catch (e) {
            log('Ошибка чтения статуса замков: ' + (e.message || String(e)));
            clogErr('lock', e);
        }
        startKeepalivePoll();
        return true;
    }

    function setConnectUiBusy(busy) {
        ['paramConnectKao', 'paramConnectAny'].forEach((id) => {
            const b = el(id);
            if (b) b.disabled = !!busy;
        });
        if (busy) setBatchParamButtonsDisabled(true);
        else if (!batchParamRunning) setBatchParamButtonsDisabled(false);
    }

    async function openKaoPort(connectedDev, opts) {
        const reopened = await connectedDev.reconnectGranted(opts);
        if (reopened) {
            log('USB-COM: повторное открытие (порт уже разрешён в браузере).');
            return true;
        }
        await connectedDev.connect(opts);
        return false;
    }

    function hexUsbId(n) {
        if (n == null || n === '') {
            return '';
        }
        return '0x' + (Number(n) & 0xffff).toString(16).toUpperCase().padStart(4, '0');
    }

    /** Дополнить S/N из WebUSB, если устройство уже разрешено сайту. */
    async function tryWebUsbSerialNumber(vid, pid) {
        if (!navigator.usb || typeof navigator.usb.getDevices !== 'function') {
            return '';
        }
        if (vid == null || pid == null) {
            return '';
        }
        try {
            const devices = await navigator.usb.getDevices();
            const match = (devices || []).find(function (d) {
                return d.vendorId === vid && d.productId === pid;
            });
            if (match && match.serialNumber) {
                return String(match.serialNumber).trim();
            }
        } catch (_e) {}
        return '';
    }

    async function readAndReportKaoUsb(connectedDev) {
        const info =
            connectedDev && typeof connectedDev.getUsbInfo === 'function'
                ? connectedDev.getUsbInfo()
                : null;
        if (!info) {
            log('КАО USB: getInfo() недоступен');
            return null;
        }
        let serial = info.serialNumber || '';
        if (!serial) {
            serial = await tryWebUsbSerialNumber(info.usbVendorId, info.usbProductId);
        }
        const payload = {
            usbVendorId: info.usbVendorId,
            usbProductId: info.usbProductId,
            vendorIdHex: hexUsbId(info.usbVendorId),
            productIdHex: hexUsbId(info.usbProductId),
            tm07ProductIdHex: hexUsbId(info.usbProductId),
            serialNumber: serial,
            keys: info.keys || [],
        };
        window.__tm07KaoUsbInfo = payload;

        const vidPid =
            (payload.vendorIdHex || '—') + ' / ' + (payload.productIdHex || '—');
        if (serial) {
            log('КАО USB: VID/PID ' + vidPid + ', S/N адаптера: ' + serial);
        } else {
            log(
                'КАО USB: VID/PID ' +
                    vidPid +
                    ', S/N адаптера: браузер не отдал (Web Serial обычно только VID/PID; keys=[' +
                    (payload.keys || []).join(',') +
                    '])'
            );
        }

        const hint = el('paramUsbFilterHint');
        if (hint) {
            hint.textContent = serial
                ? 'Адаптер КАО: ' + vidPid + ' · S/N ' + serial
                : 'Адаптер КАО: ' + vidPid + ' · S/N недоступен из браузера (только VID/PID)';
        }

        const events = window.TM07_BENCH_EVENTS;
        if (events && typeof events.reportKaoUsb === 'function') {
            try {
                const bound =
                    events.getContext &&
                    events.getContext() &&
                    events.getContext().workstationConfig &&
                    events.getContext().workstationConfig.deviceUsb;
                const expectedSn = bound && bound.kaoSerialNumber ? String(bound.kaoSerialNumber) : '';
                if (expectedSn && serial && expectedSn !== serial) {
                    log(
                        'Внимание: S/N адаптера (' +
                            serial +
                            ') ≠ привязанному к месту (' +
                            expectedSn +
                            ')'
                    );
                }
                await events.reportKaoUsb(payload);
            } catch (e) {
                log('Не удалось сохранить USB адаптера в место: ' + (e.message || e));
            }
        }
        return payload;
    }

    async function doConnect(filterKao) {
        if (connectBusy) {
            log('Подключение уже выполняется…');
            return;
        }
        if (batchParamRunning) {
            log('Дождитесь завершения чтения/записи параметров.');
            return;
        }
        if (document.body.classList.contains('wb-page')) {
            const events = window.TM07_BENCH_EVENTS;
            if (events) {
                try {
                    await events.ensureOperator();
                    await events.ensureOrderSession();
                } catch (e) {
                    const msg = e.message || 'Требуется сессия заказа';
                    if (el('paramConnStatus')) {
                        el('paramConnStatus').textContent = msg;
                    }
                    log(msg);
                    if (window.TM07_WORKBENCH && typeof window.TM07_WORKBENCH.paintSessionBadge === 'function') {
                        window.TM07_WORKBENCH.paintSessionBadge();
                    }
                    return;
                }
            }
        }
        connectBusy = true;
        setConnectUiBusy(true);
        window.__tm07KaoFilterKao = !!filterKao;
        let connectedDev = null;
        try {
            if (dev) {
                detachModbusTrace(dev);
                try {
                    await dev.disconnect();
                } catch (_e) {}
                dev = null;
                window.__paramKorrektor = null;
                window.__tm07DefaultSettingsApplied = false;
                invalidateLkgSession('reconnect');
            }
            const { a, b } = getAddrBaud();
            connectedDev = new K(a);
            const opts = { baudRate: b, rs485Rts: true };
            if (filterKao) {
                opts.filters = await resolveKaoFilters();
                const f0 = opts.filters[0];
                log(`USB VID=0x${f0.usbVendorId.toString(16)} PID=0x${f0.usbProductId.toString(16)}`);
            }
            if (el('paramConnStatus')) {
                el('paramConnStatus').textContent = `инициализация COM… addr ${a}, ${b} бод`;
            }
            await openKaoPort(connectedDev, opts);
            attachModbusTrace(connectedDev);
            dev = connectedDev;
            window.__paramKorrektor = dev;
            window.__tm07KaoWasConnected = true;
            try {
                await readAndReportKaoUsb(connectedDev);
            } catch (_e) {}
            if (window.TM07_WORKBENCH_STATE && typeof window.TM07_WORKBENCH_STATE.save === 'function') {
                window.TM07_WORKBENCH_STATE.save();
            }
            const linked = await runCorrReaderConnectStartup(b);
            if (el('paramConnStatus')) {
                el('paramConnStatus').textContent = linked
                    ? `подключено, addr ${a}, ${parseInt(el('paramBaud')?.value || String(b), 10)} бод`
                    : `COM открыт, нет ответа Modbus (addr ${a})`;
            }
            if (!linked) {
                log('Modbus не отвечает — параметризация, скорее всего, не пройдёт до восстановления связи.');
            }
        } catch (e) {
            detachModbusTrace(connectedDev);
            if (connectedDev) {
                try {
                    await connectedDev.disconnect();
                } catch (_e) {}
            }
            dev = null;
            window.__paramKorrektor = null;
            window.__tm07KaoWasConnected = false;
            let msg = e.message || String(e);
            if (filterKao && (e.name === 'NotFoundError' || /cancel|отмен/i.test(msg))) {
                msg += '. КАОшка не в списке? Нажмите «Любой USB» или укажите PID в /admin.html (раздел ТМ-07).';
            }
            if (el('paramConnStatus')) el('paramConnStatus').textContent = 'ошибка: ' + msg;
            log('Ошибка: ' + msg);
        } finally {
            connectBusy = false;
            setConnectUiBusy(false);
            if (dev && dev.port) {
                try {
                    window.dispatchEvent(
                        new CustomEvent('tm07-kao-connected', {
                            detail: {
                                linked: !!(window.__paramDevicePassport && window.__paramDevicePassport.mapVersion != null),
                                passport: window.__paramDevicePassport,
                                lock: window.__paramLockStatus,
                                kaoUsb: window.__tm07KaoUsbInfo || null,
                            },
                        })
                    );
                } catch (_e) {}
            }
        }
    }

    async function showKaoFilterHint() {
        const hint = el('paramUsbFilterHint');
        if (!hint) return;
        try {
            const f0 = (await resolveKaoFilters())[0];
            hint.textContent =
                'Кнопка «КАО» ищет USB VID 0x' +
                f0.usbVendorId.toString(16).toUpperCase() +
                ' / PID 0x' +
                f0.usbProductId.toString(16).toUpperCase() +
                '. Если ваш адаптер другой — «Любой USB» или смените PID в админке.';
        } catch (_e) {
            hint.textContent = '';
        }
    }
    showKaoFilterHint();

    el('paramConnectKao')?.addEventListener('click', () => doConnect(true));
    el('paramConnectAny')?.addEventListener('click', () => doConnect(false));
    el('paramRefreshLock')?.addEventListener('click', async () => {
        if (!isKaoConnected()) {
            log('Сначала подключите КАО');
            updateLockStatusUi(null);
            return;
        }
        try {
            const lock = await refreshLockStatus();
            log('Статус замков: ' + describeLockStatus(lock.raw) + ' (' + lockRawHex(lock.raw) + ')');
        } catch (e) {
            updateLockStatusUi(null);
            log('Ошибка чтения замков: ' + (e.message || String(e)));
            clogErr('lock refresh', e);
        }
    });
    el('paramOpenLocks')?.addEventListener('click', async () => {
        if (!isKaoConnected()) {
            log('Сначала подключите КАО');
            return;
        }
        try {
            log('<strong>Открытие замков (AutoPass)…</strong>');
            const lock = await runAutoPassLocks({ force: true });
            log('Статус замков: ' + describeLockStatus(lock.raw) + ' (' + lockRawHex(lock.raw) + ')');
            if (isLockWriteReady(lock.raw)) {
                log('Замки готовы к записи.');
            } else {
                const hint = lockWriteHint(lock.raw);
                if (hint) {
                    log('<strong>Внимание:</strong> ' + hint);
                }
            }
        } catch (e) {
            log('Ошибка открытия замков: ' + (e.message || String(e)));
            clogErr('lock open', e);
        }
    });
    el('paramCloseLocks')?.addEventListener('click', async () => {
        if (!isKaoConnected()) {
            log('Сначала подключите КАО');
            return;
        }
        try {
            log('<strong>Закрытие замков…</strong>');
            await runCloseLocks();
        } catch (e) {
            log('Ошибка закрытия замков: ' + (e.message || String(e)));
            clogErr('lock close', e);
        }
    });
    el('paramDisconnect')?.addEventListener('click', async () => {
        try {
            stopKeepalivePoll();
            if (dev) {
                detachModbusTrace(dev);
                await dev.disconnect();
            }
        } catch (_e) {}
        invalidateLkgSession('disconnect');
        dev = null;
        window.__paramKorrektor = null;
        window.__paramDevicePassport = null;
        window.__paramLockStatus = null;
        window.__tm07KaoWasConnected = false;
        window.__tm07DefaultSettingsApplied = false;
        if (el('paramConnStatus')) el('paramConnStatus').textContent = 'отключено';
        updateLockStatusUi(null);
        renderFwPanel({ deviceVer: '' });
        log('Отключено');
        if (window.TM07_WORKBENCH_STATE && typeof window.TM07_WORKBENCH_STATE.save === 'function') {
            window.TM07_WORKBENCH_STATE.save();
        }
    });

    let autoReconnectScheduled = false;
    let autoReconnectAttempted = false;

    async function tryAutoReconnectKao(filterKao, silent, force) {
        if (force) {
            autoReconnectAttempted = false;
            autoReconnectScheduled = false;
        }
        if (connectBusy || dev) {
            return !!(dev && dev.port);
        }
        if (!silent) {
            log('Автоподключение КАО…');
        }
        await doConnect(filterKao !== false);
        return isKaoPortOpen();
    }

    function scheduleAutoReconnectKao(filterKao, force) {
        if (force) {
            autoReconnectAttempted = false;
            autoReconnectScheduled = false;
        }
        if (autoReconnectAttempted || autoReconnectScheduled || connectBusy || dev) {
            return;
        }
        autoReconnectScheduled = true;
        window.setTimeout(function () {
            autoReconnectScheduled = false;
            if (autoReconnectAttempted || dev || connectBusy) {
                return;
            }
            autoReconnectAttempted = true;
            void tryAutoReconnectKao(filterKao, false);
        }, 400);
    }

    window.addEventListener('tm07-workbench-restored', function (e) {
        const d = (e && e.detail) || {};
        if (window.__tm07SessionResumeSurvey || d.sessionResume) {
            scheduleAutoReconnectKao(d.kaoFilterKao !== false, true);
            return;
        }
        if (!d.kaoWasConnected) {
            return;
        }
        scheduleAutoReconnectKao(d.kaoFilterKao !== false);
    });

    window.addEventListener('tm07-session-resume-survey', function (e) {
        const d = (e && e.detail) || {};
        scheduleAutoReconnectKao(d.kaoFilterKao !== false, true);
    });

    window.addEventListener('DOMContentLoaded', function () {
        if (autoReconnectAttempted || autoReconnectScheduled) {
            return;
        }
        let state;
        try {
            const raw = localStorage.getItem('tm07_workbench_state_v1');
            if (raw) {
                state = JSON.parse(raw);
            }
        } catch (_e) {}
        if (!state || !state.kaoWasConnected) {
            return;
        }
        scheduleAutoReconnectKao(state.kaoFilterKao !== false);
    });

    el('paramNowToDatetime')?.addEventListener('click', () => {
        const s = formatUnixMoscow(nowUnixForDevice());
        const inp = el('val_20');
        if (inp) inp.value = s;
        updateDatetimeHint(20);
    });

    async function ensureSupplierAccessLevel() {
        const step78 = findStep(78);
        if (!step78 || !dev) return true;

        /** CorrReader PRM: при открытом опт. замке производителя счётчик/комплекс пишутся без смены п.78. */
        if (isMfgOptLockOpen()) {
            log(
                'П.78: замок производителя открыт — счётчик и комплекс без временной смены уровня доступа.'
            );
            return true;
        }

        const vin = el('val_78');
        const intended = vin ? String(vin.value || '').trim() : '';
        let cur = null;
        try {
            cur = await doReadStep(step78, null, { updateInput: false });
            if (valuesRoughlyEqual('1', cur)) {
                log('П.78 уже = 1 — доступ к разделам счётчика/комплекса открыт.');
                return true;
            }
        } catch (_e) {}

        // Не трогаем val_78 в форме — там финальный режим (0=комплекс / 1=самост.).
        log(
            'П.78: временный доступ к счётчику/комплексу (=1)' +
                (cur != null ? ' (было ' + cur + ')' : '') +
                (intended !== '' && intended !== '1' ? ', затем вернём ' + intended : '') +
                '…'
        );
        try {
            await doWriteStep(step78, '1');
            log('П.78: временный доступ ok');
            return true;
        } catch (e) {
            const msg =
                'Не удалось установить п.78=1' +
                (cur != null ? ' (сейчас ' + cur + ')' : '') +
                ': ' +
                (e.message || String(e)) +
                '. Продолжаем запись счётчика/комплекса; при 0x0B нажмите «Проверить замки» (AutoPass через КАО).';
            log('<strong>' + msg + '</strong>');
            return false;
        }
    }

    /** Финальные п.78/79 по заказу (после возможного временного п.78=1). */
    async function writeFinalComplexModeFlags() {
        const pairs = [
            { id: 78, step: findStep(78) },
            { id: 79, step: findStep(79) },
        ];
        for (let i = 0; i < pairs.length; i += 1) {
            const p = pairs[i];
            if (!p.step || !dev) {
                continue;
            }
            const vin = el('val_' + p.id);
            const want = vin ? String(vin.value || '').trim() : '';
            if (want === '') {
                continue;
            }
            try {
                const cur = await doReadStep(p.step, null, { updateInput: false });
                if (valuesRoughlyEqual(want, cur)) {
                    log('П.' + p.id + ' уже = ' + want + ' (режим комплекса/СИ).');
                    continue;
                }
            } catch (_e) {}
            log('П.' + p.id + ': финал режима = ' + want + '…');
            await doWriteStep(p.step, want);
            log('П.' + p.id + ': ok');
        }
    }

    (async function loadDefaults() {
        try {
            const settings =
                window.TM07_SETTINGS && window.TM07_SETTINGS.getDeviceSettings
                    ? await window.TM07_SETTINGS.getDeviceSettings()
                    : window.TM07_SETTINGS && window.TM07_SETTINGS.getPublicSettings
                      ? await window.TM07_SETTINGS.getPublicSettings()
                      : await fetch('/api/admin-settings.php?action=bench', { credentials: 'same-origin' })
                            .then(function (r) {
                                return r.json();
                            })
                            .then(function (j) {
                                if (j && j.success) {
                                    return j.settings;
                                }
                                return fetch('/api/admin-settings.php?action=public', {
                                    credentials: 'same-origin',
                                })
                                    .then(function (r2) {
                                        return r2.json();
                                    })
                                    .then(function (j2) {
                                        return j2.success ? j2.settings : null;
                                    });
                            });
            if (!settings) return;
            applyLkgSettingsFromServer(settings);
            const t = settings.tm07 || {};
            if (t.modbusAddress != null && el('paramAddr')) el('paramAddr').value = String(t.modbusAddress);
            if (t.defaultBaudRate != null && el('paramBaud')) el('paramBaud').value = String(t.defaultBaudRate);
            if (el('ovDateReg')) {
                const cur = String(el('ovDateReg').value || '')
                    .replace(/^0x/i, '')
                    .toUpperCase();
                if (cur === '0078') el('ovDateReg').value = '';
                if (t.regDatetimeHex && !String(el('ovDateReg').value || '').trim()) {
                    const dtHex = String(t.regDatetimeHex).replace(/^0x/i, '').toUpperCase();
                    el('ovDateReg').value = dtHex === '0078' ? '008C' : dtHex;
                }
            }
        } catch (_e) {
            applyLkgSettingsFromServer({});
        }
    })();

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
    function escapeAttr(s) {
        return escapeHtml(s).replace(/"/g, '&quot;');
    }
    function parseUnixSeconds(val) {
        return parseDatetimeInputToUnix(val);
    }

    function formatUnixToHuman(val) {
        const n = parseUnixSeconds(val);
        if (n == null) return '';
        return formatUnixMoscow(n);
    }

    function updateDatetimeHint(stepId) {
        const hint = el('valhint_' + stepId);
        const inp = el('val_' + stepId);
        if (!inp) return;
        const raw = String(inp.value ?? '').trim();
        const unix = parseDatetimeInputToUnix(raw);
        if (unix != null) {
            const human = formatUnixMoscow(unix);
            // Сырой unix / ISO / «… (unix N)» → нормальный вид в поле.
            if (
                human &&
                raw !== human &&
                (/^\d{9,12}$/.test(raw) ||
                    /\(unix\s+\d+\)/i.test(raw) ||
                    /T\d{2}:\d{2}/.test(raw) ||
                    /Z$/i.test(raw))
            ) {
                inp.value = human;
            }
        }
        if (!hint) return;
        const shown = String(inp.value ?? '').trim();
        const u2 = parseDatetimeInputToUnix(shown);
        if (!shown) {
            hint.textContent = '—';
        } else if (u2 == null) {
            hint.textContent = 'формат: ДД.ММ.ГГГГ, ЧЧ:ММ:СС';
        } else {
            hint.textContent = 'Москва · unix ' + u2;
        }
        hint.classList.toggle('text-danger', !!shown && u2 == null);
        hint.classList.toggle('text-body-secondary', !shown || u2 != null);
    }

    function placeholderForType(step) {
        if (step.type === '6') return '10 цифр';
        if (step.type === 'u' || step.type === 'w') return 'число или 0x…';
        if (step.type === 'f') return 'число';
        if (step.type === 's') return 'текст ≤20';
        if (step.type === 't') return 'ДД.ММ.ГГГГ, ЧЧ:ММ:СС (Москва) или пусто → сейчас';
        if (step.type === 'q') return 'Uint64: цифры или 0x…';
        if (step.type === 'c32') return 'ASCII ≤32 симв.';
        if (step.type === 'chr') return `текст ≤${(step.regCount || 1) * 2} симв.`;
        if (step.type === 'd') return 'число (double)';
        if (step.type === 'dt') return 'ДД.ММ.ГГГГ';
        return '';
    }

    function getRegOverrideForStep(step) {
        if (step.id === 3 && el('ovSerialReg')?.value) {
            const v = parseInt(String(el('ovSerialReg').value).replace(/^0x/i, ''), 16);
            if (Number.isFinite(v)) return v;
        }
        if (step.id === 20 && el('ovDateReg')?.value) {
            const v = parseInt(String(el('ovDateReg').value).replace(/^0x/i, ''), 16);
            if (Number.isFinite(v)) return v;
        }
        return null;
    }

    function findStep(sid) {
        const id = parseInt(sid, 10);
        let s = DOC.steps.find((x) => x.id === id);
        if (s) return s;
        for (const sec of EXTRA?.sections || []) {
            s = sec.steps.find((x) => x.id === id);
            if (s) return s;
        }
        return null;
    }

    const BATCH_GAP_MS = 55;
    const BATCH_GAP_AFTER_ERR_MS = 150;
    const BATCH_GAP_MANUFACTURER_MS = 250;
    const BATCH_GAP_SENSOR_MEMORY_MS = 400;
    const MAX_CONSECUTIVE_WRITE_FAILS = 4;

    /** п.59/66: опрос п.58/65, затем команда 1 без LKG (как п.2 / DEFAULT_SETTINGS). */
    const SENSOR_MEMORY_PAIR = {
        59: { pollId: 58, snId: 57, label: 'давление газа' },
        66: { pollId: 65, snId: 64, label: 'перепад давления' },
    };

    function isKaoConnected() {
        return !!(dev && dev.port && !connectBusy);
    }

    function isKaoPortOpen() {
        return !!(dev && dev.port);
    }

    /**
     * Порядок как в карте (п.2 → п.3 → …), если preserveStepOrder.
     * Иначе: сначала поставщик, затем производитель (legacy; после п.3 раньше ловили 0x0B на п.6+ —
     * сейчас после п.3 сессия ЛКГ пересобирается).
     */
    function orderStepsForBatchWrite(steps, opts) {
        const keep = [];
        for (const step of steps) {
            if (!step || step.type === 'x' || !step.reg) {
                continue;
            }
            if (step.readOnly && step.id !== 315 && step.type !== 'battery') {
                continue;
            }
            keep.push(step);
        }
        if (!opts || opts.preserveStepOrder !== false) {
            return keep;
        }
        const supplier = [];
        const manufacturer = [];
        for (const step of keep) {
            if (step.manufacturerOnly) {
                manufacturer.push(step);
            } else {
                supplier.push(step);
            }
        }
        return supplier.concat(manufacturer);
    }
    let batchParamRunning = false;
    let keepaliveTimer = null;
    let keepaliveBusy = false;
    const KEEPALIVE_MS = 60000;
    const batchButtonIds = ['paramReadAll', 'paramWriteAll'];

    function stopKeepalivePoll() {
        if (keepaliveTimer) {
            clearInterval(keepaliveTimer);
            keepaliveTimer = null;
        }
    }

    function startKeepalivePoll() {
        stopKeepalivePoll();
        keepaliveTimer = setInterval(function () {
            void (async function () {
                if (keepaliveBusy || batchParamRunning || connectBusy || !isKaoConnected() || !dev) {
                    return;
                }
                keepaliveBusy = true;
                try {
                    // Лёгкий опрос замков — чтобы RS485/прибор не «засыпали».
                    await refreshLockStatus();
                } catch (_e) {
                    // тихо
                } finally {
                    keepaliveBusy = false;
                }
            })();
        }, KEEPALIVE_MS);
    }

    function matchParamFilterRow(tr, rawQ) {
        const q = String(rawQ || '').trim().toLowerCase();
        if (!q) {
            return true;
        }
        const stepId = String(tr.getAttribute('data-step-id') || '');
        if (q.startsWith('#')) {
            const num = q.slice(1).trim();
            if (!num) {
                return true;
            }
            return stepId === num || stepId.startsWith(num);
        }
        const hay = (tr.getAttribute('data-search') || '').toLowerCase();
        return hay.includes(q);
    }

    // Финальные маски (71/72/74/75/77) живут со своими полями (val_final_*/out_final_*),
    // чтобы не конфликтовать с полями параметризации (там автоподстановка staging 0 0 3 3 0).
    function stepInputId(step) {
        return (step && step.inputId) || 'val_' + step.id;
    }

    function stepOutId(step) {
        if (step && step.inputId) return 'out' + step.inputId.slice(3);
        return 'out_' + step.id;
    }

    function buildStepsTable(tbody, steps, groups) {
        steps.forEach((step) => {
            // type x — только ПК / без Modbus: не рисуем пустые строки в таблице.
            if (step.type === 'x') {
                return;
            }

            const reg = step.reg != null ? formatHoldingAddr(step.reg) : '—';
            const valId = stepInputId(step);
            let defaultVal = '';
            if (step.defaultVal != null) defaultVal = String(step.defaultVal);
            else if (step.defaultNum != null) {
                defaultVal =
                    step.type === 'f' || step.type === 'd'
                        ? formatDecimal2(step.defaultNum)
                        : String(step.defaultNum);
            }
            else if (step.defaultHex != null) defaultVal = String(step.defaultHex);
            if (isDefaultSettingsCmd(step)) defaultVal = String(defaultSettingsCmdValue(step));
            if (step.type === 't' && !defaultVal) defaultVal = formatUnixMoscow(nowUnixForDevice());
            const dateHintHtml =
                step.type === 't'
                    ? `<div class="small text-body-secondary mt-1 param-datetime-hint" id="valhint_${step.id}">—</div>`
                    : '';
            let maskExecHtml = '';
            let maskRowClass = '';
            if (step.finalMask) {
                const C = window.TM07_CORRECTOR_EXECUTION;
                let variant = 'И1';
                try {
                    if (C && typeof C.resolveCorrectorExecution === 'function') {
                        const Ops = window.TM07_WORKBENCH_OPS;
                        const text =
                            Ops && typeof Ops.collectOrderTextBlob === 'function'
                                ? Ops.collectOrderTextBlob()
                                : '';
                        const equip =
                            Ops && typeof Ops.getEquipmentFromOrder === 'function'
                                ? Ops.getEquipmentFromOrder()
                                : null;
                        const exec = C.resolveCorrectorExecution({
                            fullText: text,
                            equipment: equip,
                        });
                        if (exec && exec.variant) {
                            variant = exec.variant;
                        }
                    }
                } catch (_e) {}
                const maskKind =
                    step.id === 71 || step.id === 72
                        ? 'warning'
                        : step.id === 74 || step.id === 75
                          ? 'alarm'
                          : step.id === 77
                            ? 'emergency'
                            : 'mask';
                maskRowClass = '';
                const kindLabel =
                    maskKind === 'warning'
                        ? 'предупреждения'
                        : maskKind === 'alarm'
                          ? 'тревоги'
                          : maskKind === 'emergency'
                            ? 'аварии'
                            : 'маска';
                maskExecHtml =
                    `<div class="mt-1 d-flex flex-wrap gap-1">` +
                    `<span class="badge text-bg-secondary param-mask-kind">${kindLabel}</span>` +
                    `<span class="badge text-bg-light border text-dark param-mask-exec" data-mask-step="${step.id}">исполнение ${escapeHtml(
                        variant
                    )}</span></div>`;
            }

            const unit = unitForStep(step);
            const unitHtml = unit
                ? `<span class="param-unit text-body-secondary small ms-1 text-nowrap" title="единица (в корректор не пишется)">${escapeHtml(
                      unit
                  )}</span>`
                : '';

            // Даты комплекса по умолчанию — 00.00.0000 (не «сегодня»).
            if ((step.id === 202 || step.id === 203 || step.id === 298 || step.id === 299) && !defaultVal) {
                defaultVal = '00.00.0000';
            }

            const tr = document.createElement('tr');
            tr.setAttribute('data-step-id', String(step.id));
            tr.setAttribute('data-search', `${step.id} ${step.g} ${step.title} ${reg}`.toLowerCase());
            tr.className = 'param-step-row' + maskRowClass;
            // hidden — скрываем строку (п.70 «Период измерения»): значение сохраняется, пишется в батче.
            if (step.hidden) {
                tr.style.display = 'none';
            }
            tr.innerHTML =
                `<td class="text-body-secondary text-end align-top">${step.id}</td>` +
                `<td class="font-monospace small align-top">${reg}</td>` +
                `<td class="align-top"><span class="badge text-bg-light border me-1">${(groups && groups[step.g]) || step.g}</span><div class="small fw-medium">${escapeHtml(
                    step.title
                )}</div>` +
                maskExecHtml +
                `</td>` +
                `<td class="align-top"><div class="d-flex align-items-center gap-1 flex-nowrap">` +
                `<input type="text" class="form-control form-control-sm param-val" id="${valId}" 
                data-step-id="${step.id}" 
                value="${defaultVal ? escapeAttr(defaultVal) : ''}" 
                ${step.readOnly || isDefaultSettingsCmd(step) ? 'readonly disabled' : ''} 
                placeholder="${placeholderForType(step)}" 
                style="min-width:7rem;max-width:12rem">${unitHtml}</div>${dateHintHtml}</td>` +
                `<td class="text-nowrap align-top">` +
                (step.writeOnly
                    ? ''
                    : `<button type="button" class="btn btn-sm btn-outline-success me-1 btn-r" data-sid="${step.id}">Прочитать</button>`) +
                (isDefaultSettingsCmd(step)
                    ? `<button type="button" class="btn btn-sm btn-warning btn-w-default" data-sid="${step.id}" title="DEFAULT_SETTINGS: команда ${defaultSettingsCmdValue(step)}">Записать</button>`
                    : step.readOnly
                      ? ''
                      : `<button type="button" class="btn btn-sm btn-outline-warning btn-w" data-sid="${step.id}"${
                            step.manufacturerOnly
                                ? ' title="Регистр производителя — нужен ключ в админке (ТМ-07)"'
                                : ''
                        }>Записать</button>`) +
                 ` <span class="font-monospace out text-body-secondary" id="${stepOutId(step)}">—</span></td></tr>`;
            tbody.appendChild(tr);
            if (step.type === 't') {
                const inp = el(valId);
                inp?.addEventListener('input', () => updateDatetimeHint(step.id));
                updateDatetimeHint(step.id);
            }
            if (step.type === 'f' || step.type === 'd') {
                const inp = el(valId);
                inp?.addEventListener('blur', () => {
                    inp.value = formatStepInputValue(step, inp.value);
                });
            }
        });
        // Скрыть строки отсутствующих датчиков (ППД / ПТТП) после сборки таблицы.
        try {
            const Ops = window.TM07_WORKBENCH_OPS;
            if (Ops && typeof Ops.updateOrderScopeUi === 'function') {
                Ops.updateOrderScopeUi();
            }
        } catch (_e) {}
    }

    window.TM07_param_formatStepValue = formatStepInputValue;

    function setBatchParamButtonsDisabled(dis) {
        batchButtonIds.forEach((id) => {
            const b = el(id);
            if (b) b.disabled = !!dis;
        });
    }

    function formatElapsed(ms) {
        const totalSeconds = Math.max(0, Math.round((ms || 0) / 1000));
        const m = Math.floor(totalSeconds / 60);
        const s = totalSeconds % 60;
        return m + ':' + String(s).padStart(2, '0');
    }

    let batchTimer = null; // { total, done, base, count }

    function countReadableSteps(steps) {
        return (steps || []).filter(function (s) {
            return s && s.type !== 'x' && s.reg && !s.writeOnly;
        }).length;
    }

    function startBatchTimer(total, opts) {
        const nested = !!(opts && opts.nested);
        const accumulate = !!(opts && opts.accumulate);
        if (!batchTimer) {
            batchTimer = { count: 0, total: 1, done: 0, base: 0 };
        }
        const t = batchTimer;
        if (!nested) {
            t.done = 0;
            t.base = 0;
            t.total = Math.max(1, Number(total) || 1);
        } else if (accumulate) {
            t.base = t.done;
        } else {
            t.base = 0;
            t.total = Math.max(1, Number(total) || t.total || 1);
        }
        t.count += 1;
        if (opts && opts.progressId) {
            t.progressId = opts.progressId;
        } else if (!nested) {
            t.progressId = null;
        }
        const b = el('paramTimer');
        if (b) b.classList.remove('d-none');
        const fb = el('paramFinalTimer');
        if (fb && t.progressId === 'paramFinalTimer') {
            fb.classList.remove('d-none');
        }
        renderBatchTimer();
    }

    function bumpBatchTimer(localDone) {
        if (batchTimer) {
            batchTimer.done = (batchTimer.base || 0) + Math.max(0, Number(localDone) || 0);
            renderBatchTimer();
        }
    }

    function suspendBatchTimer() {
        renderBatchTimer();
    }

    function resumeBatchTimer() {
        renderBatchTimer();
    }

    function stopBatchTimer() {
        if (!batchTimer) return;
        batchTimer.count -= 1;
        if (batchTimer.count <= 0) {
            const b = el('paramTimer');
            if (b) b.classList.add('d-none');
            const keepFinal = batchTimer.progressId === 'paramFinalTimer' && batchProgressPct() >= 100;
            const fb = el('paramFinalTimer');
            if (fb && !keepFinal) {
                fb.classList.add('d-none');
            }
            batchTimer = null;
        }
    }

    function batchProgressPct() {
        if (!batchTimer) {
            return 0;
        }
        const total = Math.max(1, Number(batchTimer.total) || 1);
        const done = Math.max(0, Number(batchTimer.done) || 0);
        return Math.min(100, Math.round((done / total) * 100));
    }

    function renderBatchTimer() {
        if (!batchTimer) return;
        const b = el('paramTimer');
        const done = Math.max(0, Number(batchTimer.done) || 0);
        const total = Math.max(1, Number(batchTimer.total) || 1);
        const pct = batchProgressPct();
        if (b) {
            b.textContent = pct + '%';
            b.title = 'Выполнено ' + done + ' из ' + total + ' (' + pct + '%)';
        }
        const wl = el('wbWriteTimerLeft');
        if (wl) {
            wl.textContent = pct + '%';
        }
        const we = el('wbWriteTimerElapsed');
        if (we) we.textContent = done + ' / ' + total;
        const ws = el('wbWriteTimerStep');
        if (ws) ws.textContent = pct + '%';
        const fb = el('paramFinalTimer');
        if (fb && batchTimer.progressId === 'paramFinalTimer') {
            fb.textContent = pct + '%';
            fb.title = 'Выполнено ' + done + ' из ' + total + ' (' + pct + '%)';
            fb.classList.remove('d-none');
            fb.classList.toggle('text-bg-success', pct >= 100);
            fb.classList.toggle('text-bg-dark', pct < 100);
        }
    }

    async function runReadAllSteps(steps, label, opts) {
        const nested = !!(opts && opts.nested);
        const accumulate = !!(opts && opts.accumulate);
        if (!nested && batchParamRunning) {
            return { ok: 0, fail: 0, skipped: true };
        }
        if (connectBusy) {
            log('Дождитесь завершения подключения КАО (чтение паспорта…).');
            return { ok: 0, fail: 0, skipped: true };
        }
        if (!isKaoPortOpen()) {
            log('Сначала подключите КАО');
            return { ok: 0, fail: 0, skipped: true };
        }
        if (!nested) {
            batchParamRunning = true;
            setBatchParamButtonsDisabled(true);
        }
        const t0 = performance.now();
        const readableSteps = steps.filter((s) => s.type !== 'x' && s.reg && !s.writeOnly);
        startBatchTimer(readableSteps.length, { nested: nested, accumulate: accumulate });
        let doneCount = 0;
        let ok = 0;
        let fail = 0;
        clog('READ ALL start', label || 'основные', steps.filter((s) => s.type !== 'x' && s.reg).length, 'шагов');
        try {
            for (const step of steps) {
                if (step.type === 'x' || !step.reg || step.writeOnly) continue;
                const oreg = getRegOverrideForStep(step);
                const out = el(stepOutId(step));
                if (out) setOutStatus(out, '…', 'pending');
                try {
                    if (isSensorMemoryCmd(step)) {
                        const t = await doReadSensorMemoryCompare(step);
                        log(`[${step.id}] чтение памяти / сверка → ${t}`);
                        ok += 1;
                    } else {
                    const t = await doReadStep(step, oreg, { updateInput: false });
                    if (out) setOutStatus(out, t, 'ok');
                    log(`[${step.id}] чтение ${formatHoldingAddr(oreg ?? step.reg)} → ${t}`);
                    ok += 1;
                    }
                } catch (e) {
                    if (out) setOutStatus(out, 'ошибка', 'err');
                    let m = e.message;
                    if (/0x2|недоступен|exception\s+0x2/i.test(m)) {
                        const mapHint =
                            deviceMapVersion != null ? `карта ${deviceMapVersion}` : 'карта прибора';
                        m += ` — проверьте адрес регистра (${mapHint}, REG_LKG ${formatHoldingAddr(lkgConfig.reg)}).`;
                    }
                    log(`[${step.id}] ${m}`);
                    clogErr('READ ALL', `п.${step.id}`, m);
                    fail += 1;
                    await new Promise((r) => setTimeout(r, BATCH_GAP_AFTER_ERR_MS));
                }
                doneCount += 1;
                bumpBatchTimer(doneCount);
                await new Promise((r) => setTimeout(r, BATCH_GAP_MS));
            }
            clog('READ ALL done', label || 'основные', { ok, fail });
            log(
                `<strong>Прочитать все (${label || 'основные'}): готово</strong> — удачно ${ok}, с ошибками ${fail}. ⏱ ${formatElapsed(performance.now() - t0)}`
            );
            return { ok, fail, skipped: false };
        } finally {
            stopBatchTimer();
            if (!nested) {
                batchParamRunning = false;
                setBatchParamButtonsDisabled(false);
            }
        }
    }

    async function runWriteAllSteps(steps, label, opts) {
        const nested = !!(opts && opts.nested);
        if (!nested && batchParamRunning) {
            return { ok: 0, fail: 0, skip: 0, aborted: false };
        }
        if (connectBusy) {
            log('Дождитесь завершения подключения КАО.');
            return { ok: 0, fail: 0, skip: 0, aborted: false };
        }
        if (!isKaoConnected()) {
            log('Сначала подключите КАО');
            return { ok: 0, fail: 0, skip: 0, aborted: false };
        }
        const skipEnsure78 = opts && opts.skipEnsure78;
        const skipLockPreflight = opts && opts.skipLockPreflight;
        if (!skipLockPreflight) {
            const pre = await ensureLockWriteReady({
                allowConfirmOverride: false,
                strictLock: !!(opts && opts.strictLock),
            });
            if (!pre.ok) {
                clog('WRITE ALL blocked', 'lock preflight');
                return { ok: 0, fail: 0, skip: 0, aborted: true, lockBlocked: true };
            }
        }
        try {
            await beginLkgSession(label || 'WRITE ALL');
        } catch (e) {
            clogErr('LKG session WRITE ALL', e);
            log('<strong>ЛКГ-сессия:</strong> ' + (e.message || String(e)));
            return { ok: 0, fail: 1, skip: 0, aborted: true };
        }
        if (!nested) {
            batchParamRunning = true;
            setBatchParamButtonsDisabled(true);
        }
        let ok = 0;
        let fail = 0;
        let skip = 0;
        let consecutiveFails = 0;
        let aborted = false;
        let abortStepId = null;
        const t0 = performance.now();
        const skipAlreadyOk = !!(opts && opts.skipAlreadyOk);
        const ordered = orderStepsForBatchWrite(steps, opts);
        startBatchTimer(ordered.length, {
            nested: !!nested,
            accumulate: !!(opts && opts.accumulate),
            progressId: /финал/i.test(String(label || '')) ? 'paramFinalTimer' : opts && opts.progressId,
        });
        let stepCount = 0;
        const mfgPending = ordered.filter((s) => s.manufacturerOnly && lkgConfig.manufacturerKey);
        const mfgAtEnd =
            !!(opts && opts.preserveStepOrder === false) && mfgPending.length > 0;
        clog(
            'WRITE ALL start',
            label || 'основные',
            ordered.length,
            'шагов',
            skipAlreadyOk ? '(resume/skip ok)' : '',
            opts && opts.preserveStepOrder === false ? '(производитель в конце)' : '(порядок карты)'
        );
        if (mfgAtEnd) {
            clog('WRITE ALL', 'производитель в конце', mfgPending.map((s) => s.id).join(','));
            // В таблице п.3–5 сверху: пока идут параметры поставщика — помечаем «в конце».
            mfgPending.forEach(function (s) {
                const o = el(stepOutId(s));
                if (o && !isStepWriteMarkedOk(s.id)) {
                    setOutStatus(o, 'в конце', 'pending');
                }
            });
        }
        try {
            if (
                !skipEnsure78 &&
                steps.some((s) => s.id >= 100) &&
                !steps.some((s) => s.id === 78)
            ) {
                await ensureSupplierAccessLevel();
            }
            let prevManufacturer = false;
            for (const step of ordered) {
                stepCount += 1;
                bumpBatchTimer(stepCount);
                if (!isKaoConnected()) {
                    log('<strong>Запись прервана: КАО отключён.</strong>');
                    clog('WRITE ALL aborted', 'disconnect');
                    aborted = true;
                    abortStepId = step.id;
                    noteWriteAbort(step.id, label);
                    break;
                }
                if (skipAlreadyOk && isStepWriteMarkedOk(step.id)) {
                    skip += 1;
                    clog('WRITE ALL skip', `п.${step.id}`, 'уже ok');
                    continue;
                }
                if (step.manufacturerOnly && !prevManufacturer) {
                    prevManufacturer = true;
                    if (mfgAtEnd) {
                        log('Регистры производителя (S/N и др.) — в конце, после параметров поставщика…');
                    }
                    await new Promise((r) => setTimeout(r, BATCH_GAP_MANUFACTURER_MS));
                }
                const oreg = getRegOverrideForStep(step);
                const out = el(stepOutId(step));
                const vin = el(stepInputId(step));
                if (isSensorMemoryCmd(step)) {
                    const batchSkipMem = batchWriteSkipReason(step);
                    if (batchSkipMem) {
                        if (out) setOutStatus(out, '—', 'idle');
                        log(`[${step.id}] пропуск (${batchSkipMem})`);
                        clog('WRITE ALL skip', `п.${step.id}`, batchSkipMem);
                        skip += 1;
                        continue;
                    }
                    if (out) setOutStatus(out, '…', 'pending');
                    try {
                        const mem = await doWriteSensorMemoryCmd(step);
                        if (out && !(mem && mem.painted)) {
                            setOutStatus(out, 'ok', 'ok');
                        }
                        log(`[${step.id}] запись ${formatHoldingAddr(step.reg)} ok (запоминание S/N)`);
                        ok += 1;
                        consecutiveFails = 0;
                    } catch (e) {
                        if (out) setOutStatus(out, 'ошибка', 'err');
                        let m = e.message || String(e);
                        if (/0xb|недопустимое значение лкг/i.test(m)) {
                            m += ' — п.59/66: нужен Access-ЛКГ и ответ ЧЭ (п.58/65).';
                        }
                        log(`[${step.id}] ${m}`);
                        clogErr('WRITE ALL', `п.${step.id}`, m);
                        fail += 1;
                        consecutiveFails += 1;
                        noteWriteAbort(step.id, label);
                        await recoverAfterCommError();
                        if (isLockBlocked0b(m, window.__paramLockStatus) && !isSensorMemoryCmd(step)) {
                            log(lockPreflightHtml((window.__paramLockStatus && window.__paramLockStatus.raw) || 0x0001));
                            clog('WRITE ALL aborted', '0x0B lock', lockRawHex((window.__paramLockStatus && window.__paramLockStatus.raw) || 0));
                            aborted = true;
                            abortStepId = step.id;
                            break;
                        }
                        if (consecutiveFails >= MAX_CONSECUTIVE_WRITE_FAILS) {
                            log('<strong>Запись прервана: слишком много ошибок подряд.</strong>');
                            aborted = true;
                            abortStepId = step.id;
                            break;
                        }
                    }
                    await new Promise((r) => setTimeout(r, BATCH_GAP_MS));
                    continue;
                }
                if (step.id === 315 || step.type === 'battery') {
                    if (out) setOutStatus(out, '…', 'pending');
                    try {
                        const decoded = await doReadStep(step, oreg, { updateInput: false });
                        if (out) setOutStatus(out, decoded || 'ok', 'ok');
                        log(
                            `[${step.id}] опрос ${formatHoldingAddr(oreg ?? step.reg)}: ${decoded}`
                        );
                        ok += 1;
                        consecutiveFails = 0;
                    } catch (e) {
                        if (out) setOutStatus(out, 'ошибка', 'err');
                        const m = e.message || String(e);
                        log(`[${step.id}] ${m}`);
                        clogErr('WRITE ALL', `п.${step.id}`, m);
                        fail += 1;
                        consecutiveFails += 1;
                        noteWriteAbort(step.id, label);
                        await recoverAfterCommError();
                        if (consecutiveFails >= MAX_CONSECUTIVE_WRITE_FAILS) {
                            log('<strong>Запись прервана: слишком много ошибок подряд.</strong>');
                            aborted = true;
                            abortStepId = step.id;
                            break;
                        }
                    }
                    await new Promise((r) => setTimeout(r, BATCH_GAP_MS));
                    continue;
                }
                const batchSkip = batchWriteSkipReason(step);
                if (batchSkip) {
                    if (out) {
                        setOutStatus(out, '—', 'idle');
                    }
                    if (isBootstrapDefaultSettings(step)) {
                        log(`[${step.id}] пропуск (${batchSkip})`);
                    } else if (step.manufacturerOnly && !lkgConfig.manufacturerKey) {
                        const msg =
                            step.id === 3
                                ? `[${step.id}] пропуск S/N корректора — нужен ключ производителя или открытый замок (AutoPass через КАО)`
                                : `[${step.id}] запись пропущена (регистр производителя — нужен ключ или открытый замок)`;
                        log(msg);
                    }
                    clog('WRITE ALL skip', `п.${step.id}`, batchSkip);
                    skip += 1;
                    continue;
                }
                if (step.paramMask && opts && opts.stagingMasks) {
                    const stag = MASK_STAGING.find((m) => m.id === step.id);
                    if (out) setOutStatus(out, 'ok', 'ok');
                    log(`[${step.id}] маска — staging ${stag ? stag.val : ''} записан в начале параметризации; пакетом не перезаписываем (реальные И1…И4 — в финале)`);
                    clog('WRITE ALL skip', `п.${step.id}`, 'staging записан ранее');
                    skip += 1;
                    continue;
                }
                if (isDefaultSettingsCmd(step)) {
                    if (out) setOutStatus(out, '…', 'pending');
                    try {
                        const dres = await doWriteDefaultSettingsCmd(step, {
                            force: !isBootstrapDefaultSettings(step),
                            nested: true,
                            skipPassport: !!window.__paramDevicePassport,
                        });
                        if (dres && dres.skipped) {
                            if (out) setOutStatus(out, 'ok', 'ok');
                            log(
                                `[${step.id}] DEFAULT_SETTINGS (команда ${defaultSettingsCmdValue(step)}) уже выполнена — ok.`
                            );
                            skip += 1;
                        } else {
                            if (out) setOutStatus(out, 'ok', 'ok');
                            log(
                                `[${step.id}] DEFAULT_SETTINGS (команда ${defaultSettingsCmdValue(step)}) ok`
                            );
                            ok += 1;
                            consecutiveFails = 0;
                        }
                    } catch (e) {
                        if (out) setOutStatus(out, 'ошибка', 'err');
                        const m = e.message || String(e);
                        log(`[${step.id}] ${m}`);
                        fail += 1;
                        consecutiveFails += 1;
                        noteWriteAbort(step.id, label);
                        await recoverAfterCommError();
                        if (isLockBlocked0b(m, window.__paramLockStatus)) {
                            aborted = true;
                            abortStepId = step.id;
                            break;
                        }
                        if (consecutiveFails >= MAX_CONSECUTIVE_WRITE_FAILS) {
                            aborted = true;
                            abortStepId = step.id;
                            break;
                        }
                    }
                    await new Promise((r) => setTimeout(r, BATCH_GAP_MS));
                    continue;
                }
                if (step.closeCalibLock || step.id === 317) {
                    if (out) setOutStatus(out, '…', 'pending');
                    if (opts && opts.pauseAtCloseCalibLock) {
                        // Финальный прогон: останавливаем пакет ПЕРЕД закрытием калибровочного
                        // замка — оператор закрывает его вручную и нажимает «Продолжить…».
                        try {
                            log(
                                `<strong>Остановка пакета:</strong> закройте калибровочный замок вручную (SA2/AutoPass) и нажмите «Продолжить после закрытия замка».`
                            );
                            clog('WRITE ALL pause', `п.${step.id}`, 'ожидание ручного закрытия калибр. замка');
                            suspendBatchTimer();
                            try {
                                await waitForFinalContinue();
                            } finally {
                                resumeBatchTimer();
                            }
                            if (out) setOutStatus(out, 'ok', 'ok');
                            log(
                                `[${step.id}] калибровочный замок закрыт вручную — продолжаем финальный прогон`
                            );
                            ok += 1;
                            consecutiveFails = 0;
                        } finally {
                            clearFinalContinue();
                        }
                        await new Promise((r) => setTimeout(r, BATCH_GAP_MS));
                        continue;
                    }
                    try {
                        log(
                            `[${step.id}] Закрытие калибровочного замка (0x06AA ← 0) перед очисткой регистров…`
                        );
                        await runCloseLocks();
                        if (out) setOutStatus(out, 'ok', 'ok');
                        log(`[${step.id}] калибровочный замок: команда закрытия выполнена`);
                        ok += 1;
                        consecutiveFails = 0;
                    } catch (e) {
                        if (out) setOutStatus(out, 'ошибка', 'err');
                        const m = e.message || String(e);
                        log(`[${step.id}] закрытие калибр. замка: ${m}`);
                        fail += 1;
                        consecutiveFails += 1;
                        noteWriteAbort(step.id, label);
                        await recoverAfterCommError();
                        if (consecutiveFails >= MAX_CONSECUTIVE_WRITE_FAILS) {
                            aborted = true;
                            abortStepId = step.id;
                            break;
                        }
                    }
                    await new Promise((r) => setTimeout(r, BATCH_GAP_MS));
                    continue;
                }
                let val = vin?.value;
                if (step.type === 't' && (!val || !String(val).trim())) {
                    val = formatUnixMoscow(nowUnixForDevice());
                    if (vin) vin.value = val;
                    updateDatetimeHint(step.id);
                } else if (!String(val ?? '').trim()) {
                    if (isMotoHoursResetStep(step)) {
                        val = '0';
                        if (vin) vin.value = '0';
                    } else if (step.settingsCrcCmd || step.id === 316) {
                        val = String(step.defaultNum != null ? step.defaultNum : 1);
                        if (vin) vin.value = val;
                    } else {
                        if (out) setOutStatus(out, '—', 'idle');
                        log(`[${step.id}] запись пропущена (пустое поле)`);
                        clog('WRITE ALL skip', `п.${step.id}`, 'пустое поле');
                        skip += 1;
                        continue;
                    }
                }
                if (out) setOutStatus(out, '…', 'pending');
                try {
                    await doWriteStepWithLockRetry(step, val, oreg);
                    if (isMotoHoursResetStep(step)) {
                        const decoded = await doReadStep(step, oreg, { updateInput: false });
                        if (!isZeroMotoHoursValue(decoded)) {
                            throw new Error(
                                'моточасы не обнулились (прочитано ' + (decoded || '—') + ')'
                            );
                        }
                        if (out) setOutStatus(out, decoded || '0', 'ok');
                        log(
                            `[${step.id}] обнуление ${formatHoldingAddr(oreg ?? step.reg)} ok, прочитано ${decoded}`
                        );
                    } else {
                        if (out) setOutStatus(out, 'ok', 'ok');
                        log(`[${step.id}] запись ${formatHoldingAddr(oreg ?? step.reg)} ok`);
                    }
                    ok += 1;
                    consecutiveFails = 0;
                    const holdMs = Number(step.testModeHoldMs) || 0;
                    if (holdMs > 0) {
                        log(
                            `[${step.id}] TestMode включён — пауза ${Math.round(holdMs / 1000)} с, затем выключение…`
                        );
                        await new Promise((r) => setTimeout(r, holdMs));
                    }
                } catch (e) {
                    if (out) setOutStatus(out, 'ошибка', 'err');
                    let m = e.message;
                    if (/0x2|недоступен|exception\s+0x2/i.test(m)) {
                        const mapHint =
                            deviceMapVersion != null ? `карта ${deviceMapVersion}` : 'карта прибора';
                        m += ` — проверьте адрес регистра (${mapHint}, REG_LKG ${formatHoldingAddr(lkgConfig.reg)}).`;
                    }
                    if (/0x5|замок|доступ закрыт/i.test(m)) {
                        m += ' — регистр производителя или нужен ключ производителя в админке.';
                    }
                    if (/0xb|недопустимое значение лкг/i.test(m)) {
                        const lock = window.__paramLockStatus;
                        const hint = lock ? lockWriteHint(lock.raw) : '';
                        m += hint ? ' — ' + hint : ' — проверьте замки и ключ ЛКГ.';
                    }
                    log(`[${step.id}] ${m}`);
                    clogErr('WRITE ALL', `п.${step.id}`, m);
                    fail += 1;
                    consecutiveFails += 1;
                    noteWriteAbort(step.id, label);
                    await recoverAfterCommError();
                    if (!isKaoConnected()) {
                        log('<strong>Запись прервана: КАО отключён.</strong>');
                        aborted = true;
                        abortStepId = step.id;
                        break;
                    }
                    if (isLockBlocked0b(m, window.__paramLockStatus)) {
                        try {
                            await refreshLockStatus();
                        } catch (_e) {}
                        log(lockPreflightHtml((window.__paramLockStatus && window.__paramLockStatus.raw) || 0x0001));
                        clog(
                            'WRITE ALL aborted',
                            '0x0B lock',
                            lockRawHex((window.__paramLockStatus && window.__paramLockStatus.raw) || 0)
                        );
                        aborted = true;
                        abortStepId = step.id;
                        break;
                    }
                    if (consecutiveFails >= MAX_CONSECUTIVE_WRITE_FAILS) {
                        log(
                            `<strong>Запись прервана: ${consecutiveFails} ошибок подряд (связь или ЛКГ).</strong> Проверьте КАО и повторите.`
                        );
                        clog('WRITE ALL aborted', 'consecutive fails', consecutiveFails);
                        aborted = true;
                        abortStepId = step.id;
                        break;
                    }
                }
                await new Promise((r) => setTimeout(r, BATCH_GAP_MS));
            }
            clog('WRITE ALL done', label || 'основные', { ok, skip, fail, aborted, abortStepId });
            const tail = aborted ? ' (прервано)' : '';
            log(
                `<strong>Записать все (${label || 'основные'}): готово${tail}</strong> — записано ${ok}, пропущено ${skip}, с ошибками ${fail}. ⏱ ${formatElapsed(performance.now() - t0)}` +
                    (aborted && abortStepId != null
                        ? ' Можно продолжить с п.' + abortStepId + ' (кнопка «Продолжить»).'
                        : '')
            );
            if (/финал/i.test(String(label || '')) && ok > 0 && fail === 0 && !aborted) {
                const tb = el('paramFinalTbody');
                if (tb) {
                    tb.querySelectorAll('tr[data-step-id]').forEach(function (row) {
                        const out = row.querySelector('span.out');
                        const t = out ? String(out.textContent || '').trim().toLowerCase() : '';
                        if (t === '✓' || t === 'ok' || (out && out.classList.contains('text-success'))) {
                            row.classList.add('param-write-ok', 'param-write-ok-final');
                        }
                    });
                }
            }
            return { ok, fail, skip, aborted, abortStepId };
        } finally {
            stopBatchTimer();
            if (!nested) {
                batchParamRunning = false;
                setBatchParamButtonsDisabled(false);
            }
        }
    }

    function wireTableActions(tbody) {
        if (!tbody) return;
        tbody.addEventListener('click', async (ev) => {
        const br = ev.target.closest('.btn-r');
        const bw = ev.target.closest('.btn-w') || ev.target.closest('.btn-w-default');
        if (!br && !bw) return;
        const sid = (br || bw).getAttribute('data-sid');
        // В финальной секции маски (71/72/74/75/77) — отдельные шаги с val_final_*;
        // кнопки строки должны работать со своим шагом, а не с шагом из основных.
        let step = null;
        const tbody = (br || bw).closest('tbody');
        if (tbody && tbody.id === 'paramFinalTbody') {
            const finalSec = (EXTRA?.sections || []).find((s) => s.key === 'final');
            step = ((finalSec && finalSec.steps) || []).find((s) => String(s.id) === String(sid));
        }
        if (!step) step = findStep(sid);
        if (!step) return;
        const oreg = getRegOverrideForStep(step);
        const out = el(stepOutId(step));
        const vin = el(stepInputId(step));
        try {
            if (br) {
                if (out) setOutStatus(out, '…', 'pending');
                if (isSensorMemoryCmd(step)) {
                    await doReadSensorMemoryCompare(step);
                    return;
                }
                const t = await doReadStep(step, oreg, { updateInput: false });
                if (out) setOutStatus(out, t, 'ok');
                log(`[${step.id}] чтение ${formatHoldingAddr(oreg ?? step.reg)} → ${t}`);
            } else {
                if (isDefaultSettingsCmd(step)) {
                    if (out) setOutStatus(out, '…', 'pending');
                    await doWriteDefaultSettingsCmd(step, {
                        force: !isBootstrapDefaultSettings(step),
                        nested: true,
                    });
                    if (out) setOutStatus(out, 'ok', 'ok');
                    log(
                        `[${step.id}] DEFAULT_SETTINGS (команда ${defaultSettingsCmdValue(step)}) ok`
                    );
                    return;
                }
                const manualSkip = batchWriteSkipReason(step);
                if (manualSkip) {
                    throw new Error(manualSkip);
                }
                let val = vin?.value;
                if (step.type === 't' && (!val || !String(val).trim())) {
                    val = formatUnixMoscow(nowUnixForDevice());
                    if (vin) vin.value = val;
                    updateDatetimeHint(step.id);
                }
                if (out) setOutStatus(out, '…', 'pending');
                if (isSensorMemoryCmd(step)) {
                    const mem = await doWriteSensorMemoryCmd(step);
                    if (out && !(mem && mem.painted)) {
                        setOutStatus(out, 'ok', 'ok');
                    }
                    log(
                        `[${step.id}] запись ${formatHoldingAddr(oreg ?? step.reg)} ok (запоминание S/N)`
                    );
                    return;
                }
                await doWriteStepWithLockRetry(step, val, oreg);
                if (out) setOutStatus(out, 'ok', 'ok');
                log(`[${step.id}] запись ${formatHoldingAddr(oreg ?? step.reg)} ok`);
            }
        } catch (e) {
            if (out) setOutStatus(out, 'ошибка', 'err');
            let m = e.message;
            if (/0x2|недоступен|exception\s+0x2/i.test(m)) {
                const mapHint =
                    deviceMapVersion != null ? `карта ${deviceMapVersion}` : 'карта прибора';
                m += ` — проверьте адрес регистра (${mapHint}, REG_LKG ${formatHoldingAddr(lkgConfig.reg)}).`;
            }
            if (/0x5|замок|доступ закрыт/i.test(m)) {
                m += ' — регистр производителя или нужен ключ производителя в админке.';
            }
            log(`[${step.id}] ${m}`);
            clogErr(br ? 'READ' : 'WRITE', `п.${step.id}`, m);
        }
        });
    }

    async function writeMaskStagingDuringParam() {
        // При параметризации маски выключаем: предупреждения (71/72) = 0, тревоги (74/75) = 3,
        // аварии (77) = 0. Реальные маски И1…И4 остаются в полях формы и пишутся в финале.
        const staging = [
            { id: 71, val: '0' },
            { id: 72, val: '0' },
            { id: 74, val: '3' },
            { id: 75, val: '3' },
            { id: 77, val: '0' },
        ];
        log('<strong>Маски (staging)</strong>: предупреждения (71/72)=0, тревоги (74/75)=3, аварии (77)=0…');
        for (let i = 0; i < staging.length; i += 1) {
            const item = staging[i];
            const step = findStep(item.id);
            if (!step) {
                continue;
            }
            const inp = el('val_' + item.id);
            const prev = inp ? String(inp.value || '') : '';
            if (inp) {
                inp.value = item.val;
            }
            try {
                await doWriteStep(step, item.val);
                log(`[${item.id}] staging ← ${item.val}`);
            } catch (e) {
                log(`[${item.id}] staging: ` + (e.message || String(e)));
                throw e;
            } finally {
                if (inp) {
                    inp.value = prev;
                }
            }
            await new Promise(function (r) {
                setTimeout(r, BATCH_GAP_MS);
            });
        }
    }

    async function runFinalParameters() {
        if (batchParamRunning) {
            log('Уже идёт пакетная операция — дождитесь завершения.');
            return { ok: 0, fail: 0, skip: 0, aborted: true };
        }
        if (!isKaoConnected()) {
            log('Сначала подключите КАО');
            return { ok: 0, fail: 0, skip: 0, aborted: true };
        }
        const finalSec = (EXTRA?.sections || []).find(function (s) {
            return s.key === 'final';
        });
        if (!finalSec || !finalSec.steps || !finalSec.steps.length) {
            log('Секция «Финальные параметры» не найдена.');
            return { ok: 0, fail: 0, skip: 0, aborted: true };
        }
        // Перед прогоном финалов проверяем всё: обязательные S/N/датчики/ЛКГ/направление
        // И все незаполненные строки параметризации (основные + счётчик + комплекс).
        const OpsBeforeFinal = window.TM07_WORKBENCH_OPS;
        const hardErrors = [];
        if (OpsBeforeFinal && typeof OpsBeforeFinal.validateBeforeParametrize === 'function') {
            try {
                const v = OpsBeforeFinal.validateBeforeParametrize();
                if (v && !v.ok && v.errors && v.errors.length) {
                    v.errors.forEach((msg) => hardErrors.push(String(msg || '')));
                }
            } catch (_eBeforeFinal) {
                /* валидация не должна останавливать прогон при сбоях модуля */
            }
        }
        if (OpsBeforeFinal && typeof OpsBeforeFinal.collectEmptyRequiredSteps === 'function') {
            try {
                const missing = OpsBeforeFinal.collectEmptyRequiredSteps();
                (missing || []).forEach(function (m) {
                    hardErrors.push('не заполнено: п.' + m.id + ' — ' + (m.title || '').replace(/<\/?[^>]+>/g, ''));
                });
            } catch (_eBeforeEmpty) {
                /* аналогично — не критично при сбое модуля */
            }
        }
        if (hardErrors.length) {
            // Выводим по строке; для «не заполнено» — без тегов, читаемо.
            hardErrors.forEach(function (msg) {
                log('<span class="text-danger">Не хватает: ' + msg.replace(/<\/?[^>]+>/g, '') + '</span>');
            });
            log('Прогон финальных параметров остановлен — заполните недостающее.');
            return { ok: 0, fail: 0, skip: 0, aborted: true, validationErrors: hardErrors };
        }
        // Дубль дат поверки комплекса (п.202/203 → п.298/299) перед прогоном.
        (finalSec.steps || []).forEach(function (step) {
            if (!step || step.syncFrom == null) {
                return;
            }
            const src = el('val_' + step.syncFrom);
            const dst = el('val_' + step.id);
            if (src && dst) {
                const v = String(src.value || '').trim();
                if (v) {
                    dst.value = v;
                }
            }
        });
        log('<strong>Прогон финальных параметров</strong> — маски И1…И4, даты, моточасы 302–308, заряд 315, CRC Settings №1 (п.316), очистка…');
        try {
            await writeFinalComplexModeFlags();
        } catch (e) {
            log('п.78/79: ' + (e.message || String(e)));
        }
        return runWriteAllSteps(finalSec.steps, 'финальные', {
            skipEnsure78: true,
            // Финальный прогон останавливается перед закрытием калибровочного замка (п.317):
            // оператор закрывает замок вручную и нажимает «Продолжить после закрытия замка».
            pauseAtCloseCalibLock: true,
            preserveStepOrder: true,
        });
    }

    const MASK_STAGING = [
        { id: 71, val: '0', note: 'предупреждения (поставщик)' },
        { id: 72, val: '0', note: 'предупреждения (производитель)' },
        { id: 74, val: '3', note: 'тревоги (производитель)' },
        { id: 75, val: '3', note: 'тревоги (поставщик)' },
        { id: 77, val: '0', note: 'аварии (производитель)' },
    ];

    function initParamSection(section) {
        const tbody = el(section.tbodyId);
        if (!tbody) return;
        const groups = section.groups || DOC.groups;
        buildStepsTable(tbody, section.steps, groups);
        wireTableActions(tbody);
        if (section.readAllId) {
            batchButtonIds.push(section.readAllId, section.writeAllId);
            el(section.readAllId)?.addEventListener('click', () => {
                void runReadAllSteps(section.steps, section.title || section.key);
            });
            el(section.writeAllId)?.addEventListener('click', () => {
                void runWriteAllSteps(section.steps, section.title || section.key, {
                    pauseAtCloseCalibLock: !!section.pauseAtCloseCalibLock,
                    preserveStepOrder: !!section.pauseAtCloseCalibLock || section.key === 'final',
                });
            });
        }
        if (section.runAllId) {
            batchButtonIds.push(section.runAllId);
            el(section.runAllId)?.addEventListener('click', () => {
                void runFinalParameters().catch(function (e) {
                    log('<strong>Финальные параметры:</strong> ' + (e.message || String(e)));
                });
            });
        }
        if (section.filterId) {
            el(section.filterId)?.addEventListener('input', () => {
                const q = el(section.filterId).value || '';
                tbody.querySelectorAll('tr[data-step-id]').forEach((tr) => {
                    tr.style.display = matchParamFilterRow(tr, q) ? '' : 'none';
                });
            });
        }
    }

    initParamSection({
        tbodyId: 'paramTbody',
        steps: DOC.steps,
        groups: DOC.groups,
        filterId: 'paramFilter',
        readAllId: 'paramReadAll',
        writeAllId: 'paramWriteAll',
        title: 'основные',
    });

    (EXTRA?.sections || []).forEach((sec) => {
        initParamSection({ ...sec, groups: EXTRA.groups });
    });

    // Кнопка «Продолжить после закрытия замка» — резолвит паузу финального прогона (п.317).
    el('paramFinalContinue')?.addEventListener('click', function () {
        if (finalContinueResolver) {
            const r = finalContinueResolver;
            finalContinueResolver = null;
            r();
        }
    });

    // Подставить даты комплекса в финальные поля (п.298/299 ← п.202/203).
    (function syncFinalComplexDates() {
        const finalSec = (EXTRA?.sections || []).find(function (s) {
            return s.key === 'final';
        });
        if (!finalSec) {
            return;
        }
        (finalSec.steps || []).forEach(function (step) {
            if (!step || step.syncFrom == null) {
                return;
            }
            const src = el('val_' + step.syncFrom);
            const dst = el('val_' + step.id);
            if (src && dst && !String(dst.value || '').trim()) {
                const v = String(src.value || '').trim();
                if (v) {
                    dst.value = v;
                }
            }
        });
    })();

    /**
     * Значение для строки .prm (CorrReader: запятая в дробях, маски hex без 0x).
     */
    function formatPrmValue(step, decoded) {
        if (decoded == null) {
            return '';
        }
        const t = step.type;
        const s = String(decoded).trim();
        if (s === '') {
            return '';
        }
        if (t === 'f' || t === 'd') {
            const n = Number(s.replace(/\s/g, '').replace(',', '.'));
            if (!Number.isFinite(n)) {
                return s.replace('.', ',');
            }
            return n.toFixed(4).replace('.', ',');
        }
        if (t === 't') {
            let unix = NaN;
            const mUnix = s.match(/unix\s+(\d+)/i);
            if (mUnix) {
                unix = parseInt(mUnix[1], 10);
            } else {
                const parsed = parseDatetimeInputToUnix(s);
                unix = parsed != null ? parsed : NaN;
            }
            if (Number.isFinite(unix) && unix > 0) {
                const human = formatUnixMoscow(unix);
                // .prm: ДД.ММ.ГГГГ,ЧЧ:ММ:СС (как CorrReader)
                return human.replace(', ', ',');
            }
            return s;
        }
        if (
            t === 'u' &&
            (step.defaultHex != null || /hex/i.test(String(step.hint || '')))
        ) {
            let num = NaN;
            if (/^0x/i.test(s)) {
                num = parseInt(s, 16);
            } else {
                num = parseInt(s, 10);
            }
            if (Number.isFinite(num)) {
                return (num >>> 0).toString(16).toUpperCase().padStart(8, '0');
            }
        }
        if (t === 'chr' || t === 'c32' || t === 's') {
            return s.replace(/\r?\n/g, ' ').trim();
        }
        return s.replace('.', ',');
    }

    function downloadTextFile(filename, text) {
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () {
            URL.revokeObjectURL(url);
        }, 1500);
    }

    function prmExportFilename() {
        const passport = window.__paramDevicePassport || {};
        const sn =
            passport.serial ||
            (el('val_3') && String(el('val_3').value || '').trim()) ||
            'unknown';
        const safeSn = String(sn).replace(/[^\w\-]+/g, '_').slice(0, 24);
        const now = new Date();
        const stamp =
            now.getFullYear().toString() +
            String(now.getMonth() + 1).padStart(2, '0') +
            String(now.getDate()).padStart(2, '0') +
            '_' +
            String(now.getHours()).padStart(2, '0') +
            String(now.getMinutes()).padStart(2, '0') +
            String(now.getSeconds()).padStart(2, '0');
        return 'tm07-params_' + safeSn + '_' + stamp + '.prm';
    }

    /**
     * Считать все параметры с корректора и сохранить в .prm (как «Считать все параметры в файл» в CorrReader).
     */
    async function exportAllParamsToPrmFile() {
        if (batchParamRunning) {
            throw new Error('Уже идёт пакетная операция — дождитесь завершения.');
        }
        if (connectBusy) {
            throw new Error('Дождитесь завершения подключения КАО.');
        }
        if (!isKaoPortOpen()) {
            throw new Error('КАО не подключён');
        }
        await waitModbusIdle(120000);
        const passport = window.__paramDevicePassport;
        if (passport && passport.mapVersion != null) {
            applyDeviceMapVersion(passport.mapVersion);
        }
        const mapV =
            deviceMapVersion != null
                ? deviceMapVersion
                : passport && passport.mapVersion != null
                  ? Number(passport.mapVersion)
                  : UI_MAP_VERSION;

        const Ops = window.TM07_WORKBENCH_OPS;
        const writeComplex =
            !Ops ||
            typeof Ops.shouldWriteComplexParams !== 'function' ||
            Ops.shouldWriteComplexParams();
        const sections = [{ steps: DOC.steps, title: 'основные', key: 'main' }].concat(
            EXTRA?.sections || []
        );

        const lines = [];
        lines.push('MapVersion=' + mapV);
        lines.push('; Экспорт с рабочего места ТМ-07 ' + new Date().toISOString());
        if (passport && passport.serial) {
            lines.push('; S/N=' + passport.serial);
        }

        batchParamRunning = true;
        setBatchParamButtonsDisabled(true);
        const exportBtn = el('paramExportPrm');
        if (exportBtn) {
            exportBtn.disabled = true;
        }
        let ok = 0;
        let fail = 0;
        try {
            log('<strong>Считывание параметров в файл…</strong>');
            for (const sec of sections) {
                if (!writeComplex && sec.key === 'complex') {
                    continue;
                }
                if (!isKaoPortOpen()) {
                    throw new Error('КАО отключился во время опроса');
                }
                const steps = sec.steps || [];
                for (const step of steps) {
                    if (step.type === 'x' || !step.reg || step.writeOnly) {
                        continue;
                    }
                    const oreg = getRegOverrideForStep(step);
                    const addr = formatHoldingAddr(oreg != null ? oreg : step.reg);
                const out = el(stepOutId(step));
                if (out) {
                    setOutStatus(out, '…', 'pending');
                }
                    try {
                        const decoded = await doReadStep(step, oreg, { updateInput: false });
                        const prmVal = formatPrmValue(step, decoded);
                        lines.push(addr + '=' + prmVal);
                        if (out) {
                            setOutStatus(out, decoded, 'ok');
                        }
                        ok += 1;
                    } catch (e) {
                        lines.push('; ' + addr + ' ERROR п.' + step.id + ': ' + (e.message || String(e)));
                        if (out) {
                            setOutStatus(out, 'ошибка', 'err');
                        }
                        fail += 1;
                        await new Promise((r) => setTimeout(r, BATCH_GAP_AFTER_ERR_MS));
                    }
                    await new Promise((r) => setTimeout(r, BATCH_GAP_MS));
                }
            }
            const filename = prmExportFilename();
            downloadTextFile(filename, lines.join('\r\n') + '\r\n');
            log(
                '<strong>Параметры сохранены в файл</strong> «' +
                    filename +
                    '» — ок ' +
                    ok +
                    (fail ? ', ошибок ' + fail : '') +
                    '.'
            );
            return { ok: ok, fail: fail, filename: filename };
        } finally {
            batchParamRunning = false;
            setBatchParamButtonsDisabled(false);
            if (exportBtn) {
                exportBtn.disabled = false;
            }
        }
    }

    el('paramExportPrm')?.addEventListener('click', function () {
        void exportAllParamsToPrmFile().catch(function (e) {
            log('<strong>Экспорт .prm:</strong> ' + (e.message || String(e)));
        });
    });

    function setFwBanner(html, kind) {
        const st = el('paramFwStatus');
        if (st) {
            st.textContent = html ? String(html).replace(/<[^>]+>/g, ' ') : '';
        }
        const b = el('paramFwBanner');
        if (!b) {
            return;
        }
        b.classList.remove('d-none', 'alert-info', 'alert-warning', 'alert-success', 'alert-danger', 'alert-secondary');
        b.classList.add('alert', kind === 'warn' ? 'alert-warning' : kind === 'ok' ? 'alert-success' : kind === 'err' ? 'alert-danger' : kind === 'info' ? 'alert-info' : 'alert-secondary');
    }

    function attachFwNameMeta(file) {
        if (!file) {
            return file;
        }
        const parsed = K.parseFirmwareFilename(file.name || '');
        if (!file.version && parsed.version) {
            file.version = parsed.version;
            file.versionTag = 'v' + parsed.version;
        }
        file.lkgHex = parsed.lkgHex || file.lkgHex || '';
        file.lkgBytes = parsed.lkgBytes && parsed.lkgBytes.length ? parsed.lkgBytes : file.lkgBytes || [];
        file.lkgKeys = parsed.lkgKeys && parsed.lkgKeys.length ? parsed.lkgKeys : file.lkgKeys || [];
        file.sizeFromName = parsed.sizeFromName || 0;
        return file;
    }

    function bytesToUint64LE(bytes) {
        let v = 0n;
        const n = Math.min(8, (bytes && bytes.length) || 0);
        for (let i = 0; i < n; i += 1) {
            v |= BigInt(bytes[i] & 0xff) << BigInt(8 * i);
        }
        return v;
    }

    function keyBytesLabel(bytes) {
        return (bytes || [])
            .map(function (b) {
                return b.toString(16).padStart(2, '0').toUpperCase();
            })
            .join('');
    }

    /** Варианты SaveLkg / Access из хвоста имени TM-07_…_v…_XXXXXXXX_XXXXXXXX. */
    function firmwareLkgCandidates(file) {
        attachFwNameMeta(file);
        const words = file.lkgKeys || [];
        const keys = [];
        const seenK = new Set();
        const addKey = function (k) {
            if (!k || k.length !== 4) {
                return;
            }
            const id = keyBytesLabel(k);
            if (seenK.has(id)) {
                return;
            }
            seenK.add(id);
            keys.push(k);
        };
        words.forEach(function (w) {
            addKey(w);
            addKey(w.slice().reverse());
        });
        const saves = [];
        const seenS = new Set();
        const addSave = function (bytes) {
            if (!bytes || bytes.length < 8) {
                return;
            }
            const v = bytesToUint64LE(bytes);
            const id = v.toString(16);
            if (!v || seenS.has(id)) {
                return;
            }
            seenS.add(id);
            saves.push(v);
        };
        if (file.lkgBytes && file.lkgBytes.length >= 8) {
            addSave(file.lkgBytes);
            addSave(file.lkgBytes.slice().reverse());
        }
        if (words.length >= 2) {
            addSave(words[0].slice().reverse().concat(words[1].slice().reverse()));
            addSave(words[1].concat(words[0]));
        }
        return { keys: keys, saves: saves, lkgHex: file.lkgHex || '' };
    }

    function parseFwList(j) {
        const files = (j && j.files) || [];
        return files
            .map(function (f) {
                const name = f.name || f.filename || '';
                const version = K.normalizeFwVersion(f.version || f.versionTag || name);
                return attachFwNameMeta({
                    name: name,
                    version: version,
                    versionTag: version ? 'v' + version : '',
                    lkgHex: f.lkgHex || '',
                    size: f.size || 0,
                });
            })
            .filter(function (f) {
                return f.name && f.version;
            });
    }

    /** Правильная прошивка: выбранный вручную файл, иначе из папки (по v…). */
    function pickCorrectFwFile(files) {
        if (window.__tm07FwLocal && window.__tm07FwLocal.name) {
            return window.__tm07FwLocal;
        }
        const list = files || window.__tm07FwFiles || [];
        return list[0] || null;
    }

    function renderFwPanel(opts) {
        const o = opts || {};
        const deviceVer = K.normalizeFwVersion(
            o.deviceVer != null && o.deviceVer !== ''
                ? o.deviceVer
                : window.__paramDevicePassport && window.__paramDevicePassport.fwVersion
        );
        const file = pickCorrectFwFile();
        window.__tm07FwPicked = file;
        const folderVer = file && file.version ? file.version : '';
        const connected = isKaoPortOpen();
        const match = !!(folderVer && deviceVer && folderVer === deviceVer);
        const dv = el('paramFwDeviceVer');
        const fv = el('paramFwFolderVer');
        const badge = el('paramFwMatch');
        const btn = el('paramFwFlashBtn');
        const st = el('paramFwStatus');
        const banner = el('paramFwBanner');
        if (dv) {
            dv.textContent = deviceVer ? 'v' + deviceVer : '—';
        }
        const lkgWrap = el('paramFwLkgWrap');
        if (lkgWrap) {
            lkgWrap.classList.add('d-none');
        }
        const lkgEl = el('paramFwLkg');
        if (lkgEl) {
            lkgEl.textContent = (file && file.lkgHex) || '—';
        }
        if (fv) {
            if (file && file.local) {
                fv.textContent = (folderVer ? 'v' + folderVer : file.name) + ' (вручную)';
            } else {
                fv.textContent = folderVer ? 'v' + folderVer : 'нет файла';
            }
        }
        if (badge) {
            badge.className = 'badge rounded-pill ';
            if (!connected) {
                badge.className += 'text-bg-secondary';
                badge.textContent = 'нет связи';
            } else if (!folderVer) {
                badge.className += 'text-bg-warning text-dark';
                badge.textContent = 'нет файла в firmware/';
            } else if (!deviceVer) {
                badge.className += 'text-bg-warning text-dark';
                badge.textContent = connected ? 'версия не считана' : 'ожидание версии';
            } else if (match) {
                badge.className += 'text-bg-success';
                badge.textContent = 'актуальная прошивка';
            } else {
                badge.className += 'text-bg-danger';
                badge.textContent = 'нужна перепрошивка';
            }
        }
        const pickLbl = el('paramFwFileLabel');
        if (pickLbl) {
            pickLbl.classList.add('d-none');
        }
        if (btn) {
            // При совпадении версий перепрошивка недоступна
            btn.disabled = !connected || !file || !!o.busy || match;
            if (match) {
                btn.title = 'Версия ПО уже актуальна (v' + deviceVer + ')';
            } else {
                btn.title = file
                    ? 'Залить ' + (file.versionTag || file.name) + ' из папки firmware'
                    : 'Нет файла в firmware/ — загрузите .bin в админке';
            }
        }
        if (st && o.status != null) {
            st.textContent = o.status;
        } else if (st && !o.keepStatus) {
            if (file && file.local) {
                st.textContent = 'файл: ' + file.name;
            } else if (connected && folderVer && deviceVer && !match) {
                st.textContent = 'нужна прошивка v' + folderVer;
            } else if (connected && match) {
                st.textContent = '';
            } else if (!folderVer) {
                st.textContent = 'выберите .bin или положите в firmware/';
            } else if (!connected) {
                st.textContent = '';
            }
        }
        if (banner) {
            banner.classList.remove('d-none', 'alert-info', 'alert-warning', 'alert-success', 'alert-danger', 'alert-secondary');
            banner.classList.add(
                'alert',
                !connected ? 'alert-secondary' : match ? 'alert-success' : folderVer ? 'alert-warning' : 'alert-secondary'
            );
        }
    }

    async function loadFirmwareList() {
        const r = await fetch('/api/tm07-firmware.php?action=list', { credentials: 'same-origin' });
        const j = await r.json();
        if (!j.ok) {
            throw new Error(j.error || 'список прошивок');
        }
        window.__tm07FwFiles = parseFwList(j);
        return window.__tm07FwFiles;
    }

    async function readDeviceFwVersion() {
        if (!dev) {
            throw new Error('КАО не подключён');
        }
        const resp = await dev.readHolding(K.REG_SW_VER || 0x0007, 5, 5000);
        const ver = K.trimRegisterText(K.modbusDataBytes(resp));
        const passport = window.__paramDevicePassport || {};
        passport.fwVersion = ver;
        window.__paramDevicePassport = passport;
        return K.normalizeFwVersion(ver);
    }

    function delayMs(ms) {
        return new Promise(function (res) {
            setTimeout(res, ms);
        });
    }

    /** После заливки прибор перезапускается — сразу 0x0007 пустой. */
    const FW_POST_FLASH_DELAY_MS = 8000;
    const FW_POST_FLASH_RETRY_MS = 2000;
    const FW_POST_FLASH_RETRIES = 8;

    async function waitAndReadFwVersionAfterFlash() {
        const totalSec = Math.round(FW_POST_FLASH_DELAY_MS / 1000);
        log('Пауза ' + totalSec + ' с после прошивки (перезапуск прибора), DEFAULT_SETTINGS не выполняется.');
        for (let left = totalSec; left > 0; left -= 1) {
            renderFwPanel({
                busy: true,
                keepStatus: true,
                status: 'ожидание перезапуска… ' + left + ' с',
            });
            await delayMs(1000);
        }
        let lastErr = null;
        for (let i = 0; i < FW_POST_FLASH_RETRIES; i += 1) {
            renderFwPanel({
                busy: true,
                keepStatus: true,
                status: 'чтение версии ПО (' + (i + 1) + '/' + FW_POST_FLASH_RETRIES + ')…',
            });
            try {
                const newVer = await readDeviceFwVersion();
                if (newVer) {
                    return newVer;
                }
            } catch (e) {
                lastErr = e;
                log('Версия ПО пока не отвечает: ' + (e.message || e));
            }
            await delayMs(FW_POST_FLASH_RETRY_MS);
        }
        throw lastErr || new Error('не удалось прочитать версию ПО после прошивки');
    }

    async function offerFirmwareAfterConnect() {
        try {
            if (!window.__tm07FwFiles || !window.__tm07FwFiles.length) {
                await loadFirmwareList();
            }
        } catch (e) {
            renderFwPanel({ status: 'папка прошивок: ' + (e.message || e) });
        }
        let deviceVer = K.normalizeFwVersion(window.__paramDevicePassport && window.__paramDevicePassport.fwVersion);
        try {
            deviceVer = await readDeviceFwVersion();
        } catch (e) {
            clogErr('firmware 0x0007', e);
        }
        renderFwPanel({ deviceVer: deviceVer });
        const file = pickCorrectFwFile();
        if (file && file.lkgHex) {
            log('ЛКГ из имени файла: ' + file.lkgHex);
        }
        if (deviceVer) {
            const need = file && file.version && file.version !== deviceVer;
            log('Версия ПО (0x0007): v' + deviceVer + (need ? ' — не сходится с v' + file.version : file ? ' — сходится' : ''));
        }
    }

    async function flashSelectedFirmware() {
        let flashed = false;
        let lastFwErr = null;
        const file = pickCorrectFwFile();
        if (!file || (!file.name && !file.bytes)) {
            throw new Error('Нет файла прошивки — выберите .bin вручную или положите в firmware/');
        }
        if (!dev) {
            throw new Error('КАО не подключён');
        }
        const label = file.versionTag || file.version || file.name;
        log('Прошивка: залив ' + label + ' (кнопка «Залить» — подтверждение).');
        renderFwPanel({ busy: true, keepStatus: true, status: 'загрузка ' + label + '…' });
        let buf;
        if (file.local && file.bytes) {
            buf = file.bytes;
        } else {
            const r = await fetch(
                '/api/tm07-firmware.php?action=file&name=' + encodeURIComponent(file.versionTag || file.version || file.name),
                { credentials: 'same-origin' }
            );
            if (!r.ok) {
                let msg = 'HTTP ' + r.status;
                try {
                    const j = await r.json();
                    if (j && j.error) {
                        msg = j.error;
                    }
                } catch (_e) {}
                throw new Error(msg);
            }
            buf = new Uint8Array(await r.arrayBuffer());
        }
        if (!buf.length) {
            throw new Error('Пустой файл прошивки');
        }
        log('Прошивка: ' + label + ' (' + file.name + '), ' + buf.length + ' байт.');
        attachFwNameMeta(file);
        if (file.sizeFromName && file.sizeFromName !== buf.length) {
            log('Размер файла ' + buf.length + ' байт не совпадает с именем (' + file.sizeFromName + ').');
        }
        const cands = firmwareLkgCandidates(file);
        if (!cands.keys.length && !cands.saves.length) {
            throw new Error('В имени файла нет ЛКГ (ожидается TM-07_…_v…_XXXXXXXX_XXXXXXXX.bin)');
        }
        log('ЛКГ из имени файла: ' + cands.lkgHex);
        try {
            await ensureLockWriteReady({ allowConfirmOverride: false, strictLock: true });
        } catch (_e) {}
        if (typeof dev.openManufacturerLock === 'function') {
            try {
                await dev.openManufacturerLock();
            } catch (e) {
                log('Замок производителя: ' + (e.message || e));
            }
        }

        const progress = function (done, total) {
            const pct = total ? Math.round((done / total) * 100) : 0;
            const st = el('paramFwStatus');
            if (st) {
                st.textContent = 'запись ' + label + ': ' + pct + '%';
            }
        };
        const isLkgErr = function (e) {
            return /0x0?b\b|exception\s*11|недопустимое значение лкг/i.test(String((e && e.message) || e || ''));
        };
        const tryDump = async function (armFn, retries) {
            renderFwPanel({ busy: true, keepStatus: true, status: 'запись ' + label + '… 0%' });
            await dev.writeFirmwareImage(buf, {
                timeoutMs: 20000,
                retries: retries,
                armLkg: armFn,
                onProgress: progress,
            });
            flashed = true;
        };
        const isCalibOpen =
            window.__paramLockStatus &&
            window.__paramLockStatus.raw != null &&
            typeof isCalibLockOpen === 'function' &&
            isCalibLockOpen(window.__paramLockStatus.raw);
        if (isMfgOptLockOpen() || isCalibOpen) {
            log('Замок открыт. Старт загрузки — ЛКГ-сессия из имени файла (без записи ключа на каждый блок 0x2002).');
        }

        for (let si = 0; si < cands.saves.length && !flashed; si += 1) {
            for (let ki = 0; ki < Math.max(1, cands.keys.length) && !flashed; ki += 1) {
                const save = cands.saves[si];
                const access = cands.keys[ki] || cands.keys[0];
                log(
                    'Прошивка ЛКГ-сессия: SaveLkg 0x' +
                        save.toString(16) +
                        (access ? ', Access ' + keyBytesLabel(access) : '')
                );
                try {
                    await beginLkgSession('прошивка', {
                        force: true,
                        allowManufacturer: true,
                        saveLkg: save,
                        accessKey: access,
                    });
                    await tryDump(async function () {
                        if (access) {
                            await dev.writeLkgKey(access, parseLkgReg(), 4000);
                            await new Promise(function (r) {
                                setTimeout(r, lkgConfig.delayMs);
                            });
                        }
                    }, 2);
                } catch (e) {
                    lastFwErr = e;
                    if (!isLkgErr(e)) {
                        throw e;
                    }
                    log('Прошивка: 0x0B при этом ЛКГ — ' + (e.message || e));
                }
            }
        }

        if (!flashed && !(isMfgOptLockOpen() || isCalibOpen)) {
            log('Прошивка: пробую заливку без записи ЛКГ из имени.');
            try {
                await tryDump(null, 1);
            } catch (e) {
                lastFwErr = e;
            }
        }

        if (!flashed) {
            throw lastFwErr || new Error('Недопустимое значение ЛКГ (0x0B) при старте загрузки 0x2000');
        }
        window.__tm07SkipDefaultSettingsAfterFlash = true;
        log('Прошивка записана (' + buf.length + ' байт). DEFAULT_SETTINGS (п.2) не вызываем.');
        let newVer = '';
        try {
            newVer = await waitAndReadFwVersionAfterFlash();
            renderFwPanel({
                deviceVer: newVer,
                status: file.version && newVer === file.version ? 'залито, v' + newVer : 'залито, ПО v' + newVer,
            });
            log('Версия ПО после прошивки: v' + newVer);
        } catch (e) {
            renderFwPanel({
                keepStatus: true,
                status: 'залито, версия пока не считалась. ' + (e.message || e),
            });
            log('Версия ПО после прошивки не считалась: ' + (e.message || e));
        }
        try {
            log('Инициализация замков после опроса ПО…');
            let lock = await refreshLockStatus();
            log('Статус замков: ' + describeLockStatus(lock.raw) + ' (' + lockRawHex(lock.raw) + ')');
            if (!isLockWriteReady(lock.raw)) {
                lock = await runAutoPassLocks({ force: true });
                log('Статус замков после AutoPass: ' + describeLockStatus(lock.raw) + ' (' + lockRawHex(lock.raw) + ')');
            }
            if (isLockWriteReady(lock.raw)) {
                log('Замки готовы к записи (' + lockRawHex(lock.raw) + ').');
            }
        } catch (e) {
            log('Замки после прошивки: ' + (e.message || e));
            clogErr('lock after flash', e);
        }
    }

    el('paramFwFlashBtn')?.addEventListener('click', function () {
        void flashSelectedFirmware()
            .catch(function (err) {
                log('<strong>Прошивка:</strong> ' + (err.message || String(err)));
                renderFwPanel({ keepStatus: true, status: err.message || String(err) });
            })
            .finally(function () {
                const btn = el('paramFwFlashBtn');
                if (btn) {
                    btn.disabled = !isKaoPortOpen() || !pickCorrectFwFile();
                }
            });
    });
    el('paramFwFile')?.addEventListener('change', function () {
        const inp = el('paramFwFile');
        const f = inp && inp.files && inp.files[0];
        if (!f) {
            return;
        }
        const version = K.normalizeFwVersion(f.name);
        const reader = new FileReader();
        reader.onload = function () {
            const raw = reader.result;
            window.__tm07FwLocal = attachFwNameMeta({
                name: f.name,
                version: version,
                versionTag: version ? 'v' + version : '',
                size: f.size,
                local: true,
                bytes: new Uint8Array(raw),
            });
            log(
                'Выбран файл прошивки: ' +
                    f.name +
                    (version ? ' → ' + window.__tm07FwLocal.versionTag : '') +
                    (window.__tm07FwLocal.lkgHex ? ', ЛКГ ' + window.__tm07FwLocal.lkgHex : '')
            );
            renderFwPanel({ status: 'выбран ' + f.name });
        };
        reader.onerror = function () {
            renderFwPanel({ keepStatus: true, status: 'не удалось прочитать файл' });
        };
        reader.readAsArrayBuffer(f);
    });
    void loadFirmwareList()
        .then(function () {
            renderFwPanel({ deviceVer: '' });
        })
        .catch(function (e) {
            renderFwPanel({ deviceVer: '', status: e.message || String(e) });
        });

    window.TM07_PARAM_KAO = {
        isConnected: isKaoConnected,
        isPortOpen: isKaoPortOpen,
        isConnectBusy: () => connectBusy,
        getDevicePassport: () => window.__paramDevicePassport,
        getLockStatus: () => window.__paramLockStatus,
        refreshLockStatus: refreshLockStatus,
        runAutoPassLocks: runAutoPassLocks,
        runCloseLocks: runCloseLocks,
        openLocks: function () {
            return runAutoPassLocks({ force: true });
        },
        closeLocks: runCloseLocks,
        ensureLockWriteReady: ensureLockWriteReady,
        isLockWriteReady: isLockWriteReady,
        runWriteAllSteps: runWriteAllSteps,
        runReadAllSteps: runReadAllSteps,
        runFinalParameters: runFinalParameters,
        writeDefaultSettings: (options) => doWriteDefaultSettingsCmd(findStep(2), options),
        tryAutoReconnect: tryAutoReconnectKao,
        readAllSections: async function (options) {
            if (!isKaoPortOpen()) {
                throw new Error('КАО не подключён');
            }
            await waitModbusIdle(120000);
            const passport = window.__paramDevicePassport;
            if (passport && passport.mapVersion != null) {
                applyDeviceMapVersion(passport.mapVersion);
            }
            const skipFinal = !!(options && options.skipFinal);
            log('<strong>Полный опрос корректора (все разделы)…</strong>');
            const t0 = performance.now();
            let totalOk = 0;
            let totalFail = 0;
            const Ops = window.TM07_WORKBENCH_OPS;
            const writeComplex =
                !Ops ||
                typeof Ops.shouldWriteComplexParams !== 'function' ||
                Ops.shouldWriteComplexParams();
            const sections = [{ steps: DOC.steps, title: 'основные', key: 'main' }].concat(
                EXTRA?.sections || []
            );
            const planned = [];
            for (const sec of sections) {
                if (!writeComplex && sec.key === 'complex') {
                    continue;
                }
                if ((sec.final || sec.key === 'final') && skipFinal) {
                    continue;
                }
                if (!sec.steps || !sec.steps.length) {
                    continue;
                }
                planned.push(sec);
            }
            const grand = planned.reduce(function (n, sec) {
                return n + countReadableSteps(sec.steps);
            }, 0);
            batchParamRunning = true;
            setBatchParamButtonsDisabled(true);
            startBatchTimer(Math.max(1, grand));
            try {
                for (const sec of planned) {
                    if (!isKaoPortOpen()) {
                        break;
                    }
                    const r = await runReadAllSteps(sec.steps, sec.title || sec.key || 'доп.', {
                        nested: true,
                        accumulate: true,
                    });
                    if (r && !r.skipped) {
                        totalOk += r.ok || 0;
                        totalFail += r.fail || 0;
                    }
                }
            } finally {
                stopBatchTimer();
                batchParamRunning = false;
                setBatchParamButtonsDisabled(false);
            }
            log(
                `<strong>Опрос завершён</strong> — прочитано ${totalOk}` +
                    (totalFail ? `, ошибок ${totalFail}` : '') +
                    `. ⏱ ${formatElapsed(performance.now() - t0)}`
            );
            return { ok: totalOk, fail: totalFail };
        },
        getLastWriteAbort: function () {
            return lastWriteAbort ? Object.assign({}, lastWriteAbort) : null;
        },
        clearLastWriteAbort: clearLastWriteAbort,
        /** Полный опрос корректора → скачать .prm (формат CorrReader). */
        exportAllParamsToPrmFile: exportAllParamsToPrmFile,
        writeAllSections: async function (options) {
            if (!isKaoConnected()) {
                throw new Error('КАО не подключён — запись невозможна.');
            }
            const t0 = performance.now();
            const resume = !!(options && options.resume);
            const skipAlreadyOk = resume || !!(options && options.skipAlreadyOk);
            await waitModbusIdle(120000);
            batchParamRunning = true;
            setBatchParamButtonsDisabled(true);
            try {
                const passport = window.__paramDevicePassport;
                if (passport && passport.mapVersion != null) {
                    applyDeviceMapVersion(passport.mapVersion);
                }
                const mapCheck = assertDeviceMapCompatible(passport && passport.mapVersion);
                if (!mapCheck.ok) {
                    throw new Error(mapCheck.message || 'Несовместимая карта регистров');
                }
                const pre = await ensureLockWriteReady({ allowConfirmOverride: false, strictLock: true });
                if (!pre.ok) {
                    throw new Error(
                        'Запись остановлена: замки не готовы. AutoPass через КАО (0x06A7) не открыл замок производителя — проверьте SA2 и пароль замка в админке.'
                    );
                }

                try {
                    await beginLkgSession('writeAllSections');
                } catch (e) {
                    throw new Error('ЛКГ-сессия не открылась: ' + (e.message || String(e)));
                }

                if (resume || skipAlreadyOk) {
                    const from = lastWriteAbort && lastWriteAbort.stepId != null ? 'п.' + lastWriteAbort.stepId : 'отметок ok';
                    log(
                        '<strong>Продолжение записи</strong> — шаги с отметкой ok пропускаются (с ' +
                            from +
                            ').'
                    );
                }

                const nestedOpts = {
                    skipEnsure78: true,
                    skipLockPreflight: true,
                    nested: true,
                    accumulate: true,
                    skipAlreadyOk: skipAlreadyOk,
                    // Порядок как в карте: п.2 DEFAULT_SETTINGS → … → маски 71/72/74/75/77 и очистки 318–320.
                    preserveStepOrder: true,
                    stagingMasks: false,
                };

                // Пропуск основных по отпечатку — только в явном resume (иначе похожий заказ не пишется).
                let mainAlready = false;
                if (resume) {
                    mainAlready = await isMainSectionAlreadyOnDevice();
                }

                const Ops = window.TM07_WORKBENCH_OPS;
                const writeComplex =
                    !Ops ||
                    typeof Ops.shouldWriteComplexParams !== 'function' ||
                    Ops.shouldWriteComplexParams();
                const skipComplexName =
                    Ops &&
                    typeof Ops.shouldSkipComplexName === 'function' &&
                    Ops.shouldSkipComplexName();
                const skipTelemetryName =
                    Ops &&
                    typeof Ops.shouldSkipTelemetryName === 'function' &&
                    Ops.shouldSkipTelemetryName();
                let grand = 0;
                if (!mainAlready) {
                    grand += orderStepsForBatchWrite(DOC.steps, nestedOpts).length;
                }
                for (const sec of EXTRA?.sections || []) {
                    // Заказ только на корректор (режим «счётчик»): комплекс не пишем.
                    if (!writeComplex && sec.key === 'complex') {
                        continue;
                    }
                    if (sec.key === 'final') {
                        continue;
                    }
                    if (sec.steps && sec.steps.length) {
                        let stepsForCount = sec.steps;
                        if (sec.key === 'complex' && (skipComplexName || skipTelemetryName)) {
                            stepsForCount = sec.steps.filter(function (s) {
                                if (!s) return false;
                                const id = Number(s.id);
                                if (skipComplexName && id === 200) return false;
                                if (skipTelemetryName && id === 227) return false;
                                return true;
                            });
                        }
                        grand += orderStepsForBatchWrite(stepsForCount, {
                            nested: true,
                            accumulate: true,
                        }).length;
                    }
                }
                startBatchTimer(Math.max(1, grand));

                if (mainAlready) {
                    log(
                        '<strong>Основные параметры уже записаны в корректоре</strong> (отпечаток диапазонов/газа/Q) — пропуск п.6–79, переход к счётчику/комплексу.'
                    );
                } else {
                    // Маски пишем в пакете после п.2 (DEFAULT_SETTINGS), а не заранее —
                    // иначе сброс настроек затирает staging 0/0/3/3/0 → в приборе остаётся 0xFFFFFFFF.
                    const mainResult = await runWriteAllSteps(DOC.steps, 'основные', nestedOpts);
                    if (mainResult && mainResult.lockBlocked) {
                        throw new Error(
                            'Запись остановлена: замки не готовы. AutoPass через КАО (0x06A7) не открыл замок производителя.'
                        );
                    }
                    // Любой fail/abort на основных — стоп. Отпечаток — только если fail=0 на критике
                    // (раньше fail на п.62=0 «перепад» давал fingerprint OK и ложный успех).
                    if (mainResult && (mainResult.aborted || mainResult.fail > 0)) {
                        const stepHint =
                            mainResult.abortStepId != null ? ', остановка на п.' + mainResult.abortStepId : '';
                        throw new Error(
                            'Запись основных параметров прервана (ok=' +
                                (mainResult.ok || 0) +
                                ', fail=' +
                                (mainResult.fail || 0) +
                                (mainResult.aborted ? ', aborted' : '') +
                                stepHint +
                                '). Нажмите «Продолжить с п.…» или проверьте замки (AutoPass) / значения каналов датчиков.'
                        );
                    }
                }

                if (!isKaoConnected()) {
                    throw new Error('КАО отключился после записи основных — счётчик/комплекс не записаны.');
                }

                if (!writeComplex) {
                    log(
                        '<strong>Только корректор + счётчик</strong> — параметры комплекса не пишем; счётчик (п.100+) пишем.'
                    );
                } else if (skipComplexName || skipTelemetryName) {
                    log(
                        '<strong>Корректор + счётчик + комплекс</strong> — регистры комплекса пишем' +
                            (skipComplexName ? ', <em>п.200 не записываем</em>' : '') +
                            (skipTelemetryName ? ', <em>п.227 не записываем (нет .БТ)</em>' : '') +
                            '.'
                    );
                }

                for (const sec of EXTRA?.sections || []) {
                    if (!writeComplex && sec.key === 'complex') {
                        continue;
                    }
                    if (!isKaoConnected()) {
                        throw new Error(
                            'КАО отключился во время записи дополнительных секций — нажмите «Продолжить с п.…».'
                        );
                    }
                    // Перед финалом — зафиксировать п.78/79 (самост./комплекс).
                    // Полный FINAL (моточасы/маски/очистка) — кнопкой «Прогнать финальные».
                    if (sec.key === 'final') {
                        await writeFinalComplexModeFlags();
                        continue;
                    }
                    let secSteps = sec.steps;
                    if (sec.key === 'complex' && (skipComplexName || skipTelemetryName)) {
                        secSteps = (sec.steps || []).filter(function (s) {
                            if (!s) return false;
                            const id = Number(s.id);
                            if (skipComplexName && id === 200) return false;
                            if (skipTelemetryName && id === 227) return false;
                            return true;
                        });
                    }
                    if (secSteps && secSteps.length) {
                        const secResult = await runWriteAllSteps(secSteps, sec.title || sec.key || 'доп.', {
                            skipLockPreflight: true,
                            nested: true,
                            accumulate: true,
                            skipAlreadyOk: skipAlreadyOk,
                        });
                        if (secResult && (secResult.lockBlocked || secResult.aborted || secResult.fail > 0)) {
                            const stepHint =
                                secResult.abortStepId != null ? ', п.' + secResult.abortStepId : '';
                            throw new Error(
                                'Запись «' +
                                    (sec.title || sec.key || 'доп.') +
                                    '» прервана (ok=' +
                                    (secResult.ok || 0) +
                                    ', fail=' +
                                    (secResult.fail || 0) +
                                    stepHint +
                                    '). Следующие секции не пишем — нажмите «Продолжить с п.…».'
                            );
                        }
                    }
                }
                // Если секции final нет — всё равно зафиксировать режим.
                const hasFinal = (EXTRA?.sections || []).some(function (s) {
                    return s.key === 'final';
                });
                if (!hasFinal) {
                    await writeFinalComplexModeFlags();
                }
                clearLastWriteAbort();
                log(
                    `<strong>Запись всех разделов завершена</strong> — сессия остаётся активной (финальные параметры на КАО, затем «Завершить сессию»). ⏱ ${formatElapsed(performance.now() - t0)}`
                );
                return { ok: true };
            } finally {
                stopBatchTimer();
                batchParamRunning = false;
                setBatchParamButtonsDisabled(false);
            }
        },
        setDatetimeNow: function (stepId) {
            const sid = stepId == null ? 20 : stepId;
            const s = formatUnixMoscow(nowUnixForDevice());
            const inp = el('val_' + sid);
            if (inp && !inp.disabled) {
                inp.value = s;
                updateDatetimeHint(sid);
            }
        },
        nowUnixForDevice: nowUnixForDevice,
        readDeviceFwVersion: readDeviceFwVersion,
        offerFirmwareAfterConnect: offerFirmwareAfterConnect,
        flashSelectedFirmware: flashSelectedFirmware,
        /** Точечная запись шагов (напр. п.102–104 счётчика после основной параметризации). */
        writeStepsByIds: async function (stepIds, options) {
            if (!isKaoConnected()) {
                throw new Error('КАО не подключён — запись невозможна.');
            }
            const ids = Array.isArray(stepIds) ? stepIds : [];
            const steps = ids.map(findStep).filter(Boolean);
            if (!steps.length) {
                throw new Error('Нет шагов для записи');
            }
            await waitModbusIdle(120000);
            batchParamRunning = true;
            setBatchParamButtonsDisabled(true);
            startBatchTimer(Math.max(1, steps.length));
            try {
                const passport = window.__paramDevicePassport;
                if (passport && passport.mapVersion != null) {
                    applyDeviceMapVersion(passport.mapVersion);
                }
                const mapCheck = assertDeviceMapCompatible(passport && passport.mapVersion);
                if (!mapCheck.ok) {
                    throw new Error(mapCheck.message || 'Несовместимая карта регистров');
                }
                const pre = await ensureLockWriteReady({ allowConfirmOverride: false, strictLock: true });
                if (!pre.ok) {
                    throw new Error(
                        'Запись остановлена: замки не готовы. AutoPass через КАО (0x06A7) не открыл замок производителя.'
                    );
                }
                await beginLkgSession('writeStepsByIds');
                const label = (options && options.label) || 'выбранные';
                const result = await runWriteAllSteps(steps, label, {
                    skipEnsure78: true,
                    skipLockPreflight: true,
                    nested: true,
                });
                if (result && (result.aborted || result.fail > 0)) {
                    throw new Error(
                        'Запись прервана (ok=' +
                            (result.ok || 0) +
                            ', fail=' +
                            (result.fail || 0) +
                            ').'
                    );
                }
                return result;
            } finally {
                stopBatchTimer();
                batchParamRunning = false;
                setBatchParamButtonsDisabled(false);
            }
        },
    };
})();
