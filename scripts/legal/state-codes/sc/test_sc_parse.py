import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).parent))

import sc_audit
import sc_parse


def page(body):
    return '<div id="contentsection">%s</div><!-- mainwidepanel' % body


class SouthCarolinaParserTests(unittest.TestCase):
    def test_body_history_status_and_exact_span(self):
        raw = page(
            '<div style="font-weight: bold; text-align: center;">Title 1 - ADMINISTRATION</div>'
            '<div style="text-align: center;">CHAPTER 1</div>'
            '<div style="text-align: center;">General Provisions</div>'
            '<span style="font-weight: bold;"> SECTION 1-1-10.</span> Reserved.<br />'
            'Reserved for future use.<br />'
            'HISTORY: 2025 Act No. 1, SECTION 2, eff January 1, 2026.<br />'
            "Editor's Note<br />A note."
        )
        text, header, sections = sc_parse.parse_chapter(raw)
        section = sections[0]
        self.assertEqual(header['title']['number'], '1')
        self.assertEqual(header['chapter']['number'], '1')
        self.assertEqual(section['number'], '1-1-10')
        self.assertEqual(section['history'], ['HISTORY: 2025 Act No. 1, SECTION 2, eff January 1, 2026.'])
        self.assertEqual(text[section['body_start']:section['body_end']], 'Reserved for future use.')
        self.assertEqual(sc_parse.status_of(section['heading'], section['body']), 'Reserved')
        self.assertEqual(sc_parse.effective_of(section['history']), 'eff January 1, 2026')

    def test_table_is_preserved_in_body_span(self):
        raw = page(
            '<div style="font-weight: bold; text-align: center;">Title 2 - TEST</div>'
            '<div style="text-align: center;">CHAPTER 3</div><div style="text-align: center;">Tables</div>'
            '<span style="font-weight: bold;"> SECTION 2-3-4.</span> Form.<br />'
            '<table><tr><td>Left</td><td>Right</td></tr></table>'
            'HISTORY: 2020 Act No. 2.'
        )
        text, _, sections = sc_parse.parse_chapter(raw)
        section = sections[0]
        self.assertEqual(text[section['body_start']:section['body_end']], 'Left\tRight')

    def test_compact_roman_articles_remain_inside_section(self):
        raw = page(
            '<div style="font-weight: bold; text-align: center;">Title 3 - TEST</div>'
            '<div style="text-align: center;">CHAPTER 1</div><div style="text-align: center;">Compacts</div>'
            '<span style="font-weight: bold;"> SECTION 3-1-1.</span> Compact.<br />'
            'Opening.<div style="text-align: center;">ARTICLE I</div>'
            '<div style="text-align: center;">Purpose</div>Closing.<br />'
            '<span style="font-weight: bold;"> SECTION 3-1-2.</span> Next.<br />Next body.'
        )
        text, _, sections = sc_parse.parse_chapter(raw)
        self.assertEqual(len(sections), 2)
        first = text[sections[0]['body_start']:sections[0]['body_end']]
        self.assertIn('ARTICLE I\nPurpose\nClosing.', first)
        self.assertEqual(sections[1]['path'][-1]['level'], 'chapter')

    def test_independent_normalization_matches_publisher_variants(self):
        left = 'Title 29 - TEST\nHISTORY: 1962 Code SECTIONS 1 and 2; SECTION 3.'
        right = 'HISTORY: 1962 Code §§ 1 and 2; § 3.'
        result = sc_audit.compare_texts(left, right, 'Title 29 - TEST')
        self.assertTrue(result['matched'])


if __name__ == '__main__':
    unittest.main()
