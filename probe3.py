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
    time.sleep(0.15)
    return port.read(64)

def regs_of(r):
    if not r or len(r) < 4 or r[1] in (0x83, 0x84):
        return None
    data = r[3:3+r[2]]
    return [struct.unpack('>H', data[i:i+2])[0] for i in range(0, len(data)-1, 2)]

print('=== HOLDING 0x0010-0x001F (16 регистров) ===')
r = read(0x03, 0x0010, 16)
print('  %s' % (r.hex(' ') if r else '(no)'))
rr = regs_of(r)
if rr:
    print('  u16:', rr)
    data = r[3:3+r[2]]
    for off in range(0, len(data)-3):
        v = struct.unpack('<f', data[off:off+4])[0]
        if abs(v) < 1e6 and v != 0:
            print('  floatLE[%d] = %.6g' % (off, v))

print()
print('=== INPUT 0x0008-0x000F (8 регистров) ===')
r = read(0x04, 0x0008, 8)
print('  %s' % (r.hex(' ') if r else '(no)'))
rr = regs_of(r)
if rr:
    print('  u16:', rr)
    data = r[3:3+r[2]]
    for off in range(0, len(data)-3):
        v = struct.unpack('<f', data[off:off+4])[0]
        if abs(v) < 1e6 and v != 0:
            print('  floatLE[%d] = %.6g' % (off, v))

print()
print('=== HOLDING 0x0002 (1 регистр, 10 чтений, проверка стабильности) ===')
vals = []
for i in range(10):
    r = read(0x03, 0x0002, 1)
    rr = regs_of(r)
    vals.append(rr[0] if rr else None)
    time.sleep(0.1)
print('  values:', vals)
print('  min=%s max=%s' % (min(vals), max(vals)))

print()
print('=== INPUT 0x0002 (1 регистр, 10 чтений, проверка стабильности) ===')
vals = []
for i in range(10):
    r = read(0x04, 0x0002, 1)
    rr = regs_of(r)
    vals.append(rr[0] if rr else None)
    time.sleep(0.1)
print('  values:', vals)
print('  min=%s max=%s' % (min(vals), max(vals)))

port.close()