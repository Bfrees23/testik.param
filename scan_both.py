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
    resp = port.read(64)
    return resp

print('=== HOLDING (0x03) 0x0000-0x0007, 8 регистров ===')
r = read(0x03, 0x0000, 8)
print(r.hex(' ') if r else '(no response)')
if r and len(r) >= 5:
    n = r[2]
    data = r[3:3+n]
    print('bytes:', data.hex(' '))
    # float32 LE из разных смещений
    for off in range(0, len(data) - 3):
        v = struct.unpack('<f', data[off:off+4])[0]
        print('  floatLE[%d] = %.6g' % (off, v))

print()
print('=== INPUT (0x04) 0x0000-0x0007, 8 регистров ===')
r = read(0x04, 0x0000, 8)
print(r.hex(' ') if r else '(no response)')
if r and len(r) >= 5:
    n = r[2]
    data = r[3:3+n]
    print('bytes:', data.hex(' '))
    for off in range(0, len(data) - 3):
        v = struct.unpack('<f', data[off:off+4])[0]
        print('  floatLE[%d] = %.6g' % (off, v))
port.close()