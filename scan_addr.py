import serial, struct, time

def crc16(data):
    crc = 0xFFFF
    for b in data:
        crc ^= b
        for _ in range(8):
            crc = (crc >> 1) ^ 0xA001 if crc & 1 else crc >> 1
    return crc

port = serial.Serial('COM15', 19200, timeout=0.8)
found = []
for addr in range(1, 17):
    pdu = struct.pack('>BBHH', addr, 0x04, 0x0002, 2)
    req = pdu + struct.pack('<H', crc16(pdu))
    port.reset_input_buffer()
    port.write(req)
    time.sleep(0.3)
    resp = port.read(32)
    if resp:
        found.append((addr, resp.hex(' ')))
port.close()
if found:
    for a, r in found:
        print('ADDR %d -> %s' % (a, r))
else:
    print('NO_RESPONSE_ANY_ADDR')