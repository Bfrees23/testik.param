/**
 * TM-07 Modbus RTU over Web Serial (CRC16 0xA001, init 0xFFFF).
 * protocol Korrektora.txt
 */
class KorrektorDevice {
    constructor(address = 1) {
        this.address = address;
        this.port = null;
        this.reader = null;
        this.writer = null;
        /** @type {((dir: 'tx' | 'rx', frame: Uint8Array) => void) | null} */
        this.onFrameExchange = null;
        /** @type {number[]} байты следующего кадра, пришедшие раньше времени */
        this._rxCarry = [];
        /** Очередь Modbus: один reader.read() / writer.write() на порт. */
        this._ioLock = Promise.resolve();
        /** Задержка после TX перед RX (RS485 turnaround), мс. */
        this._turnaroundMs = 50;
        /** Управление направлением RS485 через RTS (USB-адаптеры FTDI/CH340). */
        this._rs485Rts = true;
        /** true — RTS=1 при передаче; false — инвертированная линия DE. */
        this._rs485RtsTxHigh = true;
    }

    /** @throws {Error} если Web Serial недоступен (HTTP по LAN, не Chrome/Edge и т.д.) */
    static assertWebSerialAvailable() {
        if (typeof window !== 'undefined' && window.isSecureContext === false) {
            const host = window.location.hostname || 'HOST';
            const origin = window.location.origin || 'http://' + host;
            throw new Error(
                'Web Serial (КАО) на HTTP с IP недоступен: нужен secure context. ' +
                    'Варианты: 1) Edge → edge://flags → «Insecure origins treated as secure» → добавить ' +
                    origin +
                    ' → Restart; 2) открыть https://' +
                    host +
                    ':8443' +
                    (window.location.pathname || '/') +
                    '; 3) на этом ПК — http://127.0.0.1' +
                    (window.location.pathname || '/') +
                    '.'
            );
        }
        if (typeof navigator === 'undefined' || !navigator.serial) {
            throw new Error('Web Serial недоступен: используйте Chrome или Edge.');
        }
    }

    async _closeStreams() {
        try {
            if (this.reader) {
                await this.reader.cancel();
                this.reader.releaseLock();
            }
        } catch (_e) {}
        try {
            if (this.writer) {
                this.writer.releaseLock();
            }
        } catch (_e) {}
        this.reader = null;
        this.writer = null;
    }

    async _resetReader() {
        if (!this.port?.readable) return;
        await this._closeStreams();
        try {
            this.reader = this.port.readable.getReader();
            this.writer = this.port.writable.getWriter();
        } catch (_e) {}
    }

    async _rs485SetTransmit(transmit) {
        if (!this._rs485Rts || !this.port || typeof this.port.setSignals !== 'function') return;
        try {
            const rtsOn = this._rs485RtsTxHigh ? transmit : !transmit;
            await this.port.setSignals({ requestToSend: rtsOn });
        } catch (_e) {}
    }

    async _rs485SetReceive() {
        await this._rs485SetTransmit(false);
    }

    _withIoLock(fn) {
        const run = this._ioLock.then(fn, fn);
        this._ioLock = run.then(
            () => {},
            () => {}
        );
        return run;
    }

    _takeCompleteFrame(buf) {
        if (buf.length < 5) return null;
        const fn = buf[1];
        if (fn & 0x80) {
            if (buf.length < 5) return null;
            return { total: 5 };
        }
        if (fn === 0x10) {
            if (buf.length < 8) return null;
            return { total: 8 };
        }
        if (fn === 0x03 || fn === 0x04 || fn === 0x11 || fn === 0x17) {
            if (buf.length < 3) return null;
            const total = 3 + buf[2] + 2;
            if (buf.length < total) return null;
            return { total };
        }
        return null;
    }

    calcCRC16(bytes) {
        let crc = 0xffff;
        for (const b of bytes) {
            crc ^= b;
            for (let i = 0; i < 8; i += 1) {
                const lsb = crc & 1;
                crc >>= 1;
                if (lsb) crc ^= 0xA001;
            }
        }
        return crc & 0xffff;
    }

    buildFrame(fn, payload = []) {
        const body = [this.address & 0xff, fn & 0xff, ...payload];
        const crc = this.calcCRC16(body);
        body.push(crc & 0xff, (crc >> 8) & 0xff);
        return new Uint8Array(body);
    }

    async openSelectedPort(port, baudRate = 9600, options = {}) {
        if (options.rs485Rts !== undefined) this._rs485Rts = !!options.rs485Rts;
        if (options.rs485RtsTxHigh !== undefined) this._rs485RtsTxHigh = !!options.rs485RtsTxHigh;
        if (options.turnaroundMs !== undefined) this._turnaroundMs = Number(options.turnaroundMs) || 0;
        this.port = port;
        await this.port.open({
            baudRate,
            dataBits: 8,
            stopBits: 1,
            parity: 'none',
            flowControl: 'none'
        });
        this.reader = this.port.readable.getReader();
        this.writer = this.port.writable.getWriter();
        await this._rs485SetReceive();
    }

    /** Смена скорости без повторного выбора порта в диалоге. */
    async switchBaudRate(baudRate) {
        const port = this.port;
        if (!port) throw new Error('Порт не открыт');
        return this._withIoLock(async () => {
            await this._closeStreams();
            try {
                await port.close();
            } catch (_e) {}
            await this.openSelectedPort(port, baudRate, {
                rs485Rts: this._rs485Rts,
                rs485RtsTxHigh: this._rs485RtsTxHigh,
                turnaroundMs: this._turnaroundMs,
            });
            await new Promise((r) => setTimeout(r, 150));
            await this._drainRxBufferInner(400);
        });
    }

    async connect(options = {}) {
        const baudRate = options.baudRate || 9600;
        KorrektorDevice.assertWebSerialAvailable();
        const reqOpts = {};
        if (options.filters && options.filters.length > 0) {
            reqOpts.filters = options.filters;
        }
        const selectedPort = await navigator.serial.requestPort(reqOpts);
        await this.openSelectedPort(selectedPort, baudRate, {
            rs485Rts: options.rs485Rts !== false,
            rs485RtsTxHigh: options.rs485RtsTxHigh !== false,
            turnaroundMs: options.turnaroundMs,
        });
        await new Promise((r) => setTimeout(r, 150));
        await this.drainRxBuffer(400);
    }

    async reconnectGranted(options = {}) {
        const baudRate = options.baudRate || 9600;
        KorrektorDevice.assertWebSerialAvailable();
        const filters = Array.isArray(options.filters) ? options.filters : [];
        const ports = await navigator.serial.getPorts();
        if (!ports || ports.length === 0) return false;
        let target = null;
        if (filters.length === 0) {
            target = ports[0];
        } else {
            target = ports.find((port) => {
                const info = typeof port.getInfo === 'function' ? port.getInfo() : {};
                return filters.some((f) => {
                    if (f.usbVendorId !== undefined && info.usbVendorId !== f.usbVendorId) return false;
                    if (f.usbProductId !== undefined && info.usbProductId !== f.usbProductId) return false;
                    return true;
                });
            });
        }
        if (!target) return false;
        try {
            await this.openSelectedPort(target, baudRate, {
                rs485Rts: options.rs485Rts !== false,
                rs485RtsTxHigh: options.rs485RtsTxHigh !== false,
                turnaroundMs: options.turnaroundMs,
            });
            await new Promise((r) => setTimeout(r, 150));
            await this.drainRxBuffer(400);
            return true;
        } catch (_e) {
            return false;
        }
    }

    async disconnect() {
        await this._closeStreams();
        try {
            if (this.port) await this.port.close();
        } catch (_e) {}
        this.port = null;
        this._rxCarry = [];
    }

    /**
     * Один активный reader.read() на транзакцию: при таймауте не отменяем read(),
     * следующий read() — только если кадр ещё не собран.
     */
    async readFrame(timeoutMs = 2000) {
        const buf = this._rxCarry.length ? [...this._rxCarry] : [];
        this._rxCarry = [];
        const deadline = Date.now() + timeoutMs;
        let readPromise = null;

        const frameReady = this._takeCompleteFrame(buf);
        if (frameReady) {
            this._rxCarry = buf.slice(frameReady.total);
            return new Uint8Array(buf.slice(0, frameReady.total));
        }

        while (Date.now() < deadline) {
            if (!readPromise) readPromise = this.reader.read();
            const remaining = deadline - Date.now();
            if (remaining <= 0) break;
            const r = await Promise.race([
                readPromise,
                new Promise((resolve) =>
                    setTimeout(() => resolve({ timeout: true }), Math.min(200, remaining))
                ),
            ]);
            if (r && r.timeout) continue;

            readPromise = null;

            if (!r || r.done) break;
            if (r.value && r.value.length) {
                buf.push(...r.value);
                const done = this._takeCompleteFrame(buf);
                if (done) {
                    this._rxCarry = buf.slice(done.total);
                    return new Uint8Array(buf.slice(0, done.total));
                }
                readPromise = this.reader.read();
            }
        }
        await this._resetReader();
        if (!buf.length) throw new Error('Нет ответа');
        this._rxCarry = buf;
        throw new Error('Нет ответа');
    }

    /** Сброс «хвостов» RS485 после таймаута или рассинхрона кадров. */
    async _drainRxBufferInner(maxMs = 400) {
        if (!this.reader) return;
        const deadline = Date.now() + maxMs;
        let readPromise = null;
        while (Date.now() < deadline) {
            const remaining = deadline - Date.now();
            if (remaining <= 0) break;
            if (!readPromise) readPromise = this.reader.read();
            const r = await Promise.race([
                readPromise,
                new Promise((resolve) =>
                    setTimeout(() => resolve({ timeout: true }), Math.min(80, remaining))
                ),
            ]);
            if (r && r.timeout) break;
            readPromise = null;
            if (!r || r.done) break;
            if (r.value && r.value.length) this._rxCarry = [];
        }
        await this._resetReader();
    }

    async drainRxBuffer(maxMs = 400) {
        if (!this.reader) return;
        return this._withIoLock(async () => {
            await this._drainRxBufferInner(maxMs);
        });
    }

    assertCrc(frame) {
        if (frame.length < 4) throw new Error('Короткий фрейм');
        const data = frame.slice(0, frame.length - 2);
        const expected = this.calcCRC16(data);
        const got = frame[frame.length - 2] | (frame[frame.length - 1] << 8);
        if (expected !== got) throw new Error(`CRC mismatch exp=${expected.toString(16)} got=${got.toString(16)}`);
    }

    parseException(frame) {
        if (frame.length >= 5 && (frame[1] & 0x80)) {
            const code = frame[2];
            const names = {
                0x01: 'функция не поддерживается',
                0x02: 'адрес данных недоступен',
                0x03: 'недопустимое значение в запросе',
                0x04: 'ошибка EEPROM',
                0x05: 'доступ закрыт (замок)',
                0x06: 'регистр только для записи',
                0x07: 'регистр только для чтения',
                0x08: 'ошибка CRC архивной записи',
                0x09: 'архивная запись отсутствует',
                0x0a: 'ошибка чтения Flash',
                0x0b: 'ошибка записи / недопустимое значение ЛКГ',
                0x0c: 'ошибка опроса датчика',
            };
            throw new Error(`Modbus exception 0x${code.toString(16).padStart(2, '0')} ${names[code] || ''}`);
        }
    }

    async sendFrame(frame, timeoutMs = 2000, retries = 1) {
        return this._withIoLock(async () => {
            let lastErr;
            for (let attempt = 0; attempt <= retries; attempt += 1) {
                try {
                    if (this.onFrameExchange) this.onFrameExchange('tx', frame);
                    await this._rs485SetTransmit(true);
                    await this.writer.write(frame);
                    await this._rs485SetReceive();
                    if (this._turnaroundMs > 0) {
                        await new Promise((r) => setTimeout(r, this._turnaroundMs));
                    }
                    const response = await this.readFrame(timeoutMs);
                    if (this.onFrameExchange) this.onFrameExchange('rx', response);
                    this.assertCrc(response);
                    this.parseException(response);
                    return response;
                } catch (e) {
                    lastErr = e;
                    if (attempt < retries && /нет ответа/i.test(String(e.message || e))) {
                        this._rxCarry = [];
                        await this._drainRxBufferInner(200);
                        await new Promise((r) => setTimeout(r, 60));
                        continue;
                    }
                    throw e;
                }
            }
            throw lastErr || new Error('Нет ответа');
        });
    }

    static parseIdentifyResponse(response) {
        const data = KorrektorDevice.modbusDataBytes(response);
        const name = KorrektorDevice.trimRegisterText(data.slice(0, 12));
        const fwVersion = KorrektorDevice.trimRegisterText(data.slice(20, 32));
        const serial = KorrektorDevice.trimRegisterText(data.slice(32, 52));
        const mapVersion = data.length >= 54 ? data[52] | (data[53] << 8) : 0;
        return { name, fwVersion, serial, mapVersion };
    }

    async identify(timeoutMs = 4000) {
        return this.sendFrame(this.buildFrame(0x11), timeoutMs, 2);
    }

    /** Байты данных из ответа 0x03/0x04/0x11. */
    static modbusDataBytes(response) {
        const n = response[2];
        return response.slice(3, 3 + n);
    }

    static trimRegisterText(bytes) {
        const dec = new TextDecoder('windows-1251', { fatal: false });
        try {
            return dec.decode(bytes).replace(/\0/g, '').trim();
        } catch (_e) {
            return new TextDecoder('ascii').decode(bytes).replace(/\0/g, '').trim();
        }
    }

    static decodeUint64Decimal(bytes) {
        if (bytes.length < 8) return '';
        let v = 0n;
        for (let i = 7; i >= 0; i -= 1) v = (v << 8n) | BigInt(bytes[i]);
        if (v <= 0n) return '';
        const n = Number(v);
        return Number.isFinite(n) && n <= Number.MAX_SAFE_INTEGER ? String(n) : String(v);
    }

    /**
     * Электронный паспорт (CorrReader при открытии порта): 0x0001, 0x0007, 0x000E, 0x000F.
     */
    async readElectronicPassport(timeoutMs = 5000) {
        const nameResp = await this.readHolding(0x0001, 6, timeoutMs);
        const verResp = await this.readHolding(0x0007, 5, timeoutMs);
        const mapResp = await this.readHolding(0x000e, 1, timeoutMs);
        const serialResp = await this.readHolding(0x000f, 4, timeoutMs);
        const name = KorrektorDevice.trimRegisterText(KorrektorDevice.modbusDataBytes(nameResp));
        const fwVersion = KorrektorDevice.trimRegisterText(KorrektorDevice.modbusDataBytes(verResp));
        const mapBytes = KorrektorDevice.modbusDataBytes(mapResp);
        const mapVersion = mapBytes.length >= 2 ? mapBytes[0] | (mapBytes[1] << 8) : 0;
        const serialBytes = KorrektorDevice.modbusDataBytes(serialResp);
        let serial = KorrektorDevice.decodeUint64Decimal(serialBytes);
        if (!serial) serial = KorrektorDevice.trimRegisterText(serialBytes);
        return { name, fwVersion, serial, mapVersion };
    }

    /** REG_STATUS_LOCK (карта 50: 0x0028). */
    async readLockStatus(reg = 0x0028, timeoutMs = 4000) {
        const resp = await this.readHolding(reg & 0xffff, 1, timeoutMs);
        const b = KorrektorDevice.modbusDataBytes(resp);
        const raw = b.length >= 2 ? b[0] | (b[1] << 8) : 0;
        return { reg: reg & 0xffff, raw };
    }

    /** Команда открытия замка поставщика (карта 50). */
    static get REG_OPEN_SUPPLIER_LOCK() {
        return 0x06a4;
    }

    /** Команда открытия замка производителя (карта 50). */
    static get REG_OPEN_MANUFACTURER_LOCK() {
        return 0x06a7;
    }

    /** Команда закрытия калибровочного замка (карта 50, писать 0). */
    static get REG_CLOSE_CALIB_LOCK() {
        return 0x06aa;
    }

    /** REG_DATETIME — дата/время корректора (карта 50). */
    static get REG_DATETIME() {
        return 0x008c;
    }

    /**
     * Пароль замка поставщика → 6 байт ASCII (atoi в прошивке).
     * Пример CorrReader: "-22" → 2D 32 32 00 00 00.
     */
    static encodeLockPasswordBytes(password, byteLen = 6) {
        const s = String(password ?? '');
        const enc = new TextEncoder();
        const raw = enc.encode(s);
        const out = new Uint8Array(byteLen);
        out.set(raw.subarray(0, Math.min(raw.length, byteLen)));
        return [...out];
    }

    /**
     * Пароль замка производителя по протоколу Modbus ТМ-07:
     * день+месяц+час (ДДММЧЧ ASCII), к каждому байту +0x20.
     * Пример 01.02.2024 12:xx → 50 51 50 52 51 52.
     *
     * Важно: прошивка берёт Д/М/Ч из time_t через gmtime (UTC-компоненты) —
     * это же время на дисплее. Стенд пишет в 0x008C московскую стену «как UTC»
     * (naive), поэтому getUTC* = часы на приборе. Режим moscow (+3) — только
     * запасной, если в прибор случайно записали настоящий UTC.
     *
     * @param {Date} date — Date из unix 0x008C
     * @param {'utc'|'moscow'} [mode='utc']
     */
    static encodeManufacturerLockPasswordBytes(date, mode = 'utc') {
        const d = date instanceof Date ? date : new Date(date);
        if (Number.isNaN(d.getTime())) {
            throw new Error('Некорректная дата для пароля производителя');
        }
        const pad2 = (n) => String(n).padStart(2, '0');
        let ascii;
        if (mode === 'moscow') {
            const fmt = new Intl.DateTimeFormat('en-GB', {
                timeZone: 'Europe/Moscow',
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                hourCycle: 'h23',
            });
            const map = {};
            fmt.formatToParts(d).forEach((p) => {
                if (p.type !== 'literal') map[p.type] = p.value;
            });
            ascii =
                pad2(parseInt(map.day, 10)) +
                pad2(parseInt(map.month, 10)) +
                pad2(parseInt(map.hour, 10));
        } else {
            // Как CorrReader / исходный стенд: UTC-компоненты unix = Д/М/Ч пароля.
            ascii = pad2(d.getUTCDate()) + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCHours());
        }
        return [...ascii].map((ch) => (ch.charCodeAt(0) + 0x20) & 0xff);
    }

    /** Варианты пароля 0x06A7 (utc первым; moscow — запасной). */
    static manufacturerLockPasswordVariants(date) {
        const modes = ['utc', 'moscow'];
        const out = [];
        const seen = new Set();
        for (const mode of modes) {
            const bytes = KorrektorDevice.encodeManufacturerLockPasswordBytes(date, mode);
            const key = bytes.join(',');
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({ mode, bytes });
        }
        return out;
    }

    /**
     * Прочитать дату/время корректора (REG_DATETIME, time_t LE 8 байт).
     * @returns {Promise<{ unix: number, date: Date }>}
     */
    async readDeviceDateTime(timeoutMs = 4000) {
        const resp = await this.readHolding(KorrektorDevice.REG_DATETIME, 4, timeoutMs);
        const b = KorrektorDevice.modbusDataBytes(resp);
        if (b.length < 8) {
            throw new Error('Не удалось прочитать дату/время (0x008C)');
        }
        let unix = 0n;
        for (let i = 7; i >= 0; i -= 1) unix = (unix << 8n) | BigInt(b[i]);
        const n = Number(unix);
        if (!Number.isFinite(n) || n <= 0) {
            throw new Error('Дата/время корректора пустые (0x008C)');
        }
        return { unix: n, date: new Date(n * 1000) };
    }

    /**
     * Открыть замок поставщика (0x06A4) ASCII-паролем из настроек.
     */
    async openAccessLock(lockCmdReg, password = '-22', timeoutMs = 3000) {
        const bytes = KorrektorDevice.encodeLockPasswordBytes(password, 6);
        return this.writeMultiple(lockCmdReg & 0xffff, bytes, timeoutMs);
    }

    /**
     * Открыть замок производителя (0x06A7): пароль из даты/времени прибора (как CorrReader AutoPass / CmdPasswordFabric).
     * Сначала UTC-компоненты unix, при 0x03 — повтор с Europe/Moscow.
     * @returns {Promise<{ bytes: number[], unix: number, date: Date, mode: string }>}
     */
    async openManufacturerLock(timeoutMs = 4000) {
        const { unix, date } = await this.readDeviceDateTime(timeoutMs);
        const variants = KorrektorDevice.manufacturerLockPasswordVariants(date);
        let lastErr = null;
        for (const v of variants) {
            try {
                await this.writeMultiple(KorrektorDevice.REG_OPEN_MANUFACTURER_LOCK, v.bytes, timeoutMs);
                return { bytes: v.bytes, unix, date, mode: v.mode };
            } catch (e) {
                lastErr = e;
                const msg = String((e && e.message) || e || '');
                if (!/0x0?3\b|недопустимое значение в запросе/i.test(msg)) {
                    throw e;
                }
            }
        }
        throw lastErr || new Error('AutoPass 0x06A7: не удалось открыть замок производителя');
    }

    /**
     * Закрыть калибровочный замок (0x06AA ← 0), как в карте регистров / CorrReader.
     * Замки поставщика/производителя — сессионные: сбрасываются при отключении КАО.
     */
    async closeCalibrationLock(timeoutMs = 3000) {
        await this.writeMultiple(KorrektorDevice.REG_CLOSE_CALIB_LOCK, [0x00, 0x00], timeoutMs);
        return true;
    }

    async readHolding(startReg, regCount, timeoutMs = 2000) {
        const p = [(startReg >> 8) & 0xff, startReg & 0xff, (regCount >> 8) & 0xff, regCount & 0xff];
        return this.sendFrame(this.buildFrame(0x03, p), timeoutMs);
    }

    /** 0x04 — по протоколу идентично 0x03 (чтение входных регистров). */
    async readInputRegisters(startReg, regCount) {
        const p = [(startReg >> 8) & 0xff, startReg & 0xff, (regCount >> 8) & 0xff, regCount & 0xff];
        return this.sendFrame(this.buildFrame(0x04, p));
    }

    /**
     * 0x17 — чтение после записи (архивы и др.): сначала запись, затем чтение в одной транзакции.
     * @param {number} readAddr — начальный адрес чтения (holding)
     * @param {number} readRegCount — число регистров для чтения
     * @param {number} writeAddr — начальный адрес записи
     * @param {number[]} dataBytes — чётное число байт (пары = регистры)
     */
    async readWriteRegisters(readAddr, readRegCount, writeAddr, dataBytes) {
        if (!dataBytes.length || dataBytes.length % 2 !== 0) {
            throw new Error('0x17: для записи нужно чётное число байт');
        }
        const writeRegCount = dataBytes.length / 2;
        const p = [
            (readAddr >> 8) & 0xff,
            readAddr & 0xff,
            (readRegCount >> 8) & 0xff,
            readRegCount & 0xff,
            (writeAddr >> 8) & 0xff,
            writeAddr & 0xff,
            (writeRegCount >> 8) & 0xff,
            writeRegCount & 0xff,
            dataBytes.length & 0xff,
            ...dataBytes,
        ];
        return this.sendFrame(this.buildFrame(0x17, p));
    }

    async writeMultiple(startReg, dataBytes, timeoutMs = 2000, retries = 1) {
        if (!dataBytes.length || dataBytes.length % 2 !== 0) throw new Error('Запись: четное число байт');
        if (dataBytes.length > 254) {
            throw new Error('Запись 0x10: не больше 254 байт (127 регистров) за кадр');
        }
        const regCount = dataBytes.length / 2;
        const p = [
            (startReg >> 8) & 0xff,
            startReg & 0xff,
            (regCount >> 8) & 0xff,
            regCount & 0xff,
            dataBytes.length & 0xff,
            ...dataBytes
        ];
        return this.sendFrame(this.buildFrame(0x10, p), timeoutMs, retries);
    }

    /**
     * 0x10 без лимита 254 байт (окно прошивки: 256 регистров = 512 байт, ByteCount=0).
     */
    async writeMultipleUnbounded(startReg, dataBytes, timeoutMs = 15000) {
        if (!dataBytes.length || dataBytes.length % 2 !== 0) {
            throw new Error('Запись: четное число байт');
        }
        const regCount = dataBytes.length / 2;
        const p = [
            (startReg >> 8) & 0xff,
            startReg & 0xff,
            (regCount >> 8) & 0xff,
            regCount & 0xff,
            dataBytes.length & 0xff,
            ...dataBytes,
        ];
        return this.sendFrame(this.buildFrame(0x10, p), timeoutMs, 0);
    }

    /** Float32 little-endian по потоку байт (см. пример в protocol Korrektora). */
    static floatBytesLE(value) {
        const buf = new ArrayBuffer(4);
        const view = new DataView(buf);
        view.setFloat32(0, value, true);
        return new Uint8Array([view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)]);
    }

    static parseFloat32LE(data4) {
        if (data4.length < 4) throw new Error('Нужно 4 байта float');
        const buf = new ArrayBuffer(4);
        const view = new DataView(buf);
        for (let i = 0; i < 4; i += 1) view.setUint8(i, data4[i]);
        return view.getFloat32(0, true);
    }

    async readFloat32LE(startReg) {
        const resp = await this.readHolding(startReg, 2);
        const data = resp.slice(3, 7);
        return KorrektorDevice.parseFloat32LE(data);
    }

    /** Одно 16-бит holding в представлении значений ТМ-07 (little-endian). */
    async readHoldingU16(startReg) {
        const resp = await this.readHolding(startReg, 1);
        return resp[3] | (resp[4] << 8);
    }

    async writeFloat32LE(startReg, value, timeoutMs = 2000) {
        const bytes = KorrektorDevice.floatBytesLE(value);
        return this.writeMultiple(startReg, [...bytes], timeoutMs);
    }

    /**
     * Запись ЛКГ и float с паузой между кадрами (RS485 / прибор).
     * @param {number} postLkgDelayMs — пауза после ответа на запись ЛКГ, мс
     */
    async writeLkgKeyThenFloat32(lkgBytes, lkgReg, floatReg, floatValue, postLkgDelayMs = 150) {
        await this.writeLkgKey(lkgBytes, lkgReg);
        await new Promise((r) => setTimeout(r, postLkgDelayMs));
        return this.writeFloat32LE(floatReg, floatValue);
    }

    static get REG_LKG() {
        return 0x07b6;
    }

    static get REG_INIT_LKG() {
        return 0x07b8;
    }

    /**
     * CodeOCT из прошивки (GetStrLen): 8 hex-символов из SaveLkg, со смещением tm_mon (0…11).
     */
    static lkgCodeOctFromSaveLkg(saveLkg, tmMon) {
        const bytes = KorrektorDevice.uint64BytesLE(saveLkg);
        let strLkg = '';
        for (let i = 0; i < 8; i += 1) {
            strLkg += bytes[i].toString(16).toUpperCase().padStart(2, '0');
        }
        let strCrypt = '';
        let idx = tmMon;
        for (let j = 0; j < 8; j += 1) {
            if (idx >= strLkg.length) idx = 0;
            strCrypt += strLkg[idx];
            idx += 1;
        }
        return parseInt(strCrypt, 16) >>> 0;
    }

    /**
     * CryptLkg для REG_INIT_LKG (0x07B8): CodeOCT ^ SN ^ DDMMYYYY.
     * Дата — UTC-компоненты (RTC прибора обычно хранит wall-clock как unix без TZ).
     * @param {bigint | number | string} serialNumber — текущий S/N на приборе (до записи нового)
     */
    static computeCryptLkg(saveLkg, serialNumber, now = new Date()) {
        const d = now.getUTCDate().toString().padStart(2, '0');
        const m = (now.getUTCMonth() + 1).toString().padStart(2, '0');
        const y = now.getUTCFullYear().toString();
        const codeDt = parseInt(`${d}${m}${y}`, 10) >>> 0;
        const codeOct = KorrektorDevice.lkgCodeOctFromSaveLkg(saveLkg, now.getUTCMonth());
        const codeDn = BigInt(String(serialNumber ?? '0').replace(/\D/g, '') || '0') & 0xffffffffn;
        return Number(codeOct ^ Number(codeDn) ^ codeDt) >>> 0;
    }

    static u32leBytes(value) {
        const n = value >>> 0;
        return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff];
    }

    /**
     * Сессия ЛКГ: INIT (SaveLkg+CryptLkg @ 0x07B8), затем ключ @ 0x07B6.
     */
    async writeLkgSession(
        { saveLkg, cryptLkg, accessKey, initReg = KorrektorDevice.REG_INIT_LKG, lkgReg = KorrektorDevice.REG_LKG, postLkgDelayMs = 150 },
        timeoutMs = 2000
    ) {
        const saveBytes = [...KorrektorDevice.uint64BytesLE(saveLkg)];
        const cryptBytes = KorrektorDevice.u32leBytes(cryptLkg);
        await this.writeMultiple(initReg & 0xffff, saveBytes.concat(cryptBytes), timeoutMs);
        await new Promise((r) => setTimeout(r, postLkgDelayMs));
        return this.writeLkgKey(accessKey, lkgReg, timeoutMs);
    }

    /**
     * @param {number[]} hexBytes — 4 байта ключа ЛКГ
     * @param {number} lkgReg — адрес holding-регистра ЛКГ (карта 50: 0x07B6, REG_LKG)
     */
    async writeLkgKey(hexBytes, lkgReg = 0x07b6, timeoutMs = 2000) {
        return this.writeMultiple(lkgReg & 0xffff, hexBytes, timeoutMs);
    }

    /**
     * Uint64 little-endian (8 байт), как в protocol Korrektora для многобайтовых полей.
     * @param {bigint | number | string} value
     */
    static uint64BytesLE(value) {
        let v = BigInt(value);
        if (v < 0n || v > 0xffffffffffffffffn) throw new Error('Uint64 вне диапазона 0…2⁶⁴−1');
        const out = new Uint8Array(8);
        for (let i = 0; i < 8; i += 1) {
            out[i] = Number((v >> BigInt(8 * i)) & 0xffn);
        }
        return out;
    }

    async writeUint64LE(startReg, value, timeoutMs = 2000) {
        const bytes = KorrektorDevice.uint64BytesLE(value);
        return this.writeMultiple(startReg & 0xffff, [...bytes], timeoutMs);
    }

    /**
     * Заводской номер в паспорте 0x11 — 20 байт ASCII; на карте регистров часто отдельный параметр «Серийный номер» как Uint64 (4 регистра).
     * @param {string} serialAscii — не более 20 печатных символов
     * @param {number} startReg — адрес первого из 10 регистров (20 байт)
     */
    async writeFactorySerialAscii(serialAscii, startReg) {
        const reg = startReg & 0xffff;
        const enc = new TextEncoder();
        const raw = enc.encode(String(serialAscii ?? ''));
        if (raw.length > 20) throw new Error('Заводской номер: не более 20 байт ASCII');
        const buf = new Uint8Array(20);
        buf.set(raw);
        return this.writeMultiple(reg, [...buf]);
    }

    /**
     * Серийный номер ТМ-07 как десятичное число (10 цифр), запись Uint64 LE — 4 holding-регистра (карта: адрес 0x000C).
     * @param {string} serialDigits — ровно 10 цифр, например «3002603000»
     */
    async writeTm07SerialAsUint64LE(serialDigits, startReg) {
        const s = String(serialDigits ?? '').trim();
        if (!/^\d{10}$/.test(s)) throw new Error('Ожидается 10 цифр для Uint64');
        const n = BigInt(s);
        return this.writeUint64LE(startReg, n);
    }

    /** Запись Uint64 серийного номера после ключа ЛКГ (разд. 5 документа). */
    async writeTm07SerialAsUint64LEWithLkg(serialDigits, lkgBytes, lkgReg, startReg, postLkgDelayMs = 150) {
        await this.writeLkgKey(lkgBytes, lkgReg);
        await new Promise((r) => setTimeout(r, postLkgDelayMs));
        return this.writeTm07SerialAsUint64LE(serialDigits, startReg);
    }

    /**
     * @deprecated Используйте writeTm07SerialAsUint64LEWithLkg для карты с Uint64 @ 0x000C
     */
    async writeFactorySerialAsciiWithLkg(serialAscii, lkgBytes, lkgReg, startReg, postLkgDelayMs = 150) {
        await this.writeLkgKey(lkgBytes, lkgReg);
        await new Promise((r) => setTimeout(r, postLkgDelayMs));
        return this.writeFactorySerialAscii(serialAscii, startReg);
    }

    /**
     * Индексация серийного номера: PPP + YY (год 2 цифры) + MM (месяц) + NNN (порядковый в месяце, с 001).
     * 300 — корректор ТМ-07; 400 — комплекс ПК-ТМ.
     * Пример: 3002606001 → ТМ-07, 2026-06, №001.
     */
    static get TM07_SERIAL_PREFIX() {
        return '300';
    }

    static get TM07_COMPLEX_SERIAL_PREFIX() {
        return '400';
    }

    static get TM07_SERIAL_PREFIXES() {
        return [KorrektorDevice.TM07_SERIAL_PREFIX, KorrektorDevice.TM07_COMPLEX_SERIAL_PREFIX];
    }

    /**
     * @param {string} str — 10 цифр
     * @param {Date} [now]
     * @param {string|null} [expectedPrefix] — '300' | '400' | null (любой из двух)
     * @param {{ allowAnyProductionMonth?: boolean }} [opts] — повтор из реестра: любой прошлый месяц
     * @returns {{ ok: true, prefix: string, product: string, yy: number, mm: number, seq: number, fullYear: number } | { ok: false, error: string }}
     */
    static validateTm07SerialNumber(str, now = new Date(), expectedPrefix = null, opts = null) {
        const s = String(str ?? '').trim();
        if (!/^\d{10}$/.test(s)) {
            return { ok: false, error: 'Серийный номер: ровно 10 цифр (формат PPPYYMMNNN).' };
        }
        const prefix = s.slice(0, 3);
        const allowed = KorrektorDevice.TM07_SERIAL_PREFIXES;
        if (expectedPrefix) {
            if (prefix !== String(expectedPrefix)) {
                return { ok: false, error: `Ожидается префикс ${expectedPrefix}.` };
            }
        } else if (allowed.indexOf(prefix) < 0) {
            return { ok: false, error: `Префикс: ${allowed.join(' или ')}.` };
        }
        const yy = parseInt(s.slice(3, 5), 10);
        const mm = parseInt(s.slice(5, 7), 10);
        const seq = parseInt(s.slice(7, 10), 10);
        if (Number.isNaN(mm) || mm < 1 || mm > 12) {
            return { ok: false, error: 'Месяц в номере: 01…12.' };
        }
        if (Number.isNaN(seq) || seq < 1 || seq > 999) {
            return { ok: false, error: 'Порядковый номер в месяце: 001…999.' };
        }
        const fullYear = 2000 + yy;
        const snMonthIdx = fullYear * 12 + (mm - 1);
        const curY = now.getFullYear();
        const curM = now.getMonth() + 1;
        const nowMonthIdx = curY * 12 + (curM - 1);
        if (snMonthIdx > nowMonthIdx) {
            return { ok: false, error: 'Дата (год/месяц) в номере не может быть позже текущего месяца.' };
        }
        if (!(opts && opts.allowAnyProductionMonth)) {
            const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const minMonthIdx = prevMonth.getFullYear() * 12 + prevMonth.getMonth();
            if (snMonthIdx < minMonthIdx) {
                return { ok: false, error: 'Дата в номере не раньше чем предыдущий календарный месяц.' };
            }
        }
        const product = prefix === KorrektorDevice.TM07_COMPLEX_SERIAL_PREFIX ? 'ПК-ТМ' : 'ТМ-07';
        return { ok: true, prefix, product, yy, mm, seq, fullYear };
    }

    /** Подсказка для UI: текущий допустимый префикс по дате (текущий или прошлый месяц). */
    static tm07SerialFormatHint(now = new Date()) {
        const y = now.getFullYear() % 100;
        const m = now.getMonth() + 1;
        const y2 = String(y).padStart(2, '0');
        const m2 = String(m).padStart(2, '0');
        const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const py = prev.getFullYear() % 100;
        const pm = prev.getMonth() + 1;
        const py2 = String(py).padStart(2, '0');
        const pm2 = String(pm).padStart(2, '0');
        return (
            `корр. 300${py2}${pm2}NNN / 300${y2}${m2}NNN; ` +
            `компл. 400${py2}${pm2}NNN / 400${y2}${m2}NNN`
        );
    }

    static get REG_SW_VER() {
        return 0x0007;
    }

    static get REG_FW_SIZE() {
        return 0x2000;
    }

    static get REG_FW_DATA() {
        return 0x2002;
    }

    /**
     * Только номер вида 1.010105.
     * Из «TM-07_230176_v1.010105_2A23F66C_438D4EAA» / «v1.010105» / регистра 0x0007.
     */
    static normalizeFwVersion(s) {
        const raw = String(s || '').replace(/\0/g, '').trim();
        const tagged = raw.match(/(?:^|[_\-.])v(\d+\.\d+)/i) || raw.match(/\bv(\d+\.\d+)/i);
        if (tagged) {
            return tagged[1];
        }
        const bare = raw.replace(/^v/i, '').match(/(\d+\.\d+)/);
        return bare ? bare[1] : '';
    }

    /**
     * Имя CorrReader: TM-07_{размер}_v{версия}_{ЛКГ32}_{ЛКГ32}.bin
     * Сравнение версии — только v…; ЛКГ — hex после версии (пишется в 0x07B6 при заливке).
     */
    static parseFirmwareFilename(name) {
        const base = String(name || '')
            .replace(/\\/g, '/')
            .split('/')
            .pop()
            .replace(/\.bin$/i, '');
        const version = KorrektorDevice.normalizeFwVersion(base);
        const sizeM = base.match(/(?:^|[_\-])(\d{4,})(?=_v)/i);
        const afterVer = version ? base.replace(new RegExp('v' + version.replace(/\./g, '\\.'), 'i'), '') : base;
        const words = [];
        const re = /[0-9A-Fa-f]{8}/g;
        let m;
        while ((m = re.exec(afterVer))) {
            words.push(m[0].toUpperCase());
        }
        const lkgBytes = [];
        const lkgKeys = [];
        words.forEach((h) => {
            const key = [];
            for (let i = 0; i < 8; i += 2) {
                const b = parseInt(h.slice(i, i + 2), 16);
                lkgBytes.push(b);
                key.push(b);
            }
            lkgKeys.push(key);
        });
        return {
            version,
            sizeFromName: sizeM ? Number(sizeM[1]) : 0,
            lkgWords: words,
            lkgHex: words.join('_'),
            lkgBytes,
            lkgKeys,
        };
    }

    /**
     * CorrReader Partiton 20: размер → 0x2000, затем блоки ровно по 256 регистров (512 байт) → 0x2002.
     * Обычный 0x10 ≤123 рег. на 0x2002 даёт exception 0x03.
     */
    async writeFirmwareImage(bin, opts) {
        const data = bin instanceof Uint8Array ? bin : new Uint8Array(bin || []);
        if (!data.length) {
            throw new Error('Файл прошивки пуст');
        }
        const timeoutMs = (opts && opts.timeoutMs) || 20000;
        const onProgress = opts && opts.onProgress;
        const armLkg = opts && opts.armLkg;
        const retries = Math.max(1, Number(opts && opts.retries) || 3);
        const size = data.length >>> 0;
        const sizeBytes = [size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff, (size >> 24) & 0xff];
        const isLkgErr = (e) =>
            /0x0?b\b|exception\s*11|недопустимое значение лкг/i.test(String((e && e.message) || e || ''));
        if (typeof armLkg === 'function') {
            await armLkg();
        }
        let lastSizeErr = null;
        for (let n = 0; n < retries; n += 1) {
            try {
                if (n > 0 && typeof armLkg === 'function') {
                    await armLkg();
                }
                await this.writeMultiple(KorrektorDevice.REG_FW_SIZE, sizeBytes, timeoutMs);
                lastSizeErr = null;
                break;
            } catch (e) {
                lastSizeErr = e;
                if (!isLkgErr(e) || n === retries - 1) {
                    throw e;
                }
                await new Promise((r) => setTimeout(r, 80));
            }
        }
        if (lastSizeErr) {
            throw lastSizeErr;
        }
        await new Promise((r) => setTimeout(r, 200));
        const BLOCK_REGS = 256;
        const BLOCK_BYTES = BLOCK_REGS * 2;
        let offset = 0;
        while (offset < data.length) {
            const block = new Uint8Array(BLOCK_BYTES);
            const n = Math.min(BLOCK_BYTES, data.length - offset);
            block.set(data.subarray(offset, offset + n));
            await this.writeMultipleUnbounded(KorrektorDevice.REG_FW_DATA, [...block], timeoutMs);
            offset += n;
            if (typeof onProgress === 'function') {
                onProgress(Math.min(offset, data.length), data.length);
            }
            await new Promise((r) => setTimeout(r, 30));
        }
        return { bytes: data.length };
    }
}

window.KorrektorDevice = KorrektorDevice;
