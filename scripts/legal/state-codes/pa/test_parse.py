import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import parse  # noqa: E402

FIX = pathlib.Path(__file__).resolve().parent / 'fixtures'


def load(name):
    return (FIX / name).read_text(encoding='utf8')


class Title1Excerpt(unittest.TestCase):
    def setUp(self):
        self.parsed = parse.parse_title(load('title-01-excerpt.html'), '01')
        self.text = parse.unit_text(self.parsed)
        self.offsets = parse.line_offsets(self.parsed['lines'])

    def test_sections_and_metadata(self):
        sections = self.parsed['sections']
        self.assertEqual([s['number'] for s in sections], ['101', '102', '103'])
        self.assertEqual(sections[0]['heading'], 'Short title.')
        self.assertEqual(self.parsed['revised'], '<meta name="revised" content="2024-09-13 01:13:54 PM">')
        self.assertEqual(self.parsed['anomalies'], [])

    def test_history_only_when_printed(self):
        sections = self.parsed['sections']
        self.assertEqual(sections[0]['history'], '(Dec. 10, 1974, P.L.816, No.271, eff. imd.)')
        self.assertIsNone(sections[2]['history'])

    def test_hierarchy_follows_printed_banners(self):
        hierarchy = self.parsed['sections'][0]['hierarchy']
        self.assertEqual([(h['kind'], h['number']) for h in hierarchy],
                         [('TITLE', '1'), ('PART', 'I'), ('CHAPTER', '1')])
        self.assertEqual(hierarchy[2]['heading'], 'SHORT TITLE, FORM OF CITATION AND EFFECTIVE DATE')

    def test_section_text_is_a_contiguous_slice_of_the_unit_text(self):
        for s in self.parsed['sections']:
            start = self.offsets[s['first']]
            end = self.offsets[s['last'] - 1] + len(self.parsed['lines'][s['last'] - 1])
            self.assertEqual(self.text[start:end], '\n'.join(self.parsed['lines'][s['first']:s['last']]))
        third = self.parsed['sections'][2]
        self.assertEqual('\n'.join(self.parsed['lines'][third['first']:third['last']]),
                         '§ 103. Effective date.\nThis act shall take effect immediately.')

    def test_editorial_notes_are_not_section_text(self):
        body = '\n'.join(self.parsed['lines'][self.parsed['sections'][0]['first']:self.parsed['sections'][0]['last']])
        self.assertNotIn('1974 Amendment', body)
        self.assertIn('1974 Amendment', self.text)


class RepealedSections(unittest.TestCase):
    def test_heading_only_section_keeps_its_printed_line(self):
        parsed = parse.parse_title(load('title-32-excerpt.html'), '32')
        by = {s['number']: s for s in parsed['sections']}
        self.assertEqual(sorted(by), ['7502', '7503', '7504'])
        repealed = by['7503']
        text = '\n'.join(parsed['lines'][repealed['first']:repealed['last']])
        self.assertEqual(text, '§ 7503. Legislative findings and purposes (Repealed).')
        self.assertIn('"Water facility." (Repealed).', '\n'.join(parsed['lines'][by['7502']['first']:by['7502']['last']]))
        self.assertEqual(by['7504']['history'], '(Mar. 1, 1988, P.L.82, No.16)')


if __name__ == '__main__':
    unittest.main()
