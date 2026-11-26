from collections import Counter
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
from pathlib import Path
import random
import sys
from tempfile import TemporaryDirectory
from threading import Thread
import time
import unittest
from unittest.mock import patch
from urllib.parse import urlsplit
from urllib.request import ProxyHandler, build_opener

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import build_miniapp_catalog as catalog
from media_contract import MODA_PHOTOS, sha
from moda_photo_preflight import CheckedRedirect, Downloader, preflight
import render_draft_jpg as renderer


class LocalHTTP(Downloader):
    """Use the real transport against a loopback test fixture."""

    def host(self, url):
        return urlsplit(url).hostname

    def opener(self, check):
        return build_opener(ProxyHandler({}), CheckedRedirect(check))


class ModaPhotoIntegration(unittest.TestCase):
    def setUp(self):
        raw = io.BytesIO()
        pixels = random.Random(42).randbytes(320 * 400 * 3)
        Image.frombytes("RGB", (320, 400), pixels).save(raw, "JPEG", quality=90)
        self.jpeg = raw.getvalue()
        raw = io.BytesIO()
        Image.new("RGB", (150, 150), "orange").save(raw, "PNG")
        self.small = raw.getvalue() + bytes(4_000)
        self.calls = Counter()
        self.referers = {}
        self.offline = False
        self.retry_delays = []
        fixture = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                path = self.path
                fixture.calls[path] += 1
                fixture.referers[path] = self.headers.get("Referer")
                status, mime, data = 200, "image/jpeg", fixture.jpeg
                if fixture.offline:
                    status = 404
                elif path.startswith("/product/"):
                    name = path.split("/")[-1]
                    photos = {
                        "blocked": ["/forbidden.jpg", "/fallback.jpg"],
                        "gone": ["/missing.jpg"],
                        "slow": ["/slow.jpg"],
                        "recover": ["/recover.jpg"],
                        "corrupt": ["/corrupt.jpg", "/second.jpg"],
                        "metadata": ["/html.jpg", "/tiny.jpg", "/small.png"],
                    }[name]
                    payload = json.dumps({"@type": "Product", "image": photos})
                    data = (
                        '<meta property="og:type" content="product">'
                        f'<script type="application/ld+json">{payload}</script>'
                        '<img src="/recommendations.jpg">'
                    ).encode()
                    mime = "text/html"
                elif path == "/forbidden.jpg":
                    status = 403
                elif path == "/missing.jpg":
                    status = 404
                elif path == "/slow.jpg" or path == "/recover.jpg" and fixture.calls[path] == 1:
                    time.sleep(0.35)
                elif path == "/corrupt.jpg":
                    data = fixture.jpeg[:4500]
                elif path == "/html.jpg":
                    mime = "text/html"
                elif path == "/tiny.jpg":
                    data = b"too short"
                elif path == "/small.png":
                    mime, data = "image/png", fixture.small
                try:
                    self.send_response(status)
                    self.send_header("Content-Type", mime)
                    self.send_header("Content-Length", str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
                except (BrokenPipeError, ConnectionResetError):
                    pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = Thread(target=self.server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.origin = f"http://127.0.0.1:{self.server.server_port}"

    def verify(self, directory, cards):
        request = {"schema_version": 1, "cards": [
            {"id": name, "items": [{"key": product, "product_url": f"{self.origin}/product/{product}"}
                                  for product in products]}
            for name, products in cards
        ]}
        raw = json.dumps(request).encode()
        result = preflight(raw, "test-request", directory,
                           LocalHTTP(timeout=0.2, pause=self.retry_delays.append), {"127.0.0.1"})
        self.assertEqual(result["request_sha256"], sha(raw))
        return result["cards"]

    def test_real_http_errors_retries_and_independent_cards(self):
        with TemporaryDirectory() as tmp:
            good, bad = self.verify(Path(tmp), [
                ("good", ["blocked", "recover", "corrupt"]),
                ("bad", ["gone", "slow", "metadata"]),
            ])
            self.assertEqual(good["status"], "verified")
            self.assertEqual(bad["status"], "needs_replacements")
            for row in good["items"]:
                result = row["photo"]
                self.assertEqual(result["http_status"], 200)
                self.assertEqual((result["width"], result["height"]), (320, 400))
                saved = Path(tmp) / MODA_PHOTOS / (result["sha256"] + ".jpg")
                self.assertEqual(sha(saved.read_bytes()), result["sha256"])
            blocked, recovered, corrupt = good["items"]
            self.assertEqual(blocked["failures"][0]["code"], "http_403")
            self.assertTrue(blocked["photo"]["source_url"].endswith("/fallback.jpg"))
            self.assertEqual(recovered["photo"]["attempts"], 2)
            self.assertEqual(corrupt["failures"][0]["code"], "decode")
            self.assertTrue(corrupt["photo"]["source_url"].endswith("/second.jpg"))
            gone, slow, metadata = bad["items"]
            self.assertEqual(gone["failures"][0]["code"], "http_404")
            self.assertEqual(slow["failures"][0]["code"], "timeout")
            self.assertEqual(slow["failures"][0]["attempts"], 3)
            self.assertEqual([error["code"] for error in metadata["failures"]],
                             ["content_type", "size", "resolution"])
            self.assertEqual(self.calls["/forbidden.jpg"], 1)
            self.assertEqual(self.calls["/missing.jpg"], 1)
            self.assertEqual(self.calls["/slow.jpg"], 3)
            self.assertEqual(self.calls["/recommendations.jpg"], 0)
            self.assertEqual(self.referers["/fallback.jpg"], self.origin + "/product/blocked")
            self.assertCountEqual(self.retry_delays, [1, 1, 2])

    def test_verified_copy_renders_and_reaches_catalog_after_origin_404(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            good, bad = self.verify(root, [("ready-card", ["blocked", "corrupt"]), ("failed-card", ["gone"])])
            (root / "state").mkdir()
            (root / "state/state.json").write_text('{"drafts":{}}')

            def draft(card):
                return {
                    "id": card["id"], "type": "picks", "text": "Integration",
                    "items": [
                        {"name": row["key"], "shop": "Fixture", "price": 100, "url": row["product_url"],
                         "img": row["photo"]["img"], "image_preflight": "test-request"}
                        for row in card["items"] if row["status"] == "verified"
                    ],
                }

            for card in (good, bad):
                payload = draft(card)
                for item in payload["items"]:
                    item["url"] = item["url"].replace("http://", "https://")
                (root / "drafts" / (card["id"] + ".json")).write_text(json.dumps(payload))
            receipt = root / "moda/results/test-request.json"
            receipt.write_text(receipt.read_text().replace("http://", "https://"))

            self.offline = True
            with self.assertRaisesRegex(ValueError, "HTTP 404"):
                LocalHTTP().get(self.origin + "/fallback.jpg")
            calls = self.calls.copy()
            target = root / "miniapp/catalog.json"
            with patch.object(renderer, "ROOT", root), patch.object(catalog, "ROOT", root), patch.object(catalog, "TARGET", target):
                collage = renderer.run("ready-card", root / "drafts/img")
                catalog.main()
                rows = {row["id"]: row for row in json.loads(target.read_text())["items"]}
                self.assertTrue(rows["ready-card"]["ready"])
                self.assertEqual(rows["ready-card"]["media_sha256"], sha(collage.read_bytes()))
                self.assertFalse(rows["failed-card"]["ready"])
                self.assertEqual(self.calls, calls)

                for photo in (root / MODA_PHOTOS).glob("*.jpg"):
                    photo.write_bytes(b"tampered")
                catalog.main()
                rows = {row["id"]: row for row in json.loads(target.read_text())["items"]}
                self.assertFalse(rows["ready-card"]["ready"])
