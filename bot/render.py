"""Картинки для постов: коллаж из фото товаров и карточка «История моды»."""
import io
import os
import urllib.request

from PIL import Image, ImageDraw, ImageFont, ImageOps

W, H = 1080, 1350
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130 Safari/537.36"}
FONT_DIR = os.path.join(os.path.dirname(__file__), "fonts")
FALLBACK_SERIF = "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf"


def font(name, size, weight=None):
    path = os.path.join(FONT_DIR, name)
    if not os.path.exists(path):
        path = FALLBACK_SERIF
    f = ImageFont.truetype(path, size)
    if weight:
        try:
            f.set_variation_by_axes([weight])
        except Exception:
            pass
    return f


def load(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=40) as r:
        im = Image.open(io.BytesIO(r.read()))
        im.load()
    return im.convert("RGB")


def cover(canvas, im, box, fy=0.5):
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    s = max(w / im.width, h / im.height)
    im = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
    left = (im.width - w) // 2
    top = int((im.height - h) * fy)
    canvas.paste(im.crop((left, top, left + w, top + h)), (x0, y0))


def collage(urls, bg=(255, 255, 255)):
    """1–4 фото товаров в одну картинку 1080×1350. Каталожные фото обычно в рост — режем по центру, чуть выше."""
    ims = [load(u) for u in urls[:4]]
    c = Image.new("RGB", (W, H), bg)
    g = 6
    n = len(ims)
    if n == 1:
        boxes = [(0, 0, W, H)]
    elif n == 2:
        boxes = [(0, 0, W // 2 - g // 2, H), (W // 2 + g // 2, 0, W, H)]
    elif n == 3:
        boxes = [(0, 0, W // 2 - g // 2, H),
                 (W // 2 + g // 2, 0, W, H // 2 - g // 2),
                 (W // 2 + g // 2, H // 2 + g // 2, W, H)]
    else:
        boxes = [(0, 0, W // 2 - g // 2, H // 2 - g // 2), (W // 2 + g // 2, 0, W, H // 2 - g // 2),
                 (0, H // 2 + g // 2, W // 2 - g // 2, H), (W // 2 + g // 2, H // 2 + g // 2, W, H)]
    for im, box in zip(ims, boxes):
        cover(c, im, box, fy=0.3)
    return c


def history_card(card):
    """card: kicker, year, note, title, images:[{url, grayscale, fy}], credits"""
    bg, cream, sand, mute = (20, 17, 15), (243, 236, 226), (201, 183, 156), (125, 115, 104)
    c = Image.new("RGB", (W, H), bg)
    ph, g = 880, 10
    imgs = card.get("images", [])[:2]
    boxes = [(0, 0, W, ph)] if len(imgs) == 1 else [(0, 0, W // 2 - g // 2, ph), (W // 2 + g // 2, 0, W, ph)]
    for spec, box in zip(imgs, boxes):
        im = load(spec["url"])
        if spec.get("grayscale"):
            im = ImageOps.grayscale(im).convert("RGB")
        cover(c, im, box, fy=spec.get("fy", 0.3))
    # плавный переход фото в фон
    grad = Image.new("L", (1, 220))
    for y in range(220):
        grad.putpixel((0, y), int(255 * y / 219))
    shade = Image.new("RGB", (W, 220), bg)
    c.paste(shade, (0, ph - 220), grad.resize((W, 220)))
    d = ImageDraw.Draw(c)
    kicker = " ".join(card.get("kicker", "ИСТОРИЯ МОДЫ"))
    d.text((64, ph + 22), kicker, font=font("Playfair.ttf", 28, 500), fill=sand)
    yf = font("Playfair-Italic.ttf", 150, 700)
    year = str(card.get("year", ""))
    d.text((56, ph + 58), year, font=yf, fill=cream)
    if card.get("note"):
        yw = d.textlength(year, font=yf)
        d.text((56 + yw + 34, ph + 150), card["note"], font=font("Playfair-Italic.ttf", 34, 400), fill=sand)
    d.text((64, ph + 252), card.get("title", ""), font=font("Playfair.ttf", 50, 600), fill=cream)
    if card.get("credits"):
        cf = font("Manrope.ttf", 18, 400)
        text = card["credits"]
        while d.textlength(text, font=cf) > W - 128 and len(text) > 10:
            text = text[:-2]
        d.text((64, H - 44), text, font=cf, fill=mute)
    return c


def to_jpeg(im):
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=88, optimize=True)
    return buf.getvalue()
