import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "miniapp"

class MySpaceReleaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.html = (APP / "index.html").read_text(encoding="utf-8")

    def test_editorial_covers_are_bundled_webp(self):
        for name in ("moda", "finds", "oura", "fashion", "trends", "reels", "history"):
            with self.subTest(name=name):
                path = APP / "assets" / "editorial" / f"{name}.webp"
                image = path.read_bytes()
                self.assertEqual(image[8:12], b"WEBP")
                self.assertGreater(len(image), 5000)
                self.assertIn(f"assets/editorial/{name}.webp", self.html)

    def test_all_seven_sections_present(self):
        for id_ in ("openModa", "openFinds", "openOura", "openFashion", "openReels", "openTrends", "openHistory"):
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
        self.assertIn("$('pwaBoot').classList.add('hidden');", self.html)
        self.assertIn("if(!restored)showPwaGate(true);", self.html)

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

    def test_moda_keeps_older_drafts_visible(self):
        """Unpublished drafts must not disappear at midnight."""
        builder = (ROOT / "scripts" / "build_miniapp_catalog.py").read_text(encoding="utf-8")
        self.assertNotIn("did.startswith(today", builder)
        self.assertNotIn("meta.get('status') != 'published' and", builder)
        for name in ("2026-11-13-allweneed-evening-edit",
                     "2026-11-13-mix-contrast-details",
                     "2026-11-13-myspace-panel-test"):
            self.assertTrue((ROOT / "drafts" / (name + ".json")).is_file(), name)

    def test_fashion_daily_has_no_publisher_allowlist(self):
        """Publisher domains must not silently hide editorial news."""
        data = json.loads((APP / "fashion-daily.json").read_text(encoding="utf-8"))
        self.assertTrue(data["items"])
        start = self.html.index("const fashionSafeUrl=value=>{")
        end = self.html.index("const fashionArt=", start)
        validator = self.html[start:end]
        self.assertIn("u.protocol==='https:'", validator)
        self.assertNotIn("vogue\\.com", validator)
        self.assertNotIn("posta-magazine\\.ru", validator)
        self.assertNotIn("elle\\.com", validator)
        self.assertNotIn("test(u.hostname)", validator)

    def test_moda_has_only_one_hub_navigation_button(self):
        self.assertIn('id="modaBack"', self.html)
        self.assertNotIn("const hubBtn=document.createElement('button')", self.html)
        self.assertIn('id="galleryPrev"', self.html)
        self.assertIn('id="galleryNext"', self.html)
        self.assertIn('id="galleryDots"', self.html)
        self.assertIn("setupGalleryControls(galleryImages.length)", self.html)

    def test_shared_gesture_controller_is_deployed(self):
        self.assertIn('src="gestures.js?', self.html)
        self.assertTrue((APP / 'gestures.js').is_file())

    def test_moderation_buttons_for_queued_drafts(self):
        self.assertIn("const reviewable=['queued','sent','awaiting_edit','edit_requested','failed'].includes(d.meta.status)", self.html)
        self.assertIn("reviewable&&!readonly&&pwaSession&&!isTestDraft", self.html)
        self.assertIn("['Опубликовать','ok','']", self.html)
        self.assertIn("['Отклонить','no','secondary']", self.html)
        self.assertIn("Технический тест · не публиковать", self.html)
        self.assertIn("Ожидает одобрения", self.html)

    def test_trend_radar_native_layout(self):
        self.assertIn('id="trendsSpace"', self.html)
        self.assertIn("function renderTrendRadar(data)", self.html)
        self.assertIn("if(type==='trends'){renderTrendRadar(data);return}", self.html)
        self.assertIn("trendCategories=['Все','Цвета','Фактуры'", self.html)
        self.assertIn("trend-feature", self.html)
        self.assertIn("trend-grid", self.html)
        self.assertIn("image_url||item.photo?.url", self.html)
        self.assertIn("trendPhotoCredit(item)", self.html)
        self.assertIn("img.onerror=()=>card.classList.add('hidden')", self.html)
    def test_historical_photo_renderer_present(self):
        self.assertIn("msHistoryFigure(", self.html)

if __name__ == "__main__":
    unittest.main()
