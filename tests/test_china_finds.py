import json
import math
import re
import unittest
from collections import Counter, defaultdict
from datetime import date, datetime
from pathlib import Path

CATALOG = Path("miniapp/china-finds.json")
CATEGORIES = {"Одежда", "Сумки", "Обувь", "Бижутерия"}
LEGACY_PHOTO = re.compile(r"https://basket-\d+\.(?:wbbasket\.ru|wb\.ru|wbstatic\.net)/[^\s]+")
GEO_PHOTO = re.compile(
    r"https://[a-z]{3}-basket-cdn-\d+\.geobasket\.ru/vol\d+/part\d+/"
    r"(?P<sku>\d+)/images/big/\d+\.webp(?:\?[^\s#]*)?"
)


class ChinaFindsContractTest(unittest.TestCase):
    def test_catalog_supports_complete_daily_editions(self):
        data = json.loads(CATALOG.read_text(encoding="utf-8"))
        self.assertEqual(data["schema_version"], 1)
        items = data["items"]
        self.assertIsInstance(items, list)
        if not items:
            self.assertIsNone(data["updated_at"])
            return

        self.assertTrue(data["updated_at"].endswith("Z"))
        datetime.fromisoformat(data["updated_at"])
        editions = defaultdict(Counter)
        ids = set()
        order = []
        for item in items:
            sku = item["wb_article"]
            self.assertRegex(sku, r"^\d{1,15}$")
            self.assertEqual(item["id"], f"wb-{sku}")
            self.assertNotIn(item["id"], ids)
            ids.add(item["id"])
            self.assertEqual(item["url"], f"https://www.wildberries.ru/catalog/{sku}/detail.aspx")
            self.assertIn(type(item["price"]), (int, float))
            self.assertTrue(math.isfinite(item["price"]) and item["price"] > 0)
            for field, limit in (("title", 160), ("description", 1200), ("stylist", 800)):
                self.assertTrue(item[field].strip() and len(item[field]) <= limit)
            day = date.fromisoformat(item["date"])
            self.assertEqual(day.isoformat(), item["date"])
            edition = item.get("edition", 1)
            self.assertIs(type(edition), int)
            self.assertGreaterEqual(edition, 1)
            order.append((day, edition))
            self.assertIn(item["category"], CATEGORIES)
            editions[(day, edition)][item["category"]] += 1
            photos = item["photos"]
            self.assertTrue(2 <= len(photos) <= 10)
            for photo in photos:
                url = photo["url"]
                geo = GEO_PHOTO.fullmatch(url)
                self.assertTrue(LEGACY_PHOTO.fullmatch(url) or (geo and geo["sku"] == sku))
                self.assertTrue(photo["alt"].strip())
            self.assertEqual(len(photos), len({photo["url"] for photo in photos}))
        self.assertEqual(order, sorted(order, reverse=True))
        for counts in editions.values():
            self.assertEqual(counts, Counter(dict.fromkeys(CATEGORIES, 2)))
