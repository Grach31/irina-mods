"""Сбор новинок из магазинов: название, цена, ссылка, фото."""
import re
import urllib.parse
import urllib.request

from bs4 import BeautifulSoup

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/130 Safari/537.36",
      "Accept-Language": "ru-RU,ru;q=0.9"}

# магазин: (ссылки на разделы, шаблон ссылки на товар, тип: daily — каждый день, dream — «вещь мечты»)
SHOPS = {
    "Lime": (["https://limestore.com/ru_ru/catalog/women_new?menu=13264",
              "https://limestore.com/ru_ru/catalog/women_outerwear?menu=3800",
              "https://limestore.com/ru_ru/catalog/women_knitwear?menu=7218",
              "https://limestore.com/ru_ru/catalog/women_dresses?menu=10894",
              "https://limestore.com/ru_ru/catalog/women_trousers?menu=2062"],
             r"/product/", "daily"),
    "Love Republic": (["https://loverepublic.ru/catalog/new/"], r"/catalog/[a-z-]+/[a-z-]+/\d+/", "daily"),
    "2MOOD": (["https://www.2moodstore.com/collection/new/"], r"/collection/katalog/[^/]+/", "daily"),
    "Askent": (["https://askent.ru/new/askent/"], r"/cat/(obuv|sumki|aksessuary)[^\"]*/[^/]+/$", "dream"),
    "Ushatava": (["https://www.ushatava.ru/store/w/novinki/"], r"/store/w/[a-z-]+/[a-z0-9-]+-\d+/$", "dream"),
}

PRICE = re.compile(r"(\d[\d\s  ]{2,9})\s*(?:₽|РУБ|руб)", re.I)


def fetch(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.read().decode("utf-8", errors="ignore")


def first_img(box, base):
    # 2MOOD: фото лежит в data-id="1:/upload/iblock/...jpg", а сами картинки грузятся позже
    for el in box.find_all(attrs={"data-id": re.compile(r"/upload/iblock/")}):
        path = el["data-id"].split(":", 1)[-1]
        if path.endswith(".jpg"):
            return "https://cdn.2moodstore.com/images/w729" + path[:-4] + "-jpg.webp"
    for img in box.find_all(["img", "source"]):
        for attr in ("data-src", "src", "data-srcset", "srcset"):
            v = img.get(attr)
            if not v or v.startswith("data:"):
                continue
            v = v.split(",")[0].strip().split(" ")[0]
            if v.endswith(".svg"):
                continue
            return urllib.parse.urljoin(base, v)
    return None


def parse(html, base, pattern):
    soup = BeautifulSoup(html, "lxml")
    rx = re.compile(pattern)
    out, seen = [], set()
    for a in soup.find_all("a", href=True):
        href = a["href"].split("?")[0]
        if not rx.search(href):
            continue
        url = urllib.parse.urljoin(base, href)
        if url in seen:
            continue
        box = a
        for _ in range(8):
            text = box.get_text(" ", strip=True)
            if PRICE.search(text) and box.find(["img", "source"]):
                break
            box = box.parent
            if box is None:
                break
        if box is None:
            continue
        text = box.get_text(" ", strip=True)
        m = PRICE.search(text)
        img = first_img(box, base)
        if not m or not img or len(text) > 600:
            continue
        price = int(re.sub(r"\D", "", m.group(1)))
        name = (a.get_text(" ", strip=True) or "").strip()
        if not name or PRICE.search(name):
            alt = box.find("img", alt=True)
            name = alt["alt"].strip() if alt and alt["alt"].strip() else text[:m.start()].strip()
        name = re.sub(r"\s+", " ", name)
        name = re.sub(r"\.\s*Вид \d+$", "", name)[:90]
        img = img.replace("/thumb/375_9999/", "/thumb/600_9999/")
        if not name or price < 2500:  # отсекаем косметику и мелочи
            continue
        seen.add(url)
        out.append({"name": name[:1].upper() + name[1:].lower() if name.isupper() else name,
                    "price": price, "url": url, "img": img})
    return out


def parse_2mood(html, base):
    """2MOOD отдаёт фото только у первых карточек, остальное лежит в JSON страницы."""
    out, seen = [], set()
    rx = re.compile(r'"code":"([a-z0-9_]+)","type":"product","title":"([^"]+)".{0,400}?"media":\[\{"type":"image","title":"[^"]*","url":"(/upload/iblock/[^"]+?\.jpg)"', re.S)
    for m in rx.finditer(html):
        code, title, img = m.groups()
        if code in seen:
            continue
        tail = html[m.end():m.end() + 6000]
        pm = re.search(r'"price":(\d+),"currency":"RUB"', tail)
        if not pm:
            continue
        price = int(pm.group(1)) // 100
        if price < 2500:
            continue
        seen.add(code)
        out.append({"name": title, "price": price,
                    "url": f"https://www.2moodstore.com/collection/katalog/{code}/",
                    "img": "https://cdn.2moodstore.com/images/w729" + img[:-4] + "-jpg.webp"})
    return out


def collect(log=print):
    result = {}
    for shop, (urls, pattern, kind) in SHOPS.items():
        items, seen = [], set()
        for u in urls:
            try:
                html = fetch(u)
                found = parse_2mood(html, u) if shop == "2MOOD" else parse(html, u, pattern)
                for it in found:
                    if it["url"] not in seen:
                        seen.add(it["url"])
                        it["shop"] = shop
                        it["kind"] = kind
                        items.append(it)
            except Exception as e:  # магазин недоступен — пропускаем
                log(f"{shop}: {u}: {e}")
        result[shop] = items[:40]
        log(f"{shop}: {len(items)} товаров")
    return result
