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

def read(fn, reg, cnt):
    pdu = struct.pack('>BBHH', addr, fn, reg, cnt)
    req = pdu + struct.pack('<H', crc16(pdu))
    port.reset_input_buffer()
    port.write(req)
    time.sleep(0.2)
    return port.read(64)

def regs_of(r):
    if not r or len(r) < 4 or r[1] in (0x83, 0x84):
        return None
    data = r[3:3+r[2]]
    return [struct.unpack('>H', data[i:i+2])[0] for i in range(0, len(data)-1, 2)]

def try_floats(data, label):
    """Перебор всех float32-интерпретаций 4 байт."""
    if len(data) < 4:
        return
    variants = {
        'LE (ABCD)': struct.unpack('<f', data[0:4])[0],
        'BE (DCBA)': struct.unpack('>f', data[0:4])[0],
        'CDAB': struct.unpack('<f', bytes([data[2], data[3], data[0], data[1]]))[0],
        'BADC': struct.unpack('<f', bytes([data[1], data[0], data[3], data[2]]))[0],
    }
    for name, v in variants.items():
        # ищем разумное давление: 0.01..1000 кПа (или МПа 0.00001..1)
        if 0.01 <= abs(v) <= 1000:
            print('  %s %s = %.6g' % (label, name, v))

print('=== INPUT 0x0000-0x0007 (8 регистров, 5 чтений) ===')
for i in range(5):
    r = read(0x04, 0x0000, 8)
    rr = regs_of(r)
    if rr:
        data = r[3:3+r[2]]
        print('  %d: %s' % (i, data.hex(' ')))
        print('     u16:', rr)
        for off in range(0, len(data)-3):
            try_floats(data[off:off+4], 'float[%d]' % off)
    else:
        print('  %d: %s' % (i, r.hex(' ') if r else '(no)'))

print()
print('=== HOLDING 0x0000-0x001F (32 регистра, 3 чтения) ===')
for i in range(3):
    r = read(0x03, 0x0000, 32)
    rr = regs_of(r)
    if rr:
        data = r[3:3+r[2]]
        print('  %d: %s' % (i, data.hex(' ')))
        print('     u16:', rr)
        for off in range(0, len(data)-3):
            try_floats(data[off:off+4], 'float[%d]' % off)
    else:
        print('  %d: %s' % (i, r.hex(' ') if r else '(no)'))

port.close()