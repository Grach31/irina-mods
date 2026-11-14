"""Build an immutable deployment inventory; no moderation notes or secrets are exported."""
import hashlib
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / 'miniapp'
FILES = {'moda': 'catalog.json', 'fashion': 'fashion-daily.json', 'reels': 'reels-studio.json', 'history': 'style-time-machine.json', 'trends': 'trend-radar.json'}

def digest(raw):
    return hashlib.sha256(raw).hexdigest()

def version(item):
    return digest(json.dumps({k: v for k, v in item.items() if k not in ('updated_at', 'last_checked_at', 'meta')}, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode())

def build(root=ROOT):
    app = root / 'miniapp'
    result = {'built_at': datetime.now(timezone.utc).isoformat(), 'sha': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip(), 'files': {}, 'items': [], 'completions': [], 'reports': []}
    for space, filename in FILES.items():
        raw = (app / filename).read_bytes()
        result['files'][filename] = digest(raw)
        for item in json.loads(raw).get('items', []):
            iid = item.get('id')
            if not iid:
                raise ValueError(f'{filename}: stable id missing')
            if space == 'moda' and (item.get('ready') is not True or 'test' in iid.lower() or item.get('meta', {}).get('status') in ('rejected', 'published')):
                continue
            result['items'].append({'source_id': f'{space}:{iid}', 'version': version(item), 'kind': 'draft' if space == 'moda' else 'updates', 'target': {'space': space, 'id': iid}})
    for file in (root / 'editorial' / 'edit-completions').glob('*.json'):
        receipt = json.loads(file.read_text())
        did = receipt['draft_id']
        if '/' in did or '..' in did:
            raise ValueError('Invalid draft id')
        draft = root / 'drafts' / f'{did}.json'
        # Invalid/stale receipts never announce completion.
        if draft.exists() and receipt.get('lease_token') and digest(draft.read_bytes()) == receipt.get('content_hash') and any(x['source_id']=='moda:'+did for x in result['items']):
            result['completions'].append({k: receipt[k] for k in ('draft_id', 'request_created_at', 'content_hash','lease_token')})
    for file in (root / 'editorial' / 'status').glob('*.json'):
        report = json.loads(file.read_text())
        if report.get('section') in FILES and report.get('state') in ('ready', 'blocked'):
            result['reports'].append({k: report[k] for k in ('id', 'section', 'state', 'reason_code', 'recorded_at')})
    result['reports'] = sorted(result['reports'], key=lambda r: r['recorded_at'])[-35:]
    return result

if __name__ == '__main__':
    output = build()
    (APP / 'notification-manifest.json').write_text(json.dumps(output, ensure_ascii=False, separators=(',', ':')))
    print(f'Notification inventory: {len(output["items"])} materials, {len(output["completions"])} receipts')
