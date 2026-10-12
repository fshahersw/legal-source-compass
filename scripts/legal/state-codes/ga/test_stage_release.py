"""Synthetic local provenance tests; fixtures are never sent to a corpus."""
import gzip
import json
import re
from pathlib import Path
import tempfile
import unittest

import stage_release as S
import verify_release_packet as V

def save(path,value):path.write_text(json.dumps(value)+'\n',encoding='utf-8')
def fixture(root):
    data=root/'data';pdfs=root/'pdfs';data.mkdir();(pdfs/'raw').mkdir(parents=True);(pdfs/'receipts').mkdir()
    source_url='https://www.legis.ga.gov/api/document/docs/default-source/joint-features-document-library/fixture.pdf'
    raw=b'%PDF-synthetic-test-only';digest=S.sha(raw);(pdfs/'raw'/(digest+'.pdf')).write_bytes(raw)
    save(pdfs/'receipts'/(S.sha(source_url.encode())+'.json'),dict(source_url=source_url,sha256=digest,expected_sha256=digest,
        bytes=len(raw),http_status=200,checksum_match=True,retrieved_at='2026-10-12T00:00:00Z'))
    records=[]
    for citation,text,status,qualifier in [('1-1-1','(a) A 1/3 fraction.','active','Effective until January 1, 2026.'),
         ('1-1-1','(a) A second printing.','active','Effective January 1, 2026.'),('1-1-2','','repealed',None)]:
        records.append(dict(citation=citation,citation_scheme='ocga',title=1,chapter='1',article=None,part=None,subpart=None,
            headings=dict(title='GENERAL PROVISIONS',chapter='GENERAL PROVISIONS',article=None,part=None,subpart=None),
            text=text,status=status,catchline='Printed catchline.' if text else '',history='',effective_qualifier=qualifier,
            printing=None,range_end='1-1-4' if not text else None,current_through='Including Acts of the 2025 Regular Session',
            warnings=['dehyphenation_unverified:frac-tion'] if text else [],
            text_source=dict(sha256=digest,source_url=source_url,page_start=1,page_end=2,kind='bound',volume='V3',edition=2019,supplement_year=None)))
    raw=gzip.compress((''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in records)).encode());release_sha=S.sha(raw)
    (data/'ocga-code.jsonl.gz').write_bytes(raw)
    save(data/'ocga-code.jsonl.gz.receipt.json',dict(source_url=S.URL,sha256=release_sha,bytes=len(raw),http_status=200,
        retrieved_at='2026-10-12T00:00:00Z',retrieval_method='direct_third_party_release_download',proxy=None))
    comparisons=[]
    statuses=['unresolved_pdf_text_order_or_content','whole_body_line_hyphen_join','publisher_status_without_body']
    for ordinal,(r,status) in enumerate(zip(records,statuses),1):
        comparisons.append(dict(ordinal=ordinal,citation=r['citation'],source_sha256=digest,page_start=1,page_end=2,
            text_sha256=S.sha(r['text'].encode()),extracted_pages_sha256='e'*64,comparison=status,source_status=r['status'],effective_qualifier=r['effective_qualifier']))
    ledger=''.join(json.dumps(r)+'\n' for r in comparisons).encode();(data/'row-comparisons.jsonl').write_bytes(ledger)
    save(data/'report.json',dict(schema_version='ga-independent-pdf-text-comparison/1',bulk_sha256=release_sha,row_ledger_sha256=S.sha(ledger),
        records=3,comparisons=dict.fromkeys(statuses,1),normalization='Synthetic fixture normalization',qualification='Synthetic comparison evidence only',
        current_law_verified=False))
    return data,pdfs,release_sha

class ReleaseTest(unittest.TestCase):
    def test_duplicates_effective_qualifiers_and_empty_status_are_preserved_without_choosing_law(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);data,pdfs,digest=fixture(root);out=root/'staged'
            report=S.stage(data,pdfs,out,digest,comparison_dir=data);rows=list(V.rows(out/'sections.jsonl'))
            self.assertEqual(report['records'],3);self.assertEqual(report['status_only_records'],1)
            self.assertTrue(all('no operative version has been selected' in r['status_note'] for r in rows[:2]))
            self.assertIn('Effective until January 1, 2026.',rows[0]['status_note'])
            self.assertIn('Effective January 1, 2026.',rows[1]['status_note'])
            self.assertEqual(rows[2]['text'],'');self.assertIsNone(rows[2]['heading'])
            self.assertEqual(rows[2]['span']['start'],rows[2]['span']['end'])
            self.assertTrue(rows[2]['source_occurrence']['text_field_empty'])
            self.assertIn('not independently verified',rows[2]['status_note'])
            self.assertFalse(V.read(out/'manifest.json')['retrieval']['official_source'])
            manifest=V.read(out/'manifest.json')
            self.assertFalse(manifest['current_law_verified']);self.assertFalse(manifest['calculation_activation_allowed'])
            self.assertIn(manifest['archive']['edition'],manifest['archive']['qualification'])
            self.assertIn('PDF comparison unresolved',rows[0]['status_note'])
            self.assertIn('line-end hyphens',rows[1]['status_note'])
            for obj in V.rows(out/'objects.jsonl'):
                for source in obj['sources']:
                    self.assertTrue(any(re.search(p,source['source_url']) for p in manifest['retrieval']['source_url_patterns']))
            self.assertTrue(V.verify(data,out)['passed'])

    def test_exact_release_record_and_span_verifier_rejects_changed_text_and_warning(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);data,pdfs,digest=fixture(root);out=root/'staged';S.stage(data,pdfs,out,digest,comparison_dir=data)
            path=out/'sections.jsonl';original=path.read_bytes()
            for field,value in [('text','Different law'),('status_note',S.QUALIFICATION),('citation','1-1-9')]:
                rows=[json.loads(line) for line in original.decode().splitlines()];rows[0][field]=value
                path.write_text(''.join(json.dumps(r)+'\n' for r in rows),encoding='utf-8')
                with self.assertRaises(ValueError):V.verify(data,out)

    def test_fetched_source_pdf_must_match_exact_upstream_hash(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);data,pdfs,digest=fixture(root);next((pdfs/'raw').iterdir()).write_bytes(b'Changed PDF')
            with self.assertRaisesRegex(ValueError,'PDF differs'):S.stage(data,pdfs,root/'staged',digest,comparison_dir=data)

    def test_retrieval_is_not_relabelled_official_or_output_overwritten(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);data,pdfs,digest=fixture(root);out=root/'staged';out.mkdir()
            with self.assertRaises(FileExistsError):S.stage(data,pdfs,out,digest,comparison_dir=data)
            path=data/'ocga-code.jsonl.gz.receipt.json';receipt=V.read(path);receipt['retrieval_method']='direct_official_http';save(path,receipt)
            with self.assertRaisesRegex(ValueError,'third-party'):S.stage(data,pdfs,root/'other',digest,comparison_dir=data)

    def test_comparison_requires_complete_exact_body_and_page_evidence(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);data,pdfs,digest=fixture(root)
            ledger=data/'row-comparisons.jsonl';original=ledger.read_bytes()
            for field,value in [('page_end',3),('text_sha256','0'*64),('ordinal',99),('comparison','guessed_verified')]:
                rows=[json.loads(line) for line in original.decode().splitlines()];rows[0][field]=value
                ledger.write_bytes(''.join(json.dumps(r)+'\n' for r in rows).encode())
                report=V.read(data/'report.json');report['row_ledger_sha256']=S.sha(ledger.read_bytes());save(data/'report.json',report)
                with self.assertRaises(ValueError):S.stage(data,pdfs,root/'staged',digest,comparison_dir=data)

if __name__=='__main__':unittest.main()
