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
