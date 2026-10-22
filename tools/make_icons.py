"""Draws the alphamac app icon (a mint α on the dark background) as PNGs.

Plain python, no Pillow needed: each pixel's colour comes from how far it is
from the strokes of the α (a "signed distance" drawing), and the PNG file is
written by hand with zlib.

    python tools/make_icons.py
"""

import math
import struct
import zlib
from pathlib import Path

BG = (0x0F, 0x11, 0x15)    # --bg in style.css
INK = (0x8F, 0xE3, 0xA8)   # --accent in style.css
OUT = Path(__file__).parent.parent / "docs" / "icons"
SIZES = [180, 192, 512]    # 180 = iphone home screen, 192/512 = web manifest

# the α, in 0–1 coordinates (0,0 = top left)
RING_CENTRE = (0.43, 0.52)
RING_RADIUS = 0.17
STROKE = 0.075
TAILS = [((0.585, 0.445), (0.74, 0.30)),   # top-right flick
         ((0.585, 0.595), (0.76, 0.74))]   # bottom-right flick


def dist_to_segment(p, a, b):
    (px, py), (ax, ay), (bx, by) = p, a, b
    dx, dy = bx - ax, by - ay
    t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def ink_amount(x, y, size):
    """0 = background, 1 = fully on the α, in between = soft edge."""
    ring = abs(math.hypot(x - RING_CENTRE[0], y - RING_CENTRE[1]) - RING_RADIUS)
    d = min([ring] + [dist_to_segment((x, y), a, b) for a, b in TAILS])
    edge = (STROKE / 2 - d) * size   # distance from the stroke edge, in pixels
    return max(0.0, min(1.0, edge + 0.5))


def png(size):
    rows = []
    for py in range(size):
        row = bytearray([0])  # filter byte: 0 = none
        for px in range(size):
            t = ink_amount((px + 0.5) / size, (py + 0.5) / size, size)
            row += bytes(round(bg + (ink - bg) * t) for bg, ink in zip(BG, INK))
        rows.append(bytes(row))

    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    header = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)  # 8-bit rgb
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header)
            + chunk(b"IDAT", zlib.compress(b"".join(rows), 9)) + chunk(b"IEND", b""))


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        path = OUT / f"icon-{size}.png"
        path.write_bytes(png(size))
        print(f"wrote {path.name}")
