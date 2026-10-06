import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import parse  # noqa: E402


FIXTURE = b"""<html><body>
<div class="title" id="34"><span id="ic_number">IC 34</span>
<span id="shortdescription">TITLE 34. CIVIL LAW AND PROCEDURE</span></div>
<div><span style="width: 150px"><a target="_blank" href="#34-11">Art. 11.</a></span></div>
<div class="article" id="34-11"><span id="ic_number">IC 34-11</span>
<span id="shortdescription">ARTICLE 11. LIMITATION OF ACTIONS</span></div>
<div><span style="width: 150px"><a target="_blank" href="#34-11-2">Ch. 2.</a></span></div>
<div class="chapter" id="34-11-2"><span id="ic_number">IC 34-11-2</span>
<span id="shortdescription">Chapter 2. Specific Statutes of Limitation</span></div>
<div><span style="width: 150px"><a target="_blank" href="#34-11-2-4">34-11-2-4</a></span></div>
<div><span style="width: 150px"><a target="_blank" href="#34-11-2-5">34-11-2-5</a></span></div>
<div class="section" id="34-11-2-4"><span id="ic_number">IC 34-11-2-4</span>
<span id="shortdescription">Two-year limitation</span></div>
<p><span>Sec. 4. (a) An action must be commenced within two years.</span></p>
<p><i>As amended by P.L.1-2026, SEC.1.</i></p>
<div class="section" id="34-11-2-5"><span id="ic_number">IC 34-11-2-5</span>
<span id="shortdescription">Repealed</span></div>
<p>Note: This repeal is effective 7-1-2027.</p>
<p><i>Repealed by P.L.2-2026, SEC.2.</i></p>
</body></html>"""


class ParserTests(unittest.TestCase):
    def test_structural_parse_and_history_split(self):
        result = parse.parse_member(FIXTURE, '34.html', 'a' * 64)
        self.assertEqual(result['counts'], {
            'title': 1, 'article': 1, 'chapter': 1, 'section': 2,
        })
        first, second = result['sections']
        self.assertEqual(first['citation'], 'IC 34-11-2-4')
        self.assertEqual(first['text'],
                         'Sec. 4. (a) An action must be commenced within two years.')
        self.assertEqual(first['history'], 'As amended by P.L.1-2026, SEC.1.')
        self.assertEqual([item['number'] for item in first['citation_path']],
                         ['34', '11', '2', '4'])
        self.assertEqual(second['status_label'], 'Repealed')
        self.assertEqual(second['text'], 'Note: This repeal is effective 7-1-2027.')
        self.assertEqual(second['effective'], 'Note: This repeal is effective 7-1-2027.')
        self.assertEqual(second['history'], 'Repealed by P.L.2-2026, SEC.2.')

    def test_navigation_inventory_is_independent(self):
        result = parse.parse_member(FIXTURE, '34.html', 'a' * 64)
        self.assertEqual(result['toc_ids'], {
            '34-11', '34-11-2', '34-11-2-4', '34-11-2-5',
        })
        self.assertEqual(result['toc_ids'], result['structural_non_title_ids'])
        self.assertEqual(result['regex_section_count'], 2)

    def test_component_rejects_wrong_parent(self):
        with self.assertRaises(ValueError):
            parse.component('35-1-1-1', '34-1-1')

    def test_toc_only_entry_is_retained_as_inventory_gap(self):
        fixture = FIXTURE.replace(
            b'<div class="section" id="34-11-2-4">',
            b'<div><span style="width: 150px"><a target="_blank" '
            b'href="#34-11-2-99">34-11-2-99</a></span>'
            b'<span>Relocated</span></div><div class="section" id="34-11-2-4">',
        )
        result = parse.parse_member(fixture, '34.html', 'a' * 64)
        self.assertIn('34-11-2-99', result['toc_only_ids'])
        row = next(item for item in result['inventory']
                   if item['native_id'] == '34-11-2-99')
        self.assertEqual(row['inventory_basis'], 'toc_only_no_structural_body')
        self.assertEqual(row['heading'], 'Relocated')


if __name__ == '__main__':
    unittest.main()
