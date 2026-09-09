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
    const readSerialBtn = document.getElementById('pkdReadSerialBtn');
    const startPollBtn = document.getElementById('pkdStartPollBtn');
    const stopPollBtn = document.getElementById('pkdStopPollBtn');
    const setDacBtn = document.getElementById('pkdSetDacBtn');
    const dacInput = document.getElementById('pkdDacInput');

    if (!connectBtn) {
        return;
    }

    /** EEPROM / SRAM адреса из «ПКД-160 Автоматизированное рабочее место» */
    const PKD_EEPROM_ID = 0x00; // идентификатор ППЗУ (WORD), ожидание 0x55AA
    const PKD_EEPROM_DEVICE_SN = 0x1e; // заводской номер прибора (WORD)
    const PKD_SRAM_DUT_SN = [0x2c, 0x30, 0x34, 0x38]; // зав. номера датчиков каналов 1–4 (DWORD)
    /** Тип операнда в кадре 10/11 (как у ИКСУ/UAIL): 1=BYTE/статус, 2=WORD, 3=FLOAT, 4=DWORD */
    const PKD_TYPE_BYTE = 1;
    const PKD_TYPE_WORD = 2;
    const PKD_TYPE_FLOAT = 3;
    const PKD_TYPE_DWORD = 4;

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
                        : settings.usb && settings.usb.vendorIdHex
                          ? settings.usb.vendorIdHex
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
    const eepromIdEl = document.getElementById('pkdEepromId');
    const deviceSnEl = document.getElementById('pkdDeviceSerial');
    const dutSnEls = [
        document.getElementById('pkdDutSerial1'),
        document.getElementById('pkdDutSerial2'),
        document.getElementById('pkdDutSerial3'),
        document.getElementById('pkdDutSerial4'),
    ];

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
                // Убрать ведущий 0xFF/мусор до начала кадра
                this.buffer += chunk;
                this.buffer = this.buffer.replace(/^[^\r\n:!]+/, '');
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
            // Нормализуем конец кадра (\r / \n / \r\n)
            const norm = String(answer).replace(/\r\n/g, '\r').replace(/\n/g, '\r');
            if (!norm.startsWith('!') || !norm.endsWith('\r')) {
                throw new Error('bad response format: ' + JSON.stringify(answer));
            }
            const raw = norm.slice(1, -1);
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
            return { addr, values, raw: norm };
        }

        processBuffer() {
            // Ищем кадр !…\r или !…\n
            while (this.buffer.includes('!')) {
                const start = this.buffer.indexOf('!');
                // Мусор до '!' (в т.ч. 0xFF)
                if (start > 0) {
                    this.buffer = this.buffer.slice(start);
                }
                const rest = this.buffer;
                let end = rest.search(/[\r\n]/);
                if (end === -1) {
                    break;
                }
                let endLen = 1;
                if (rest[end] === '\r' && rest[end + 1] === '\n') {
                    endLen = 2;
                }
                const answer = rest.slice(0, end + endLen);
                this.buffer = this.buffer.slice(end + endLen);
                if (!this.pending) {
                    console.warn('[PKD] ответ без ожидающей команды:', JSON.stringify(answer));
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
                    const buf = this.buffer;
                    this.buffer = '';
                    reject(
                        new Error(
                            'timeout (нет ответа !…\\r). buf=' +
                                JSON.stringify(buf) +
                                ' len=' +
                                buf.length
                        )
                    );
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
                        clearTimeout(timer);
                        p.reject(e);
                    }
                }
            });
        }

        /** Код $N в ответе UAIL: $0 = OK, иначе ошибка прибора. */
        assertOkOrValue(res, ctx) {
            const v0 = res && res.values && res.values[0] != null ? String(res.values[0]) : '';
            if (/^\$\d+$/.test(v0)) {
                if (v0 === '$0') {
                    return { ok: true, code: 0, values: res.values };
                }
                throw new Error((ctx || 'PKD') + ': код прибора ' + v0);
            }
            return { ok: true, code: null, values: res.values };
        }

        async initArmMode() {
            const res = await this.sendCommand(11, [1, 0, PKD_TYPE_BYTE, 1]);
            this.assertOkOrValue(res, 'Init ARM');
            this.armInitialized = true;
            await new Promise((r) => setTimeout(r, 300));
        }

        async exitArmMode() {
            const res = await this.sendCommand(11, [200, 0, PKD_TYPE_BYTE, 200]);
            this.assertOkOrValue(res, 'Exit ARM');
            this.armInitialized = false;
        }

        async readMeasurement(ch) {
            const res = await this.sendCommand(1, [ch]);
            this.assertOkOrValue(res, 'cmd1 ch' + ch);
            const v = parseFloat(String(res.values[0] || '').replace(',', '.'));
            if (Number.isNaN(v)) {
                throw new Error(`invalid measurement for ch ${ch}: ${res.values[0]}`);
            }
            return v;
        }

        /**
         * Чтение параметра командой 10.
         * dataType: 1=BYTE/статус, 2=WORD, 3=FLOAT, 4=DWORD (по аналогии с ИКСУ/UAIL).
         */
        async readParam(addr, dataType = PKD_TYPE_BYTE) {
            const res = await this.sendCommand(10, [addr, 0, dataType]);
            this.assertOkOrValue(res, 'cmd10 @0x' + addr.toString(16));
            const raw = String(res.values[0] || '').replace(',', '.');
            if (dataType === PKD_TYPE_FLOAT) {
                const f = parseFloat(raw);
                if (Number.isNaN(f)) {
                    throw new Error(`invalid float @0x${addr.toString(16)}: ${raw}`);
                }
                return f;
            }
            const v = parseInt(raw, 10);
            if (Number.isNaN(v)) {
                throw new Error(`invalid int @0x${addr.toString(16)}: ${raw}`);
            }
            return v;
        }

        async readStatus(addr) {
            return this.readParam(addr, PKD_TYPE_BYTE);
        }

        /** Зав. номер прибора (EEPROM WORD 0x1E) + id ППЗУ + S/N датчиков каналов 1–4. */
        async readSerials() {
            // Тип 2=WORD для EEPROM; если прошивка ждёт 1 — пробуем запасной вариант
            async function readWord(dev, addr) {
                try {
                    return await dev.readParam(addr, PKD_TYPE_WORD);
                } catch (e1) {
                    try {
                        return await dev.readParam(addr, PKD_TYPE_BYTE);
                    } catch (e2) {
                        throw e1;
                    }
                }
            }
            async function readDword(dev, addr) {
                try {
                    return await dev.readParam(addr, PKD_TYPE_DWORD);
                } catch (e1) {
                    try {
                        return await dev.readParam(addr, PKD_TYPE_WORD);
                    } catch (e2) {
                        try {
                            return await dev.readParam(addr, PKD_TYPE_BYTE);
                        } catch (e3) {
                            throw e1;
                        }
                    }
                }
            }

            const eepromId = await readWord(this, PKD_EEPROM_ID);
            const deviceSerial = await readWord(this, PKD_EEPROM_DEVICE_SN);
            const dutSerials = [];
            for (let i = 0; i < PKD_SRAM_DUT_SN.length; i += 1) {
                dutSerials.push(await readDword(this, PKD_SRAM_DUT_SN[i]));
            }
            return { eepromId, deviceSerial, dutSerials };
        }

        async setDacCurrent(mA) {
            const res = await this.sendCommand(11, [45, 0, PKD_TYPE_FLOAT, mA]);
            this.assertOkOrValue(res, 'DAC(I)');
        }
    }

    function fmtHexWord(n) {
        if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
        return '0x' + (n >>> 0).toString(16).toUpperCase().padStart(4, '0');
    }

    function fmtSerial(n) {
        if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
        return String(n);
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
        if (eepromIdEl) eepromIdEl.textContent = '—';
        if (deviceSnEl) deviceSnEl.textContent = '—';
        dutSnEls.forEach(function (el) {
            if (el) el.textContent = '—';
        });
    }

    function paintSerials(info) {
        if (eepromIdEl) {
            eepromIdEl.textContent = fmtHexWord(info.eepromId) + (info.eepromId === 0x55aa ? ' (ok)' : '');
        }
        if (deviceSnEl) {
            deviceSnEl.textContent = fmtSerial(info.deviceSerial);
        }
        (info.dutSerials || []).forEach(function (sn, i) {
            if (dutSnEls[i]) dutSnEls[i].textContent = fmtSerial(sn);
        });
    }

    async function readSerialSnapshot() {
        if (!pkd || !pkd.isConnected) {
            throw new Error('not connected');
        }
        await ensureArm();
        const info = await pkd.readSerials();
        paintSerials(info);
        return info;
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
            // Уже подключены — не открывать порт повторно
            if (pkd && pkd.isConnected) {
                log('уже подключено');
                return;
            }
            if (window.__benchPkd && window.__benchPkd.isConnected) {
                pkd = window.__benchPkd;
                log('используем уже открытый порт');
                return;
            }
            if (window.__benchPkd) {
                try {
                    await window.__benchPkd.disconnect();
                } catch (_e) {}
                window.__benchPkd = null;
            }

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

    if (readSerialBtn) {
        readSerialBtn.addEventListener('click', async () => {
            try {
                const info = await readSerialSnapshot();
                log(
                    'S/N прибора=' +
                        fmtSerial(info.deviceSerial) +
                        ', ППЗУ=' +
                        fmtHexWord(info.eepromId) +
                        ', датчики=[' +
                        (info.dutSerials || []).map(fmtSerial).join(', ') +
                        ']'
                );
            } catch (e) {
                log(`serial read error: ${e.message}`);
            }
        });
    }

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

