import struct
import time

import serial


def crc16(data):
    crc = 0xFFFF
    for b in data:
        crc ^= b
        for _ in range(8):
            crc = (crc >> 1) ^ 0xA001 if crc & 1 else crc >> 1
    return crc


def mida_fp32(data):
    if data is None or len(data) < 4:
        return None
    low = (data[0] << 8) | data[1]
    high = (data[2] << 8) | data[3]
    u = (high << 16) | low
    return struct.unpack(">f", struct.pack(">I", u))[0]


def all_fp(data):
    out = {}
    if data is None or len(data) < 4:
        return out
    b = data[:4]
    out["byteLE"] = struct.unpack("<f", b)[0]
    out["byteBE"] = struct.unpack(">f", b)[0]
    out["CDAB"] = mida_fp32(b)
    out["BADC"] = struct.unpack("<f", bytes([b[1], b[0], b[3], b[2]]))[0]
    return out


def read(port, addr, fn, reg, cnt):
    pdu = struct.pack(">BBHH", addr, fn, reg, cnt)
    req = pdu + struct.pack("<H", crc16(pdu))
    port.reset_input_buffer()
    port.write(req)
    time.sleep(0.25)
    return port.read(64)


def parse(r):
    if not r or len(r) < 5:
        return None, r
    if r[1] & 0x80:
        return None, r
    n = r[2]
    return r[3 : 3 + n], r


def fmt_fp(fp):
    out = {}
    for k, v in fp.items():
        if not isinstance(v, float):
            out[k] = v
        elif abs(v) < 1e8:
            out[k] = round(v, 6)
        else:
            out[k] = v
    return out


port = serial.Serial("COM15", 19200, timeout=0.6)
print("open", port.name)

print("=== holding 0-15 addr2 ===")
data, r = parse(read(port, 2, 0x03, 0, 16))
print("raw", data.hex(" ") if data is not None else (r.hex(" ") if r else "no"))
if data is not None:
    u16 = [struct.unpack(">H", data[i : i + 2])[0] for i in range(0, len(data) - 1, 2)]
    print("u16", u16)
    print("MUnit", u16[7] if len(u16) > 7 else None)
    print("DFOrder", u16[10] if len(u16) > 10 else None)
    print("dP CDAB", mida_fp32(data[26:30]) if len(data) >= 30 else None)

print("=== input 0 x8, 3 reads addr2 ===")
for i in range(3):
    data, r = parse(read(port, 2, 0x04, 0, 8))
    if data is None:
        print(i, "FAIL", r.hex(" ") if r else "no")
        continue
    u16 = [struct.unpack(">H", data[i : i + 2])[0] for i in range(0, len(data) - 1, 2)]
    print(i, data.hex(" "), "u16", u16)
    for off in range(0, 12, 2):
        print("  off", off, "reg", off // 2, fmt_fp(all_fp(data[off : off + 4])))

print("=== targeted 2-reg reads addr2 ===")
for start in (1, 2, 3, 4):
    data, r = parse(read(port, 2, 0x04, start, 2))
    print("start", start, data.hex(" ") if data is not None else (r.hex(" ") if r else "no"))
    if data is not None:
        print(" ", fmt_fp(all_fp(data)))

port.close()
print("done")
