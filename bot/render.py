"""Картинки для постов: коллаж из фото товаров и карточка «История моды»."""
import html
import io
import json
import os
import re
import urllib.parse
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


FREE = re.compile(r"^(public domain|cc0( 1\.0)?|cc[ -]by(-sa)?([ -]\d\.\d)?)(\s|$)", re.I)


def commons(name, width=1280):
    """Фото с Wikimedia Commons по названию файла: ссылка, автор и лицензия прямо из API.
    Возвращает {"url", "credit"} или бросает ValueError, если лицензия не свободная."""
    name = name.strip()
    if name.lower().startswith(("file:", "файл:")):
        name = name.split(":", 1)[1]
    q = urllib.parse.urlencode({"action": "query", "format": "json", "prop": "imageinfo",
                                "titles": "File:" + name, "iiprop": "url|extmetadata",
                                "iiurlwidth": width})
    req = urllib.request.Request("https://commons.wikimedia.org/w/api.php?" + q,
                                 headers={"User-Agent": "StamboBot/1.0 (github.com/Grach31/irina-mods)"})
    with urllib.request.urlopen(req, timeout=40) as r:
        page = next(iter(json.load(r)["query"]["pages"].values()))
    if "imageinfo" not in page:
        raise ValueError(f"нет такого файла на Commons: {name}")
    ii = page["imageinfo"][0]
    meta = {k: v.get("value", "") for k, v in ii.get("extmetadata", {}).items()}
    lic = meta.get("LicenseShortName", "").strip()
    if not FREE.match(lic):
        raise ValueError(f"лицензия не подходит: {name} — {lic or 'не указана'}")
    artist = html.unescape(re.sub(r"<[^>]+>", "", meta.get("Artist", ""))).strip()
    artist = re.sub(r"(?i)no machine-readable author provided\.?|assumed \(based on copyright claims\)\.?"
                    r"|~\w*wiki", "", artist)
    artist = re.sub(r"\s+", " ", artist).strip(" .,") [:60].strip() or "автор неизвестен"
    credit = lic if lic.lower().startswith("public domain") and artist == "автор неизвестен" \
        else f"{artist}, {lic}"
    return {"url": ii.get("thumburl") or ii["url"], "credit": credit}


API_UA = {"User-Agent": "StamboBot/1.0 (github.com/Grach31/irina-mods)"}


def get_json(url):
    req = urllib.request.Request(url, headers=API_UA)
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.load(r)


def met(object_id):
    """The Met Open Access: фото вещи по номеру объекта (metmuseum.org/art/collection/search/<id>). Только CC0."""
    o = get_json(f"https://collectionapi.metmuseum.org/public/collection/v1/objects/{int(object_id)}")
    if not o.get("isPublicDomain"):
        raise ValueError(f"The Met {object_id}: фото не в открытом доступе")
    url = o.get("primaryImage") or o.get("primaryImageSmall")
    if not url:
        raise ValueError(f"The Met {object_id}: у объекта нет фото")
    return {"url": url, "credit": "The Met, CC0"}


def cleveland(object_id):
    """Cleveland Museum of Art Open Access по id или accession number. Только CC0."""
    d = get_json(f"https://openaccess-api.clevelandart.org/api/artworks/{urllib.parse.quote(str(object_id))}")["data"]
    if (d.get("share_license_status") or "").upper() != "CC0":
        raise ValueError(f"Cleveland {object_id}: лицензия {d.get('share_license_status')}")
    url = ((d.get("images") or {}).get("web") or {}).get("url")
    if not url:
        raise ValueError(f"Cleveland {object_id}: у объекта нет фото")
    return {"url": url, "credit": "Cleveland Museum of Art, CC0"}


OPENVERSE_FREE = {"cc0": "CC0", "pdm": "Public domain", "by": "CC BY", "by-sa": "CC BY-SA"}


def openverse(image_id):
    """Openverse (свободные фото Smithsonian, Rijksmuseum, Europeana, Flickr и др.) по id картинки."""
    o = get_json(f"https://api.openverse.org/v1/images/{urllib.parse.quote(str(image_id))}/")
    lic = OPENVERSE_FREE.get((o.get("license") or "").lower())
    if not lic:
        raise ValueError(f"Openverse {image_id}: лицензия не подходит — {o.get('license')}")
    if lic.startswith("CC BY") and o.get("license_version"):
        lic += f" {o['license_version']}"
    who = (o.get("creator") or "").strip()[:60] or (o.get("source") or "").strip()
    return {"url": o["url"], "credit": f"{who}, {lic}" if who else lic}


SOURCES = {"commons": commons, "met": met, "cleveland": cleveland, "openverse": openverse}


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
    """card: kicker, year, note, title, images:[{url | commons | met | cleveland | openverse, grayscale, fy}]
    (1–4 фото), credits. Для фото из свободных источников подпись (автор, лицензия) собирается из API
    и добавляется к credits; для "url" подпись пишется вручную в credits (например «Фото: Dior»)."""
    bg, cream, sand, mute = (20, 17, 15), (243, 236, 226), (201, 183, 156), (125, 115, 104)
    c = Image.new("RGB", (W, H), bg)
    ph, g = 880, 10
    imgs = card.get("images", [])[:4]
    L, R, T, B = (0, W // 2 - g // 2), (W // 2 + g // 2, W), (0, ph // 2 - g // 2), (ph // 2 + g // 2, ph)
    boxes = {1: [(0, 0, W, ph)],
             2: [(L[0], 0, L[1], ph), (R[0], 0, R[1], ph)],
             3: [(L[0], 0, L[1], ph), (R[0], T[0], R[1], T[1]), (R[0], B[0], R[1], B[1])],
             4: [(L[0], T[0], L[1], T[1]), (R[0], T[0], R[1], T[1]),
                 (L[0], B[0], L[1], B[1]), (R[0], B[0], R[1], B[1])]}.get(len(imgs), [])
    credits = []
    for spec, box in zip(imgs, boxes):
        src = next((k for k in SOURCES if spec.get(k)), None)
        if src:
            info = SOURCES[src](spec[src])
            spec = {**spec, "url": info["url"]}
            credits.append(info["credit"])
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
    if credits:
        credits = ["Фото: " + " · ".join(credits)]
    credits = [t for t in [card.get("credits", "")] + credits if t]
    if credits:
        cf = font("Manrope.ttf", 18, 400)
        # подпись в 1–2 строки (при 3–4 фото она длинная), лишнее обрезаем
        lines, cur = [], ""
        for part in " · ".join(credits).split(" "):
            t = (cur + " " + part).strip()
            if d.textlength(t, font=cf) <= W - 128 or not cur:
                cur = t
            else:
                lines.append(cur)
                cur = part
        lines.append(cur)
        if len(lines) > 2:
            lines = lines[:2]
            lines[1] += "…"
        for i, text in enumerate(lines):
            while d.textlength(text, font=cf) > W - 128 and len(text) > 10:
                text = text[:-2] + "…"
            d.text((64, H - 44 - 26 * (len(lines) - 1 - i)), text, font=cf, fill=mute)
    return c


def to_jpeg(im):
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=88, optimize=True)
    return buf.getvalue()


# ---------- Карусель образов (флэтлей из каталожных фото) ----------

BEIGE, INK, SOFT = (239, 230, 218), (58, 40, 30), (140, 117, 98)


def _img(src):
    return src if isinstance(src, Image.Image) else load(src)


def studio(im, tol=14):
    """Каталожное фото на однотонном светлом фоне → фон доводится до белого и вещь обрезается по краям.
    Потом такое фото кладётся на бежевый фон умножением: фон исчезает, мягкая студийная тень остаётся.
    Если фон не однотонный (модель в интерьере) — None."""
    w, h = im.size
    px = im.load()
    step = max(1, min(w, h) // 120)
    border = [px[x, y] for x in range(0, w, step) for y in (2, h - 3)] + \
             [px[x, y] for y in range(0, h, step) for x in (2, w - 3)]
    bg = tuple(sorted(c[i] for c in border)[len(border) // 2] for i in range(3))
    near = sum(1 for c in border if max(abs(c[i] - bg[i]) for i in range(3)) <= tol)
    if near < 0.6 * len(border) or min(bg) < 205:
        return None
    norm = Image.merge("RGB", [band.point(lambda v, b=b: min(255, round(v * 255 / max(b, 1))))
                               for band, b in zip(im.split(), bg)])
    # обрезка по содержимому: всё заметно темнее белого
    dark = ImageOps.invert(norm.convert("L")).point(lambda v: 255 if v > tol * 2 else 0)
    box = dark.getbbox()
    if not box:
        return None
    pad = int(0.03 * max(w, h))
    box = (max(0, box[0] - pad), max(0, box[1] - pad), min(w, box[2] + pad), min(h, box[3] + pad))
    return norm.crop(box)


def _place(c, item, box):
    """Вещь в рамку box: студийное фото — умножением на фон, иначе фото со скруглёнными углами и тенью."""
    from PIL import ImageChops, ImageFilter
    x0, y0, x1, y1 = box
    bw, bh = x1 - x0, y1 - y0
    st = item.get("_studio")
    src = st if st is not None else item["_img"]
    s = min(bw / src.width, bh / src.height)
    im = src.resize((max(1, int(src.width * s)), max(1, int(src.height * s))), Image.LANCZOS)
    x, y = x0 + (bw - im.width) // 2, y0 + (bh - im.height) // 2
    if st is not None:
        region = c.crop((x, y, x + im.width, y + im.height)).convert("RGB")
        c.paste(ImageChops.multiply(region, im), (x, y))
        return
    m = Image.new("L", im.size, 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, im.width - 1, im.height - 1), 18, fill=255)
    sh = Image.new("RGBA", (im.width + 60, im.height + 60), (60, 40, 25, 0))
    sm = Image.new("L", sh.size, 0)
    sm.paste(m.point(lambda v: v * 0.3), (30, 30))
    sh.putalpha(sm.filter(ImageFilter.GaussianBlur(14)))
    c.alpha_composite(sh, (x - 22, y - 16))
    im = im.convert("RGBA")
    im.putalpha(m)
    c.alpha_composite(im, (x, y))


# раскладки без наложений (x0, доля высоты сверху, x1, доля снизу).
# Порядок вещей в образе: верхняя одежда, верх, низ, обувь/сумка, аксессуар
LAYOUTS = {
    2: [(40, 0, 530, 1), (550, 0, 1040, 1)],
    3: [(40, 0, 560, .62), (580, 0, 1040, 1), (40, .64, 560, 1)],
    4: [(40, 0, 560, .62), (580, 0, 1040, .46), (580, .48, 1040, 1), (40, .64, 560, 1)],
    5: [(40, 0, 560, .62), (580, 0, 1040, .46), (580, .48, 1040, 1), (40, .64, 295, 1), (305, .64, 560, 1)],
}


def _flatlay(c, items, top, bottom):
    for it in items:
        if "_img" not in it:
            it["_img"] = _img(it["img"])
            it["_studio"] = studio(it["_img"])
    lay = LAYOUTS.get(len(items), LAYOUTS[4])
    span = bottom - top
    for it, (x0, f0, x1, f1) in zip(items, lay):
        _place(c, it, (x0, int(top + f0 * span), x1, int(top + f1 * span)))


def _price(p):
    return f"{int(p):,}".replace(",", " ") + " ₽"


def look_slide(look, n=None, total=None):
    """Слайд одного образа: заголовок, флэтлей вещей, подписи «вещь · магазин · цена»."""
    c = Image.new("RGBA", (W, H), BEIGE + (255,))
    d = ImageDraw.Draw(c)
    kick = f"ОБРАЗ {n}" + (f" / {total}" if total else "") if n else "ОБРАЗ"
    d.text((64, 52), " ".join(kick), font=font("Manrope.ttf", 24, 600), fill=SOFT)
    d.text((60, 82), look.get("title", ""), font=font("Playfair-Italic.ttf", 64, 500), fill=INK)
    items = look["items"][:5]
    _flatlay(c, items, 190, 1110)
    d = ImageDraw.Draw(c)
    lf = font("Manrope.ttf", 25, 500)
    pf = font("Manrope.ttf", 25, 700)
    rows = [(it.get("short") or it["name"], f"{it['shop']} · {_price(it['price'])}") for it in items]
    y = 1140
    colw = (W - 128) // 2
    for i, (name, tail) in enumerate(rows):
        x = 64 + (i % 2) * colw
        yy = y + (i // 2) * 64
        d.text((x, yy), name, font=pf, fill=INK)
        d.text((x, yy + 30), tail, font=lf, fill=SOFT)
    return c.convert("RGB")


def looks_cover(cover, look):
    """Обложка карусели: крупный заголовок и первый образ."""
    c = Image.new("RGBA", (W, H), BEIGE + (255,))
    d = ImageDraw.Draw(c)
    title = cover.get("title", "ОБРАЗЫ")
    tf = font("Playfair.ttf", 150, 600)
    while d.textlength(title, font=tf) > W - 100 and tf.size > 60:
        tf = font("Playfair.ttf", tf.size - 10, 600)
    d.text(((W - d.textlength(title, font=tf)) / 2, 50), title, font=tf, fill=INK)
    sub = " ".join(cover.get("subtitle", "").upper())
    sf = font("Manrope.ttf", 26, 600)
    while d.textlength(sub, font=sf) > W - 100 and sf.size > 14:
        sf = font("Manrope.ttf", sf.size - 2, 600)
    sw = d.textlength(sub, font=sf)
    d.text(((W - sw) / 2, 250), sub, font=sf, fill=SOFT)
    d.line(((W - 160) / 2, 312, (W + 160) / 2, 312), fill=SOFT, width=2)
    _flatlay(c, look["items"][:5], 350, 1300)
    return c.convert("RGB")


def looks_carousel(draft):
    """Все слайды карусели: обложка + по слайду на образ (до 9 образов — лимит альбома Telegram 10)."""
    looks = draft["looks"][:9]
    slides = [looks_cover(draft.get("cover", {}), looks[0])]
    slides += [look_slide(lk, i + 1, len(looks)) for i, lk in enumerate(looks)]
    return slides
