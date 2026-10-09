"""
Arrowsterr logo set: builds every SVG from exact geometry, with the wordmark turned into outlines.

    python3 brand/logo/build_logo.py          # writes brand/logo/set/svg/*.svg
    node brand/logo/render_png.mjs            # writes the PNGs, favicon and OG image

The mark ("Peak"): an A with a rounded peak and flat, softly rounded feet, a smaller rank chevron
nested inside it parallel to the legs, and an AI spark above. The gap around the inner chevron
equals the gap below the spark.
"""
import math
import os

import uharfbuzz as hb
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "set", "svg")
FONT = "/usr/share/fonts/opentype/inter/Inter-SemiBold.otf"

BLUE = "#0943B0"
TINT = "#4F7FE0"
INK = "#171717"
WHITE = "#FFFFFF"

# ─────────────── mark geometry (64 × 64 design grid) ───────────────
AO, BASE, HW = 28.0, 60.0, 22.0   # outer apex y, base y of the centre line, half width at the base
W, GAP = 6.5, 4.5                  # stroke width, clear space
CUT = 62.5                         # the flat base
FILLET = 1.6                       # how far the soft corner reaches along each edge


def norm(x, y):
    l = math.hypot(x, y)
    return x / l, y / l


def chevron(apex_y, foot_half):
    """Outline of a chevron stroke: round peak, flat feet cut at CUT with soft corners."""
    ax, ay = 32.0, apex_y
    slope = (BASE - apex_y) / foot_half  # dy per dx along a leg
    h = W / 2
    out = []
    pts = {}
    for side in (-1, 1):
        dx, dy = norm(side, slope)                      # down the leg
        nx, ny = (-dy, dx) if side < 0 else (dy, -dx)   # outward normal (away from the centre line)
        o = (ax + nx * h, ay + ny * h)                   # outer edge start (tangent to the peak)
        i = (ax - nx * h, ay - ny * h)                   # inner edge start
        to_cut = lambda p: (p[0] + dx * (CUT - p[1]) / dy, CUT)
        pts[side] = dict(d=(dx, dy), tan=o, inner=i, foot_o=to_cut(o), foot_i=to_cut(i))
    # inner edges meet on the centre line below the peak
    li = pts[-1]["inner"]
    dx, dy = pts[-1]["d"]
    t = (32.0 - li[0]) / dx
    meet = (32.0, li[1] + dy * t)

    def back(p, d, e):  # move from a foot corner back up its edge
        return (p[0] - d[0] * e, p[1] - d[1] * e)

    L, R = pts[-1], pts[1]
    e = FILLET
    f = lambda p: f"{p[0]:.3f} {p[1]:.3f}"
    p = []
    p.append(f"M{f(back(L['foot_o'], L['d'], e))}")
    p.append(f"L{f(L['tan'])}")
    p.append(f"A{h:.3f} {h:.3f} 0 0 1 {f(R['tan'])}")
    p.append(f"L{f(back(R['foot_o'], R['d'], e))}")
    p.append(f"Q{f(R['foot_o'])} {f((R['foot_o'][0] - e, CUT))}")
    p.append(f"L{f((R['foot_i'][0] + e, CUT))}")
    p.append(f"Q{f(R['foot_i'])} {f(back(R['foot_i'], R['d'], e))}")
    p.append(f"L{f(meet)}")
    p.append(f"L{f(back(L['foot_i'], L['d'], e))}")
    p.append(f"Q{f(L['foot_i'])} {f((L['foot_i'][0] - e, CUT))}")
    p.append(f"L{f((L['foot_o'][0] + e, CUT))}")
    p.append(f"Q{f(L['foot_o'])} {f(back(L['foot_o'], L['d'], e))}")
    p.append("Z")
    xs = [L["foot_o"][0], R["foot_o"][0]]
    return " ".join(p), min(xs), max(xs)


slope = (BASE - AO) / HW
cos_a = math.cos(math.atan(slope))
AI = AO + (W + GAP) / cos_a          # inner apex: parallel legs, GAP of clear space between strokes
HI = (BASE - AI) / slope
OUTER, X0, X1 = chevron(AO, HW)
INNER, _, _ = chevron(AI, HI)

SB = AO - W / 2 - GAP                # spark bottom: GAP above the peak
TOP = 3.0
RY = (SB - TOP) / 2
CY = SB - RY
RX = RY * 0.85


def spark(cx, cy, ry, rx, k=0.24):
    kx, ky = k * rx, k * ry
    return (f"M{cx} {cy - ry:.3f} C{cx + kx:.3f} {cy - ky:.3f} {cx + kx:.3f} {cy - ky:.3f} {cx + rx:.3f} {cy:.3f} "
            f"C{cx + kx:.3f} {cy + ky:.3f} {cx + kx:.3f} {cy + ky:.3f} {cx} {cy + ry:.3f} "
            f"C{cx - kx:.3f} {cy + ky:.3f} {cx - kx:.3f} {cy + ky:.3f} {cx - rx:.3f} {cy:.3f} "
            f"C{cx - kx:.3f} {cy - ky:.3f} {cx - kx:.3f} {cy - ky:.3f} {cx} {cy - ry:.3f} Z")


SPARK = spark(32, CY, RY, RX)
MARK_BOX = (X0, TOP, X1 - X0, CUT - TOP)  # x, y, w, h of the mark


def mark_group(outer, inner, sparkc, inner_opacity=1.0):
    op = f' fill-opacity="{inner_opacity}"' if inner_opacity < 1 else ""
    return (f'<path d="{OUTER}" fill="{outer}"/>'
            f'<path d="{INNER}" fill="{inner}"{op}/>'
            f'<path d="{SPARK}" fill="{sparkc}"/>')


SCHEMES = {
    "color": dict(outer=BLUE, inner=TINT, spark=BLUE, text=INK, op=1.0),
    "blue": dict(outer=BLUE, inner=BLUE, spark=BLUE, text=BLUE, op=1.0),
    "black": dict(outer=INK, inner=INK, spark=INK, text=INK, op=1.0),
    "white": dict(outer=WHITE, inner=WHITE, spark=WHITE, text=WHITE, op=0.6),
}

# ─────────────── wordmark as outlines ───────────────
font = TTFont(FONT)
UPEM = font["head"].unitsPerEm
CAP = font["OS/2"].sCapHeight / UPEM
glyphs = font.getGlyphSet()
blob = hb.Blob.from_file_path(FONT)
face = hb.Face(blob)
hbfont = hb.Font(face)


def word_path(text, size, x0, baseline, tracking=-0.04):
    """SVG path of text set at `size`, starting at x0 on `baseline`. Returns (d, width)."""
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(hbfont, buf, {"kern": True, "liga": True})
    s = size / UPEM
    x = 0.0
    parts = []
    names = font.getGlyphOrder()
    n = len(buf.glyph_infos)
    for k, (info, pos) in enumerate(zip(buf.glyph_infos, buf.glyph_positions)):
        name = names[info.codepoint]
        pen = SVGPathPen(glyphs)
        tp = TransformPen(pen, (s, 0, 0, -s, x0 + (x + pos.x_offset) * s, baseline - pos.y_offset * s))
        glyphs[name].draw(tp)
        parts.append(pen.getCommands())
        x += pos.x_advance + (tracking * UPEM if k < n - 1 else 0)
    return " ".join(parts), x * s


def svg(w, h, body, bg=None):
    rect = f'<rect width="{w:.2f}" height="{h:.2f}" fill="{bg}"/>' if bg else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.2f} {h:.2f}" width="{w:.2f}" height="{h:.2f}">'
            f'{rect}{body}</svg>\n')


def place_mark(scheme, x, y, height):
    """The mark scaled to `height`, top-left at (x, y)."""
    bx, by, bw, bh = MARK_BOX
    k = height / bh
    s = SCHEMES[scheme]
    return (f'<g transform="translate({x:.3f} {y:.3f}) scale({k:.5f}) translate({-bx:.3f} {-by:.3f})">'
            f'{mark_group(s["outer"], s["inner"], s["spark"], s["op"])}</g>'), bw * k


def write(name, content):
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, name), "w") as fh:
        fh.write(content)


# Sizes are in px for a 100px wordmark, so the SVGs open at a sensible size. They scale freely.
F = 100.0
CAPH = CAP * F
PAD = 0.0


def build():
    bx, by, bw, bh = MARK_BOX
    for name, s in SCHEMES.items():
        # Mark alone
        mh = 256.0
        m, mw = place_mark(name, 0, 0, mh)
        write(f"arrowsterr-mark-{name}.svg", svg(mw, mh, m))

        # Wordmark alone
        d, ww = word_path("Arrowsterr", F, 0, CAPH)
        write(f"arrowsterr-wordmark-{name}.svg", svg(ww, CAPH, f'<path d="{d}" fill="{s["text"]}"/>'))

        # Horizontal lockup: the flat base of the A sits on the text baseline,
        # the body of the A matches the cap height, and the spark rises above it.
        body = (CUT - (AO - W / 2)) / bh          # share of the mark height taken by the A body
        mh = CAPH / body
        top = mh - CAPH                            # how far the spark rises above the caps
        gap = 0.3 * F
        m, mw = place_mark(name, 0, 0, mh)
        d, ww = word_path("Arrowsterr", F, mw + gap, mh)
        write(f"arrowsterr-logo-{name}.svg", svg(mw + gap + ww, mh, m + f'<path d="{d}" fill="{s["text"]}"/>'))

        # Stacked lockup: mark centred over the wordmark
        smh = CAPH * 2.4
        sgap = 0.42 * F
        d, ww = word_path("Arrowsterr", F, 0, smh + sgap + CAPH)
        m, mw = place_mark(name, (ww - smh * bw / bh) / 2, 0, smh)
        write(f"arrowsterr-logo-stacked-{name}.svg", svg(ww, smh + sgap + CAPH, m + f'<path d="{d}" fill="{s["text"]}"/>'))

    # App icon: white mark on a blue rounded square
    side = 1024.0
    r = side * 0.225
    mh = side * 0.6
    mw = mh * bw / bh
    m, _ = place_mark("white", (side - mw) / 2, (side - mh) / 2, mh)
    write("arrowsterr-icon.svg", svg(side, side, f'<rect width="{side}" height="{side}" rx="{r}" fill="{BLUE}"/>' + m))
    # Square icon for favicons and avatars (circle crops keep the mark clear)
    write("arrowsterr-icon-square.svg", svg(side, side, f'<rect width="{side}" height="{side}" fill="{BLUE}"/>' + m))
    # Favicon: a bigger mark so it reads at 16 and 32 px
    fh = side * 0.8
    fw = fh * bw / bh
    k = fh / bh
    fav = (f'<g transform="translate({(side - fw) / 2:.3f} {(side - fh) / 2 + side * 0.01:.3f}) scale({k:.5f}) translate({-bx:.3f} {-by:.3f})">'
           f'{mark_group(WHITE, WHITE, WHITE, 0.7)}</g>')
    write("arrowsterr-favicon.svg", svg(side, side, f'<rect width="{side}" height="{side}" rx="{side * 0.18}" fill="{BLUE}"/>' + fav))


if __name__ == "__main__":
    build()
    print("mark box", [round(v, 2) for v in MARK_BOX], "inner apex", round(AI, 2), "spark", round(CY, 2), round(RY, 2))
    print("wrote", sorted(os.listdir(OUT)))
