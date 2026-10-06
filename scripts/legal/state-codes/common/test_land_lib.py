import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import land_lib as L  # noqa: E402


class LandLibTest(unittest.TestCase):
    def test_canonical_is_sorted_compact_and_rejects_floats(self):
        self.assertEqual(L.canonical({'b': 1, 'a': ['x', None, True]}), b'{"a":["x",null,true],"b":1}')
        with self.assertRaises(ValueError):
            L.canonical({'a': 1.5})
        with self.assertRaises(ValueError):
            L.canonical({'a': 'bad\x00'})

    def test_rows_bind_original_unit_and_gates(self):
        cur = L.currency_obj('Current through 2025', '2025-12-31', '2025', 'publisher_statement')
        original = {'sha256': 'a' * 64, 'source_url': 'https://example.gov/c1', 'retrieved_at': '2026-10-06T00:00:00Z',
                    'retrieval_method': 'publisher_page', 'proxy': None}
        unit = {'unit_key': 'c1', 'unit_kind': 'chapter', 'text_sha256': 'b' * 64, 'text_code_points': 9}
        urow = L.unit_row('ZZ', 'zz-code', 'p/1', 'c' * 64, unit, original, cur)
        self.assertEqual(urow['native_id'], 'ZZ:unit:c1')
        self.assertEqual(urow['provenance']['source_as_of'], '2025-12-31')
        sec = {'citation_path': '1-2', 'citation': 'ZZ Code 1-2', 'text': 'Text é', 'hierarchy': [{'level': 'section', 'number': '1-2', 'heading': None}]}
        srow = L.section_row('ZZ', 'zz-code', 'p/1', 'c' * 64, sec, unit, original, cur)
        self.assertEqual(srow['data']['text_code_points'], 6)
        self.assertEqual(srow['data']['unit_id'], 'ZZ:unit:c1')
        self.assertFalse(srow['data']['public_projection_allowed'])
        self.assertEqual(srow['provenance']['record_sha256'], L.canonical_sha(srow['data']))

    def test_basis_none_clears_statement_and_date(self):
        self.assertEqual(L.currency_obj('x', '2025-01-01', None, 'none'),
                         {'basis': 'none', 'statement': '', 'through_date': None, 'edition': None})
        self.assertIsNone(L.currency_obj('x', 'January 2025', None, 'publisher_statement')['through_date'])

    def test_batches_respect_row_cap(self):
        rows = [{'i': i} for i in range(1201)]
        sizes = [len(b) for b in L.batches(rows)]
        self.assertEqual(sizes, [500, 500, 201])


if __name__ == '__main__':
    unittest.main()
