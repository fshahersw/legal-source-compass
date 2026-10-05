import importlib.util
import pathlib
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('tx_parse', pathlib.Path(__file__).with_name('tx-parse.py'))
parser = importlib.util.module_from_spec(spec)
spec.loader.exec_module(parser)


def chapter(body):
    return ('<html><body><pre>' + body + '</pre></body></html>').encode('utf8')


def heading(anchor, caption):
    return f'<p><a href="https://statutes.capitol.texas.gov/Docs/CP/htm/CP.16.htm#{anchor}">Sec. {anchor}. {caption}</a> (a) Operative body.</p>'


class TexasParserTest(unittest.TestCase):
    def test_repeated_citations_are_distinct_occurrences_with_text_spans(self):
        text, _, rows = parser.parse_chapter(chapter(heading('16.003', 'FIRST.') + '<p>Version one.</p>' + heading('16.003', 'SECOND.') + '<p>Version two.</p>'), 'CP', 'cp.16.htm')
        self.assertEqual([r['occurrence'] for r in rows], [1, 2])
        self.assertIn('Version one.', text[rows[0]['text_start']:rows[0]['text_end']])
        self.assertNotIn('Version two.', text[rows[0]['text_start']:rows[0]['text_end']])
        for row in rows:
            self.assertEqual(row['text_sha256'], parser.sha(text[row['text_start']:row['text_end']].encode('utf8')))

    def test_single_paragraph_body_and_non_ascii_survive(self):
        text, _, rows = parser.parse_chapter(chapter(heading('16.003', 'CLAIM—INJURY.')), 'CP', 'cp.16.htm')
        self.assertIn('Operative body.', text[rows[0]['text_start']:rows[0]['text_end']])
        self.assertIn('—', rows[0]['citation_heading'])

    def test_publisher_notice_is_preserved_outside_previous_section(self):
        raw = chapter(heading('16.003', 'FIRST.') + '<p>Text of section effective before January 1, 2030.</p>' + heading('16.004', 'SECOND.'))
        text, blocks, rows = parser.parse_chapter(raw, 'CP', 'cp.16.htm')
        self.assertIn('effective before', text)
        self.assertNotIn('effective before', text[rows[0]['text_start']:rows[0]['text_end']])
        self.assertEqual(blocks[1]['kind'], 'publisher_note')

    def test_parent_transition_clears_child_hierarchy(self):
        raw = chapter('<p class="center">CHAPTER 16. LIMITATIONS</p><p class="center">SUBCHAPTER A. FIRST</p>' + heading('16.001', 'FIRST.') + '<p class="center">CHAPTER 17. NEXT</p>' + heading('17.001', 'NEXT.'))
        _, _, rows = parser.parse_chapter(raw, 'CP', 'cp.16.htm')
        self.assertIn('SUBCHAPTER', rows[0]['hierarchy'])
        self.assertNotIn('SUBCHAPTER', rows[1]['hierarchy'])

    def test_toc_and_cross_references_do_not_create_sections(self):
        raw = chapter('<p>16.003 Two years.</p><p>See <a href="https://statutes.capitol.texas.gov/Docs/CP/htm/CP.16.htm#16.003">Sec. 16.003.</a></p>' + heading('16.003', 'TWO YEARS.'))
        _, _, rows = parser.parse_chapter(raw, 'CP', 'cp.16.htm')
        self.assertEqual(len(rows), 1)

    def test_non_chapter_response_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'publisher chapter'):
            parser.parse_chapter(b'<html><body>Site unavailable</body></html>', 'CP', 'cp.16.htm')
        with self.assertRaises(UnicodeDecodeError):
            parser.parse_chapter(chapter('valid') + b'\xff', 'CP', 'cp.16.htm')

    def test_named_anchor_and_plain_heading_retain_exact_identity_and_body(self):
        raw = chapter('<p><a name="254.001"></a><a name="132929.120935"></a></p>'
                      '<p>Sec. 254.001. DEVISES TO TRUSTEES. (a) A testator may devise property.</p>'
                      '<p>Added by Acts 2009.</p>')
        text, _, rows = parser.parse_chapter(raw, 'ES', 'es.254.v2.htm')
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['native_section_anchor'], '254.001')
        self.assertEqual(rows[0]['identity_evidence'], 'preceding_named_anchor')
        self.assertEqual(rows[0]['anchor_element_ordinal'], 0)
        self.assertIsNone(rows[0]['source_url'])
        self.assertIn('A testator may devise property.', text[rows[0]['text_start']:rows[0]['text_end']])

    def test_plain_heading_requires_matching_adjacent_source_anchor(self):
        for body in [
            '<p><a name="254.002"></a></p><p>Sec. 254.001. WRONG ANCHOR.</p>',
            '<p><a name="254.001"></a></p><p>Intervening text</p><p>Sec. 254.001. UNBOUND.</p>',
            '<p>Sec. 254.001. NO ANCHOR.</p>',
        ]:
            _, _, rows = parser.parse_chapter(chapter(body), 'ES', 'es.254.v2.htm')
            self.assertEqual(rows, [])

    def test_amendment_notice_between_named_anchor_and_heading_is_retained(self):
        raw = chapter('<p><a name="51.217"></a><a name="127385.115526"></a></p>'
                      '<p class="center">The following section was amended by the 89th Legislature. Pending publication, see H.B. 33.</p>'
                      '<br/><p>Sec. 51.217. EMERGENCY OPERATIONS PLAN. (a) Operative body.</p>')
        text, blocks, rows = parser.parse_chapter(raw, 'ED', 'ed.51-old.htm')
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['native_section_anchor'], '51.217')
        self.assertEqual(rows[0]['anchor_element_ordinal'], 0)
        self.assertEqual(blocks[0]['kind'], 'publisher_note')
        self.assertIn('Pending publication', text)
        self.assertNotIn('Pending publication', text[rows[0]['text_start']:rows[0]['text_end']])

    def test_unmapped_pre_text_is_rejected_instead_of_dropped(self):
        for body in ['Orphan text<p>A paragraph</p>', '<p>A paragraph</p>Orphan tail']:
            with self.assertRaisesRegex(ValueError, 'Unmapped text'):
                parser.parse_chapter(chapter(body), 'ES', 'es.254.v2.htm')

    def test_reviewed_embedded_articles_extend_parent_without_leaking_hierarchy(self):
        raw = chapter(heading('16.003', 'COMPACT.') + '<p class="center">ARTICLE I</p>'
                      '<p>First compact clause.</p><p class="center">ARTICLE II</p>'
                      '<p>Last compact clause.</p>' + heading('16.004', 'NEXT.'))
        evidence = [{'code': 'CP', 'member': 'cp.16.htm', 'native_anchor': '16.003',
                     'raw_member_sha256': parser.sha(raw), 'article_headings': 2}]
        with patch.object(parser, 'REVIEWED_SUBDIVISIONS', evidence):
            text, blocks, rows = parser.parse_chapter(raw, 'CP', 'cp.16.htm')
        self.assertIn('Last compact clause.', text[rows[0]['text_start']:rows[0]['text_end']])
        self.assertNotIn('NEXT.', text[rows[0]['text_start']:rows[0]['text_end']])
        self.assertEqual([s['label'] for s in rows[0]['subdivisions']], ['ARTICLE I', 'ARTICLE II'])
        self.assertNotIn('ARTICLE', rows[1]['hierarchy'])
        self.assertEqual(sum(b['kind'] == 'subdivision_heading' for b in blocks), 2)

    def test_outer_article_or_changed_source_is_never_assumed_embedded(self):
        raw = chapter(heading('16.003', 'FIRST.') + '<p class="center">ARTICLE II</p>'
                      '<p>Outer text.</p>' + heading('16.004', 'NEXT.'))
        for evidence in [[], [{'code': 'CP', 'member': 'cp.16.htm', 'native_anchor': '16.003',
                              'raw_member_sha256': '0' * 64, 'article_headings': 1}]]:
            with patch.object(parser, 'REVIEWED_SUBDIVISIONS', evidence):
                text, _, rows = parser.parse_chapter(raw, 'CP', 'cp.16.htm')
            self.assertNotIn('Outer text.', text[rows[0]['text_start']:rows[0]['text_end']])
            self.assertEqual(rows[1]['hierarchy']['ARTICLE'], 'ARTICLE II')

    def test_reviewed_article_count_must_match_the_bound_source(self):
        raw = chapter(heading('16.003', 'COMPACT.') + '<p class="center">ARTICLE I</p>')
        evidence = [{'code': 'CP', 'member': 'cp.16.htm', 'native_anchor': '16.003',
                     'raw_member_sha256': parser.sha(raw), 'article_headings': 2}]
        with patch.object(parser, 'REVIEWED_SUBDIVISIONS', evidence):
            with self.assertRaisesRegex(ValueError, 'subdivision count mismatch'):
                parser.parse_chapter(raw, 'CP', 'cp.16.htm')


if __name__ == '__main__':
    unittest.main()
