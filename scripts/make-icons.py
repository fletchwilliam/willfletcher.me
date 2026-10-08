# Regenerates the site icons in media/site/ (uploaded to R2, served at /favicon.ico, /apple-touch-icon.png, ...).
from PIL import Image, ImageDraw, ImageFont
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
BG, FG, TEXT = "#111111", "#ffffff", "WF"

def render(n, scale=8, pad=0.0):
    S = n * scale
    img = Image.new("RGB", (S, S), BG)
    d = ImageDraw.Draw(img)
    f = ImageFont.truetype(FONT, int(S * 0.49))
    b = d.textbbox((0, 0), TEXT, font=f)
    w, h = b[2] - b[0], b[3] - b[1]
    d.text(((S - w) / 2 - b[0], (S - h) / 2 - b[1]), TEXT, font=f, fill=FG)
    return img.resize((n, n), Image.LANCZOS)

render(180).save("media/site/apple-touch-icon.png", optimize=True)
render(32).save("media/site/favicon-32x32.png", optimize=True)
render(16).save("media/site/favicon-16x16.png", optimize=True)
big = render(256)
big.save("media/site/favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])

# SVG: glyph outlines as paths, so it doesn't depend on installed fonts.
font = TTFont(FONT)
gs, cmap = font.getGlyphSet(), font.getBestCmap()
upm = font["head"].unitsPerEm
x, parts, bp = 0, [], BoundsPen(gs)
for ch in TEXT:
    g = cmap[ord(ch)]
    pen = SVGPathPen(gs)
    gs[g].draw(pen)
    parts.append((x, pen.getCommands()))
    from fontTools.pens.transformPen import TransformPen
    gs[g].draw(TransformPen(bp, (1, 0, 0, 1, x, 0)))
    x += gs[g].width
xmin, ymin, xmax, ymax = bp.bounds
w, h = xmax - xmin, ymax - ymin
V = 100
s = (V * 0.66) / max(w, h * 1.0)  # text width ~66% of the square
tx = (V - w * s) / 2 - xmin * s
ty = (V + h * s) / 2 + ymin * s  # flip y: font units are y-up
paths = "".join(f'<path transform="translate({dx * s + tx:.3f} {ty:.3f}) scale({s:.5f} {-s:.5f})" d="{d}"/>' for dx, d in parts)
svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {V} {V}"><rect width="{V}" height="{V}" fill="{BG}"/><g fill="{FG}">{paths}</g></svg>\n'
open("media/site/icon.svg", "w").write(svg)
print("icons written")
