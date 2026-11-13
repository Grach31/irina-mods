"""Build a compact, read-only Mini App catalog from editorial drafts.

No config, Telegram IDs, file IDs or request records are exported.
Note: GitHub Pages is public, so this catalog is not a privacy boundary.
"""
import glob
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "miniapp" / "catalog.json"

def main():
    state = json.loads((ROOT / "state" / "state.json").read_text(encoding="utf-8"))
    all_drafts = state.get("drafts", {})
    permitted = {"sent", "awaiting_edit", "published", "rejected", "approved", "edit_requested"}
    # Editorial-ready drafts are visible in Safari even before Telegram delivery.
    # A missing Telegram status is *queued*, not delivered or approved.
    rows = []
    for file in (ROOT / "drafts").glob("*.json"):
        did = file.stem
        meta = all_drafts.get(did, {})
        if meta.get("status") in {"error", "partial_error", "replaced"}:
            continue
        if meta.get("status") and meta["status"] not in permitted:
            continue
        rows.append((did, meta))
    rows.sort(key=lambda pair: pair[1].get("sent_at") or pair[0], reverse=True)
    rows = rows[:120]
    items = []
    media_dir = ROOT / 'miniapp' / 'media'
    media_dir.mkdir(parents=True, exist_ok=True)
    for did, meta in rows:
        file = ROOT / "drafts" / (did + ".json")
        if not file.is_file():
            continue
        try:
            draft = json.loads(file.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            continue
        if draft.get("hold"):
            continue
        # Keep only content needed to display the post; do not export owner-only state.
        item = {"id": did, "type": draft.get("type", ""),
                "text": draft.get("text", ""),
                "meta": {"status": meta.get("status", "queued"), "sent_at": meta.get("sent_at", "")}}
        for key in ("items", "looks", "photos", "image"):
            if key in draft:
                item[key] = draft[key]
        if "card" in draft and isinstance(draft["card"], dict):
            item["card"] = {"images": draft["card"].get("images", [])}
        # Include the first generated JPEG in Pages, avoiding cross-domain image failures.
        src = ROOT / "drafts" / "img" / (did + ".jpg")
        if src.is_file() and src.stat().st_size < 5_000_000:
            shutil.copyfile(src, media_dir / (did + ".jpg"))
        items.append(item)
    result = {
        "pending": sum(d.get("status") == "sent" for d in all_drafts.values()),
        "published": sum(d.get("status") == "published" for d in all_drafts.values()),
        "rejected": sum(d.get("status") == "rejected" for d in all_drafts.values()),
        "items": items,
    }
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Exported {len(items)} miniapp posts ({TARGET.stat().st_size} bytes)")

if __name__ == "__main__":
    main()
