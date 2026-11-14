"""Record an editorial outcome for notification recovery; never sends Telegram messages."""
import json
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo
if __name__=='__main__':
    section,state,code=sys.argv[1:]
    if section not in ('moda','fashion','reels','history','trends') or state not in ('ready','blocked') or code not in ('ok','sources','images','access','validation','other'):
        raise ValueError('Invalid editorial outcome')
    now=datetime.now(ZoneInfo('Europe/Moscow'));root=Path(__file__).resolve().parents[1]/'editorial/status';root.mkdir(parents=True,exist_ok=True)
    data={'id':f'{now.date()}:{section}','section':section,'state':state,'reason_code':code,'recorded_at':now.isoformat()}
    file=root/f'{now.date()}-{section}.json'
    previous=json.loads(file.read_text()) if file.exists() else {}
    if previous.get('state')!=state or previous.get('reason_code')!=code:
        file.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
