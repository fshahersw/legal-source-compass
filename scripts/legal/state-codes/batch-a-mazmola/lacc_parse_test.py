import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import lacc_parse as P  # noqa: E402

FX = pathlib.Path(__file__).resolve().parent / 'lacc_fixtures'


def load(name):
    return P.parse_page((FX / name).read_text(encoding='utf8'))


class CivilCodeParse(unittest.TestCase):
    def test_first_article_prints_its_headings_and_a_heading_continues_on_the_next_line(self):
        pg = load('cc-1.html')
        self.assertEqual(pg['path'], '1')
        self.assertEqual([h[:3] for h in pg['headers']], [['title', 1, 'Preliminary'], ['chapter', 3, '1']])
        self.assertEqual(pg['headers'][1][3], 'GENERAL PRINCIPLES')
        rec = P.article_record(pg)
        self.assertEqual(rec['heading'], 'Sources of law')
        self.assertEqual(rec['text'], 'The sources of law are legislation and custom.')
        self.assertTrue(rec['history'].startswith('Acts 1987, No. 124'))

    def test_a_later_article_prints_no_headings_and_carries_the_ones_in_force(self):
        state = P.apply_headers([], load('cc-1.html')['headers'])
        pg = load('cc-2.html')
        self.assertEqual(pg['headers'], [])
        self.assertEqual([s[0] for s in P.apply_headers(state, pg['headers'])], ['title', 'chapter'])

    def test_a_shallower_heading_drops_the_deeper_ones(self):
        state = [('book', 0, 'I', 'X'), ('title', 1, 'I', 'Y'), ('chapter', 3, '2', 'Z')]
        state = P.apply_headers(state, [['title', 1, 'II', 'W']])
        self.assertEqual([s[:3] for s in state], [('book', 0, 'I'), ('title', 1, 'II')])

    def test_a_repealed_article_keeps_its_printed_words_as_text_and_status(self):
        pg = load('cc-118-repealed.html')
        rec = P.article_record(pg)
        self.assertEqual(pg['path'], '118')
        self.assertEqual(rec['heading'], None)
        self.assertTrue(rec['text'].startswith('Repealed by Acts 2018'))
        self.assertEqual(rec['status_note'], rec['text'])

    def test_art_without_a_period_and_a_lettered_subsection_heading_parse(self):
        self.assertEqual(load('cc-681-no-period.html')['path'], '681')
        pg = load('cc-195-subsection.html')
        self.assertIn('subsection_group', [h[0] for h in pg['headers']])

    def test_a_section_sign_heading_is_a_heading_not_the_article_line(self):
        pg = load('cc-3192-sign-heading.html')
        self.assertEqual(pg['path'], '3192')
        self.assertEqual(pg['art_no'], '3192')
        self.assertEqual(pg['headers'], [['section_group', 4, '1', 'OF FUNERAL CHARGES']])
        self.assertEqual(P.article_record(pg)['heading'], 'Funeral charges, definition.')

    def test_a_section_sign_heading_ending_in_a_period_is_a_heading(self):
        pg = load('cc-3218-sign-heading-period.html')
        self.assertEqual(pg['path'], '3218')
        self.assertEqual(pg['headers'], [['section_group', 4, '1', 'OF THE PRIVILEGE OF THE LESSOR']])

    def test_a_mixed_case_subsection_heading_parses(self):
        pg = load('cc-3020-mixed-case-subsection.html')
        self.assertEqual([h[:3] for h in pg['headers']], [['subsection_group', 5, 'B']])
        self.assertEqual(pg['headers'][0][3], 'Relations Between the Principal and Third Persons')

    def test_code_of_civil_procedure_banner_and_multi_dot_labels(self):
        html = (FX / 'ccp-1-banner.html').read_text(encoding='utf8')
        pg = P.parse_page(html, 'CCP', 'LOUISIANA CODE OF CIVIL PROCEDURE')
        self.assertEqual(pg['path'], '1')
        self.assertEqual(pg['headers'][0][0], 'book')
        with self.assertRaises(ValueError):
            P.parse_page(html, 'CCP')
        two = P.parse_page((FX / 'ccp-74.3.1-two-dots.html').read_text(encoding='utf8'), 'CCP', 'LOUISIANA CODE OF CIVIL PROCEDURE')
        self.assertEqual(two['path'], '74.3.1')

    def test_a_page_with_no_printed_text_is_a_gap_not_a_failure(self):
        with self.assertRaises(P.EmptyArticlePage):
            P.parse_page((FX / 'ccp-1067-empty.html').read_text(encoding='utf8'), 'CCP', 'LOUISIANA CODE OF CIVIL PROCEDURE')

    def test_an_unplaced_line_raises(self):
        html = ('<span id="LabelName">CC 5</span><div id="LabelDocument"><p>stray words<br/>Art. 5. Ignorance of law</p>'
                '<p>Body.</p></div>')
        with self.assertRaises(ValueError):
            P.parse_page(html)


if __name__ == '__main__':
    unittest.main()
