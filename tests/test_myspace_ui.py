import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "miniapp"

class MySpaceReleaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.html = (APP / "index.html").read_text(encoding="utf-8")

    def test_approved_images_are_bundled_and_nontrivial(self):
        for name in ("moda-cover", "oura-cover", "fashion-cover", "oura-banner"):
            with self.subTest(name=name):
                svg = (APP / "assets" / f"{name}.svg").read_text(encoding="utf-8")
                self.assertIn("data:image/webp;base64,", svg)
                self.assertGreater(len(svg), 6000)
                self.assertIn(f"assets/{name}.svg", self.html)

    def test_all_six_sections_present(self):
        for id_ in ("openModa", "openOura", "openFashion", "openReels", "openTrends", "openHistory"):
            self.assertIn(f'id="{id_}"', self.html)
        for id_ in ("settingsSpace", "reelsSpace", "trendsSpace", "historySpace"):
            self.assertIn(f'id="{id_}"', self.html)

    def test_editorial_sections_refresh_when_opened(self):
        self.assertIn("if(space==='fashion')loadFashion(true);", self.html)
        self.assertIn("loadMySpaceEditorial(space,true);", self.html)
        self.assertIn("async function loadFashion(force=false)", self.html)

    def test_saved_owner_session_is_restored(self):
        self.assertIn("await client.auth.getSession()", self.html)
        self.assertIn("await activatePasswordSession()", self.html)

    def test_login_gate_does_not_flash_during_session_restore(self):
        self.assertIn('id="pwaBoot"', self.html)
        self.assertIn('class="pwa-gate hidden" id="pwaGate" style="display:none"', self.html)
        self.assertIn("restored=await activatePasswordSession();", self.html)
        self.assertIn("if(!restored)showPwaGate(true);", self.html)
        self.assertIn("document", self.html)
        self.assertIn("$('pwaBoot').classList.add('hidden');", self.html)
        self.assertNotIn("showPwaGate(true);\n try{", self.html)

    def test_obsolete_login_options_removed(self):
        self.assertIn("signInWithPassword", self.html)
        self.assertIn("myspace.auth.v1", self.html)
        self.assertNotIn("registerPasskey", self.html)
        self.assertNotIn("signInWithPasskey", self.html)
        self.assertNotIn("experimental:{passkey:true}", self.html)
        self.assertNotIn('id="passkeyEnroll"', self.html)
        self.assertNotIn('id="pwaPairBtn"', self.html)
        self.assertNotIn('id="loginKeyBtn"', self.html)
        self.assertNotIn('id="independentEnroll"', self.html)
        self.assertNotIn("Face ID", self.html)

    def test_settings_and_gestures_present(self):
        self.assertIn("myspace.theme.v1", self.html)
        self.assertIn("prefers-color-scheme: dark", self.html)
        self.assertIn("msGoBack()", self.html)
        self.assertIn("msRefreshCurrent()", self.html)
        self.assertIn('id="pullIndicator"', self.html)
        self.assertNotIn("TELEGRAM + SAFARI", self.html)

    def test_editorial_json_is_structured(self):
        for name, min_count in (("reels-studio", 3), ("trend-radar", 3), ("style-time-machine", 5)):
            with self.subTest(name=name):
                data = json.loads((APP / f"{name}.json").read_text(encoding="utf-8"))
                self.assertGreaterEqual(len(data["items"]), min_count)
                self.assertTrue(all(item.get("title") for item in data["items"]))

    def test_new_covers_are_exact_bundled_artwork(self):
        for name in ("reels", "trends", "history"):
            with self.subTest(name=name):
                svg = (APP / "assets" / f"{name}-approved.svg").read_text(encoding="utf-8")
                self.assertIn("data:image/webp;base64,", svg)
                self.assertGreater(len(svg), 10000)
                self.assertIn(f'assets/{name}-approved.svg', self.html)

    def test_moda_has_only_one_hub_navigation_button(self):
        self.assertIn('id="modaBack"', self.html)
        self.assertNotIn("const hubBtn=document.createElement('button')", self.html)
        self.assertIn('id="galleryPrev"', self.html)
        self.assertIn('id="galleryNext"', self.html)
        self.assertIn('id="galleryDots"', self.html)
        self.assertIn("setupGalleryControls(galleryImages.length)", self.html)

    def test_edge_back_and_deliberate_refresh_gestures(self):
        self.assertIn("const edgeBack=(g.fromRight&&dx< -85)||(g.fromLeft&&dx>85)", self.html)
        self.assertIn("msGoBack();return;", self.html)
        self.assertIn("Date.now()-msLastScrollAt>550", self.html)
        self.assertIn("dy>=175", self.html)
        self.assertIn("duration>=280", self.html)
        self.assertIn("touchcancel", self.html)
        self.assertNotIn("if(start.nearTop&&dy>105", self.html)

    def test_historical_cards_have_photo_and_source_attribution(self):
        data = json.loads((APP / "style-time-machine.json").read_text(encoding="utf-8"))
        self.assertGreaterEqual(len(data["items"]), 5)
        for item in data["items"]:
            self.assertTrue(isinstance(item.get("photos"), list) and len(item["photos"]) >= 1, item["title"])
            for photo in item["photos"]:
                self.assertTrue(photo.get("caption"), item["title"])
                self.assertTrue(photo.get("credit"), item["title"])
                self.assertTrue(photo["url"].startswith("https://"), item["title"])
                self.assertTrue(photo["source_url"].startswith("https://"), item["title"])
        self.assertIn("msHistoryFigure(", self.html)

    def test_fashion_articles_have_real_image_previews(self):
        data = json.loads((APP / "fashion-daily.json").read_text(encoding="utf-8"))
        self.assertGreaterEqual(len(data["items"]), 12)
        for item in data["items"]:
            self.assertTrue((isinstance(item.get("image_url"), str) and item["image_url"].startswith("https://")) or (item.get("image_url") is None and item.get("image_rights") == "no_external_image"), item["id"])
            self.assertTrue(item.get("source") and item.get("url"))
            self.assertTrue(item.get("article_sections"))
if __name__ == "__main__":
    unittest.main()
