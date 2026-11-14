import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from media_contract import media_ready,render_fingerprint,sha
import render_draft_jpg as renderer
class MediaSafetyTests(unittest.TestCase):
 def test_changed_product_invalidates_existing_jpeg(self):
  d={'id':'demo','items':[{'name':'first','img':'https://shop.test/first.jpg'}]}
  with tempfile.TemporaryDirectory() as td:
   p=Path(td);(p/'demo.jpg').write_bytes(b'jpeg-v1');(p/'demo.render.json').write_text(json.dumps({'fingerprint':render_fingerprint(d),'jpeg_sha256':sha(b'jpeg-v1')}))
   self.assertTrue(media_ready(d,p));d['items'][0]['img']='https://shop.test/second.jpg';self.assertFalse(media_ready(d,p))
 def test_modified_jpeg_does_not_reuse_receipt(self):
  d={'id':'demo','items':[]}
  with tempfile.TemporaryDirectory() as td:
   p=Path(td);(p/'demo.jpg').write_bytes(b'changed');(p/'demo.render.json').write_text(json.dumps({'fingerprint':render_fingerprint(d),'jpeg_sha256':sha(b'original')}));self.assertFalse(media_ready(d,p))
 def test_pending_selection_includes_old_draft_and_rebuilds_stale_file(self):
  with tempfile.TemporaryDirectory() as td:
   p=Path(td);(p/'drafts/img').mkdir(parents=True);(p/'state').mkdir();(p/'state/state.json').write_text('{"drafts":{}}');(p/'drafts/2025-01-01-demo.json').write_text('{"id":"2025-01-01-demo","type":"picks","items":[]}');(p/'drafts/img/2025-01-01-demo.jpg').write_bytes(b'old')
   with patch.object(renderer,'ROOT',p),patch.object(renderer,'run') as run,patch.object(sys,'argv',['render','--pending']):renderer.main()
   run.assert_called_once_with('2025-01-01-demo',p/'drafts/img')
