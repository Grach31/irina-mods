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


def main():
    data = shops.collect()
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
