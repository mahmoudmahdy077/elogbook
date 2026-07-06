#!/usr/bin/env python3
"""Generate a minimal 1x1 PNG as placeholder for og-image."""
import struct, zlib, sys

def make_png(width, height, r, g, b):
    def chunk(tag, data):
        crc = struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
        return struct.pack('>I', len(data)) + tag + data + crc

    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))

    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filter byte
        for x in range(width):
            raw.extend([r, g, b])

    idat = chunk(b'IDAT', zlib.compress(bytes(raw)))
    iend = chunk(b'IEND', b'')
    return sig + ihdr + idat + iend

data = make_png(1, 1, 0, 122, 255)
sys.stdout.buffer.write(data)
