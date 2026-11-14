import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('manifest',ROOT/'scripts/build_notification_manifest.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class InventoryTests(unittest.TestCase):
 def test_check_date_and_moderation_changes_do_not_create_new_content_version(self):
  a={'id':'x','title':'Сатин','last_checked_at':'yesterday','updated_at':'one','meta':{'status':'queued'}}
  b={**a,'last_checked_at':'today','updated_at':'two','meta':{'status':'published'}}
  self.assertEqual(m.version(a),m.version(b))
  self.assertNotEqual(m.version(a),m.version({**a,'title':'Бархат'}))
 def test_receipt_is_only_exported_for_exact_deployed_draft_bytes(self):
  with tempfile.TemporaryDirectory() as td:
   r=Path(td);(r/'miniapp').mkdir();(r/'drafts').mkdir();(r/'editorial/edit-completions').mkdir(parents=True)
   for file in m.FILES.values():(r/'miniapp'/file).write_text(json.dumps({'items':[{'id':'safe','title':'title','ready':True}]}))
   raw=b'{"id":"safe","text":"corrected"}';(r/'drafts/safe.json').write_bytes(raw)
   rec=r/'editorial/edit-completions/safe.json';data={'draft_id':'safe','request_created_at':'2026-11-14T08:00:00Z','content_hash':hashlib.sha256(raw).hexdigest(),'lease_token':'11111111-1111-4111-8111-111111111111'};rec.write_text(json.dumps(data))
   with patch.object(m.subprocess,'check_output',return_value='a'*40):
    self.assertEqual(len(m.build(r)['completions']),1)
    (r/'drafts/safe.json').write_text('changed again');self.assertEqual(m.build(r)['completions'],[])
 def test_no_test_or_decided_draft_announcements(self):
  with tempfile.TemporaryDirectory() as td:
   r=Path(td);(r/'miniapp').mkdir()
   for file in m.FILES.values():(r/'miniapp'/file).write_text('{"items":[]}')
   (r/'miniapp/catalog.json').write_text(json.dumps({'items':[{'id':'demo-test'},{'id':'published','meta':{'status':'published'}},{'id':'ready','ready':True,'meta':{'status':'queued'}}]}))
   with patch.object(m.subprocess,'check_output',return_value='a'*40):self.assertEqual([x['target']['id'] for x in m.build(r)['items']],['ready'])
if __name__=='__main__':unittest.main()
