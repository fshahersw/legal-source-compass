import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from capture_originals import make_plan
from parse_cic_rtf import parse
from stage_historical import source_rows, stage
from verify_packet import verify
from prepare_readback import prepare
from test_parse_cic_rtf import fixture


RAW = fixture(r'\pard\s9 1-2-3. Original heading.\par \pard\s10 Text\par \pard\s11 (a) Exact law.\par \pard\s10 History\par \pard\s11 Enacted 1999.\par \pard\s10 Annotations\par \pard\s11 Commentary.\par ')
QUAL = 'Third-party historical source edition 2020-11-06; current law not verified.'


class StageTests(unittest.TestCase):
    def test_source_occurrences_keep_exact_body_and_history_excluding_annotations(self):
        parsed = parse(RAW, 'AR', '2020-11-06')
        rows, text, held, _ = source_rows(parsed, RAW, '01', QUAL, {})
        self.assertEqual(held, [])
        self.assertEqual(rows[0]['text'], '1-2-3. Original heading.\n(a) Exact law.')
        self.assertEqual(rows[0]['history'], 'Enacted 1999.')
        self.assertNotIn('Commentary', text)
        self.assertEqual(parsed['sections'][0]['annotations'], 'Commentary.')
        span = rows[0]['span']; self.assertEqual(text[span['start']:span['end']], rows[0]['text'])
        self.assertEqual(rows[0]['citation_path'], f"src-{hashlib.sha256(RAW).hexdigest()}-section-1")

    def test_rehashed_parsed_body_substitution_is_rejected_by_raw_span_replay(self):
        parsed = parse(RAW, 'AR', '2020-11-06')
        parsed['sections'][0]['parts']['text'][0]['text'] = 'Invented law.'
        with self.assertRaisesRegex(ValueError, 'exact raw span'): source_rows(parsed, RAW, '01', QUAL, {})

    def test_unknown_semantic_controls_quarantine_occurrence_and_preserve_unit_text(self):
        raw = RAW.replace(b'Exact law.', b'Exact\\unreviewed law.')
        rows, text, held, _ = source_rows(parse(raw, 'AR', '2020-11-06'), raw, '01', QUAL, {})
        self.assertEqual(rows, [])
        self.assertEqual(len(held), 1)
        self.assertIn('Original heading.', text)

    def test_offline_packet_binds_original_receipt_edition_and_counts(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict('capture_originals.SOURCES', {'AR': ('gov.ar.code', 'release78.2020.11.06', 'gov.ar.code', 1)}):
            root = Path(tmp); evidence = root / 'evidence'; originals = root / 'originals'; evidence.mkdir(); (originals / 'AR').mkdir(parents=True)
            metadata = {'metadata': {'identifier': 'gov.ar.code'}, 'files': [{'name': 'release78.2020.11.06/gov.ar.code.title.01.rtf', 'size': str(len(RAW)), 'sha1': hashlib.sha1(RAW).hexdigest(), 'md5': hashlib.md5(RAW).hexdigest()}]}
            data = json.dumps(metadata).encode(); (evidence / 'ar-archive-metadata.json').write_bytes(data)
            plan = make_plan('AR', data); (originals / 'plan.json').write_text(json.dumps(plan))
            item = plan[0]; source = originals / 'AR' / item['file']; source.write_bytes(RAW)
            receipt_path = source.parent / (source.name + '.receipt.json')
            receipt = {**item, 'sha256': hashlib.sha256(RAW).hexdigest(), 'http_status': 200, 'final_url': item['source_url'], 'retrieved_at': '2026-10-12T12:00:00+00:00'}
            receipt_path.write_text(json.dumps(receipt))
            report = stage(originals, evidence, 'AR', root / 'packet')
            self.assertEqual(report['source_occurrences'], 1)
            self.assertFalse(report['publication_allowed'])
            manifest = json.loads((root / 'packet' / 'manifest.json').read_bytes())
            self.assertFalse(manifest['retrieval']['official_source'])
            self.assertEqual(manifest['archive']['edition_date'], '2020-11-06')
            self.assertEqual(manifest['provenance_class'], 'third_party_historical_archive')
            proof = verify(root / 'packet', originals, evidence)
            self.assertEqual(proof['rows_replayed'], 1)
            proof_path = root / 'proof.json'; proof_path.write_text(json.dumps(proof))
            expected = prepare(root / 'packet', proof_path, root / 'readback')
            self.assertEqual(expected['source_occurrences'], 1)
            self.assertEqual(expected['units'], 1)
            self.assertIn('begin transaction isolation level repeatable read read only;', (root / 'readback' / 'readback.sql').read_text())
            self.assertIn('authority_gate_errors', expected['zero_fields'])
            section_path = root / 'packet' / 'sections.jsonl'
            section = json.loads(section_path.read_bytes()); section['status_note'] = 'Missing warning'
            section_path.write_text(json.dumps(section), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'changed since full original replay'): prepare(root / 'packet', proof_path, root / 'tampered-readback')
            with self.assertRaisesRegex(ValueError, 'exact original replay'): verify(root / 'packet', originals, evidence)
            receipt['source_edition'] = '2026-10-12'; receipt_path.write_text(json.dumps(receipt))
            with self.assertRaisesRegex(ValueError, 'Receipt differs'): stage(originals, evidence, 'AR', root / 'tampered')


if __name__ == '__main__': unittest.main()
