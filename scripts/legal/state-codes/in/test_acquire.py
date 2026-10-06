import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import acquire  # noqa: E402
import stage_blocker  # noqa: E402


class AcquireTests(unittest.TestCase):
    def test_plan_covers_37_titles(self):
        titles = [u for l, u, k in acquire.plan('2026') if k == 'pdf']
        self.assertEqual(len(titles), 37)
        self.assertEqual(titles[0], 'https://iga.in.gov/ic/2026/Title_1.pdf')
        self.assertEqual(titles[-1], 'https://iga.in.gov/ic/2026/Title_37.pdf')

    def test_classify(self):
        self.assertEqual(acquire.classify(b'%PDF-1.6 x', 'pdf'), 'pdf')
        self.assertEqual(acquire.classify(b'<html><div id="root"></div>', 'pdf'), 'spa-shell')
        self.assertEqual(acquire.classify(b'junk', 'pdf'), 'unexpected')
        self.assertEqual(
            acquire.classify(b'{"error":"403","message":"Unauthorized"}', 'api-denial'),
            'api-key-gate',
        )

    def test_blocker_probes_never_supply_key(self):
        probes = acquire.blocker_probes('2026')
        self.assertEqual(len(probes), 7)
        self.assertTrue(all('api-key' not in url for _, url, _, _ in probes))
        self.assertIn(('api-titles-no-key', 'https://api.iga.in.gov/2026/ic/titles',
                       'api-denial', (200, 401, 403)), probes)

    def test_raw_manifest_deduplicates_bodies_and_receipts(self):
        receipt = {
            'ok': True, 'stored_path': 'raw/aa/abc', 'sha256': 'abc', 'bytes': 3,
            'url': 'https://example.invalid/a', 'final_url': 'https://example.invalid/a',
            'status': 200, 'retrieved_at': '2026-10-06T00:00:00Z',
            'retrieval_method': 'direct',
        }
        entries = stage_blocker.raw_manifest([receipt, dict(receipt)])
        self.assertEqual(len(entries), 1)
        self.assertEqual(len(entries[0]['receipts']), 1)


if __name__ == '__main__':
    unittest.main()
