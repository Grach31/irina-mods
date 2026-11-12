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

    def test_fashion_articles_have_real_image_previews(self):
        data = json.loads((APP / "fashion-daily.json").read_text(encoding="utf-8"))
        self.assertGreaterEqual(len(data["items"]), 12)
        for item in data["items"]:
            self.assertTrue(item["image_url"].startswith("https://"), item["id"])
            self.assertTrue(item.get("source") and item.get("url"))
            self.assertTrue(item.get("article_sections"))
if __name__ == "__main__":
    unittest.main()
