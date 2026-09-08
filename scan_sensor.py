import serial, struct, time

def crc16(data):
    crc = 0xFFFF
    for b in data:
        crc ^= b
        for _ in range(8):
            crc = (crc >> 1) ^ 0xA001 if crc & 1 else crc >> 1
    return crc

port = serial.Serial('COM15', 19200, timeout=0.5)
addr = 2
regs = [0x0000, 0x0001, 0x0002, 0x0003, 0x0004, 0x0005, 0x0006, 0x0007,
        0x0008, 0x0009, 0x000A, 0x000B, 0x000C, 0x000D, 0x000E, 0x000F, 0x0010]
for reg in regs:
    for fn in [0x04, 0x03]:
        pdu = struct.pack('>BBHH', addr, fn, reg, 2)
        req = pdu + struct.pack('<H', crc16(pdu))
        port.reset_input_buffer()
        port.write(req)
        time.sleep(0.12)
        resp = port.read(32)
        if resp:
            print('ADDR %d FN 0x%02X REG 0x%04X -> %s' % (addr, fn, reg, resp.hex(' ')))
            break
port.close()