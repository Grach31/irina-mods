import hashlib
import contextlib
import io
import os
import textwrap
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
 def test_delivery_proof_does_not_change_notification_version(self):
  item={'id':'safe','ready':True,'revision':'b'*64,'media_sha256':'c'*64,'meta':{'status':'queued'}}
  with tempfile.TemporaryDirectory() as td:
   root=Path(td);(root/'miniapp').mkdir()
   for file in m.FILES.values():(root/'miniapp'/file).write_text('{"items":[]}')
   (root/'miniapp/catalog.json').write_text(json.dumps({'items':[item]}))
   with patch.object(m.subprocess,'check_output',return_value='a'*40):entry=m.build(root)['items'][0]
  self.assertEqual(entry['version'],m.version(item))
  self.assertEqual(entry['delivery'],{'release_sha':'a'*40,'ready':True,'revision':'b'*64,'media_sha256':'c'*64})
  for broken in ({**item,'ready':False},{**item,'revision':''},{**item,'media_sha256':'invalid'}):
   self.assertIsNone(m.delivery_receipt(broken,'a'*40))

 def test_deployment_requires_ingestion_not_just_http_200(self):
  workflow=(ROOT/'.github/workflows/miniapp-pages.yml').read_text()
  step=workflow.split('      - name: Notify My Space of deployed release',1)[1]
  code=textwrap.dedent(step.split("python - <<'PYCODE'\n",1)[1].split('          PYCODE',1)[0])
  for body,accepted in (({'ok':True,'ingested':{'changes':2}},True),({'ok':True,'ingested':None},False),({'ok':True,'disabled':True},False),({'error':'failed'},False)):
   with self.subTest(body=body):
    token=io.BytesIO(b'{"value":"mock-token"}');response=io.BytesIO(json.dumps(body).encode());response.status=200
    stdout=io.StringIO()
    env={'ACTIONS_ID_TOKEN_REQUEST_URL':'https://token.test/?x=1','ACTIONS_ID_TOKEN_REQUEST_TOKEN':'mock-request','NOTICE_URL':'https://notice.test/','NOTICE_SHA':'a'*40}
    with patch.dict(os.environ,env),patch('urllib.request.urlopen',side_effect=[token,response]),contextlib.redirect_stdout(stdout):
     if accepted:exec(compile(code,'deployment-step','exec'),{})
     else:
      with self.assertRaisesRegex(RuntimeError,'did not confirm'):exec(compile(code,'deployment-step','exec'),{})
    self.assertEqual('MYSPACE_DEPLOYMENT_RECONCILED' in stdout.getvalue(),accepted)

if __name__=='__main__':unittest.main()
