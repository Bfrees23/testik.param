import serial, struct, time

def crc16(data):
    crc = 0xFFFF
    for b in data:
        crc ^= b
        for _ in range(8):
            crc = (crc >> 1) ^ 0xA001 if crc & 1 else crc >> 1
    return crc

port = serial.Serial('COM15', 19200, timeout=0.8)
addr = 2
# Функция 0x03 (holding) на разных регистрах
for reg in [0x0000, 0x0001, 0x0002, 0x000A, 0x000B, 0x0010, 0x0020, 0x0100, 0x1000]:
    pdu = struct.pack('>BBHH', addr, 0x03, reg, 1)
    req = pdu + struct.pack('<H', crc16(pdu))
    port.reset_input_buffer()
    port.write(req)
    time.sleep(0.2)
    resp = port.read(32)
    print('FN 0x03 REG 0x%04X -> %s' % (reg, resp.hex(' ') if resp else '(no response)'))
port.close()