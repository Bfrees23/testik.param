(function () {
    const AUTO_CONNECT_ENABLED_KEY = 'bench_tm07_auto_connect_enabled_v1';
    const connectBtn = document.getElementById('corrConnectBtn');
    if (!connectBtn) return;

    const KorrektorDeviceCls = window.KorrektorDevice;
    if (typeof KorrektorDeviceCls !== 'function') {
        return;
    }

    const disconnectBtn = document.getElementById('corrDisconnectBtn');
    const identifyBtn = document.getElementById('corrIdentifyBtn');
    const readDateBtn = document.getElementById('corrReadDateBtn');
    const readBtn = document.getElementById('corrReadBtn');
    const writeBtn = document.getElementById('corrWriteBtn');
    const addressInput = document.getElementById('corrAddress');
    const baudInput = document.getElementById('corrBaud');
    const readAddrInput = document.getElementById('corrReadAddr');
    const readCountInput = document.getElementById('corrReadCount');
    const writeAddrInput = document.getElementById('corrWriteAddr');
    const writeHexInput = document.getElementById('corrWriteHex');
    const statusEl = document.getElementById('corrStatus');
    const identEl = document.getElementById('corrIdent');
    const dtEl = document.getElementById('corrDateTime');
    const rawEl = document.getElementById('corrRaw');
    const logEl = document.getElementById('log');
    const autoScrollLog = document.getElementById('autoScrollLog');

    let dev = null;
    const CORR_ARC_KEY = 'bench_tm07_corr_autorc_v1';

    function rememberAutoReconnect(on) {
        try {
            if (on) localStorage.setItem(CORR_ARC_KEY, '1');
            else localStorage.removeItem(CORR_ARC_KEY);
        } catch (_e) {}
    }

    function isAutoReconnectEnabled() {
        try {
            const globalAuto = localStorage.getItem(AUTO_CONNECT_ENABLED_KEY);
            if (globalAuto === '0') return false;
            return localStorage.getItem(CORR_ARC_KEY) === '1';
        } catch (_e) {
            return false;
        }
    }

    function log(message) {
        const ts = new Date().toLocaleTimeString();
        if (logEl) {
            logEl.innerHTML += `[${ts}] [TM-07] ${message}<br>`;
            if (!autoScrollLog || autoScrollLog.checked) logEl.scrollTop = logEl.scrollHeight;
        }
    }
    function setStatus(text) {
        if (statusEl) statusEl.textContent = text;
    }
    function bytesToHex(bytes) {
        return Array.from(bytes, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
    }
    function parseHexBytes(text) {
        return text
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .map((x) => parseInt(x, 16))
            .filter((x) => Number.isFinite(x) && x >= 0 && x <= 255);
    }

    function getAddress() {
        const n = Number(addressInput.value);
        if (!Number.isInteger(n) || n < 1 || n > 15) throw new Error('Адрес должен быть 1..15');
        return n;
    }

    function getBaud() {
        const b = parseInt(baudInput?.value || '9600', 10);
        return Number.isFinite(b) && b > 0 ? b : 9600;
    }

    function toUnix64LE(data8) {
        let v = 0n;
        for (let i = 7; i >= 0; i -= 1) v = (v << 8n) | BigInt(data8[i]);
        return v;
    }

    function renderRaw(frame) {
        if (rawEl) rawEl.textContent = bytesToHex(frame);
    }

    function publishInstance() {
        window.__benchKorrektor = dev;
    }

    connectBtn.addEventListener('click', async () => {
        try {
            const address = getAddress();
            dev = new KorrektorDeviceCls(address);
            setStatus('подключение...');
            await dev.connect({ baudRate: getBaud() });
            setStatus(`подключен (addr=${address}, ${getBaud()} бод)`);
            publishInstance();
            rememberAutoReconnect(true);
            log(`Подключен, адрес ${address}, ${getBaud()} бод`);
        } catch (e) {
            setStatus('ошибка');
            dev = null;
            publishInstance();
            log(`Ошибка подключения: ${e.message}`);
        }
    });

    disconnectBtn.addEventListener('click', async () => {
        try {
            if (dev) await dev.disconnect();
        } finally {
            dev = null;
            publishInstance();
            rememberAutoReconnect(false);
            setStatus('отключено');
            log('Отключено');
        }
    });

    identifyBtn.addEventListener('click', async () => {
        try {
            if (!dev) throw new Error('Сначала подключите корректор');
            const resp = await dev.identify();
            renderRaw(resp);
            const data = resp.slice(3, 3 + resp[2]);
            const name = new TextDecoder().decode(data.slice(0, 20)).replace(/\0/g, '').trim();
            const fw = new TextDecoder().decode(data.slice(20, 32)).replace(/\0/g, '').trim();
            const sn = new TextDecoder().decode(data.slice(32, 52)).replace(/\0/g, '').trim();
            const map = data[52] | (data[53] << 8);
            identEl.textContent = `${name || '-'} | FW ${fw || '-'} | SN ${sn || '-'} | map ${map}`;
            log(`Идентификация: ${identEl.textContent}`);
        } catch (e) {
            log(`Ошибка 0x11: ${e.message}`);
        }
    });

    readDateBtn.addEventListener('click', async () => {
        try {
            if (!dev) throw new Error('Сначала подключите корректор');
            const resp = await dev.readHolding(0x0078, 4);
            renderRaw(resp);
            const data = resp.slice(3, 11);
            const unix = Number(toUnix64LE(data));
            dtEl.textContent =
                Number.isFinite(unix) && unix > 0
                    ? `${new Date(unix * 1000).toISOString()} (unix=${unix})`
                    : `unix=${unix}`;
            log(`DateTime: ${dtEl.textContent}`);
        } catch (e) {
            log(`Ошибка чтения DateTime: ${e.message}`);
        }
    });

    readBtn.addEventListener('click', async () => {
        try {
            if (!dev) throw new Error('Сначала подключите корректор');
            const addr = parseInt(readAddrInput.value.trim(), 16);
            const count = Number(readCountInput.value);
            const resp = await dev.readHolding(addr, count);
            renderRaw(resp);
            log(`Read 0x03 addr=0x${addr.toString(16)} count=${count} ok`);
        } catch (e) {
            log(`Ошибка чтения 0x03: ${e.message}`);
        }
    });

    writeBtn.addEventListener('click', async () => {
        try {
            if (!dev) throw new Error('Сначала подключите корректор');
            const addr = parseInt(writeAddrInput.value.trim(), 16);
            const bytes = parseHexBytes(writeHexInput.value);
            const resp = await dev.writeMultiple(addr, bytes);
            renderRaw(resp);
            log(`Write 0x10 addr=0x${addr.toString(16)} bytes=${bytes.length} ok`);
        } catch (e) {
            log(`Ошибка записи 0x10: ${e.message}`);
        }
    });

    (async () => {
        if (!isAutoReconnectEnabled() || !navigator.serial) return;
        try {
            const address = getAddress();
            dev = new KorrektorDeviceCls(address);
            setStatus('автоподключение...');
            const ok = await dev.reconnectGranted({ baudRate: getBaud() });
            if (!ok) {
                dev = null;
                setStatus('отключено');
                return;
            }
            publishInstance();
            setStatus(`подключен (addr=${address}, ${getBaud()} бод)`);
            log(`Автоподключение успешно, адрес ${address}, ${getBaud()} бод`);
        } catch (e) {
            dev = null;
            publishInstance();
            setStatus('отключено');
            log(`Автоподключение не удалось: ${e.message}`);
        }
    })();

    publishInstance();
})();
