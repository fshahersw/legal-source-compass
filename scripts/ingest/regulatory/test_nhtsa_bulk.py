"""Offline synthetic ZIPs only; no real source rows or source acquisition."""
import tempfile
import unittest
import zipfile
from pathlib import Path
from nhtsa_bulk import parse_bulk


def row(record_id='1', campaign='26V123000', received='20261009', model='SYNTHETIC'):
    data = [''] * 29
    data[0], data[1], data[2], data[3], data[4] = record_id, campaign, 'SYNTHETIC MAKE', model, '2026'
    data[7], data[15], data[16], data[19] = 'SYNTHETIC MANUFACTURER', received, received, 'Synthetic defect description; test only.'
    return data


class BulkTests(unittest.TestCase):
    def run_parse(self, rows, member='FLAT_RCL_POST_2010.txt', source='nhtsa_recalls', **kwargs):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / 'source.zip'
            with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as target:
                target.writestr(member, '\r\n'.join('\t'.join(r) for r in rows) + '\r\n')
            return parse_bulk(archive, source, '2026-10-01', '2026-10-12', **kwargs)

    def test_full_campaign_group_includes_associations_outside_selection_date(self):
        result = self.run_parse([row(), row('2', received='20260101', model='SYNTHETIC SECOND')])
        self.assertEqual(result['selected_native_groups'], 1)
        self.assertEqual(result['records'][0]['fields']['association_count'], 2)
        self.assertEqual(result['records'][0]['published_on'], '2026-01-01')

    def test_source_native_letter_identifiers_are_preserved(self):
        self.assertEqual(self.run_parse([row(campaign='21V00H000')])['records'][0]['native_id'], '21V00H000')

    def test_duplicate_native_association_rejected(self):
        with self.assertRaisesRegex(ValueError, 'DUPLICATE_RECORD_ID'):
            self.run_parse([row(), row()])

    def test_schema_drift_outside_window_also_blocks_completion(self):
        with self.assertRaisesRegex(ValueError, 'COLUMN_COUNT_CHANGED'):
            self.run_parse([row(), row(received='20200101')[:-1]])

    def test_member_paths_never_extracted_or_accepted(self):
        with self.assertRaisesRegex(ValueError, 'ZIP_MEMBERS_INVALID'):
            self.run_parse([row()], member='../FLAT_RCL_POST_2010.txt')

    def test_native_group_cap_is_failure_not_partial_success(self):
        with self.assertRaisesRegex(ValueError, 'SOURCE_RECORD_CAP'):
            self.run_parse([row(), row('2', campaign='26V456000')], maximum=1)

    def test_closed_investigation_in_window_retains_prior_opening_date(self):
        investigation = ['DP26003', 'SYNTHETIC', 'MODEL', '2026', 'COMPONENT', 'MANUFACTURER', '20260101', '20261009', '', 'SYNTHETIC SUBJECT', 'Synthetic summary\u2028with an embedded Unicode separator.']
        result = self.run_parse([investigation], member='FLAT_INV.txt', source='nhtsa_investigations')
        self.assertEqual(result['records'][0]['published_on'], '2026-01-01')
        self.assertIsNone(result['records'][0]['status'])
        self.assertIn('\u2028', result['records'][0]['fields']['publisher_rows'][0][10])

    def test_invalid_selected_date_is_not_silently_normalized(self):
        with self.assertRaises(ValueError):
            self.run_parse([row(received='20261032'), row('2')])


if __name__ == '__main__':
    unittest.main()
