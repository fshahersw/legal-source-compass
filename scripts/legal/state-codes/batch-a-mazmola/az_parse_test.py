import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import az_parse as P  # noqa: E402

FX = pathlib.Path(__file__).resolve().parent / 'az_fixtures'


def read(name):
    return (FX / name).read_text(encoding='utf8')


class ArizonaParse(unittest.TestCase):
    def test_a_single_paragraph_section(self):
        pg = P.parse_section(read('1-101-simple.htm'), 'https://www.azleg.gov/ars/1/00101.htm')
        self.assertEqual((pg['num'], pg['title'], pg['heading']), ('1-101', '1', 'Designation and citation'))
        self.assertEqual(len(pg['body']), 1)
        rec = P.section_record(pg)
        self.assertTrue(rec['text'].startswith('The Arizona Revised Statutes adopted and enacted'))
        self.assertEqual((rec['heading'], rec['status_note']), ('Designation and citation', None))

    def test_a_multi_paragraph_section_keeps_every_printed_line(self):
        pg = P.parse_section(read('multi-line.htm'))
        self.assertGreaterEqual(len(pg['body']), 3)
        self.assertEqual(P.section_record(pg)['text'], '\n'.join(pg['body']))

    def test_a_section_number_that_does_not_belong_to_the_url_raises(self):
        with self.assertRaises(ValueError):
            P.parse_section(read('1-101-simple.htm'), 'https://www.azleg.gov/ars/3/00101.htm')

    def test_a_body_less_section_keeps_its_printed_words_as_text_and_status(self):
        html = '<html><body><p><font color=GREEN>9-901</font>. <font color=PURPLE><u>Repealed by laws 2001</u></font></p></body></html>'
        rec = P.section_record(P.parse_section(html, 'https://www.azleg.gov/ars/9/00901.htm'))
        self.assertEqual((rec['text'], rec['status_note'], rec['heading']), ('Repealed by laws 2001', 'Repealed by laws 2001', None))

    def test_a_page_with_no_paragraph_is_a_gap(self):
        with self.assertRaises(P.EmptySectionPage):
            P.parse_section('<html><body></body></html>', 'https://www.azleg.gov/ars/1/00999.htm')

    def test_title_listing_reads_chapter_article_and_every_hyphenated_section_link(self):
        listing = P.parse_detail(read('title-1-first-chapter.html'))
        self.assertTrue(listing)
        first = next(iter(listing.values()))
        self.assertTrue(first['chapter'][0] and first['article'][0] is not None)
        html = ('<a class="stat" href="/viewdocument/?docName=https://www.azleg.gov/ars/3/00109-01.htm">3-109.01</a>'
                '<a class="stat" href="/viewdocument/?docName=https://www.azleg.gov/ars/3/00109.htm">3-109</a>')
        self.assertEqual(P.listed_urls(html), ['https://www.azleg.gov/ars/3/00109-01.htm', 'https://www.azleg.gov/ars/3/00109.htm'])


if __name__ == '__main__':
    unittest.main()
