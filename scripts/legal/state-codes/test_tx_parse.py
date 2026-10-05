import importlib.util
import pathlib
import unittest

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


if __name__ == '__main__':
    unittest.main()
