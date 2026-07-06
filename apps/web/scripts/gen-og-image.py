#!/usr/bin/env python3
"""Generate a minimal og-image.png placeholder (1200x630 solid blue)."""
import struct, zlib

def create_png(width, height, r, g, b):
    def chunk(chunk_type, data):
        c = chunk_type + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))

    raw = b''
    for y in range(height):
        raw += b'\x00'  # filter byte
        for x in range(width):
            raw += struct.pack('BBB', r, g, b)

    idat = chunk(b'IDAT', zlib.compress(raw))
    iend = chunk(b'IEND', b'')
    return sig + ihdr + idat + iend

png_data = create_png(1200, 630, 0, 122, 255)
with open('/root/elogbook/apps/web/public/og-image.png', 'wb') as f:
    f.write(png_data)
print(f'Created og-image.png: {len(png_data)} bytes')
