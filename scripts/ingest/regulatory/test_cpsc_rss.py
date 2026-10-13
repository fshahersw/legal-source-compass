"""Synthetic fixtures only; never collected or published."""
import unittest
from cpsc_rss import parse_feed

GUID = 'https://www.cpsc.gov/_00000000-0000-4000-8000-000000000001'


def feed(item=None):
    item = item if item is not None else f'<item><title>SYNTHETIC RECALL</title><link>https://www.cpsc.gov/Recalls/2026/Synthetic</link><description>&lt;p&gt;Synthetic hazard &amp;amp; qualification.&lt;/p&gt;</description><pubDate>October 08, 2026</pubDate><guid>{GUID}</guid></item>'
    return f'<rss version="2.0"><channel><title>Recall List</title>{item}</channel></rss>'.encode()


class CpscRssTests(unittest.TestCase):
    def test_native_guid_literal_description_and_date(self):
        rows = parse_feed(feed())
        self.assertEqual(rows[0]['guid'], GUID)
        self.assertEqual(rows[0]['published_on'], '2026-10-08')
        self.assertEqual(rows[0]['description_html'], '<p>Synthetic hazard &amp; qualification.</p>')

    def test_external_entities_and_dtd_rejected(self):
        for prefix in [b'<!DOCTYPE rss>', b'<!ENTITY x SYSTEM "file:///secret">']:
            with self.assertRaises(ValueError):
                parse_feed(prefix + feed())

    def test_duplicate_missing_or_wrong_native_identity_rejected(self):
        for raw in [feed().replace(f'<guid>{GUID}</guid>'.encode(), b''),
                    feed().replace(GUID.encode(), b'https://example.com/_x'),
                    feed().replace(b'</item>', f'<guid>{GUID}</guid></item>'.encode())]:
            with self.assertRaises(ValueError):
                parse_feed(raw)

    def test_empty_error_html_and_wrong_channel_fail(self):
        for raw in [feed(''), b'<html><body>Error</body></html>', feed().replace(b'Recall List', b'Error')]:
            with self.assertRaises(ValueError):
                parse_feed(raw)

    def test_impossible_dates_and_duplicate_items_fail(self):
        raw = feed()
        item = raw[raw.index(b'<item>'):raw.index(b'</item>') + 7]
        for data in [raw.replace(b'October 08', b'February 30'), feed((item + item).decode())]:
            with self.assertRaises(ValueError):
                parse_feed(data)


if __name__ == '__main__':
    unittest.main()
