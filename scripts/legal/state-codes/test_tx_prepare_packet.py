import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location('packet', pathlib.Path(__file__).with_name('tx-prepare-packet.py'))
packet = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packet)


class PublisherPacketTest(unittest.TestCase):
    def fixture(self, member='cp.16.htm'):
        text = 'Publisher note 🏛\nSec. 16.003. TWO YEARS. Operative body.'
        start = text.index('Sec.')
        chapter = {'id': 'CP:' + member, 'code': 'CP', 'publisher_member': member,
            'text_sha256': packet.sha(text.encode()), 'archive_sha256': 'a' * 64,
            'raw_member_sha256': 'b' * 64, 'archive_source_url': 'https://tcss.legis.texas.gov/resources/Zips/CP.htm.zip',
            'retrieved_at': '2026-10-05T15:00:00Z', 'parser': 'texas-publisher-html/5',
            'publisher_filename_legacy_hint': 'old' in member}
        section = {'id': chapter['id'] + ':16.003:1', 'chapter_id': chapter['id'],
            'native_section_anchor': '16.003', 'native_citation_key': 'CP:16.003', 'occurrence': 1,
            'citation_heading': 'Sec. 16.003. TWO YEARS.', 'source_url': None,
            'identity_evidence': 'preceding_named_anchor', 'anchor_whitespace_anomaly': False,
            'hierarchy': {}, 'text_start': start, 'text_end': len(text),
            'text_sha256': packet.sha(text[start:].encode()), 'chapter_text_sha256': chapter['text_sha256'],
            'archive_sha256': chapter['archive_sha256'], 'raw_member_sha256': chapter['raw_member_sha256'],
            'following_context_start': None}
        return section, chapter, text

    def test_unicode_span_unit_is_explicit_and_source_observation_is_separate(self):
        section, chapter, text = self.fixture()
        row = packet.section_record(section, chapter, text)
        self.assertEqual(row['data']['text_span']['unit'], 'unicode_code_points')
        self.assertEqual(row['data']['text_span']['start'], text.index('Sec.'))
        self.assertIsNone(row['data']['publisher_section_url'])
        self.assertEqual(row['provenance']['source_url'], chapter['archive_source_url'])
        self.assertEqual(row['provenance']['record_sha256'], packet.sha(packet.canonical(row['data'])))

    def test_same_citation_in_older_file_keeps_distinct_identity_and_gates(self):
        a = packet.section_record(*self.fixture())
        b = packet.section_record(*self.fixture('cp.16-old.htm'))
        self.assertEqual(a['data']['native_citation_key'], b['data']['native_citation_key'])
        self.assertNotEqual(a['native_id'], b['native_id'])
        self.assertTrue(b['data']['publisher_filename_legacy_hint'])
        for row in [a, b]:
            for gate in ['public_projection_allowed', 'current_law_verified', 'calculation_activation_allowed']:
                self.assertFalse(row['data'][gate])

    def test_changed_source_text_hash_or_identity_fails(self):
        for mutation in ['text', 'raw_member_sha256', 'native_citation_key', 'occurrence']:
            section, chapter, text = self.fixture()
            if mutation == 'text':
                text = text.replace('Operative', 'Changed')
            elif mutation == 'occurrence':
                section[mutation] = 0
            else:
                section[mutation] = 'changed'
            with self.assertRaises(ValueError):
                packet.section_record(section, chapter, text)

    def test_canonical_codec_rejects_lossy_or_unsupported_values(self):
        for value in [1.5, 9007199254740992, '\x00', '\ud800', {'é': 'value'}]:
            with self.assertRaises(ValueError):
                packet.canonical(value)

    def test_subdivision_labels_are_bound_to_the_parent_text(self):
        section, chapter, text = self.fixture()
        start = text.index('Operative')
        section['subdivisions'] = [{'label': 'Operative', 'text_start': start, 'text_end': start + 9,
                                    'source_element_ordinal': 1}]
        row = packet.section_record(section, chapter, text)
        self.assertEqual(row['data']['subdivision_span_unit'], 'unicode_code_points')
        self.assertEqual(row['data']['subdivisions'], section['subdivisions'])
        section['subdivisions'][0]['text_end'] += 1
        with self.assertRaisesRegex(ValueError, 'Subdivision outside'):
            packet.section_record(section, chapter, text)


if __name__ == '__main__':
    unittest.main()
