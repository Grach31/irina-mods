"""Offline tests for Stambo.i Mini App approvals and read-only permissions."""
import importlib.util
import json
from pathlib import Path
import types
import unittest
from datetime import datetime, timezone

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location("miniapp", ROOT/"bot"/"miniapp.py")
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class MiniAppTests(unittest.TestCase):
    def setUp(self):
        self.calls=[]
        self.tg=types.SimpleNamespace(call=lambda method,**kwargs: self.calls.append((method,kwargs)))
        self.config=types.SimpleNamespace(ALLOWED={42,731539637},READ_ONLY={731539637},IRINA=42)
        self.state={"drafts":{"post-1":{"status":"sent","msg_id":99}}}
    def send(self,user,action="ok",did="post-1"):
        payload=json.dumps({"type":"stambo_miniapp","action":action,"id":did})
        msg={"from":{"id":user},"chat":{"id":user,"type":"private"},"web_app_data":{"data":payload}}
        module.handle(self.state,msg,self.tg,self.config,lambda:datetime.now(timezone.utc))
    def test_owner_can_approve(self):
        self.send(42)
        self.assertEqual(self.state["drafts"]["post-1"]["status"],"approved")
        self.assertIn("publish_at",self.state["drafts"]["post-1"])
    def test_viewer_cannot_approve(self):
        self.send(731539637)
        self.assertEqual(self.state["drafts"]["post-1"]["status"],"sent")
    def test_unknown_cannot_approve(self):
        self.send(999)
        self.assertEqual(self.state["drafts"]["post-1"]["status"],"sent")
    def test_approve_is_idempotent(self):
        self.send(42)
        self.send(42)
        self.assertEqual(self.state["drafts"]["post-1"]["status"],"approved")
    def test_reject(self):
        self.send(42,"no")
        self.assertEqual(self.state["drafts"]["post-1"]["status"],"rejected")
    def test_edit(self):
        self.send(42,"edit")
        self.assertEqual(self.state["awaiting_edit"],"post-1")
    def test_invalid_id(self):
        self.send(42,"ok","../config.json")
        self.assertEqual(self.state["drafts"]["post-1"]["status"],"sent")
if __name__=="__main__":
    unittest.main()
