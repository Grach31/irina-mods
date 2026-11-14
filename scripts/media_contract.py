"""Shared immutable content and image readiness checks."""
import hashlib
import json
from pathlib import Path

def sha(raw):return hashlib.sha256(raw).hexdigest()
def render_fingerprint(draft):
    return sha(json.dumps({'renderer':sha(Path(__file__).with_name('render_draft_jpg.py').read_bytes()),'items':draft.get('items',[])},ensure_ascii=False,sort_keys=True,separators=(',',':')).encode())
def media_ready(draft,folder):
    image=Path(folder)/(draft['id']+'.jpg');receipt=Path(folder)/(draft['id']+'.render.json')
    try:
        data=json.loads(receipt.read_text())
        return image.is_file() and data['fingerprint']==render_fingerprint(draft) and data['jpeg_sha256']==sha(image.read_bytes())
    except (OSError,ValueError,KeyError):return False
