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

# INPUT 0x0000-0x000F (16 регистров)
r = read(0x04, 0x0000, 16)
print('INPUT 0x0000-0x000F:', r.hex(' ') if r else '(no)')
if r and len(r) > 3 and r[1] == 0x04:
    data = r[3:3+r[2]]
    print('bytes:', data.hex(' '))
    for off in range(0, len(data)-3):
        v = struct.unpack('<f', data[off:off+4])[0]
        print('  floatLE[%d] = %.6g' % (off, v))
    print('u16 regs:', [struct.unpack('>H', data[i:i+2])[0] for i in range(0, len(data)-1, 2)])

print()
# HOLDING 0x000C-0x000D (2 регистра) - проверка давления
r = read(0x03, 0x000C, 2)
print('HOLDING 0x000C-0x000D:', r.hex(' ') if r else '(no)')
if r and len(r) > 3 and r[1] == 0x03:
    data = r[3:3+r[2]]
    print('bytes:', data.hex(' '))
    print('floatLE =', struct.unpack('<f', data)[0], 'MPa =', struct.unpack('<f', data)[0]*1000, 'kPa')
    print('floatBE =', struct.unpack('>f', data)[0])
port.close()