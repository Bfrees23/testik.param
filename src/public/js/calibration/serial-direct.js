/**
 * Прямое подключение к COM-портам через Web Serial API
 * Работает только в Chrome/Edge на HTTPS или localhost
 */

class SerialDevice {
    constructor() {
        this.port = null;
        this.reader = null;
        this.writer = null;
        this.keepReading = false;
        this.onDataReceived = null;
        this.isConnected = false;
        this.readBuffer = '';
    }

    async openPort(port, baudRate = 9600) {
        // Свой предыдущий сеанс
        if (this.isConnected || this.port) {
            try {
                await this.disconnect();
            } catch (_e) {}
        }

        this.port = port;

        // Порт уже открыт другим инстансом (автоподключение) — закрыть и открыть заново
        if (port.readable || port.writable) {
            try {
                await port.close();
            } catch (_e) {}
            // дать CDC отпустить handle
            await new Promise((r) => setTimeout(r, 150));
        }

        try {
            await this.port.open({
                baudRate: baudRate,
                dataBits: 8,
                stopBits: 1,
                parity: 'none',
                flowControl: 'none'
            });
        } catch (e) {
            if (e && e.name === 'InvalidStateError') {
                try {
                    await port.close();
                } catch (_e2) {}
                await new Promise((r) => setTimeout(r, 200));
                await this.port.open({
                    baudRate: baudRate,
                    dataBits: 8,
                    stopBits: 1,
                    parity: 'none',
                    flowControl: 'none'
                });
            } else {
                throw e;
            }
        }

        // USB CDC часто молчит без DTR/RTS
        if (typeof this.port.setSignals === 'function') {
            try {
                await this.port.setSignals({ dataTerminalReady: true, requestToSend: true });
            } catch (_e) {}
        }

        this.isConnected = true;
        console.log(`Порт открыт с скоростью ${baudRate}`);

        const textEncoder = new TextEncoderStream();
        this.writableStreamClosed = textEncoder.readable.pipeTo(this.port.writable);
        this.writer = textEncoder.writable.getWriter();

        const textDecoder = new TextDecoderStream();
        this.readableStreamClosed = this.port.readable.pipeTo(textDecoder.writable);
        this.reader = textDecoder.readable.getReader();

        this.keepReading = true;
        this.readLoop();
    }

    async connect(baudRate = 9600, options = {}) {
        if (!navigator.serial) {
            throw new Error("Web Serial API не поддерживается этим браузером. Используйте Chrome или Edge.");
        }

        try {
            const requestOptions = {};
            const filters = Array.isArray(options.filters) ? options.filters : [];

            // requestPort в Web Serial требует usbVendorId, если указан usbProductId.
            // Поэтому в requestPort отправляем только валидные фильтры,
            // а точную проверку (в т.ч. по одному PID) делаем после выбора порта.
            const requestFilters = filters.filter((filter) => {
                if (filter.usbProductId !== undefined && filter.usbVendorId === undefined) {
                    return false;
                }
                return filter.usbVendorId !== undefined || filter.usbProductId !== undefined;
            });

            if (!options.skipRequestFilters && requestFilters.length > 0) {
                requestOptions.filters = requestFilters;
            }

            // Запрос пользователю выбрать порт (с фильтрами при необходимости)
            const selectedPort = await navigator.serial.requestPort(requestOptions);

            // Дополнительная проверка выбранного порта по исходным фильтрам.
            // Это позволяет поддержать сценарий "только PID", который requestPort не принимает напрямую.
            if (filters.length > 0) {
                const info = selectedPort.getInfo ? selectedPort.getInfo() : {};
                const matched = filters.some((filter) => {
                    if (filter.usbVendorId !== undefined && info.usbVendorId !== filter.usbVendorId) {
                        return false;
                    }
                    if (filter.usbProductId !== undefined && info.usbProductId !== filter.usbProductId) {
                        return false;
                    }
                    return true;
                });

                if (!matched) {
                    const selectedPid = info.usbProductId !== undefined ? `0x${info.usbProductId.toString(16).toUpperCase()}` : 'unknown';
                    throw new Error(`Выбранный порт не соответствует фильтру (PID ${selectedPid})`);
                }
            }

            await this.openPort(selectedPort, baudRate);

            return true;
        } catch (error) {
            console.error("Ошибка подключения:", error);
            throw error;
        }
    }

    async reconnectGranted(baudRate = 9600, options = {}) {
        if (!navigator.serial) {
            throw new Error("Web Serial API не поддерживается этим браузером. Используйте Chrome или Edge.");
        }

        const filters = Array.isArray(options.filters) ? options.filters : [];
        const ports = await navigator.serial.getPorts();
        if (!ports || ports.length === 0) {
            return false;
        }

        let targetPort = null;
        if (filters.length === 0) {
            targetPort = ports[0];
        } else {
            targetPort = ports.find((port) => {
                const info = port.getInfo ? port.getInfo() : {};
                return filters.some((filter) => {
                    if (filter.usbVendorId !== undefined && info.usbVendorId !== filter.usbVendorId) {
                        return false;
                    }
                    if (filter.usbProductId !== undefined && info.usbProductId !== filter.usbProductId) {
                        return false;
                    }
                    return true;
                });
            });
        }

        if (!targetPort) {
            return false;
        }

        try {
            await this.openPort(targetPort, baudRate);
            return true;
        } catch (error) {
            console.warn("Автоподключение не удалось:", error);
            return false;
        }
    }

    async readLoop() {
        while (this.keepReading && this.reader) {
            try {
                const { value, done } = await this.reader.read();
                if (done) {
                    console.log('Чтение порта: поток закрыт (done)');
                    break;
                }
                if (value) {
                    // Симметрично «Отправлено:» — чтобы в консоли было видно RX
                    console.log('Получено:', JSON.stringify(value));
                    if (this.onDataReceived) {
                        this.onDataReceived(value);
                    }
                }
            } catch (error) {
                if (this.keepReading) {
                    console.error('Ошибка чтения:', error);
                }
                break;
            }
        }
    }

    async write(data) {
        if (!this.writer || !this.isConnected) {
            throw new Error('Порт не открыт');
        }
        await this.writer.write(data);
        console.log('Отправлено:', JSON.stringify(data));
    }

    async disconnect() {
        this.keepReading = false;
        
        if (this.reader) {
            try {
                await this.reader.cancel();
                await this.readableStreamClosed.catch(() => {});
            } catch(e) {}
            this.reader = null;
        }
        
        if (this.writer) {
            try {
                await this.writer.close();
                await this.writableStreamClosed.catch(() => {});
            } catch(e) {}
            this.writer = null;
        }

        if (this.port) {
            try {
                await this.port.close();
            } catch(e) {}
            this.port = null;
        }

        this.isConnected = false;
        console.log("Порт закрыт");
    }
}

// Специфичная логика для МИТ 8 (на основе протокола из старого delphi)
// МИТ 8 передает данные непрерывно в формате: "B 1:25.34 B 2:26.12 B 3:24.89"
class MIT8Device extends SerialDevice {
    constructor() {
        super();
        this.buffer = '';
        this.channels = [null, null, null]; // 3 канала (индексы 0,1,2 соответствуют каналам 1,2,3)
        this.onDataUpdate = null; // Callback для обновления UI
        
        this.onDataReceived = (data) => {
            this.buffer += data;
            
            // МИТ отправляет данные в формате "B 1:25.34" разделенные пробелами или переводами строки
            // В uMITThread.pas: ParseAnswer ищет 'B' + Char(VK_SPACE) т.е. "B "
            const delimiter = 'B ';
            
            if (this.buffer.includes(delimiter)) {
                const parts = this.buffer.split(delimiter);
                
                // Обрабатываем все части кроме первой (она может быть пустой или неполной)
                for (let i = 1; i < parts.length; i++) {
                    const part = parts[i].trim();
                    if (!part) continue;
                    
                    // Формат: "1:25.34" где 1 - номер канала, 25.34 - температура
                    const colonIndex = part.indexOf(':');
                    if (colonIndex === -1) continue;
                    
                    const channelNum = parseInt(part.substring(0, colonIndex));
                    const tempValue = parseFloat(part.substring(colonIndex + 1));
                    
                    if (channelNum >= 1 && channelNum <= 3 && !isNaN(tempValue)) {
                        // Проверка на специальное значение -1.000000E+06 (NULL_DATA в Delphi)
                        if (Math.abs(tempValue + 1.0e6) < 1) {
                            this.channels[channelNum - 1] = null; // NULL данные
                        } else {
                            this.channels[channelNum - 1] = tempValue;
                        }
                        
                        // Вызываем callback обновления
                        if (this.onDataUpdate) {
                            this.onDataUpdate(this.channels);
                        }
                    }
                }
                
                // Очищаем буфер, оставляя только последнюю часть (если она неполная)
                this.buffer = delimiter + parts[parts.length - 1];
            }
        };
    }

    // Расчет CRC8 (алгоритм из uCalibratorThread.pas / MIT)
    // Полином и инициализация зависят от конкретной реализации в паскале
    calculateCRC8(data) {
        let crc = 0x00; // Или 0xFF зависит от реализации
        for (let i = 0; i < data.length; i++) {
            let byte = data.charCodeAt(i);
            crc ^= byte;
            for (let j = 0; j < 8; j++) {
                if (crc & 0x01) {
                    crc = (crc >> 1) ^ 0x8C; // Полином needs verification from .pas
                } else {
                    crc >>= 1;
                }
            }
        }
        return crc;
    }

    parseResponse(line) {
        // Парсинг ответа от МИТ
        // Пример формата: " 25.34 26.12 24.89" или "T1:25.34 T2:26.12 T3:24.89"
        // Нужно адаптировать под реальный формат из старого delphi
        
        // Попытка найти числа с плавающей точкой
        const numbers = line.match(/[-+]?\d*\.?\d+/g);
        if (numbers && numbers.length >= 1) {
            // Если 3 числа - это три канала
            if (numbers.length >= 3) {
                this.channels[0] = parseFloat(numbers[0]);
                this.channels[1] = parseFloat(numbers[1]);
                this.channels[2] = parseFloat(numbers[2]);
            } else {
                // Если одно число - возможно это общий или первый канал
                this.channels[0] = parseFloat(numbers[0]);
            }
            
            // Событие обновления данных (можно повесить callback)
            if (this.onDataUpdate) {
                this.onDataUpdate(this.channels);
            }
        }
    }

    async getTemperature() {
        // МИТ 8 передает данные непрерывно, поэтому не нужно отправлять команду запроса
        // Просто ждем обновления от onDataUpdate callback
        return new Promise((resolve, reject) => {
            if (!this.isConnected) {
                reject(new Error("Не подключено"));
                return;
            }
            
            const timeout = setTimeout(() => {
                reject(new Error("Таймаут ответа"));
            }, 4000); // Увеличенный таймаут как в Delphi (4000ms)
            
            // Временный обработчик для получения одного ответа
            const originalCallback = this.onDataUpdate;
            this.onDataUpdate = (channels) => {
                clearTimeout(timeout);
                this.onDataUpdate = originalCallback;
                if (typeof originalCallback === 'function') {
                    try {
                        originalCallback(channels);
                    } catch (_e) {
                        /* UI не должна рвать чтение МИТ */
                    }
                }
                resolve(channels);
            };
        });
    }
    
    async checkConnection() {
        // Для МИТ 8 проверка подключения - это просто ожидание первых данных
        // Так как устройство передает данные непрерывно
        try {
            if (!this.isConnected) {
                return false;
            }
            
            return new Promise((resolve) => {
                const timeout = setTimeout(() => resolve(false), 4000);
                
                const originalCallback = this.onDataUpdate;
                this.onDataUpdate = (channels) => {
                    clearTimeout(timeout);
                    this.onDataUpdate = originalCallback;
                    if (typeof originalCallback === 'function') {
                        try {
                            originalCallback(channels);
                        } catch (_e) {}
                    }
                    resolve(true);
                };
            });
        } catch (e) {
            return false;
        }
    }
}

// Экспорт для использования в main.js
window.SerialDevice = SerialDevice;
window.MIT8Device = MIT8Device;
