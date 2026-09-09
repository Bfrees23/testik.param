/**
 * Класс для работы с калибратором ЭЛЕМЕР-ТК-М90К через Web Serial API
 * Протокол основан на документации "Протокол обмена с калибраторами температуры ЭЛЕМЕР-КТ"
 * 
 * Формат команды (ASCII UAIL):
 *   Запрос: :<адрес>;<команда>;<операнд1>;...;<операндN>;<CRC><CR>
 *   Ответ: !<адрес>;<операнд1>;...;<операндN>;<CRC><CR>
 * 
 * Параметры:
 *   - Адрес прибора: 2 (фиксированный для КТ)
 *   - CRC рассчитывается от строки БЕЗ начального ':' но ДО последней ';' включительно
 *   - Полином CRC16: 0xA001 (40961), инициализация: 0xFFFF
 *   - Скорость порта: 9600 бод, 8 бит данных, без паритета, 1 стоп-бит
 * 
 * Поддерживаемые команды:
 *   0  - Чтение типа прибора (ответ: 64 для КТ)
 *   10 - Чтение измеренных и эталонных значений (только ASCII UAIL_EXT, версия ПО > 3.87)
 *   32 - Чтение разновидности протокола (0=UAIL, 2=UAIL_EXT)
 *   40 - Открытие файла (0=EEPROM, 1=RAM, 2=Flash)
 *   41 - Переход в файле по адресу
 *   42 - Чтение данных из файла
 *   43 - Запись данных в файл
 *   44 - Актуализация данных файла (перезагрузка)
 *   254 - Чтение версии ПО
 * 
 * Структуры данных:
 *   - Выходные данные (RAM, адрес 0, размер 36 байт)
 *   - Параметры регулятора (Flash, адрес 63, размер 13 байт)
 *   - Управление регулятором (Flash, адрес 76, размер 23 байта)
 */

class M90Device extends SerialDevice {
    constructor() {
        super();
        this.buffer = '';
        this.deviceType = null;
        this.serialNumber = null;
        this.temperatureCelsius = null;
        this.temperatureKelvin = null;
        this.fileOpened = false;
        this.adjusterState = 'unknown'; // 'unknown', 'on', 'off'
        this.stabilizationTime = '';
        this.onDataUpdate = null;
        
        // Настройки порта согласно документации (раздел 2.5)
        this.baudRate = 9600;
        
        // Адрес прибора (раздел 4.1)
        this.deviceAddress = 2;
        
        // Тип прибора (раздел 4.1)
        this.expectedDeviceType = 64;
        
        // Таймауты (раздел 4.2)
        this.timeouts = {
            responseTimeout: 400,      // Таймаут ответа первого байта
            pollInterval: 1200,        // Рекомендуемое время опроса
            pauseAfterWrite: 500,      // Пауза после записи памяти
            pauseAfterUpdate: 1500,    // Пауза после актуализации
            pauseOnRetry: 500          // Пауза при перезапосе после ошибки CRC
        };
        
        // Состояния калибратора
        this.states = {
            typeConfirmed: false,
            protocolVersion: null,     // 0 = UAIL, 2 = UAIL_EXT
            fileOpened: false,
            adjusted: false,
            crcError: false,
            failed: false
        };
        
        this.currentCommandIndex = 0;
        this.sendingAttempt = 0;
        this.maxAttempts = 2;
        
        this.pendingCommand = null;
        this.commandTimeout = null;
        this.commandQueue = Promise.resolve();
        
        this.onDataReceived = (data) => {
            this.buffer += data;
            this.processBuffer();
        };
    }

    /**
     * Расчет CRC16 по алгоритму из документации (раздел 3.3)
     * Полином: 0xA001 (40961), инициализация: 0xFFFF
     * 
     * Алгоритм:
     * 1. KS = 0xFFFF
     * 2. Для каждого байта данных:
     *    - KS = byte XOR KS
     *    - 8 раз:
     *      - Если младший бит KS = 1: KS = (KS >> 1) XOR 0xA001
     *      - Иначе: KS = KS >> 1
     * 3. Результат - итоговое значение KS
     */
    calcCRC16(dataStr) {
        if (!dataStr || dataStr.length === 0) {
            return 0xFFFF;
        }
        
        let crc = 0xFFFF;
        for (let i = 0; i < dataStr.length; i++) {
            let byte = dataStr.charCodeAt(i);
            crc ^= byte;
            for (let j = 0; j < 8; j++) {
                if ((crc & 0x0001) === 1) {
                    crc = (crc >> 1) ^ 0xA001;
                } else {
                    crc = crc >> 1;
                }
            }
        }
        return crc & 0xFFFF;
    }

    /**
     * Расчет CRC8 для структур данных (раздел 6.5)
     * Алгоритм: сумма всех байт структуры (кроме байта CRC) с последующим поразрядным отрицанием
     * 
     * Пример из документации:
     * uint8_t computeChecksumm(uint8_t *p, size_t bSize) {
     *   uint8_t result = 0x00;
     *   while (bSize --> 0) result += *p++;
     *   return ~result;
     * }
     */
    calcCRC8(byteArray) {
        let crc = 0x00;
        for (let i = 0; i < byteArray.length; i++) {
            crc = (crc + byteArray[i]) & 0xFF;
        }
        return (~crc) & 0xFF;
    }

    /**
     * Форматирование команды по протоколу ASCII UAIL (раздел 3.1)
     * Формат запроса: :<адрес>;<команда>;<операнд1>;...;<операндN>;<CRC><CR>
     * CRC считается от строки БЕЗ начального ':' но включая последнюю ';'
     * 
     * Примеры:
     * - Команда 0 (чтение типа): :2;0;57435\r
     *   где данные для CRC = "2;0;" 
     * - Команда 40 (открыть RAM): :2;40;1;XXXXX\r
     *   где данные для CRC = "2;40;1;"
     */
    formatCommand(command, operands = []) {
        // Формируем строку команды без CRC и CR
        let commandStr = `${this.deviceAddress};${command}`;
        
        // Добавляем операнды если есть
        if (operands && operands.length > 0) {
            for (const operand of operands) {
                commandStr += `;${operand}`;
            }
        }
        
        // Добавляем завершающую точку с запятой перед CRC
        commandStr += ';';
        
        // Считаем CRC от строки с адресом, командой, операндами и последней ';'
        const crc = this.calcCRC16(commandStr);
        
        // Формируем полную команду: : + данные + CRC + CR
        return `:${commandStr}${crc}\r`;
    }

    /**
     * Проверка CRC в ответе устройства (раздел 3.1, 3.3)
     * Формат ответа: !<адрес>;<операнд1>;...;<операндN>;<CRC><CR>
     * CRC считается от строки БЕЗ начального '!' но включая последнюю ';' перед CRC
     * 
     * Пример из документации (раздел 7.1):
     * Запись: :2;0;<CRC>\r
     * Чтение: !2;64;<CRC>\r
     * где CRC для "2;64;" = 57435 (пример)
     */
    checkCRCInAnswer(answer) {
        console.log(`=== Проверка CRC ответа ===`);
        console.log(`Получен ответ (raw): ${JSON.stringify(answer)}`);
        
        // Ответ должен начинаться с '!'
        if (answer.length < 4 || !answer.startsWith('!')) {
            console.log(`Неверный формат ответа: длина=${answer.length}, startsWith!=${answer.startsWith('!')}`);
            return { valid: false, data: null };
        }
        
        // Проверяем наличие \r в конце (может быть удален при split в processBuffer)
        const hasCR = answer.endsWith('\r');
        console.log(`Ответ заканчивается на \\r: ${hasCR}`);
        
        // Удаляем '!' в начале и '\r' в конце если есть
        let cleanAnswer = answer.substring(1);
        if (cleanAnswer.endsWith('\r')) {
            cleanAnswer = cleanAnswer.substring(0, cleanAnswer.length - 1);
        }
        // Также удаляем возможные пробелы
        cleanAnswer = cleanAnswer.trim();
        
        console.log(`Очищенный ответ (без ! и \\r): "${cleanAnswer}"`);
        
        // Разбиваем по ';'
        const parts = cleanAnswer.split(';');
        console.log(`Части после split: ${JSON.stringify(parts)}`);
        
        if (parts.length < 2) {
            console.log(`Недостаточно частей в ответе: ${parts.length}`);
            return { valid: false, data: null };
        }
        
        // Последняя часть - CRC
        const receivedCRC = parseInt(parts[parts.length - 1], 10);
        console.log(`Полученный CRC (строка): "${parts[parts.length - 1]}", число: ${receivedCRC}`);
        
        if (isNaN(receivedCRC)) {
            console.log(`CRC не является числом: ${parts[parts.length - 1]}`);
            return { valid: false, data: null };
        }
        
        // Собираем данные для проверки CRC (все части кроме последней, с ';' после каждой)
        let dataForCRC = '';
        for (let i = 0; i < parts.length - 1; i++) {
            dataForCRC += parts[i] + ';';
        }
        console.log(`Данные для расчета CRC: "${dataForCRC}"`);
        
        const calculatedCRC = this.calcCRC16(dataForCRC);
        console.log(`Расчетный CRC: ${calculatedCRC}`);
        
        if (calculatedCRC !== receivedCRC) {
            console.log(`CRC ошибка! Получено: ${receivedCRC}, Ожидалось: ${calculatedCRC} (данные: ${dataForCRC})`);
            return { valid: false, data: parts.slice(0, -1) };
        }
        
        console.log(`CRC OK! Данные: ${JSON.stringify(parts.slice(0, -1))}`);
        return { valid: true, data: parts.slice(0, -1) };
    }

    /**
     * Отправка команды и ожидание ответа
     */
    async sendCommand(command, operands = [], timeout = 2000) {
        this.commandQueue = this.commandQueue
            .catch(() => {})
            .then(() => this._sendCommandInternal(command, operands, timeout));
        return this.commandQueue;
    }

    async _sendCommandInternal(command, operands = [], timeout = 2000) {
        if (!this.isConnected) {
            throw new Error('Порт не подключен');
        }

        return new Promise((resolve, reject) => {
            const commandName = `${command}${operands.length > 0 ? ':' + operands.join(',') : ''}`;
            this.pendingCommand = commandName;
            
            const formattedCommand = this.formatCommand(command, operands);
            console.log(`Отправка команды [${commandName}]:`, formattedCommand.replace(/\r/g, '\\r'));
            
            this.write(formattedCommand).catch(err => {
                this.pendingCommand = null;
                reject(err);
            });

            // Таймаут ожидания ответа
            const timeoutId = setTimeout(() => {
                if (this.pendingCommand) {
                    this.pendingCommand = null;
                    reject(new Error(`Таймаут ответа на команду ${commandName}`));
                }
            }, timeout);

            // Временный обработчик для получения ответа
            const originalCallback = this.onDataUpdate;
            this.onDataUpdate = (result) => {
                clearTimeout(timeoutId);
                this.onDataUpdate = originalCallback;
                
                if (result.error) {
                    reject(new Error(result.error));
                } else if (result.command === commandName) {
                    resolve(result);
                }
            };
        });
    }

    /**
     * Команда 0: Чтение типа прибора (раздел 5.2)
     * Ответ: тип прибора (должен быть 64 для КТ)
     */
    async readDeviceType() {
        try {
            console.log('=== Начало чтения типа прибора ===');
            
            // Формируем команду вручную для отладки
            const commandStr = `${this.deviceAddress};0;`;
            const crc = this.calcCRC16(commandStr);
            const fullCommand = `:${commandStr}${crc}\r`;
            
            console.log(`Данные для CRC: "${commandStr}"`);
            console.log(`Расчетный CRC: ${crc}`);
            console.log(`Полная команда: "${fullCommand.replace(/\r/g, '\\r')}"`);
            
            const result = await this.sendCommand(0, [], 2000);
            console.log(`Результат sendCommand: success=${result.success}, data=${JSON.stringify(result.data)}`);
            
            if (result.success && result.data && result.data.length > 1) {
                // Ответ формата: !<адрес>;<тип прибора>;<CRC>
                // result.data[0] = адрес (должен быть "2")
                // result.data[1] = тип прибора (должен быть "64")
                const deviceTypeStr = result.data[1];
                console.log(`Строка типа прибора: "${deviceTypeStr}"`);
                
                const deviceType = parseInt(deviceTypeStr, 10);
                console.log(`Распарсенный тип прибора: ${deviceType}`);
                
                if (isNaN(deviceType)) {
                    console.log('Ошибка: не удалось распарсить число');
                    return null;
                }
                
                this.deviceType = deviceType;
                this.states.typeConfirmed = (deviceType === this.expectedDeviceType);
                console.log(`Тип подтвержден: ${this.states.typeConfirmed}`);
                return deviceType;
            }
            console.log('Ошибка: пустой результат или нет данных');
            return null;
        } catch (e) {
            console.error('Ошибка чтения типа прибора:', e);
            console.log(`Исключение: ${e.message}`);
            return null;
        }
    }

    /**
     * Команда 32: Чтение разновидности протокола (раздел 5.4)
     * Ответ: 0 = ASCII UAIL, 2 = ASCII UAIL_EXT
     */
    async readProtocolVersion() {
        try {
            const result = await this.sendCommand(32, [], 2000);
            if (result.success && result.data && result.data.length > 0) {
                const version = parseInt(result.data[0], 10);
                this.states.protocolVersion = version;
                return version;
            }
            return null;
        } catch (e) {
            console.error('Ошибка чтения версии протокола:', e);
            return null;
        }
    }

    /**
     * Команда 254: Чтение версии ПО (раздел 5.10)
     * Ответ: строка вида "Ver 3.88"
     */
    async readSoftwareVersion() {
        try {
            const result = await this.sendCommand(254, [], 2000);
            if (result.success && result.data && result.data.length > 0) {
                return result.data[0];
            }
            return null;
        } catch (e) {
            console.error('Ошибка чтения версии ПО:', e);
            return null;
        }
    }

    /**
     * Команда 40: Открытие файла (раздел 5.5)
     * memoryType: 0 = EEPROM, 1 = RAM, 2 = Flash
     * Ответ: $0 - успех, другая ошибка
     */
    async openFile(memoryType) {
        try {
            const result = await this.sendCommand(40, [memoryType], 2000);
            if (result.success && result.data && result.data.length > 1) {
                // Код результата во втором элементе (после адреса прибора)
                const resultCode = result.data[1];
                this.fileOpened = (resultCode === '$0');
                if (!this.fileOpened) {
                    console.error(`Ошибка открытия файла (тип ${memoryType}): код возврата ${resultCode}`);
                }
                return this.fileOpened;
            }
            return false;
        } catch (e) {
            console.error(`Ошибка открытия файла (тип ${memoryType}):`, e);
            return false;
        }
    }

    /**
     * Команда 41: Переход в файле по адресу (раздел 5.6)
     * address: адрес в памяти
     * Ответ: $0 - успех
     */
    async seekFile(address) {
        try {
            // Второй операнд всегда 0 согласно документации
            const result = await this.sendCommand(41, [address, 0], 2000);
            if (result.success && result.data && result.data.length > 1) {
                // Код результата во втором элементе (после адреса прибора)
                const success = result.data[1] === '$0';
                if (!success) {
                    console.error(`Ошибка перехода по адресу ${address}: код возврата ${result.data[1]}`);
                }
                return success;
            }
            return false;
        } catch (e) {
            console.error(`Ошибка перехода по адресу ${address}:`, e);
            return false;
        }
    }

    /**
     * Команда 42: Чтение данных из файла (раздел 5.7)
     * byteCount: количество байт для чтения (максимум 40 для КТ)
     * Ответ: HexData - данные в шестнадцатеричном формате
     */
    async readFileBytes(byteCount) {
        try {
            if (byteCount > 40) {
                console.warn(`Количество байт ${byteCount} превышает максимум 40, будет обрезано`);
                byteCount = 40;
            }
            const result = await this.sendCommand(42, [byteCount], 2000);
            if (result.success && result.data && result.data.length > 1) {
                // Индекс 0 - адрес прибора, индекс 1 - HexData
                return result.data[1];
            }
            return null;
        } catch (e) {
            console.error(`Ошибка чтения ${byteCount} байт:`, e);
            return null;
        }
    }

    /**
     * Команда 43: Запись данных в файл (раздел 5.8)
     * hexData: данные в шестнадцатеричном формате (максимум 40 байт = 80 символов)
     * Ответ: $0 - успех
     */
    async writeFileBytes(hexData) {
        try {
            // Проверяем длину данных (максимум 40 байт = 80 hex символов)
            if (hexData.length > 80) {
                console.warn(`Длина данных ${hexData.length} превышает максимум 80 hex символов`);
            }
            const result = await this.sendCommand(43, [hexData], 2000);
            if (result.success && result.data && result.data.length > 1) {
                // Код результата во втором элементе (после адреса прибора)
                const success = result.data[1] === '$0';
                if (!success) {
                    console.error(`Ошибка записи данных: код возврата ${result.data[1]}`);
                }
                return success;
            }
            return false;
        } catch (e) {
            console.error('Ошибка записи данных:', e);
            return false;
        }
    }

    /**
     * Команда 44: Актуализация данных файла (раздел 5.9)
     * После выполнения требуется пауза 1500 мс
     * Ответ: $0 - успех
     */
    async updateFile() {
        try {
            // Операнд всегда 0 согласно документации
            const result = await this.sendCommand(44, [0], 2000);
            if (result.success && result.data && result.data.length > 1) {
                // Код результата во втором элементе (после адреса прибора)
                const success = result.data[1] === '$0';
                if (!success) {
                    console.error(`Ошибка актуализации данных: код возврата ${result.data[1]}`);
                }
                return success;
            }
            return false;
        } catch (e) {
            console.error('Ошибка актуализации данных:', e);
            return false;
        }
    }

    /**
     * Чтение структуры выходных данных (раздел 6.2, 7.2)
     * RAM, адрес 0, размер 36 байт
     * Возвращает данные о состоянии регулятора
     */
    async readOutputDataStructure() {
        try {
            // Шаг 1: Открыть RAM (тип памяти 1)
            if (!await this.openFile(1)) {
                console.error('Не удалось открыть RAM');
                return null;
            }
            
            // Шаг 2: Перейти к адресу 0
            if (!await this.seekFile(0)) {
                console.error('Не удалось перейти к адресу 0');
                return null;
            }
            
            // Шаг 3: Прочитать 36 байт
            const hexData = await this.readFileBytes(36);
            if (!hexData) {
                console.error('Не удалось прочитать данные');
                return null;
            }
            
            return this.parseOutputDataStructure(hexData);
        } catch (e) {
            console.error('Ошибка чтения структуры выходных данных:', e);
            return null;
        }
    }

    /**
     * Парсинг структуры выходных данных (раздел 6.2)
     */
    parseOutputDataStructure(hexData) {
        try {
            console.log('[PARSE OUTPUT] HEX данные:', hexData);
            console.log('[PARSE OUTPUT] Длина HEX строки:', hexData.length);
            
            const bytes = this.hexStringToByteArray(hexData);
            console.log('[PARSE OUTPUT] Распаршено байт:', bytes.length);
            
            if (bytes.length < 36) {
                console.error(`[PARSE OUTPUT] Недостаточно байт: ожидалось 36, получено ${bytes.length}`);
                // Пытаемся дополнить нулями если данных меньше
                while (bytes.length < 36) {
                    bytes.push(0);
                }
            }
            
            const view = new DataView(new Uint8Array(bytes).buffer);
            
            // Байт 0: Битовое поле статуса
            const statusByte = bytes[0];
            const status = {
                channelsEnabled: (statusByte & 0x01) !== 0,           // Бит 0
                mainBlockEnabled: (statusByte & 0x02) !== 0,          // Бит 1
                upperChannelEnabled: (statusByte & 0x04) !== 0,       // Бит 2
                lowerChannelEnabled: (statusByte & 0x08) !== 0,       // Бит 3
                cycleCounter: (statusByte >> 4) & 0x07,               // Биты 4-6
                prevCommandAccepted: (statusByte & 0x80) !== 0        // Бит 7
            };
            
            // Байты 1-4: Уставка основного блока (Float)
            const mainSetpoint = view.getFloat32(1, true); // little-endian
            
            // Байты 5-8: Основной блок (Float)
            const mainBlock = view.getFloat32(5, true);
            
            // Байты 9-12: Верхняя охранная зона (Float)
            const upperZone = view.getFloat32(9, true);
            
            // Байты 13-16: Нижняя охранная зона (Float)
            const lowerZone = view.getFloat32(13, true);
            
            // Байты 17-18: Мощность основной блок (INT16)
            const mainPower = view.getInt16(17, true);
            
            // Байты 19-20: Мощность верх (INT16)
            const upperPower = view.getInt16(19, true);
            
            // Байты 21-22: Мощность низ (INT16)
            const lowerPower = view.getInt16(21, true);
            
            // Байты 23-24: Температура прибора (INT16)
            const deviceTemp = view.getInt16(23, true);
            
            // Байты 25-26: Температура компенсатора (INT16)
            const compensatorTemp = view.getInt16(25, true);
            
            // Байты 27-28: Напряжение питания * 100 (INT16)
            const voltage = view.getInt16(27, true) / 100.0;
            
            // Байт 29: Секунды времени стабилизации
            const stabSeconds = bytes[29];
            
            // Байт 30: Минуты времени стабилизации
            const stabMinutes = bytes[30];
            
            // Байт 31: Часы времени стабилизации
            const stabHours = bytes[31];
            
            // Байты 32-33: Код ошибки (UINT16)
            const errorCode = view.getUint16(32, true);
            
            // Байты 34-35: Параметры блокировки (UINT16)
            const lockParams = view.getUint16(34, true);
            
            return {
                status,
                mainSetpoint,
                mainBlock,
                upperZone,
                lowerZone,
                mainPower,
                upperPower,
                lowerPower,
                deviceTemp,
                compensatorTemp,
                voltage,
                stabilizationTime: {
                    hours: stabHours,
                    minutes: stabMinutes,
                    seconds: stabSeconds
                },
                errorCode,
                lockParams,
                rawBytes: bytes
            };
        } catch (e) {
            console.error('Ошибка парсинга структуры выходных данных:', e);
            return null;
        }
    }

    /**
     * Чтение структуры параметров регулятора (раздел 6.3)
     * Flash, адрес 63, размер 13 байт
     */
    async readRegulatorParamsStructure() {
        try {
            // Шаг 1: Открыть Flash (тип памяти 2)
            if (!await this.openFile(2)) {
                console.error('Не удалось открыть Flash');
                return null;
            }
            
            // Шаг 2: Перейти к адресу 63
            if (!await this.seekFile(63)) {
                console.error('Не удалось перейти к адресу 63');
                return null;
            }
            
            // Шаг 3: Прочитать 13 байт
            const hexData = await this.readFileBytes(13);
            if (!hexData) {
                console.error('Не удалось прочитать данные');
                return null;
            }
            
            return this.parseRegulatorParamsStructure(hexData);
        } catch (e) {
            console.error('Ошибка чтения структуры параметров регулятора:', e);
            return null;
        }
    }

    /**
     * Парсинг структуры параметров регулятора (раздел 6.3)
     */
    parseRegulatorParamsStructure(hexData) {
        try {
            console.log('[PARSE REG PARAMS] HEX данные:', hexData);
            console.log('[PARSE REG PARAMS] Длина HEX строки:', hexData.length);
            
            const bytes = this.hexStringToByteArray(hexData);
            console.log('[PARSE REG PARAMS] Распаршено байт:', bytes.length);
            
            if (bytes.length < 13) {
                console.error(`[PARSE REG PARAMS] Недостаточно байт: ожидалось 13, получено ${bytes.length}`);
                // Пытаемся дополнить нулями если данных меньше
                while (bytes.length < 13) {
                    bytes.push(0);
                }
            }
            
            const view = new DataView(new Uint8Array(bytes).buffer);
            
            // Байты 0-3: Уставка (Float)
            const setpoint = view.getFloat32(0, true);
            
            // Байты 4-7: Плато (Float)
            const plateau = view.getFloat32(4, true);
            
            // Байты 8-11: Скорость (Float)
            const speed = view.getFloat32(8, true);
            
            // Байт 12: Контрольная сумма
            const checksum = bytes[12];
            
            // Проверяем контрольную сумму
            const calculatedChecksum = this.calcCRC8(bytes.slice(0, 12));
            const checksumValid = (checksum === calculatedChecksum);
            
            if (!checksumValid) {
                console.warn(`Неверная контрольная сумма структуры параметров: ${checksum} != ${calculatedChecksum}`);
            }
            
            return {
                setpoint,
                plateau,
                speed,
                checksum,
                checksumValid,
                rawBytes: bytes
            };
        } catch (e) {
            console.error('Ошибка парсинга структуры параметров регулятора:', e);
            return null;
        }
    }

    /**
     * Запись структуры параметров регулятора (раздел 6.3, 7.3)
     * @param {Object} params - новые параметры (setpoint, plateau, speed)
     */
    async writeRegulatorParamsStructure(params) {
        try {
            // Шаг 1: Читаем текущую структуру
            const currentData = await this.readRegulatorParamsStructure();
            if (!currentData) {
                console.error('Не удалось прочитать текущие параметры');
                return false;
            }
            
            console.log('[WRITE REG PARAMS] Текущие байты перед записью:', currentData.rawBytes);
            console.log('[WRITE REG PARAMS] Текущая уставка:', currentData.setpoint);
            
            // Создаем НОВЫЙ массив байт для модификации
            const bytes = new Uint8Array(13);
            const view = new DataView(bytes.buffer);
            
            // Копируем текущие значения
            for (let i = 0; i < 13; i++) {
                bytes[i] = currentData.rawBytes[i];
            }
            
            // Устанавливаем новые значения
            if (params.setpoint !== undefined) {
                view.setFloat32(0, params.setpoint, true);
                console.log('[WRITE REG PARAMS] Новая уставка в буфере:', view.getFloat32(0, true));
            }
            if (params.plateau !== undefined) {
                view.setFloat32(4, params.plateau, true);
            }
            if (params.speed !== undefined) {
                view.setFloat32(8, params.speed, true);
            }
            
            // Пересчитываем контрольную сумму (байт 12) как ИНВЕРСИЮ суммы байтов 0-11
            // Согласно Delphi-коду: Result := Byte(not CRC) после суммирования
            let sum = 0;
            for (let i = 0; i < 12; i++) {
                sum += bytes[i];
            }
            let calculatedChecksum = (~sum) & 0xFF; // Инверсия и маска 0xFF
            
            console.log(`[WRITE REG PARAMS] Сумма байтов 0-11: ${sum & 0xFF}, инвертированная checksum: ${calculatedChecksum}`);
            
            bytes[12] = calculatedChecksum;
            
            const hexData = this.byteArrayToHexString(bytes);
            console.log('[WRITE REG PARAMS] HEX для записи:', hexData);
            console.log('[WRITE REG PARAMS] Байты для записи:', Array.from(bytes));
            
            // Шаг 2: Открываем Flash
            if (!await this.openFile(2)) {
                console.error('Не удалось открыть Flash');
                return false;
            }
            
            // Шаг 3: Переходим к адресу 63
            if (!await this.seekFile(63)) {
                console.error('Не удалось перейти к адресу 63');
                return false;
            }
            
            // Шаг 4: Записываем данные
            if (!await this.writeFileBytes(hexData)) {
                console.error('Не удалось записать данные');
                return false;
            }
            
            console.log('[WRITE REG PARAMS] Данные записаны, ждем 2000мс для записи во Flash...');
            // Критически важная пауза 2000 мс после записи для гарантированного сохранения во Flash
            await this.sleep(2000);
            
            // Шаг 5: Актуализируем данные (команда 44) - критически важно для сохранения во Flash!
            if (!await this.updateFile()) {
                console.error('Не удалось актуализировать данные');
                return false;
            }
            
            // Еще одна пауза после актуализации согласно документации (1500 мс)
            await this.sleep(1500);
            
            // В протоколе ЭЛЕМЕР-КТ нет команды закрытия файла - сессия завершается автоматически
            console.log('[WRITE REG PARAMS] Запись и актуализация завершены');
            
            return true;
        } catch (e) {
            console.error('Ошибка записи структуры параметров регулятора:', e);
            return false;
        }
    }

    /**
     * Чтение структуры управления регулятором (раздел 6.4)
     * Flash, адрес 76, размер 23 байта
     */
    async readRegulatorControlStructure() {
        try {
            // Шаг 1: Открыть Flash (тип памяти 2)
            if (!await this.openFile(2)) {
                console.error('Не удалось открыть Flash');
                return null;
            }
            
            // Шаг 2: Перейти к адресу 76
            if (!await this.seekFile(76)) {
                console.error('Не удалось перейти к адресу 76');
                return null;
            }
            
            // Шаг 3: Прочитать 23 байта
            const hexData = await this.readFileBytes(23);
            if (!hexData) {
                console.error('Не удалось прочитать данные');
                return null;
            }
            
            return this.parseRegulatorControlStructure(hexData);
        } catch (e) {
            console.error('Ошибка чтения структуры управления регулятора:', e);
            return null;
        }
    }

    /**
     * Парсинг структуры управления регулятором (раздел 6.4)
     */
    parseRegulatorControlStructure(hexData) {
        try {
            const bytes = this.hexStringToByteArray(hexData);
            if (bytes.length < 23) {
                console.error('Недостаточно байт в структуре управления регулятора');
                return null;
            }
            
            const view = new DataView(new Uint8Array(bytes).buffer);
            
            // Байт 0: Состояние регулятора (Bits)
            const controlByte = bytes[0];
            const control = {
                regulatorOn: (controlByte & 0x01) !== 0,              // Бит 0
                mainBlockEnabled: (controlByte & 0x02) !== 0,         // Бит 1
                upperChannelEnabled: (controlByte & 0x04) !== 0,      // Бит 2
                lowerChannelEnabled: (controlByte & 0x08) !== 0,      // Бит 3
                regulatorType: (controlByte >> 4) & 0x0F              // Биты 4-7
            };
            
            // Байты 1-2: Мин. измеряемая температура (INT16)
            const minTemp = view.getInt16(1, true);
            
            // Байты 3-4: Макс. измеряемая температура (INT16)
            const maxTemp = view.getInt16(3, true);
            
            // Байты 5-8: Зона пропорциональности (Float)
            const proportionalZone = view.getFloat32(5, true);
            
            // Байты 9-12: Зона нечувствительности (Float)
            const deadZone = view.getFloat32(9, true);
            
            // Байты 13-16: Коридор готовности (Float)
            const readinessCorridor = view.getFloat32(13, true);
            
            // Байты 17-20: Дополнительный параметр коридора (Float, всегда 0)
            const additionalCorridorParam = view.getFloat32(17, true);
            
            // Байт 21: Время стабилизации и флаги мощности (Bits)
            const stabFlagsByte = bytes[21];
            const stabFlags = {
                stabilizationTimeMinutes: stabFlagsByte & 0x3F,       // Биты 0-5 (0-60 минут)
                fixedPowerEnabled: (stabFlagsByte & 0x40) !== 0,      // Бит 6
                voltageCorrectionEnabled: (stabFlagsByte & 0x80) !== 0 // Бит 7
            };
            
            // Байт 22: Контрольная сумма
            const checksum = bytes[22];
            
            // Проверяем контрольную сумму
            const calculatedChecksum = this.calcCRC8(bytes.slice(0, 22));
            const checksumValid = (checksum === calculatedChecksum);
            
            if (!checksumValid) {
                console.warn(`Неверная контрольная сумма структуры управления: ${checksum} != ${calculatedChecksum}`);
            }
            
            return {
                control,
                minTemp,
                maxTemp,
                proportionalZone,
                deadZone,
                readinessCorridor,
                additionalCorridorParam,
                stabFlags,
                checksum,
                checksumValid,
                rawBytes: bytes
            };
        } catch (e) {
            console.error('Ошибка парсинга структуры управления регулятора:', e);
            return null;
        }
    }

    /**
     * Запись структуры управления регулятором (раздел 6.4, 7.3)
     * После записи требуется команда актуализации (44)
     * @param {Object} updates - изменения для структуры
     */
    async writeRegulatorControlStructure(updates) {
        try {
            // Шаг 1: Читаем текущую структуру
            const currentData = await this.readRegulatorControlStructure();
            if (!currentData) {
                console.error('Не удалось прочитать текущую структуру управления');
                return false;
            }
            
            // Обновляем параметры
            const bytes = currentData.rawBytes;
            
            // Обновляем байт 0 (состояние регулятора)
            if (updates.control !== undefined) {
                let controlByte = bytes[0];
                if (updates.control.regulatorOn !== undefined) {
                    controlByte = updates.control.regulatorOn ? (controlByte | 0x01) : (controlByte & ~0x01);
                }
                if (updates.control.mainBlockEnabled !== undefined) {
                    controlByte = updates.control.mainBlockEnabled ? (controlByte | 0x02) : (controlByte & ~0x02);
                }
                if (updates.control.upperChannelEnabled !== undefined) {
                    controlByte = updates.control.upperChannelEnabled ? (controlByte | 0x04) : (controlByte & ~0x04);
                }
                if (updates.control.lowerChannelEnabled !== undefined) {
                    controlByte = updates.control.lowerChannelEnabled ? (controlByte | 0x08) : (controlByte & ~0x08);
                }
                // Биты 4-7 (тип регулятора) не должны изменяться
                bytes[0] = controlByte;
            }
            
            // Обновляем байт 21 (время стабилизации и флаги)
            if (updates.stabFlags !== undefined) {
                let stabByte = bytes[21];
                if (updates.stabFlags.stabilizationTimeMinutes !== undefined) {
                    stabByte = (stabByte & 0xC0) | (updates.stabFlags.stabilizationTimeMinutes & 0x3F);
                }
                if (updates.stabFlags.fixedPowerEnabled !== undefined) {
                    stabByte = updates.stabFlags.fixedPowerEnabled ? (stabByte | 0x40) : (stabByte & ~0x40);
                }
                if (updates.stabFlags.voltageCorrectionEnabled !== undefined) {
                    stabByte = updates.stabFlags.voltageCorrectionEnabled ? (stabByte | 0x80) : (stabByte & ~0x80);
                }
                bytes[21] = stabByte;
            }
            
            // Пересчитываем контрольную сумму (байт 22)
            bytes[22] = this.calcCRC8(bytes.slice(0, 22));
            
            const hexData = this.byteArrayToHexString(bytes);
            
            // Шаг 2: Открываем Flash
            if (!await this.openFile(2)) {
                console.error('Не удалось открыть Flash');
                return false;
            }
            
            // Шаг 3: Переходим к адресу 76
            if (!await this.seekFile(76)) {
                console.error('Не удалось перейти к адресу 76');
                return false;
            }
            
            // Шаг 4: Записываем данные
            if (!await this.writeFileBytes(hexData)) {
                console.error('Не удалось записать данные');
                return false;
            }
            
            // Пауза 500 мс после записи (раздел 5.8)
            await this.sleep(this.timeouts.pauseAfterWrite);
            
            // Шаг 5: Актуализация данных (команда 44)
            if (!await this.updateFile()) {
                console.error('Не удалось выполнить актуализацию');
                return false;
            }
            
            // Пауза 1500 мс после актуализации (раздел 4.2, 5.9)
            await this.sleep(this.timeouts.pauseAfterUpdate);
            
            return true;
        } catch (e) {
            console.error('Ошибка записи структуры управления регулятора:', e);
            return false;
        }
    }

    /**
     * Включение/выключение регулятора
     * @param {boolean} turnOn - true для включения, false для выключения
     */
    async setRegulatorPower(turnOn) {
        return await this.writeRegulatorControlStructure({
            control: { regulatorOn: turnOn }
        });
    }

    /**
     * Установка времени стабилизации (в минутах)
     * @param {number} minutes - время стабилизации (0-60)
     */
    async setStabilizationTime(minutes) {
        if (minutes < 0 || minutes > 60) {
            console.error('Время стабилизации должно быть от 0 до 60 минут');
            return false;
        }
        return await this.writeRegulatorControlStructure({
            stabFlags: { stabilizationTimeMinutes: Math.floor(minutes) }
        });
    }

    /**
     * Проверка подключения к устройству (алгоритм из раздела 7.1)
     * Отправляет команду 0 (чтение типа прибора) и проверяет ответ
     * @returns {Promise<boolean>} true если тип прибора = 64
     */
    async checkConnection() {
        try {
            console.log('=== НАЧАЛО ПРОВЕРКИ ПОДКЛЮЧЕНИЯ ===');
            console.log(`Порт подключен: ${this.isConnected}`);
            console.log(`Порт читаемый: ${this.port?.readable}`);
            
            if (!this.isConnected || !this.port?.readable) {
                console.log('Ошибка: Порт не подключен или не читаем');
                return false;
            }
            
            const deviceType = await this.readDeviceType();
            console.log(`Тип прибора получен: ${deviceType}`);
            
            if (deviceType === this.expectedDeviceType) {
                this.states.typeConfirmed = true;
                console.log('Устройство подтверждено как ЭЛЕМЕР-КТ (тип 64)');
                return true;
            } else if (deviceType === null) {
                console.log('Ошибка: Не удалось получить тип прибора (таймаут или ошибка CRC)');
                console.log('Проверьте: 1) Режим "Управление с ПК" на приборе, 2) Драйверы FTDI, 3) Кабель USB');
                return false;
            } else {
                console.log(`Ошибка: Неверный тип прибора. Получено: ${deviceType}, ожидается: 64`);
                return false;
            }
        } catch (e) {
            console.log(`Критическая ошибка проверки подключения: ${e.message}`);
            console.error('Ошибка проверки подключения:', e);
            return false;
        }
    }

    /**
     * Получение данных о температуре (основной метод для чтения)
     * Читает структуру выходных данных из RAM
     * @returns {Promise<{celsius: number|null, kelvin: number|null, status: object|null}>}
     */
    async obtainData() {
        try {
            const data = await this.readOutputDataStructure();
            if (!data) {
                return { celsius: null, kelvin: null, status: null };
            }
            
            // Сохраняем данные в свойства объекта
            // mainBlock - это температура основного блока в °C (байты 5-8, Float)
            this.temperatureCelsius = data.mainBlock;
            this.temperatureKelvin = data.mainBlock !== null ? data.mainBlock + 273.15 : null;
            
            console.log(
                `[OBTAIN DATA] Setpoint=${data.mainSetpoint}°C, Temp=${data.mainBlock}°C (${this.temperatureKelvin}K), MainPower=${data.mainPower}`
            );
            
            return {
                celsius: data.mainBlock,
                kelvin: this.temperatureKelvin,
                setpoint: data.mainSetpoint,
                status: data.status
            };
        } catch (e) {
            console.error('Ошибка получения данных:', e);
            return { celsius: null, kelvin: null, status: null };
        }
    }

    /**
     * Установка температуры калибровки (уставки) с заданной скоростью нагрева
     * Записывает новую уставку в структуру параметров регулятора
     * @param {number} setPoint - целевая температура в °C
     * @param {number} stabTimeMinutes - время стабилизации в минутах (для расчета скорости)
     * @param {number} customSpeed - пользовательская скорость нагрева в °C/мин (опционально)
     * @returns {Promise<boolean>} true если успешно
     */
    async setCalibrationTemperatureWithRate(setPoint, stabTimeMinutes = 10, customSpeed = null) {
        try {
            // Читаем текущие параметры регулятора
            const currentParams = await this.readRegulatorParamsStructure();
            if (!currentParams) {
                console.error('Не удалось прочитать текущие параметры регулятора');
                return false;
            }
            
            // Получаем текущую температуру
            const currentTemp = await this.obtainData();
            const currentTempValue = currentTemp?.celsius || 20.0;
            
            // Рассчитываем скорость нагрева (°C/мин)
            // Если передана пользовательская скорость, используем её
            // Иначе рассчитываем исходя из времени стабилизации
            let speed = 0;
            if (customSpeed !== null && customSpeed !== undefined) {
                speed = customSpeed;
                console.log(`Используем пользовательскую скорость: ${speed}°C/мин`);
            } else if (stabTimeMinutes > 0) {
                const tempDiff = Math.abs(setPoint - currentTempValue);
                speed = tempDiff / stabTimeMinutes;
                // Округляем до 0.1 °C/мин
                speed = Math.round(speed * 10) / 10;
            }
            
            console.log(`Расчет скорости: текущая=${currentTempValue}°C, целевая=${setPoint}°C, время=${stabTimeMinutes}мин, скорость=${speed}°C/мин`);
            
            // На ряде прошивок М90 принудительная запись speed/plateau приводит к
            // сбросу уставки. Поэтому для надежности меняем только setpoint,
            // а остальные поля сохраняем из текущей структуры.
            const newParams = {
                setpoint: setPoint,
                plateau: currentParams.plateau,
                speed: currentParams.speed
            };
            if (customSpeed !== null && customSpeed !== undefined) {
                console.log(`[SET CAL WITH RATE] customSpeed=${customSpeed} рассчитана, но не пишется в reg63 (режим совместимости).`);
            }
            
            // Записываем новые параметры
            const success = await this.writeRegulatorParamsStructure(newParams);
            if (!success) {
                console.error('Не удалось записать параметры регулятора');
                return false;
            }
            
            // Пауза после записи (раздел 4.2)
            await this.sleep(this.timeouts.pauseAfterWrite);

            // Проверяем, что уставка реально попала в RAM-выходы прибора.
            const verifyOut = await this.readOutputDataStructure();
            if (!verifyOut || Math.abs((verifyOut.mainSetpoint ?? NaN) - setPoint) > 0.2) {
                console.warn(
                    `[SET CAL WITH RATE] После записи уставка не подтверждена в RAM: ожидалось ${setPoint}, получено ${verifyOut?.mainSetpoint}`
                );
            } else {
                console.log(`[SET CAL WITH RATE] Уставка подтверждена: ${verifyOut.mainSetpoint}°C`);
            }
            
            // Читаем структуру управления для включения регулятора
            const controlData = await this.readRegulatorControlStructure();
            if (!controlData) {
                console.error('Не удалось прочитать структуру управления');
                return false;
            }
            
            // Включаем регулятор и устанавливаем время стабилизации
            const writeSuccess = await this.writeRegulatorControlStructure({
                control: { regulatorOn: true },
                stabFlags: { stabilizationTimeMinutes: Math.floor(stabTimeMinutes) & 0x3F }
            });
            
            if (!writeSuccess) {
                console.error('Не удалось включить регулятор');
                return false;
            }
            
            // Пауза после записи
            await this.sleep(this.timeouts.pauseAfterWrite);
            
            // Актуализация данных (раздел 5.9)
            const updateSuccess = await this.updateFile();
            if (!updateSuccess) {
                console.error('Не удалось актуализировать данные');
                return false;
            }
            
            // Пауза после актуализации (раздел 4.2)
            await this.sleep(this.timeouts.pauseAfterUpdate);
            
            return true;
        } catch (e) {
            console.error('Ошибка установки температуры калибровки:', e);
            return false;
        }
    }

    /**
     * Установка температуры калибровки (уставки) без включения регулятора
     * Только записывает значение уставки в параметры регулятора, не запуская нагрев
     * @param {number} setPoint - целевая температура в °C
     * @returns {Promise<boolean>} true если успешно
     */
    async setTemperatureSetpointOnly(setPoint) {
        try {
            console.log('[SET TEMP ONLY] Начало установки уставки:', setPoint);
            
            // Читаем текущие параметры регулятора
            const currentParams = await this.readRegulatorParamsStructure();
            if (!currentParams) {
                console.error('Не удалось прочитать текущие параметры регулятора');
                return false;
            }
            
            console.log('[SET TEMP ONLY] Текущие параметры:', currentParams);
            
            // Формируем новые параметры с новой уставкой, сохраняя остальные значения
            const newParams = {
                setpoint: setPoint,
                plateau: currentParams.plateau || 0,
                speed: currentParams.speed || 0
            };
            
            console.log('[SET TEMP ONLY] Новые параметры для записи:', newParams);
            
            // Записываем новые параметры
            const success = await this.writeRegulatorParamsStructure(newParams);
            if (!success) {
                console.error('Не удалось записать параметры регулятора');
                return false;
            }
            
            console.log('[SET TEMP ONLY] Параметры успешно записаны');
            
            // Пауза после записи (раздел 4.2)
            await this.sleep(this.timeouts.pauseAfterWrite);
            
            // Актуализация данных (раздел 5.9)
            const updateSuccess = await this.updateFile();
            if (!updateSuccess) {
                console.error('Не удалось актуализировать данные');
                return false;
            }
            
            console.log('[SET TEMP ONLY] Данные актуализированы');
            
            // Пауза после актуализации (раздел 4.2)
            await this.sleep(this.timeouts.pauseAfterUpdate);
            
            // Проверяем что записалось
            const verifyParams = await this.readRegulatorParamsStructure();
            if (verifyParams) {
                console.log('[SET TEMP ONLY] Проверка после записи:', verifyParams);
                if (Math.abs(verifyParams.setpoint - setPoint) > 0.1) {
                    console.warn('[SET TEMP ONLY] ВНИМАНИЕ: Уставка после записи не совпадает! Ожидалось:', setPoint, 'Получено:', verifyParams.setpoint);
                } else {
                    console.log('[SET TEMP ONLY] Уставка успешно установлена и подтверждена:', verifyParams.setpoint);
                }
            }
            
            return true;
        } catch (e) {
            console.error('Ошибка установки уставки температуры:', e);
            return false;
        }
    }

    /**
     * Установка температуры калибровки (уставки)
     * Устаревший метод, используйте setCalibrationTemperatureWithRate
     * @param {number} setPoint - целевая температура в °C
     * @returns {Promise<boolean>} true если успешно
     */
    async setCalibrationTemperature(setPoint) {
        return await this.setCalibrationTemperatureWithRate(setPoint, 0);
    }

    /**
     * Остановка нагрева и выключение регулятора (раздел 6.4, 7.3)
     * Выключает регулятор и сбрасывает уставку
     */
    async stopCalibration() {
        try {
            // Читаем структуру управления для выключения регулятора
            const controlData = await this.readRegulatorControlStructure();
            if (!controlData) {
                console.error('Не удалось прочитать структуру управления');
                return false;
            }
            
            // Выключаем регулятор (бит 0 = 0)
            const writeSuccess = await this.writeRegulatorControlStructure({
                control: { 
                    regulatorOn: false,
                    mainBlockOn: false,
                    channel1On: false,
                    channel2On: false
                }
            });
            
            if (!writeSuccess) {
                console.error('Не удалось выключить регулятор');
                return false;
            }
            
            // Пауза после записи
            await this.sleep(this.timeouts.pauseAfterWrite);
            
            // Сбрасываем уставку в 0
            const resetParams = {
                setPoint: 0,
                plateau: 0,
                rate: 0
            };
            
            const paramsSuccess = await this.writeRegulatorParamsStructure(resetParams);
            if (!paramsSuccess) {
                console.error('Не удалось сбросить параметры регулятора');
                return false;
            }
            
            // Пауза после записи
            await this.sleep(this.timeouts.pauseAfterWrite);
            
            // Актуализация данных (раздел 5.9)
            const updateSuccess = await this.updateFile();
            if (!updateSuccess) {
                console.error('Не удалось актуализировать данные');
                return false;
            }
            
            // Пауза после актуализации (раздел 4.2)
            await this.sleep(this.timeouts.pauseAfterUpdate);
            
            return true;
        } catch (e) {
            console.error('Ошибка остановки калибровки:', e);
            return false;
        }
    }

    /**
     * Вспомогательная функция для паузы
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Преобразование HEX строки в байтовый массив
     */
    hexStringToByteArray(hex) {
        if (!hex || hex.length === 0) {
            console.error('[HEX->BYTES] Пустая HEX строка');
            return [];
        }
        
        // Убедимся, что длина четная
        if (hex.length % 2 !== 0) {
            console.error('[HEX->BYTES] Нечетная длина HEX строки:', hex, 'добавляем ведущий 0');
            hex = '0' + hex;
        }
        
        const bytes = [];
        for (let i = 0; i < hex.length; i += 2) {
            const byteStr = hex.substr(i, 2);
            const byte = parseInt(byteStr, 16);
            if (isNaN(byte)) {
                console.error('[HEX->BYTES] Неверный HEX байт:', byteStr, 'в строке:', hex);
                continue;
            }
            bytes.push(byte);
        }
        
        console.log(`[HEX->BYTES] Длина строки: ${hex.length}, байт получено: ${bytes.length}`);
        return bytes;
    }

    /**
     * Преобразование байтового массива в HEX строку
     */
    byteArrayToHexString(bytes) {
        // Важно: bytes может быть Uint8Array.
        // У TypedArray метод map приводит результат callback к Number,
        // что ломает строковую конвертацию в hex.
        return Array.from(bytes, (b) => Number(b).toString(16).padStart(2, '0').toUpperCase()).join('');
    }

    /**
     * Конвертация float в байты (little-endian IEEE 754)
     */
    floatToBytes(value) {
        const buffer = new ArrayBuffer(4);
        const view = new DataView(buffer);
        view.setFloat32(0, value, true); // true = little-endian
        return [view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)];
    }

    /**
     * Подготовка файла 63 для записи (установка уставки температуры)
     * Устаревший метод, используйте writeRegulatorParamsStructure
     */
    prepareFile63(hexData, setPoint) {
        console.warn('prepareFile63 устарел, используйте writeRegulatorParamsStructure');
        try {
            const bytes = this.hexStringToByteArray(hexData);
            
            // Устанавливаем уставку (байты 0-3 для Float)
            const tempBytes = this.floatToBytes(setPoint);
            for (let i = 0; i < 4 && i < tempBytes.length; i++) {
                bytes[i] = tempBytes[i];
            }
            
            // Пересчитываем CRC (последний байт)
            bytes[bytes.length - 1] = this.calcCRC8(bytes.slice(0, -1));
            
            return this.byteArrayToHexString(bytes);
        } catch (e) {
            console.error('Ошибка подготовки файла 63:', e);
            return null;
        }
    }

    /**
     * Подготовка файла 76 для записи (включение регулятора)
     * Устаревший метод, используйте writeRegulatorControlStructure
     */
    prepareFile76ForWrite(hexData, turnOn) {
        console.warn('prepareFile76ForWrite устарел, используйте writeRegulatorControlStructure');
        try {
            const bytes = this.hexStringToByteArray(hexData);
            
            if (turnOn) {
                bytes[0] = bytes[0] | 1; // Установить бит 0
            } else {
                bytes[0] = bytes[0] & ~1; // Сбросить бит 0
            }
            
            // Пересчитываем CRC (последний байт)
            bytes[bytes.length - 1] = this.calcCRC8(bytes.slice(0, -1));
            
            return this.byteArrayToHexString(bytes);
        } catch (e) {
            console.error('Ошибка подготовки файла 76:', e);
            return null;
        }
    }

    /**
     * Обработка буфера данных от устройства
     * Поиск и проверка ответов в формате !DATA;CRC<CR>
     */
    processBuffer() {
        // Ищем начало ответа '!'
        while (this.buffer.includes('!')) {
            const startIndex = this.buffer.indexOf('!');
            const remainingBuffer = this.buffer.substring(startIndex);
            
            // Ищем конец ответа '\r' (CR)
            const endIndex = remainingBuffer.indexOf('\r');
            if (endIndex === -1) {
                // Нет полного ответа, ждем больше данных
                break;
            }

            // Извлекаем полный ответ включая CR
            const answer = remainingBuffer.substring(0, endIndex + 1);
            
            // Удаляем обработанную часть из буфера
            this.buffer = this.buffer.substring(startIndex + endIndex + 1);

            // Проверяем CRC
            const crcResult = this.checkCRCInAnswer(answer);
            
            if (crcResult.valid && this.pendingCommand) {
                // Ответ получен успешно
                clearTimeout(this.commandTimeout);
                
                const result = {
                    command: this.pendingCommand,
                    success: true,
                    data: crcResult.data,
                    rawAnswer: answer
                };

                console.log(`Получен ответ [${this.pendingCommand}]:`, crcResult.data);

                // Вызываем callback
                if (this.onDataUpdate) {
                    this.onDataUpdate(result);
                }

                this.pendingCommand = null;
            } else if (!crcResult.valid) {
                console.warn(`CRC ошибка в ответе: ${answer}`);
                if (this.pendingCommand) {
                    clearTimeout(this.commandTimeout);
                    
                    const result = {
                        command: this.pendingCommand,
                        success: false,
                        error: 'CRC ошибка',
                        rawAnswer: answer
                    };

                    if (this.onDataUpdate) {
                        this.onDataUpdate(result);
                    }

                    this.pendingCommand = null;
                }
            }
        }
    }
}

// Экспорт класса
window.M90Device = M90Device;
