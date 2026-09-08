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

print('=== HOLDING 0x000D-0x000E (float32, 5 чтений) ===')
for i in range(5):
    r = read(0x03, 0x000D, 2)
    if r and len(r) > 3 and r[1] == 0x03:
        data = r[3:3+r[2]]
        f = struct.unpack('<f', data)[0]
        print('  %d: %s  floatLE=%.6g MPa = %.3f kPa' % (i, data.hex(' '), f, f*1000))
    else:
        print('  %d: %s' % (i, r.hex(' ') if r else '(no)'))

print()
print('=== INPUT 0x0000-0x0007 (8 регистров, 3 чтения) ===')
for i in range(3):
    r = read(0x04, 0x0000, 8)
    if r and len(r) > 3 and r[1] == 0x04:
        data = r[3:3+r[2]]
        regs = [struct.unpack('>H', data[j:j+2])[0] for j in range(0, len(data)-1, 2)]
        print('  %d: %s' % (i, data.hex(' ')))
        print('     u16:', regs)
        for off in range(0, len(data)-3):
            v = struct.unpack('<f', data[off:off+4])[0]
            if abs(v) < 1e6 and v != 0:
                print('     floatLE[%d] = %.6g' % (off, v))
    else:
        print('  %d: %s' % (i, r.hex(' ') if r else '(no)'))

print()
print('=== INPUT 0x0002 (2 регистра, 5 чтений) ===')
for i in range(5):
    r = read(0x04, 0x0002, 2)
    if r and len(r) > 3 and r[1] == 0x04:
        data = r[3:3+r[2]]
        regs = [struct.unpack('>H', data[j:j+2])[0] for j in range(0, len(data)-1, 2)]
        print('  %d: %s  u16=%s  floatLE=%.6g' % (i, data.hex(' '), regs, struct.unpack('<f', data)[0]))
    else:
        print('  %d: %s' % (i, r.hex(' ') if r else '(no)'))

port.close()