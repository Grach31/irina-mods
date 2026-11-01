"""Раз в день: новинки магазинов → data/candidates.json и контактные листы с фото для отбора."""
import json
import os
import sys
import traceback

from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(__file__))
import render  # noqa: E402
import shops  # noqa: E402

import config  # noqa: E402

OUT = os.path.join(config.DATA, "data")


def sheet(items, path):
    """Сетка миниатюр с номерами — по ней Claude смотрит качество фото."""
    cols, tw, th = 8, 180, 240
    rows = (len(items) + cols - 1) // cols
    im = Image.new("RGB", (cols * tw, rows * (th + 26)), (255, 255, 255))
    d = ImageDraw.Draw(im)
    f = render.font("Manrope.ttf", 18, 600)
    for i, it in enumerate(items):
        x, y = (i % cols) * tw, (i // cols) * (th + 26)
        try:
            render.cover(im, render.load(it["img"]), (x + 2, y + 2, x + tw - 2, y + th - 2), fy=0.3)
        except Exception:
            it["img_error"] = True
        d.text((x + 6, y + th + 2), f"#{i} {it['price']:,}".replace(",", " "), font=f, fill=(0, 0, 0))
    im.save(path, "JPEG", quality=80)


PROBES = {"Sela": ["https://www.sela.ru/", "https://sela.ru/eshop/", "https://www.sela.ru/eshop/zhenskaya/"],
          "Befree": ["https://befree.ru/", "https://befree.ru/catalog/", "https://befree.ru/zhenskaya/"]}


def diagnose(data):
    """Для магазинов, где ничего не нашлось: что отдал сайт (статус, заголовок, ссылки, цены) — по этому правят шаблоны."""
    import re
    import urllib.request
    from bs4 import BeautifulSoup
    out = {}
    for shop, items in data.items():
        if items:
            continue
        urls, pattern, _ = shops.SHOPS[shop]
        info = []
        for u in urls:
            rec = {"url": u}
            try:
                req = urllib.request.Request(u, headers=shops.UA)
                with urllib.request.urlopen(req, timeout=40) as r:
                    html = r.read().decode("utf-8", errors="ignore")
                    rec.update(status=r.status, final_url=r.geturl(), length=len(html))
                soup = BeautifulSoup(html, "lxml")
                rec["title"] = (soup.title.get_text(" ", strip=True) if soup.title else "")[:150]
                hrefs = [a["href"] for a in soup.find_all("a", href=True)]
                rec["links_total"] = len(hrefs)
                rec["links_match"] = len([h for h in hrefs if re.search(pattern, h.split("?")[0])])
                with_digits = [h for h in dict.fromkeys(hrefs) if re.search(r"\d{3,}", h) and not h.startswith(("tel:", "mailto:"))]
                rec["sample_links_digits"] = with_digits[:25]
                rec["sample_links"] = list(dict.fromkeys(hrefs))[:25]
                rec["price_mentions"] = len(shops.PRICE.findall(html))
                rec["imgs"] = len(soup.find_all("img"))
                rec["has_jsonld"] = "application/ld+json" in html
                rec["has_next_data"] = "__NEXT_DATA__" in html or "__NUXT__" in html or "window.__INITIAL_STATE__" in html
                m = re.search(r'"price"\s*:\s*"?(\d{3,6})', html)
                rec["json_price_sample"] = m.group(0) if m else None
                rx = re.compile(pattern)
                for a in soup.find_all("a", href=True):
                    if rx.search(a["href"].split("?")[0]):
                        box, samples = a, []
                        for lvl in range(1, 7):
                            box = box.parent
                            if box is None:
                                break
                            if lvl in (2, 4, 6):
                                samples.append(str(box)[:1500])
                        rec["card_samples"] = samples
                        rec["card_href"] = a["href"]
                        break
                rec["head"] = re.sub(r"\s+", " ", soup.get_text(" ", strip=True))[:300]
            except Exception as e:
                rec["error"] = str(e)[:300]
            info.append(rec)
        for u in PROBES.get(shop, []):          # главная страница: ищем, где у магазина новинки
            rec = {"probe": u}
            try:
                req = urllib.request.Request(u, headers=shops.UA)
                with urllib.request.urlopen(req, timeout=40) as r:
                    html = r.read().decode("utf-8", errors="ignore")
                    rec.update(status=r.status, final_url=r.geturl(), length=len(html))
                soup = BeautifulSoup(html, "lxml")
                hrefs = list(dict.fromkeys(a["href"] for a in soup.find_all("a", href=True)))
                rec["new_links"] = [h for h in hrefs if re.search(r"new|novin|nov|collection|catalog", h, re.I)][:40]
                rec["title"] = (soup.title.get_text(" ", strip=True) if soup.title else "")[:150]
            except Exception as e:
                rec["error"] = str(e)[:300]
            info.append(rec)
        out[shop] = info
    return out


def main():
    data = shops.collect()
    try:
        debug = diagnose(data)
        with open(os.path.join(OUT, "scrape_debug.json"), "w", encoding="utf-8") as f:
            json.dump(debug, f, ensure_ascii=False, indent=1)
    except Exception:
        traceback.print_exc()
    os.makedirs(os.path.join(OUT, "sheets"), exist_ok=True)
    for shop, items in data.items():
        if not items:
            continue
        try:
            sheet(items, os.path.join(OUT, "sheets", f"{shop.replace(' ', '_')}.jpg"))
        except Exception:
            traceback.print_exc()
    with open(os.path.join(OUT, "candidates.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
