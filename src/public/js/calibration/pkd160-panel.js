/**
 * Панель ПКД-160-Н (АРМ): протокол из calibrator.txt — кадры :addr;…;crc\r → !…\r,
 * CRC16 poly 0xA001 / init 0xFFFF по символам тела (как M90 UAIL в проекте).
 */
(function () {
    const AUTO_CONNECT_ENABLED_KEY = 'bench_tm07_auto_connect_enabled_v1';
    const connectBtn = document.getElementById('pkdConnectBtn');
    const disconnectBtn = document.getElementById('pkdDisconnectBtn');
    const initArmBtn = document.getElementById('pkdInitArmBtn');
    const exitArmBtn = document.getElementById('pkdExitArmBtn');
    const readBtn = document.getElementById('pkdReadBtn');
    const startPollBtn = document.getElementById('pkdStartPollBtn');
    const stopPollBtn = document.getElementById('pkdStopPollBtn');
    const setDacBtn = document.getElementById('pkdSetDacBtn');
    const dacInput = document.getElementById('pkdDacInput');

    if (!connectBtn) {
        return;
    }

    const PKD_DECIMALS = 5;
    /** Отображение измерений ПКД в таблице и в журнале */
    function fmtPkdNum(n) {
        return typeof n === 'number' && Number.isFinite(n) ? n.toFixed(PKD_DECIMALS) : '—';
    }

    const PKD_ADDR = 1;
    /** Microchip CDC (лог browser://device-log: VID 04D8, PID 000A) + запасной FTDI при другом адаптере */
    const PKD_FILTERS_FALLBACK = [
        { usbVendorId: 0x04d8, usbProductId: 0x000a },
        { usbVendorId: 0x0403, usbProductId: 0x6014 },
    ];

    async function resolvePkdConnectOptions() {
        let baud = 9600;
        let addr = PKD_ADDR;
        let filters = PKD_FILTERS_FALLBACK;
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
            if (settings && settings.pkd160) {
                const p = settings.pkd160;
                if (p.baudRate != null) baud = parseInt(String(p.baudRate), 10) || baud;
                if (p.busAddress != null) addr = parseInt(String(p.busAddress), 10) || addr;
                const vidHex =
                    p.vendorIdHex != null && String(p.vendorIdHex).trim() !== ''
                        ? p.vendorIdHex
                        : j.settings.usb && j.settings.usb.vendorIdHex
                          ? j.settings.usb.vendorIdHex
                          : '0x04D8';
                const pidHex = p.productIdHex || '0x000A';
                const vid = parseInt(String(vidHex).replace(/^0x/i, ''), 16);
                const pid = parseInt(String(pidHex).replace(/^0x/i, ''), 16);
                if (Number.isFinite(vid) && Number.isFinite(pid)) {
                    filters = [{ usbVendorId: vid, usbProductId: pid }];
                }
            }
        } catch (_e) {}
        return { baud, addr, filters };
    }

    const armStateEl = document.getElementById('pkdArmState');
    const batteryEl = document.getElementById('pkdBattery');
    const pRefEl = document.getElementById('pkdRefPressure');
    const pRefConvEl = document.getElementById('pkdRefPressureConv');
    const pCh1El = document.getElementById('pkdPCh1');
    const errCh1El = document.getElementById('pkdErrCh1');
    const relay1El = document.getElementById('pkdRelay1');
    const relay2El = document.getElementById('pkdRelay2');
    const accEl = document.getElementById('pkdAcc');
    const alarmEl = document.getElementById('pkdAlarm');

    const logEl = document.getElementById('log');
    const autoScrollLog = document.getElementById('autoScrollLog');

    let pkd = null;
    let pollId = null;
    const PKD_ARC_KEY = 'bench_tm07_pkd_autorc_v1';

    function rememberAutoReconnect(on) {
        try {
            if (on) localStorage.setItem(PKD_ARC_KEY, '1');
            else localStorage.removeItem(PKD_ARC_KEY);
        } catch (_e) {}
    }

    function isAutoReconnectEnabled() {
        try {
            const globalAuto = localStorage.getItem(AUTO_CONNECT_ENABLED_KEY);
            if (globalAuto === '0') return false;
            return localStorage.getItem(PKD_ARC_KEY) === '1';
        } catch (_e) {
            return false;
        }
    }

    function log(message) {
        if (!logEl) {
            return;
        }
        const timestamp = new Date().toLocaleTimeString();
        logEl.innerHTML += `[${timestamp}] [PKD] ${message}<br>`;
        if (!autoScrollLog || autoScrollLog.checked) {
            logEl.scrollTop = logEl.scrollHeight;
        }
    }

    class PKD160Device extends window.SerialDevice {
        constructor(address = PKD_ADDR) {
            super();
            this.address = address;
            this.buffer = '';
            this.pending = null;
            this.armInitialized = false;
            this.onDataReceived = (chunk) => {
                this.buffer += chunk;
                this.processBuffer();
            };
        }

        calcCRC16(dataStr) {
            let crc = 0xffff;
            for (let i = 0; i < dataStr.length; i += 1) {
                crc ^= dataStr.charCodeAt(i);
                for (let j = 0; j < 8; j += 1) {
                    const needXor = crc & 1;
                    crc >>= 1;
                    if (needXor) {
                        crc ^= 0xA001; // 40961
                    }
                }
            }
            return crc & 0xffff;
        }

        formatCommand(cmd, operands = []) {
            let body = `${this.address};${cmd}`;
            for (const op of operands) {
                body += `;${op}`;
            }
            body += ';';
            const crc = this.calcCRC16(body);
            return `:${body}${crc}\r`;
        }

        parseResponse(answer) {
            if (!answer.startsWith('!') || !answer.endsWith('\r')) {
                throw new Error('bad response format');
            }
            const raw = answer.slice(1, -1);
            const lastSep = raw.lastIndexOf(';');
            if (lastSep < 0) {
                throw new Error('no crc');
            }
            const payload = raw.slice(0, lastSep + 1);
            const crcText = raw.slice(lastSep + 1);
            const expected = parseInt(crcText, 10);
            const actual = this.calcCRC16(payload);
            if (!Number.isFinite(expected) || expected !== actual) {
                throw new Error(`crc mismatch ${expected} != ${actual}`);
            }
            const parts = payload.split(';').filter(Boolean);
            const addr = parseInt(parts[0], 10);
            const values = parts.slice(1);
            return { addr, values };
        }

        processBuffer() {
            while (this.buffer.includes('!')) {
                const start = this.buffer.indexOf('!');
                const rest = this.buffer.slice(start);
                const end = rest.indexOf('\r');
                if (end === -1) {
                    break;
                }
                const answer = rest.slice(0, end + 1);
                this.buffer = this.buffer.slice(start + end + 1);
                if (!this.pending) {
                    continue;
                }
                const { resolve, reject } = this.pending;
                this.pending = null;
                try {
                    resolve(this.parseResponse(answer));
                } catch (e) {
                    reject(e);
                }
            }
        }

        async sendCommand(cmd, operands = [], timeoutMs = 2500) {
            if (!this.isConnected) {
                throw new Error('device not connected');
            }
            if (this.pending) {
                throw new Error('another command is pending');
            }
            const packet = this.formatCommand(cmd, operands);
            return new Promise(async (resolve, reject) => {
                const timer = setTimeout(() => {
                    if (this.pending) {
                        this.pending = null;
                    }
                    reject(new Error('timeout'));
                }, timeoutMs);

                this.pending = {
                    resolve: (v) => {
                        clearTimeout(timer);
                        resolve(v);
                    },
                    reject: (e) => {
                        clearTimeout(timer);
                        reject(e);
                    }
                };

                try {
                    await this.write(packet);
                } catch (e) {
                    if (this.pending) {
                        const p = this.pending;
                        this.pending = null;
                        p.reject(e);
                    }
                }
            });
        }

        async initArmMode() {
            await this.sendCommand(11, [1, 0, 1, 1]);
            this.armInitialized = true;
        }

        async exitArmMode() {
            await this.sendCommand(11, [200, 0, 1, 200]);
            this.armInitialized = false;
        }

        async readMeasurement(ch) {
            const res = await this.sendCommand(1, [ch]);
            const v = parseFloat((res.values[0] || '').replace(',', '.'));
            if (Number.isNaN(v)) {
                throw new Error(`invalid measurement for ch ${ch}`);
            }
            return v;
        }

        async readStatus(addr) {
            const res = await this.sendCommand(10, [addr, 0, 1]);
            const v = parseInt(res.values[0], 10);
            if (Number.isNaN(v)) {
                throw new Error(`invalid status 0x${addr.toString(16)}`);
            }
            return v;
        }

        async setDacCurrent(mA) {
            await this.sendCommand(11, [45, 0, 3, mA]);
        }
    }

    function setArmState(on) {
        if (armStateEl) {
            armStateEl.textContent = on ? 'on' : 'off';
        }
    }

    function stopPolling() {
        if (pollId) {
            clearInterval(pollId);
            pollId = null;
        }
    }

    function clearUi() {
        setArmState(false);
        if (batteryEl) batteryEl.textContent = '—';
        if (pRefEl) pRefEl.textContent = '—';
        if (pRefConvEl) pRefConvEl.textContent = '—';
        if (pCh1El) pCh1El.textContent = '—';
        if (errCh1El) errCh1El.textContent = '—';
        if (relay1El) relay1El.textContent = '—';
        if (relay2El) relay2El.textContent = '—';
        if (accEl) accEl.textContent = '—';
        if (alarmEl) alarmEl.textContent = '—';
    }

    async function ensureArm() {
        if (!pkd) {
            throw new Error('not connected');
        }
        if (!pkd.armInitialized) {
            await pkd.initArmMode();
            setArmState(true);
            log('ARM mode initialized');
        }
    }

    async function readSnapshot() {
        if (!pkd || !pkd.isConnected) {
            throw new Error('not connected');
        }
        await ensureArm();

        const battery = await pkd.readMeasurement(0);
        const pRef = await pkd.readMeasurement(1);
        const pRefConv = await pkd.readMeasurement(2);
        const pCh1 = await pkd.readMeasurement(9);
        const errCh1 = await pkd.readMeasurement(13);

        const relay1 = await pkd.readStatus(0x0104);
        const relay2 = await pkd.readStatus(0x0105);
        const acc = await pkd.readStatus(0x0108);
        const alarm = await pkd.readStatus(0x0109);

        if (batteryEl) batteryEl.textContent = fmtPkdNum(battery);
        if (pRefEl) pRefEl.textContent = fmtPkdNum(pRef);
        if (pRefConvEl) pRefConvEl.textContent = fmtPkdNum(pRefConv);
        if (pCh1El) pCh1El.textContent = fmtPkdNum(pCh1);
        if (errCh1El) errCh1El.textContent = fmtPkdNum(errCh1);
        if (relay1El) relay1El.textContent = relay1 === 1 ? 'замкнуто' : 'разомкнуто';
        if (relay2El) relay2El.textContent = relay2 === 1 ? 'замкнуто' : 'разомкнуто';
        if (accEl) accEl.textContent = acc === 1 ? 'заряжается' : 'нет заряда';
        if (alarmEl) alarmEl.textContent = alarm === 1 ? 'активна' : 'норма';
    }

    connectBtn.addEventListener('click', async () => {
        try {
            const opts = await resolvePkdConnectOptions();
            pkd = new PKD160Device(opts.addr);
            await pkd.connect(opts.baud, { filters: opts.filters, skipRequestFilters: true });
            window.__benchPkd = pkd;
            rememberAutoReconnect(true);
            log(`connected (baud=${opts.baud}, addr=${opts.addr})`);
        } catch (e) {
            log(`connect error: ${e.message}`);
            pkd = null;
            window.__benchPkd = null;
        }
    });

    disconnectBtn.addEventListener('click', async () => {
        stopPolling();
        try {
            if (pkd) {
                try {
                    if (pkd.armInitialized) {
                        await pkd.exitArmMode();
                    }
                } catch (_e) {}
                await pkd.disconnect();
            }
            log('disconnected');
        } catch (e) {
            log(`disconnect error: ${e.message}`);
        } finally {
            pkd = null;
            window.__benchPkd = null;
            rememberAutoReconnect(false);
            clearUi();
        }
    });

    initArmBtn.addEventListener('click', async () => {
        try {
            if (!pkd || !pkd.isConnected) {
                throw new Error('not connected');
            }
            await pkd.initArmMode();
            setArmState(true);
            log('ARM init sent (11;1;0;1;1)');
        } catch (e) {
            log(`ARM init error: ${e.message}`);
        }
    });

    exitArmBtn.addEventListener('click', async () => {
        try {
            if (!pkd || !pkd.isConnected) {
                throw new Error('not connected');
            }
            await pkd.exitArmMode();
            setArmState(false);
            log('ARM exit sent (11;200;0;1;200)');
        } catch (e) {
            log(`ARM exit error: ${e.message}`);
        }
    });

    readBtn.addEventListener('click', async () => {
        try {
            await readSnapshot();
            log('snapshot updated');
        } catch (e) {
            log(`read error: ${e.message}`);
        }
    });

    startPollBtn.addEventListener('click', () => {
        stopPolling();
        pollId = setInterval(() => {
            readSnapshot().catch(() => {});
        }, 2000);
        log('polling started (2s)');
    });

    stopPollBtn.addEventListener('click', () => {
        stopPolling();
        log('polling stopped');
    });

    setDacBtn.addEventListener('click', async () => {
        try {
            if (!pkd || !pkd.isConnected) {
                throw new Error('not connected');
            }
            await ensureArm();
            const mA = parseFloat((dacInput?.value || '').replace(',', '.'));
            if (Number.isNaN(mA)) {
                throw new Error('invalid mA');
            }
            await pkd.setDacCurrent(mA);
            log(`DAC(I) set to ${fmtPkdNum(mA)} mA`);
        } catch (e) {
            log(`DAC error: ${e.message}`);
        }
    });

    const clearLogBtn = document.getElementById('clearLogBtn');
    if (clearLogBtn && logEl) {
        clearLogBtn.addEventListener('click', () => {
            logEl.innerHTML = '';
        });
    }

    clearUi();

    (async () => {
        if (!isAutoReconnectEnabled() || !navigator.serial) return;
        try {
            const opts = await resolvePkdConnectOptions();
            pkd = new PKD160Device(opts.addr);
            const ok = await pkd.reconnectGranted(opts.baud, { filters: opts.filters });
            if (!ok) {
                pkd = null;
                window.__benchPkd = null;
                return;
            }
            window.__benchPkd = pkd;
            log(`auto-connected (baud=${opts.baud}, addr=${opts.addr})`);
        } catch (e) {
            pkd = null;
            window.__benchPkd = null;
            log(`auto-connect error: ${e.message}`);
        }
    })();
})();

