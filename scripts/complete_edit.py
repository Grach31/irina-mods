"""Record explicit editorial completion after the actual requested edits and checks.
Usage: python scripts/complete_edit.py DRAFT_ID REQUEST_CREATED_AT
Does not mark anything published. Commit the receipt with the reviewed draft.
"""
import hashlib
import json
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
if __name__ == '__main__':
    did, requested_at = sys.argv[1:]
    if not did or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.-' for c in did):
        raise ValueError('Invalid draft id')
    content_hash = hashlib.sha256((ROOT / 'drafts' / f'{did}.json').read_bytes()).hexdigest()
    from datetime import datetime
    datetime.fromisoformat(requested_at.replace('Z', '+00:00'))
    target = ROOT / 'editorial' / 'edit-completions'
    target.mkdir(parents=True, exist_ok=True)
    (target / f'{did}.json').write_text(json.dumps({'draft_id': did, 'request_created_at': requested_at, 'content_hash': content_hash}, ensure_ascii=False, indent=2) + '\n')
    print(f'Explicit completion recorded for {did}; deployment and request validation still required.')
