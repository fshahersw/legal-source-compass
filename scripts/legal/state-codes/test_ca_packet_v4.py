"""Source-bound packet behavior, including separate native versions and attachments."""
import csv
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('ca_packet_v4', Path(__file__).with_name('ca-build-packet-v4.py'))
packet = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packet)
verify_spec = importlib.util.spec_from_file_location('ca_verify_v4', Path(__file__).with_name('ca-verify-packet-v4.py'))
verifier = importlib.util.module_from_spec(verify_spec)
verify_spec.loader.exec_module(verifier)


def table(rows):
    text = io.StringIO(newline='')
    csv.writer(text, delimiter='\t', quotechar='`', lineterminator='\n').writerows(rows)
    return text.getvalue()


def fixture(root, mismatch=False):
    archive = root / 'pubinfo_2025.zip'
    sections = [
        ['PEN1', 'PEN', '1.', '', '', '', '', 'v1', 'NULL', 'NULL', 'NULL', 'NULL', 'NULL', 'History one', 'one.lob', 'Y', '', ''],
        ['PEN1B', 'PEN', '1.', '', '', '', '', 'v2', 'NULL', 'NULL', 'NULL', 'NULL', 'NULL', 'History two', 'two.lob', 'Y', '', ''],
    ]
    nodes = [
        ['PEN', *(['NULL']*5), 'PRELIMINARY', 'Y', '', '', '', '1', '2', '2', 'Y', '', '', '', ''],
        ['PEN', *(['NULL']*5), 'ALTERNATE', 'Y', '', '', '', '1', '3', '3', 'Y', '', '', '', ''],
    ]
    references = [
        ['PEN1', 'PEN', '2', '1.', '1', 'First heading', '', '', '', '', '', 'v1', '1'],
        ['WRONG' if mismatch else 'PEN1B', 'PEN', '3', '1.', '1', 'Alternate heading', '', '', '', '', '', 'v2', '2'],
    ]
    xml = '<caml:Content xmlns:caml="http://lc.ca.gov/legalservices/schemas/caml.1#">{}</caml:Content>'
    with zipfile.ZipFile(archive, 'w') as z:
        for name, rows in [('CODES_TBL.dat', [['PEN','Penal Code']]), ('LAW_SECTION_TBL.dat',sections), ('LAW_TOC_TBL.dat',nodes), ('LAW_TOC_SECTIONS_TBL.dat',references)]:
            z.writestr(name, table(rows))
        z.writestr('one.lob', xml.format('<p>(a)<span class="EnSpace"/>🧭 <caml:Fraction><caml:Numerator>1</caml:Numerator><caml:Denominator>4</caml:Denominator></caml:Fraction></p>'))
        z.writestr('two.lob', xml.format('<p>Use the form.</p><caml:TipIn numPages="2"/>'))
    checksum = hashlib.sha256(archive.read_bytes()).hexdigest()
    receipt = root / 'capture.json'
    receipt.write_text(json.dumps({'objects':[{'sha256':checksum,'outcome':'captured','status':200,'bytes':archive.stat().st_size,'finalUrl':'https://downloads.leginfo.legislature.ca.gov/pubinfo_2025.zip','completedAt':'2026-10-05T22:24:52.030Z'}]}))
    return archive, checksum, receipt


class PacketTests(unittest.TestCase):
    def test_lossless_text_exact_versions_source_nodes_and_attachment_warning(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            archive, checksum, receipt = fixture(root)
            report = packet.build(archive, checksum, receipt, root/'out')
            rows = [json.loads(line) for line in (root/'out/sections.jsonl').read_text(encoding='utf-8').splitlines()]
            self.assertEqual([r['citation_path'] for r in rows], ['PEN:1.', 'PEN:1.~2'])
            self.assertEqual(rows[0]['text'], '(a)\u2002🧭 1/4\n')
            self.assertEqual(rows[0]['hierarchy'][1]['node_id'], 'CA:PEN:2')
            self.assertEqual(rows[1]['hierarchy'][1]['node_id'], 'CA:PEN:3')
            self.assertIn('not present in this text export', rows[1]['status_note'])
            self.assertEqual(report['attachment_gap_sections'], 1)
            text = (root/'out/code-text/PEN.txt').read_text(encoding='utf-8')
            for row in rows:
                self.assertEqual(text[row['span']['start']:row['span']['end']],row['text'])
                self.assertFalse(row['source_locator']['display_url_retrieved'])
                self.assertIsNone(row['currency']['through_date'])
            self.assertFalse(report['publication_allowed'])
            self.assertFalse(report['current_law_verified'])
            self.assertEqual(hashlib.sha256(archive.read_bytes()).hexdigest(), checksum)

    def test_rejects_wrong_source_version_and_changed_archive(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            archive, checksum, receipt = fixture(root, mismatch=True)
            with self.assertRaisesRegex(ValueError, 'identity'):
                packet.build(archive, checksum, receipt, root/'out')
            archive.write_bytes(archive.read_bytes()+b'changed')
            with self.assertRaisesRegex(ValueError, 'receipt/hash'):
                packet.build(archive, checksum, receipt, root/'other')

    def test_refuses_overwrite(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            archive, checksum, receipt = fixture(root)
            (root/'out').mkdir()
            with self.assertRaises(FileExistsError):
                packet.build(archive, checksum, receipt, root/'out')

    def test_verifier_crosslinks_original_object_and_member_bytes(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            archive, checksum, receipt = fixture(root)
            packet.build(archive, checksum, receipt, root/'out')
            row = json.loads((root/'out/sections.jsonl').read_text(encoding='utf-8').splitlines()[0])
            with zipfile.ZipFile(archive) as z:
                source_row = list(csv.reader(io.StringIO(z.read('LAW_SECTION_TBL.dat').decode()), delimiter='\t', quotechar='`'))[0]
                verifier.verify_source_locator(z, checksum, row['source_locator'], source_row)
                with self.assertRaisesRegex(ValueError, 'archive fingerprint'):
                    verifier.verify_source_locator(z, '0'*64, row['source_locator'], source_row)
                with self.assertRaisesRegex(ValueError, 'original bytes'):
                    verifier.verify_source_locator(z, checksum, {**row['source_locator'], 'member_sha256':'0'*64}, source_row)
                with self.assertRaisesRegex(ValueError, 'section table'):
                    verifier.verify_source_locator(z, checksum, {**row['source_locator'], 'member':'two.lob'}, source_row)


if __name__ == '__main__':
    unittest.main()
