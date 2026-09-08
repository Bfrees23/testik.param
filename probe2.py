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

print('=== HOLDING 0x0002 (1 регистр, 5 чтений) ===')
for i in range(5):
    r = read(0x03, 0x0002, 1)
    rr = regs_of(r)
    print('  %d: %s  u16=%s' % (i, r.hex(' ') if r else '(no)', rr))

print()
print('=== INPUT 0x0002 (1 регистр, 5 чтений) ===')
for i in range(5):
    r = read(0x04, 0x0002, 1)
    rr = regs_of(r)
    print('  %d: %s  u16=%s' % (i, r.hex(' ') if r else '(no)', rr))

print()
print('=== INPUT 0x0004 (1 регистр, 5 чтений) ===')
for i in range(5):
    r = read(0x04, 0x0004, 1)
    rr = regs_of(r)
    print('  %d: %s  u16=%s' % (i, r.hex(' ') if r else '(no)', rr))

print()
print('=== HOLDING 0x0000-0x000F (3 чтения) ===')
for i in range(3):
    r = read(0x03, 0x0000, 16)
    rr = regs_of(r)
    print('  %d: %s' % (i, rr))

print()
print('=== INPUT 0x0000-0x0007 (3 чтения) ===')
for i in range(3):
    r = read(0x04, 0x0000, 8)
    rr = regs_of(r)
    print('  %d: %s' % (i, rr))

port.close()