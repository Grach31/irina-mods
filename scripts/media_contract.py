"""Shared immutable content and image readiness checks."""
import hashlib
import json
import re
from pathlib import Path

MODA_PHOTOS = Path("drafts/photos/moda")
MODA_PHOTO_URL = "https://raw.githubusercontent.com/Grach31/irina-mods/main/drafts/photos/moda/"
PREVIOUS_RENDERER = "a8613972cf5c02fbddcdbe207fb4e058c79c4176133a8bd7be88c949da093c5a"


def moda_photo(root, draft_id, item):
    """Resolve a snapshot locally and bind it to the server receipt for this product."""
    url = item["img"]
    receipt_id = item.get("image_preflight")
    if not receipt_id and not url.startswith(MODA_PHOTO_URL):
        return None
    filename = url.removeprefix(MODA_PHOTO_URL)
    if (not url.startswith(MODA_PHOTO_URL) or not re.fullmatch(r"[a-f0-9]{64}\.jpg", filename)
            or not isinstance(receipt_id, str) or not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,95}", receipt_id)):
        raise ValueError("Invalid Moda snapshot URL or preflight request ID")
    receipt = json.loads((root / "moda/results" / (receipt_id + ".json")).read_text(encoding="utf-8"))
    if receipt.get("schema_version") != 1 or receipt.get("request_id") != receipt_id:
        raise ValueError("Invalid Moda preflight receipt")
    if not any(card["id"] == draft_id and row["status"] == "verified"
               and row["product_url"] == item["url"] and row["photo"]["img"] == url
               and row["photo"]["sha256"] == filename[:-4]
               for card in receipt["cards"] for row in card["items"]):
        raise ValueError("Snapshot was not verified for this card and product")
    photo = root / MODA_PHOTOS / filename
    if sha(photo.read_bytes()) != filename[:-4]:
        raise ValueError("Verified snapshot checksum mismatch")
    return photo


def sha(raw):return hashlib.sha256(raw).hexdigest()
def render_fingerprint(draft, renderer=None):
    renderer = renderer or sha(Path(__file__).with_name('render_draft_jpg.py').read_bytes())
    payload = {"renderer": renderer, "items": draft.get("items", [])}
    return sha(json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode())
def media_ready(draft,folder,root=None):
    image=Path(folder)/(draft['id']+'.jpg');receipt=Path(folder)/(draft['id']+'.render.json')
    try:
        data=json.loads(receipt.read_text())
        snapshots = [moda_photo(root or Path(__file__).resolve().parents[1], draft["id"], item)
                     for item in draft.get("items", [])]
        fingerprints = {render_fingerprint(draft)}
        if not any(snapshots):
            # The collage layout, encoding and legacy photo loader are unchanged.
            fingerprints.add(render_fingerprint(draft, PREVIOUS_RENDERER))
        return (image.is_file() and data['fingerprint'] in fingerprints
                and data['jpeg_sha256'] == sha(image.read_bytes()))
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return False
