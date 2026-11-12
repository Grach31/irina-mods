"""Offline smoke tests for the new Telegram moderation widget."""
import importlib.util
import json
import pathlib
import sys
import types
import unittest
import zlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
calls = []
tg = types.ModuleType("tg")
tg.call = lambda method, **kwargs: calls.append((method, kwargs)) or {"message_id": 1}
config = types.ModuleType("config")
config.ALLOWED = {42}
config.READ_ONLY = set()
config.DATA = str(ROOT)
config.MSK = __import__("datetime").timezone(__import__("datetime").timedelta(hours=3))
sys.modules["tg"] = tg
sys.modules["config"] = config
spec = importlib.util.spec_from_file_location("widget", ROOT / "bot" / "widget.py")
widget = importlib.util.module_from_spec(spec)
spec.loader.exec_module(widget)

class WidgetTests(unittest.TestCase):
    def setUp(self):
        calls.clear()
        self.state = {"drafts": {"draft-test": {"status": "sent", "msg_id": 5, "sent_at": "2026-11-12T09:00:00+03:00"}}}
    def request(self, uid, action):
        widget.handle(self.state, {"id": "query1", "from": {"id": uid},
            "chat": {"id": uid, "type": "private"}, "data": action})
    def test_html_size_and_interactions(self):
        raw = widget.HTML.encode()
        self.assertLessEqual(len(raw), 32768)
        self.assertLessEqual(len(zlib.compress(raw,9)),4096)
        self.assertIn("TelegramWidget.request", widget.HTML)
        self.assertNotIn("fetch(", widget.HTML)
    def test_send(self):
        widget.send(42)
        self.assertEqual(calls[-1][0], "sendWidget")
        self.assertTrue(calls[-1][1]["allow_queries"])
    def test_access_control(self):
        self.request(55, "ok:draft-test")
        self.assertEqual(self.state["drafts"]["draft-test"]["status"], "sent")
    def test_approval(self):
        self.request(42, "ok:draft-test")
        self.assertEqual(self.state["drafts"]["draft-test"]["status"], "approved")
        self.assertEqual(calls[-1][0], "answerWidgetQuery")
        self.assertLessEqual(len(calls[-1][1]["data"].encode()),1024)
    def test_rejection(self):
        self.request(42, "no:draft-test")
        self.assertEqual(self.state["drafts"]["draft-test"]["status"], "rejected")
    def test_edit(self):
        self.request(42, "edit:draft-test")
        self.assertEqual(self.state["awaiting_edit"], "draft-test")
    def test_duplicate_action(self):
        self.request(42, "ok:draft-test")
        self.request(42, "ok:draft-test")
        self.assertEqual(self.state["drafts"]["draft-test"]["status"], "approved")
        self.assertIn("уже обработан", json.loads(calls[-1][1]["data"])["notice"])
    def test_view_sends_photo_without_approval(self):
        self.state["drafts"]["draft-test"]["file_id"] = "photo123"
        # A minimal file fixture for the preview handler.
        import tempfile
        with tempfile.TemporaryDirectory() as base:
            folder = pathlib.Path(base) / "drafts"
            folder.mkdir()
            (folder / "draft-test.json").write_text(json.dumps({"text": "Тестовый пост"}), encoding="utf-8")
            previous = config.DATA
            config.DATA = base
            try:
                self.request(42, "view:draft-test")
            finally:
                config.DATA = previous
        self.assertEqual(self.state["drafts"]["draft-test"]["status"], "sent")
        self.assertTrue(any(method == "sendPhoto" for method, _ in calls))
    def test_snapshot(self):
        self.assertEqual(json.loads(widget.snapshot(self.state))["pending"],1)
if __name__=="__main__": unittest.main()
