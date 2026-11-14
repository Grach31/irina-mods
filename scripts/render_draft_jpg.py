"""Render verified product-photo drafts into JPEG cards. No synthetic product imagery."""
import argparse
import io
import json
import os
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

from PIL import Image, ImageDraw, ImageFont, ImageOps, UnidentifiedImageError

ROOT = Path(__file__).resolve().parents[1]
ALLOWED = {"https"}
MAX_DOWNLOAD = 12_000_000
WIDTH, HEIGHT = 1080, 1350


def font(size, bold=False):
    paths = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
    ]
    for path in paths:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def fetch_photo(url):
    parts = urlsplit(url)
    if parts.scheme not in ALLOWED or not parts.hostname or parts.username or parts.password:
        raise ValueError("Product image must have a public HTTPS URL")
    request = Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; StamboEditorial/1.0)", "Accept": "image/*"})
    with urlopen(request, timeout=22) as response:
        final = urlsplit(response.geturl())
        if final.scheme != "https":
            raise ValueError("Image redirect must remain HTTPS")
        mime = response.headers.get_content_type()
        if not mime.startswith("image/"):
            raise ValueError("URL did not return an image")
        raw = response.read(MAX_DOWNLOAD + 1)
    if len(raw) > MAX_DOWNLOAD:
        raise ValueError("Image exceeds size limit")
    try:
        with Image.open(io.BytesIO(raw)) as source:
            source.load()
            if source.width < 250 or source.height < 250:
                raise ValueError("Product image too small")
            if source.width * source.height > 35_000_000:
                raise ValueError("Product image too large")
            return ImageOps.exif_transpose(source).convert("RGB")
    except (UnidentifiedImageError, OSError) as exc:
        raise ValueError("Image cannot be decoded") from exc


def render(draft, photos, target):
    canvas = Image.new("RGB", (WIDTH, HEIGHT), "#f7f5f1")
    draw = ImageDraw.Draw(canvas)
    title = "STAMBO.i  /  MODA"
    draw.text((55, 40), title, font=font(34, True), fill="#202020")
    draw.line((55, 102, 1025, 102), fill="#b8b0a5", width=2)
    count = len(photos)
    gap = 14
    tile_width = (970 - (count - 1) * gap) // count
    top, bottom = 150, 1060
    for index, (item, photo) in enumerate(zip(draft["items"], photos)):
        left = 55 + index * (tile_width + gap)
        tile = ImageOps.contain(photo, (tile_width, bottom - top), Image.Resampling.LANCZOS)
        # Neutral background; preserve full garment rather than cropping it.
        x = left + (tile_width - tile.width) // 2
        y = top + (bottom - top - tile.height) // 2
        canvas.paste(tile, (x, y))
        draw.rectangle((left, top, left + tile_width, bottom), outline="#ddd8d1", width=2)
        label = str(item["shop"])[:25]
        draw.text((left, 1080), label, font=font(22, True), fill="#252525")
        price = item.get("price")
        draw.text((left, 1120), f"{price:,} RUB".replace(",", " "), font=font(22), fill="#555555")
        name = str(item["name"]).strip()
        # Short labels only; full item names and links stay in JSON.
        while name and draw.textbbox((0, 0), name, font=font(19))[2] > tile_width:
            name = name[:-1]
        draw.text((left, 1160), name, font=font(19), fill="#303030")
    draw.line((55, 1230, 1025, 1230), fill="#b8b0a5", width=2)
    draw.text((55, 1260), "EDITORIAL SELECTION  /  ORIGINAL PRODUCT PHOTOS", font=font(19), fill="#77716c")
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(".tmp")
    canvas.save(tmp, format="JPEG", quality=88, optimize=True, subsampling=0)
    with Image.open(tmp) as check:
        check.verify()
    os.replace(tmp, target)
    if target.stat().st_size > 5_000_000:
        target.unlink()
        raise ValueError("JPEG exceeds Pages media limit")
    return target


def run(draft_id, output_dir):
    if "/" in draft_id or "\\" in draft_id or not draft_id or draft_id.startswith("."):
        raise ValueError("Invalid draft ID")
    source = ROOT / "drafts" / (draft_id + ".json")
    draft = json.loads(source.read_text(encoding="utf-8"))
    if draft.get("id") != draft_id or draft.get("type") != "picks":
        raise ValueError("Not a matching picks draft")
    items = draft.get("items")
    if not isinstance(items, list) or not 2 <= len(items) <= 3:
        raise ValueError("Only complete 2–3 item picks drafts are supported")
    for item in items:
        if not all(item.get(key) for key in ("name", "price", "url", "img", "shop")):
            raise ValueError("Product metadata incomplete")
        if urlsplit(item["url"]).scheme != "https":
            raise ValueError("Product page must be HTTPS")
    photos = [fetch_photo(item["img"]) for item in items]
    target = output_dir / (draft_id + ".jpg")
    render(draft, photos, target)
    print(f"VERIFIED JPEG: {target} ({target.stat().st_size} bytes)")
    return target


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--draft-id", action="append", default=[])
    parser.add_argument("--today", action="store_true")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "drafts" / "img")
    args = parser.parse_args()
    ids = list(args.draft_id)
    if args.today:
        today = datetime.now(ZoneInfo("Europe/Moscow")).date().isoformat()
        for path in sorted((ROOT / "drafts").glob(today + "-*.json")):\n            try:\n                data = json.loads(path.read_text(encoding="utf-8"))\n                if data.get("type") == "picks" and not data.get("hold"):\n                    ids.append(path.stem)\n            except (ValueError, OSError):\n                print(f"SKIP invalid draft: {path}")
    ids = list(dict.fromkeys(ids))
    if not ids:
        print("No drafts selected")
        return
    failures = []
    for draft_id in ids:
        target = args.output_dir / (draft_id + ".jpg")
        if target.exists():
            print(f"SKIP existing: {target}")
            continue
        try:
            run(draft_id, args.output_dir)
        except Exception as exc:
            print(f"FAILED {draft_id}: {type(exc).__name__}: {exc}", flush=True)
            failures.append(draft_id)
    if failures:
        raise SystemExit(f"Could not render: {', '.join(failures)}")


if __name__ == "__main__":
    main()
