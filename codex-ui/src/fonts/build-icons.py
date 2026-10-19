"""Builds public/fonts/codex-icons.woff2, the face server/claude-fonts.mjs serves as
Anthropicons-Variable when Claude Desktop is missing: Phosphor Icons (MIT) outlines at the
Anthropicons codepoints of ui.tsx, one per name in icons.json ("@<deg>" turns it clockwise,
"@flip" mirrors it; a -fill name is from Phosphor's fill set). Like Anthropicons it has a wght axis, 400-700, so
ui.tsx's per-size weights keep their stroke: the 700 master is the 400 one emboldened.

    npm pack @phosphor-icons/core@2.1.1 && tar xf phosphor-icons-core-2.1.1.tgz
    python build-icons.py package

Needs fontTools and brotli.
"""

import json
import math
import re
import sys
from pathlib import Path
from xml.etree import ElementTree as ET

from fontTools.fontBuilder import FontBuilder
from fontTools.misc.timeTools import timestampFromString
from fontTools.misc.transform import Transform
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.svgLib.path import parse_path
from fontTools.ttLib.tables.TupleVariation import TupleVariation

HERE = Path(__file__).resolve().parent
OUT = HERE.parent.parent / "public" / "fonts" / "codex-icons.woff2"

# Anthropicons (1000 upem) centres each glyph's box on (500, 500) of a 1000 x 1000 em and draws
# 0.93x Phosphor's 256 grid (the median over the 139 names both sets share). Its stroke runs
# from 56 units at wght 400 to 90 at 700; Phosphor's 16/256 em is 58 at that scale, so the 700
# master moves each edge out by 16.
SCALE = 0.93 * 1000 / 256
BOLD = 16


def outline(phosphor, source):
    """The Phosphor icon `source` as a TrueType glyph in Anthropicons' em."""
    stem, _, how = source.partition("@")
    weight = "fill" if stem.endswith("-fill") else "regular"
    svg = RecordingPen()
    for path in ET.parse(phosphor / "assets" / weight / f"{stem}.svg").getroot().iter("{http://www.w3.org/2000/svg}path"):
        parse_path(path.get("d"), svg)
    # SVG is y-down, so a positive turn is clockwise on screen: turn or mirror, then scale and flip.
    turn = Transform(-1, 0, 0, 1, 0, 0) if how == "flip" else Transform().rotate(math.radians(float(how or 0)))
    place = Transform(SCALE, 0, 0, -SCALE, 0, 0).transform(turn)
    bounds = BoundsPen(None)
    svg.replay(TransformPen(bounds, place))
    x0, y0, x1, y1 = bounds.bounds
    centre = (1, 0, 0, 1, 500 - (x0 + x1) / 2, 500 - (y0 + y1) / 2)
    pen = TTGlyphPen(None)
    svg.replay(TransformPen(TransformPen(Cu2QuPen(pen, max_err=1), centre), place))
    return pen.glyph()


def inside(point, polygon):
    x, y = point
    hits = 0
    for (x0, y0), (x1, y1) in zip(polygon, polygon[1:] + polygon[:1]):
        if (y0 > y) != (y1 > y) and x < x0 + (y - y0) * (x1 - x0) / (y1 - y0):
            hits += 1
    return hits % 2 == 1


def area(polygon):
    """Twice the signed area: positive when counter-clockwise."""
    return sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(polygon, polygon[1:] + polygon[:1]))


def embolden(points, ends, strength):
    """FreeType's FT_Outline_EmboldenXY, minus its drift up and right: each point moves along the
    bisector of its edges' normals so both edges sit `strength` further out; holes shrink.
    Phosphor winds its separate shapes either way, so each contour's side comes from its nesting
    (a contour inside an odd number of others is a hole), not from the glyph's orientation."""
    contours, start = [], 0
    for end in ends:
        contours.append(points[start : end + 1])
        start = end + 1
    moved = []
    for c in contours:
        hole = sum(inside(c[0], other) for other in contours if other is not c) % 2 == 1
        # +1 moves a counter-clockwise contour out: the outward normal of an edge (x, y) is (y, -x).
        sign = (1 if area(c) > 0 else -1) * (-1 if hole else 1)
        n = len(c)
        out = []
        for i, p in enumerate(c):
            prev = next((c[(i - j) % n] for j in range(1, n) if c[(i - j) % n] != p), p)
            after = next((c[(i + j) % n] for j in range(1, n) if c[(i + j) % n] != p), p)
            li, lo = math.dist(prev, p), math.dist(p, after)
            if not li or not lo:
                out.append(p)
                continue
            ix, iy = (p[0] - prev[0]) / li, (p[1] - prev[1]) / li
            ox, oy = (after[0] - p[0]) / lo, (after[1] - p[1]) / lo
            d = ix * ox + iy * oy
            if d <= -0.9375:  # turns sharper than ~160 degrees stay put
                out.append(p)
                continue
            d += 1
            q = sign * (ox * iy - oy * ix)
            k = strength / d if strength * q <= min(li, lo) * d else min(li, lo) / q
            out.append((p[0] + sign * (iy + oy) * k, p[1] - sign * (ix + ox) * k))
        assert (abs(area(out)) < abs(area(c))) == hole, "a shape thinned or a hole grew"
        moved += out
    return [(round(x), round(y)) for x, y in moved]


def main(phosphor):
    ui = (HERE.parent / "components" / "ui.tsx").read_text(encoding="utf-8")
    codepoints = {name: int(cp, 16) for name, cp in re.findall(r"(\w+): (0x[0-9a-f]+)", ui)}
    icons = json.loads((HERE / "icons.json").read_text(encoding="utf-8"))
    glyphs = {".notdef": TTGlyphPen(None).glyph(), **{name: outline(phosphor, source) for name, source in icons.items()}}
    variations = {}
    for name, glyph in glyphs.items():
        if glyph.numberOfContours > 0:
            points = list(glyph.coordinates)
            bold = embolden(points, glyph.endPtsOfContours, BOLD)
            deltas = [(bx - x, by - y) for (x, y), (bx, by) in zip(points, bold)] + [(0, 0)] * 4
            variations[name] = [TupleVariation({"wght": (0, 1, 1)}, deltas)]

    fb = FontBuilder(1000, isTTF=True)
    fb.setupGlyphOrder(list(glyphs))
    fb.setupCharacterMap({codepoints[name]: name for name in icons})
    fb.setupGlyf(glyphs)
    glyf = fb.font["glyf"]
    fb.setupHorizontalMetrics({name: (1000, getattr(glyf[name], "xMin", 0)) for name in glyphs})
    fb.setupHorizontalHeader(ascent=1000, descent=0)
    fb.setupOS2(sTypoAscender=1000, sTypoDescender=0, sTypoLineGap=0, usWinAscent=1000, usWinDescent=0, fsType=0)
    fb.setupNameTable(
        {
            "familyName": "Codex Icons",
            "styleName": "Regular",
            "copyright": "Copyright (c) 2023 Phosphor Icons",
            "description": "Phosphor Icons at the Anthropicons codepoints codex-ui draws.",
            "licenseDescription": "MIT License",
            "licenseInfoURL": "https://github.com/phosphor-icons/core/blob/main/LICENSE",
        }
    )
    fb.setupPost()
    fb.setupFvar([("wght", 400, 400, 700, "Weight")], [])
    fb.setupGvar(variations)
    # A fixed date, so building again from the same icons gives the same bytes.
    fb.updateHead(created=timestampFromString("Sun Jan  1 00:00:00 2023"), modified=timestampFromString("Sun Jan  1 00:00:00 2023"))
    fb.font.recalcTimestamp = False
    fb.font.flavor = "woff2"
    fb.save(OUT)
    print(f"{OUT.name}: {len(icons)} icons, {OUT.stat().st_size} bytes")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
