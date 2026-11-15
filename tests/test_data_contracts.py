"""Delivery contracts only: no editorial scoring or live source checks."""
import json
import unittest
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
FIELDS = {
    'fashion-daily': ('id', 'title', 'date', 'region', 'source', 'url', 'summary', 'article_sections'),
    'reels-studio': ('id', 'title', 'category', 'format', 'duration', 'hook', 'script', 'shots', 'cta'),
    'style-time-machine': ('id', 'title', 'year', 'period', 'description', 'then', 'now', 'category', 'source_url', 'photos'),
    'trend-radar': ('id', 'title', 'category', 'status', 'summary', 'stylist', 'evidence', 'sources', 'added_at', 'updated_at', 'last_checked_at', 'image_url', 'image_alt', 'image_source_url', 'image_credit', 'image_license'),
}


class DataContractTests(unittest.TestCase):
    def required(self, obj, fields):
        self.assertIsInstance(obj, dict)
        for field in fields:
            self.assertIn(field, obj)
            self.assertTrue(obj[field] is not None and obj[field] != '' and obj[field] != [], field)

    def records(self, data, fields):
        self.required(data, ('updated_at',))
        self.assertIsInstance(data['items'], list)
        ids = []
        for item in data['items']:
            self.required(item, fields)
            self.assertIsInstance(item['id'], str)
            ids.append(item['id'])
        self.assertEqual(len(ids), len(set(ids)), 'duplicate IDs')

    def local_images(self, obj, base):
        """Check referenced local files, not remote availability or licensing policy."""
        if isinstance(obj, list):
            for value in obj:
                self.local_images(value, base)
        elif isinstance(obj, dict):
            for key, value in obj.items():
                if key in ('image', 'image_url', 'img', 'cover', 'url') and isinstance(value, str):
                    url = urlsplit(value)
                    if not url.scheme and not url.netloc and url.path.lower().endswith(('.jpg', '.jpeg', '.png', '.webp', '.svg', '.gif', '.avif')):
                        path = (base / unquote(url.path)).resolve()
                        self.assertTrue(path.is_relative_to(ROOT), value)
                        self.assertTrue(path.is_file(), value)
                        self.assertGreater(path.stat().st_size, 0, value)
                self.local_images(value, base)

    def test_editorial_files_and_archive(self):
        files = [(ROOT / 'miniapp' / f'{name}.json', name) for name in FIELDS]
        files += [(p, 'fashion-daily') for p in (ROOT / 'miniapp/fashion-archive').glob('*.json')]
        for path, name in files:
            with self.subTest(path=path):
                data = json.loads(path.read_text())
                self.records(data, FIELDS[name])
                # Legacy Fashion records use date when published_at is absent.
                if name == 'fashion-daily':
                    self.required(data, ('edition_date',))
                if name == 'trend-radar':
                    self.required(data, ('period_label', 'intro'))
                self.local_images(data, ROOT / 'miniapp')
                for item in data['items']:
                    if name == 'style-time-machine':
                        self.assertIsInstance(item['photos'], list)
                        for photo in item['photos']:
                            self.required(photo, ('url', 'caption', 'credit', 'source_url'))
                    if name == 'trend-radar':
                        self.assertIsInstance(item['sources'], list)
                        for source in item['sources']:
                            self.required(source, ('title', 'url', 'date'))
                    if name == 'fashion-daily':
                        self.assertIn(item['region'], ('ru', 'world'))
                        self.assertIsInstance(item['article_sections'], list)
                    if name == 'reels-studio':
                        self.assertIsInstance(item['duration'], int)
                        self.assertIsInstance(item['script'], list)
                        self.assertIsInstance(item['shots'], list)

    def test_rejects_broken_delivery_contracts(self):
        for data in ({'updated_at': 'today', 'items': [{'id': 'x'}]},
                     {'updated_at': 'today', 'items': [{'id': 'x', 'title': 'A'}, {'id': 'x', 'title': 'B'}]}):
            with self.assertRaises(AssertionError):
                self.records(data, ('id', 'title'))
        with self.assertRaises(AssertionError):
            self.local_images({'image': 'images/missing-contract-test.jpg'}, ROOT / 'miniapp')
        # An absent optional Fashion photo is a supported text cover.
        self.local_images({'image': None, 'image_rights': 'no_external_image'}, ROOT / 'miniapp')

    def test_drafts(self):
        for path in (ROOT / 'drafts').glob('*.json'):
            with self.subTest(path=path):
                data = json.loads(path.read_text())
                self.required(data, ('id', 'type', 'text'))
                self.assertEqual(data['id'], path.stem)
                self.assertFalse(path.stem.startswith('.'))
                self.assertNotIn('\\', path.stem)
                self.local_images(data, ROOT)
                if data['type'] == 'picks':
                    self.required(data, ('items',))
                    self.assertIsInstance(data['items'], list)
                    for item in data['items']:
                        self.required(item, ('name', 'price', 'url', 'img', 'shop'))
                        self.assertIsInstance(item['price'], (int, float))
