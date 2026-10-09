"""A ZIP capture must never invent evidence that a constructed web page was fetched."""
import importlib.util
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

HERE = Path(__file__).parent
SPEC = importlib.util.spec_from_file_location('ca_adapter', HERE / 'to_landing.py')
CA = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CA)


def digest(value):
    return hashlib.sha256(value).hexdigest()


class LandingProvenanceTest(unittest.TestCase):
    def fixture(self, root):
        (root/'raw').mkdir(); (root/'receipts').mkdir(); (root/'parsed').mkdir()
        lob = b'<section><p>Exact source body.</p></section>'
        archive = root/'raw/pubinfo_2025.zip'
        with zipfile.ZipFile(archive, 'w') as z:
            z.writestr('LAW_SECTION_TBL_1.lob', lob)
            z.writestr('LAW_SECTION_TBL.dat', '\t'.join(['CIV1','CIV','1.','','','','','v1','NULL','NULL','NULL','NULL','NULL','','LAW_SECTION_TBL_1.lob','Y','',''])+'\n')
        data = archive.read_bytes()
        receipt = dict(source_url='https://downloads.leginfo.legislature.ca.gov/pubinfo_2025.zip',
                       retrieved_at='2026-10-08T12:00:00Z', http_status=200,
                       sha256=digest(data), bytes=len(data), raw_file='raw/pubinfo_2025.zip')
        (root/'receipts/pubinfo_2025.zip.json').write_text(json.dumps(receipt))
        row = dict(id='CIV1', law_code='CIV', section_num='1.', law_section_version_id='v1', citation_path='CIV:1.', citation='CIV § 1.',
                   text='Exact source body.', text_sha256=digest(b'Exact source body.'),
                   heading='Section 1', lob_member='LAW_SECTION_TBL_1.lob', lob_sha256=digest(lob),
                   hierarchy=[dict(level='section',number='1.',heading='Section 1')],
                   source_url='https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1.',
                   active_flg='Y')
        (root/'parsed/sections.jsonl').write_text(json.dumps(row)+'\n')
        (root/'parsed/summary.json').write_text(json.dumps(dict(archive_sha256=receipt['sha256'],parse_failures=0,sections_parsed=1)))
        cfg=json.loads((HERE/'landing.json').read_text())
        return receipt,row,cfg

    def test_records_only_actually_captured_archive_as_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); receipt,row,cfg=self.fixture(root)
            CA.convert(str(root),'parsed',cfg)
            units=[json.loads(s) for s in (root/'landing/units.jsonl').read_text().splitlines()]
            objects=[json.loads(s) for s in (root/'landing/objects.jsonl').read_text().splitlines()]
            self.assertEqual(units[0]['source_url'],receipt['source_url'])
            self.assertEqual(units[0]['retrieval_method'],'publisher_zip_member')
            for obj in objects:
                for source in obj['sources']:
                    self.assertEqual(source['source_url'],receipt['source_url'])
                    self.assertNotEqual(source['retrieval_method'],'publisher_page')
            section=json.loads((root/'landing/sections.jsonl').read_text().splitlines()[0])
            self.assertEqual(section['publisher_display_url'],row['source_url'])

    def test_rejects_archive_bytes_different_from_receipt(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); receipt,row,cfg=self.fixture(root)
            with (root/'raw/pubinfo_2025.zip').open('ab') as f:f.write(b'changed')
            with self.assertRaisesRegex((ValueError,SystemExit), 'archive|Archive'):
                CA.convert(str(root),'parsed',cfg)

    def test_cannot_overwrite_a_prior_landing_version(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); receipt,row,cfg=self.fixture(root)
            (root/'landing').mkdir(); (root/'landing/preserved.txt').write_text('prior capture')
            with self.assertRaises((ValueError,SystemExit,FileExistsError)):
                CA.convert(str(root),'parsed',cfg)
            self.assertEqual((root/'landing/preserved.txt').read_text(),'prior capture')

    def test_mismatched_parse_summary_is_not_admitted(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); receipt,row,cfg=self.fixture(root)
            (root/'parsed/summary.json').write_text(json.dumps(dict(archive_sha256='0'*64,parse_failures=0,sections_parsed=1)))
            with self.assertRaisesRegex((ValueError,SystemExit), 'snapshot|archive|Archive'):
                CA.convert(str(root),'parsed',cfg)

    def test_valid_text_cannot_be_assigned_to_a_different_statute(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); receipt,row,cfg=self.fixture(root)
            row['law_code']='CCP';row['citation_path']='CCP:1.'
            (root/'parsed/sections.jsonl').write_text(json.dumps(row)+'\n')
            with self.assertRaisesRegex((ValueError,SystemExit),'identity|citation|table'):
                CA.convert(str(root),'parsed',cfg)

    def test_export_label_is_not_a_legal_effective_date(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); receipt,row,cfg=self.fixture(root)
            cfg['currency_defaults']['through_date']='2026-12-31'
            CA.convert(str(root),'parsed',cfg)
            section=json.loads((root/'landing/sections.jsonl').read_text().splitlines()[0])
            self.assertIsNone(section['currency']['through_date'])
            self.assertEqual(section['currency']['basis'],'none')

if __name__=='__main__':unittest.main()
