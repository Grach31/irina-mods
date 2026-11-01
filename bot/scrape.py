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


PROBES = {}


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


def diagnose2(data):
    """Доп. диагностика трёх проблемных магазинов: фото Zarina, карточка Zarina, данные IDOL, исходник 12 Storeez."""
    import re
    import urllib.request
    out = {}

    def get(url, headers=None):
        req = urllib.request.Request(url, headers=headers or shops.UA)
        with urllib.request.urlopen(req, timeout=40) as r:
            return r.status, r.read()

    # Zarina: фото разными способами
    try:
        it = data["Zarina"][0]
        img = it["img"]
        tests = {}
        for label, url, hd in [
            ("plain", img, shops.UA),
            ("referer", img, {**shops.UA, "Referer": "https://zarina.ru/"}),
            ("no_query", img.split("?")[0], {**shops.UA, "Referer": "https://zarina.ru/"}),
            ("jpg_variant", img.split("?")[0].replace(".webp", ".jpg"), {**shops.UA, "Referer": "https://zarina.ru/"}),
            ("accept_image", img, {**shops.UA, "Referer": "https://zarina.ru/", "Accept": "image/avif,image/webp,image/*,*/*;q=0.8"}),
        ]:
            try:
                st, body = get(url, hd)
                tests[label] = {"status": st, "bytes": len(body), "head": body[:12].hex()}
            except Exception as e:
                tests[label] = {"error": str(e)[:200], "url": url}
        out["zarina_img"] = {"url": img, "tests": tests}
        st, body = get(shops.SHOPS["Zarina"][0][0])
        html = body.decode("utf-8", errors="ignore")
        i = html.find("/catalog/product/")
        out["zarina_card"] = html[max(0, i - 900): i + 2600]
    except Exception as e:
        out["zarina_error"] = str(e)[:300]
    # IDOL: Nuxt-данные
    try:
        st, body = get("https://idol.ru/catalog/new/")
        html = body.decode("utf-8", errors="ignore")
        out["idol_scripts"] = re.findall(r"<script[^>]*>", html)[:20]
        k = html.find("kurtka-rabochego-s-vorotom-iz-mekha-norki")
        ks = [m.start() for m in re.finditer("kurtka-rabochego-s-vorotom-iz-mekha-norki", html)]
        out["idol_occurrences"] = ks[:10]
        j = html.find("6381407259")
        out["idol_payload_sample"] = html[max(0, j - 600): j + 1800] if j >= 0 else ""
        m = re.search(r'<script[^>]*id="__NUXT_DATA__"[^>]*>(.*?)</script>', html, re.S)
        arr = json.loads(m.group(1)) if m else []
        out["idol_nuxt_len"] = len(arr)

        def show(v, depth=0):
            # формат devalue: числа внутри объектов/списков — ссылки на элементы общего массива
            if isinstance(v, int) and not isinstance(v, bool) and 0 <= v < len(arr) and depth < 3:
                t = arr[v]
                if isinstance(t, (dict, list)):
                    return show(t, depth + 1)
                return t
            if isinstance(v, dict) and depth < 4:
                return {k: show(x, depth + 1) for k, x in list(v.items())[:40]}
            if isinstance(v, list) and depth < 4:
                return [show(x, depth + 1) for x in v[:12]]
            return v

        hits = [i for i, v in enumerate(arr) if isinstance(v, str) and "6381407259" in v]
        out["idol_hits"] = hits[:8]
        objs = []
        for i, v in enumerate(arr):
            if isinstance(v, dict) and any(x in hits for x in v.values() if isinstance(x, int)):
                objs.append(show(v))
                if len(objs) >= 2:
                    break
        out["idol_product_objects"] = json.dumps(objs, ensure_ascii=False)[:6000]
        cd = [v for v in arr if isinstance(v, dict) and "catalogData" in v]
        out["idol_catalogdata_keys"] = json.dumps(show(cd[0]["catalogData"]) if cd else None, ensure_ascii=False)[:2500]
    except Exception as e:
        out["idol_error"] = str(e)[:300]
    # IDOL: прямой вызов разбора на странице женских новинок
    try:
        import traceback as tb
        st, body = get("https://idol.ru/catalog/new/woman/")
        html = body.decode("utf-8", errors="ignore")
        res = {"len": len(html), "gzip_head": body[:2].hex()}
        try:
            found = shops.parse_idol(html, "https://idol.ru/catalog/new/woman/")
            res["found"] = len(found)
            res["first"] = found[:2]
        except Exception:
            res["parse_error"] = tb.format_exc()[-800:]
        m = re.search(r'<script[^>]*id="__NUXT_DATA__"[^>]*>(.*?)</script>', html, re.S)
        res["has_nuxt"] = bool(m)
        if m:
            arr = json.loads(m.group(1))
            res["arr_len"] = len(arr)
            prods = [v for v in arr if isinstance(v, dict) and "article" in v]
            res["dicts_with_article"] = len(prods)
            if prods:
                res["sample_keys"] = list(prods[0].keys())
                res["sample_raw"] = json.dumps(prods[0], ensure_ascii=False)[:800]
                im = arr[prods[0]["images"]] if isinstance(prods[0].get("images"), int) else prods[0].get("images")
                res["images_raw"] = json.dumps(im, ensure_ascii=False)[:500]
                if isinstance(im, dict):
                    k = im.get("large") or im.get("medium")
                    res["image_large_raw"] = json.dumps(arr[k] if isinstance(k, int) else k, ensure_ascii=False)[:500]
        out["idol_woman"] = res
    except Exception as e:
        out["idol_woman_error"] = str(e)[:300]
    # 12 Storeez: исходник пустой страницы
    try:
        st, body = get("https://12storeez.com/catalog/new")
        out["storeez_html"] = body.decode("utf-8", errors="ignore")[:2500]
    except Exception as e:
        out["storeez_error"] = str(e)[:300]
    return out


def main():
    data = shops.collect()
    try:
        with open(os.path.join(OUT, "scrape_debug2.json"), "w", encoding="utf-8") as f:
            json.dump(diagnose2(data), f, ensure_ascii=False, indent=1)
    except Exception:
        traceback.print_exc()
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
