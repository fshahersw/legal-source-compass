import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0,str(Path(__file__).parent))
import revalidate as R
import build_packet as B
import source_review as S

RUN='11111111-1111-4111-8111-111111111111'
HASH='a'*64
URL='https://www.ksrevisor.gov/statutes/chapters/ch001/001_001_0001.html'


def fixture():
    state=dict(jurisdiction='KS',source_system='ks-statutes',review_status='landed',public_projection_allowed=False,
               last_run=RUN,current_manifest_sha256=HASH,sections=1)
    manifest=dict(jurisdiction='KS',source_system='ks-statutes',section_id={'regex':r'^\d{3}_\d{3}_\d{4}(?::\d+)?$'})
    pre=dict(schema='ks-preflight/1',read_only='on',state=state,run=dict(id=RUN,status='completed'),open_runs=0,
        manifest=dict(manifest_sha256=HASH,manifest=manifest),objects=[dict(missing_or_public_storage=0)],
        rpc_controls=[dict(definer=True,anon=False,authenticated=False,service_role=True,settings=['search_path=""'])])
    row=dict(native_id='KS:001_001_0001',citation_path='001_001_0001',source_url=URL,
        last_run=RUN,manifest_sha256=HASH,text_hash_valid=True,retained_version_matches=True,unit_matches=True,
        original_registered=True,text_code_points=10,currency=dict(edition='dated source',through_date=None))
    inv=dict(schema='ks-inventory/1',read_only='on',run_id=RUN,manifest_sha256=HASH,state=state,sections=[row])
    return pre,inv,dict(section_urls=[URL])


def summary_fixture():
    pre,inv,toc=fixture()
    totals=dict(sections=1,unique_native_ids=1,unique_source_pages=1)
    totals.update({k:0 for k in ['bad_text_hash','bad_retained_version','bad_unit','bad_original',
        'bad_native_identity','bad_page_identity','bad_scope','empty_text']})
    summary={**inv,'schema':'ks-inventory-summary/1','totals':totals,'failure_count':0,
             'chapters':list(R.toc_groups(toc).values())}
    summary.pop('sections')
    return pre,summary,toc


class ReviewTests(unittest.TestCase):
    def test_currency_revived_type_handles_both_pdf_layouts(self):
        inline='Table One\n59-2701 Rev 480 2 89 4/23/2026\n          & Am\n'
        wrapped='Table One\n          Rev\n59-2701 480 2 89 4/23/2026\n          & Am\n'
        for text in [inline,wrapped]:
            parsed=B.parse_change_text(text)['59-2701'][0]
            self.assertEqual(parsed['type'],'Rev & Am')
            self.assertEqual((parsed['bill'],parsed['sec'],parsed['sl_ch']),('480','2','89'))

    def test_source_check_detects_printed_text_outside_parser_blocks(self):
        text='1-1. Test. Body.'
        row=dict(data=dict(citation_path='001_001_0001',text=text,text_sha256=R.digest(text.encode()),
            citation='1-1.',heading='Test.',history=None,span=dict(unit='unicode_code_points',start=0,end=len(text))),
            provenance=dict(source_url=URL))
        unit=dict(data=dict(sections_expected=1,text_sha256=R.digest(text.encode())))
        body=b'<html><div id="print"><p><span class="stat_number">1-1.</span> <span class="stat_caption">Test.</span> Body.</p></div></html>'
        self.assertTrue(S.exact_body_check(body,row,unit,'Test.')['passed'])
        extra=body.replace(b'</p>',b'</p> Omitted printed text.')
        result=S.exact_body_check(extra,row,unit,'Test.')
        self.assertFalse(result['passed'])
        self.assertFalse(result['checks']['print_box_entire_character_sequence'])

    def test_source_check_preserves_unicode_span_units(self):
        text='1-1. Caf\u00e9 \U0001f600.'
        row=dict(data=dict(citation_path='001_001_0001',text=text,text_sha256=R.digest(text.encode()),
            citation='1-1.',heading='Caf\u00e9 \U0001f600.',history=None,
            span=dict(unit='unicode_code_points',start=0,end=len(text.encode()))),provenance=dict(source_url=URL))
        unit=dict(data=dict(sections_expected=1,text_sha256=R.digest(text.encode())))
        body='<html><div id="print"><p><span class="stat_number">1-1.</span> <span class="stat_caption">Caf\u00e9 \U0001f600.</span></p></div></html>'.encode()
        result=S.exact_body_check(body,row,unit,None)
        self.assertFalse(result['checks']['span_exact'])
        row['data']['span']['end']=len(text)
        self.assertTrue(S.exact_body_check(body,row,unit,None)['passed'])

    def test_source_sample_cannot_fetch_outside_recorded_toc(self):
        with self.assertRaises(ValueError):S.sample_urls(dict(samples=[]),dict(section_urls=[URL]))
        rows=[dict(native_id='KS:'+str(i),source_system=R.SOURCE,
                   data=dict(citation_path=str(i)),provenance=dict(source_url='https://foreign.test/',source_sha256=HASH))for i in range(20)]
        with self.assertRaises(ValueError):S.sample_urls(dict(samples=rows),dict(section_urls=[URL]))

    def test_toc_keeps_inline_markup_in_native_citation(self):
        page='''<html><h2>Chapter 32. WILDLIFE, PARKS AND RECREATION</h2>
        <a class="collapsed">Article 1. GENERAL PROVISIONS</a><ul><li>
        32-104<i>l</i>, 32-104m<a href="/statutes/chapters/ch32/032_001_0004l.html">Transferred.</a>
        </li></ul></html>'''
        chapter,rows=B.parse_toc(page)
        self.assertEqual(chapter[0],'32')
        self.assertEqual(rows['https://www.ksrevisor.gov/statutes/chapters/ch32/032_001_0004l.html'],
                         ('1','Article 1. GENERAL PROVISIONS','32-104l, 32-104m','Transferred.'))

    def test_toc_repeated_exact_url_retains_review_evidence_without_new_identity(self):
        page='''<html><h2>Chapter 1. TEST</h2><a class="collapsed">Article 1. TEST</a>
        <li>1-1<a href="/statutes/chapters/ch01/001_001_0001.html">Earlier title</a></li>
        <li>1-1<a href="/statutes/chapters/ch01/001_001_0001.html">Later title</a></li></html>'''
        duplicates=[];_,rows=B.parse_toc(page,duplicates)
        self.assertEqual(len(rows),1);self.assertEqual(len(duplicates),1)
        self.assertEqual(next(iter(rows.values()))[-1],'Later title')
        self.assertEqual(duplicates[0]['earlier_label'][-1],'Earlier title')

    def test_structural_pass_never_authorizes_publication(self):
        result=R.audit(*fixture())
        self.assertTrue(result['passed_inventory_checks'])
        self.assertFalse(result['publication_allowed'])
        self.assertFalse(result['calculation_activation_allowed'])
        self.assertGreaterEqual(len(result['remaining_requirements']),4)

    def test_missing_and_extra_publisher_pages_are_both_holds(self):
        pre,inv,toc=fixture();toc['section_urls']=['https://www.ksrevisor.gov/statutes/chapters/ch002/002_001_0001.html']
        result=R.audit(pre,inv,toc)
        self.assertIn('publisher_pages_without_sections',result['issues'])
        self.assertIn('stored_pages_absent_from_current_toc',result['issues'])

    def test_missing_or_permissive_boundary_evidence_fails(self):
        for key,value in [('anon',True),('authenticated',True),('service_role',False),('definer',False),
                          ('settings',['search_path=public']),('settings',None)]:
            pre,inv,toc=fixture();pre['rpc_controls'][0][key]=value
            self.assertIn('rpc_boundary_not_confirmed',R.audit(pre,inv,toc)['issues'])
        pre,inv,toc=fixture();pre['objects']=[]
        self.assertIn('object_catalog_missing_or_public',R.audit(pre,inv,toc)['issues'])
        pre,inv,toc=fixture();inv.pop('schema')
        self.assertIn('unexpected_export_schema',R.audit(pre,inv,toc)['issues'])

    def test_additional_rpc_timeout_does_not_change_empty_search_path(self):
        pre,inv,toc=fixture();pre['rpc_controls'][0]['settings'].append('statement_timeout=20s')
        self.assertTrue(R.audit(pre,inv,toc)['passed_inventory_checks'])

    def test_stale_scope_or_premature_review_fails(self):
        for key,value in [('review_status','reviewed'),('public_projection_allowed',True),('last_run','other')]:
            pre,inv,toc=fixture();pre['state'][key]=value
            self.assertFalse(R.audit(pre,inv,toc)['passed_inventory_checks'])

    def test_full_inventory_integrity_failures_are_not_sampled_away(self):
        for field in ['text_hash_valid','retained_version_matches','unit_matches','original_registered']:
            pre,inv,toc=fixture();inv['sections'][0][field]=False
            self.assertIn(field,R.audit(pre,inv,toc)['record_failures'][0]['errors'])

    def test_native_identity_and_legacy_rows_fail(self):
        pre,inv,toc=fixture();row=inv['sections'][0]
        row.update(native_id='KS:wrong',last_run='other')
        errors=R.audit(pre,inv,toc)['record_failures'][0]['errors']
        self.assertIn('native_id',errors);self.assertIn('legacy_or_different_run',errors)

    def test_tenth_publisher_occurrence_keeps_distinct_identity(self):
        pre,inv,toc=fixture();inv['sections'][0].update(native_id='KS:001_001_0001:10',citation_path='001_001_0001:10')
        self.assertTrue(R.audit(pre,inv,toc)['passed_inventory_checks'])

    def test_anchor_inventory_rejects_foreign_queries_and_fabrication(self):
        body=(f'<a href="{URL}">ok</a><a href="https://evil.test/statutes/chapters/a.html">no</a>'
              '<a href="/statutes/chapters/a.html?x=1">no</a>').encode()
        self.assertEqual(R.links(body,R.ROOT,R.SECTION),[URL])

    def test_sql_is_read_only_and_rejects_unsafe_cursor(self):
        for kind in ['preflight','inventory','summary','unit-proof','sample','originals']:
            text=R.sql(kind,RUN,HASH)
            self.assertIn('read only;',text)
            self.assertNotIn('corpus_publisher_code_review_v2(',text)
        with self.assertRaises(ValueError):R.sql('originals',RUN,HASH,"';delete",1000)
        with self.assertRaises(ValueError):R.sql('originals',RUN,HASH,'',1001)
        self.assertIn("limit 100",R.sql('page',RUN,HASH,'KS:001_001_0001',100,'ch001'))
        with self.assertRaises(ValueError):R.sql('page',RUN,HASH,'',101,'ch001')
        with self.assertRaises(ValueError):R.sql('page',RUN,HASH,'',100,"ch001';select")

    def test_summary_exact_inventory_hashes_pass_without_authorizing_release(self):
        result=R.audit_summary(*summary_fixture())
        self.assertTrue(result['passed_inventory_checks'])
        self.assertFalse(result['publication_allowed'])

    def test_summary_equal_counts_cannot_hide_substituted_page(self):
        pre,summary,toc=summary_fixture()
        summary['chapters'][0]['urls_sha256']='f'*64
        result=R.audit_summary(pre,summary,toc)
        self.assertIn('publisher_chapter_inventory_differs',result['issues'])
        self.assertEqual(result['chapter_mismatches'][0]['chapter'],'ch001')

    def test_summary_missing_failure_counter_and_duplicate_chapter_fail(self):
        pre,summary,toc=summary_fixture();summary['totals'].pop('bad_unit')
        summary['chapters']*=2
        result=R.audit_summary(pre,summary,toc)
        self.assertIn('record_integrity_or_provenance_failures',result['issues'])
        self.assertIn('duplicate_chapter_summary',result['issues'])

    def test_framed_hash_preserves_identity_boundaries_and_order(self):
        self.assertNotEqual(R.framed_hash(['ab','c']),R.framed_hash(['a','bc']))
        self.assertEqual(R.framed_hash(['b','a']),R.framed_hash(['a','b']))

    def test_original_pages_select_complete_hash_groups(self):
        text=R.sql('originals',RUN,HASH)
        self.assertIn('select distinct s.sha256',text)
        self.assertIn('join hashes h using(sha256)',text)

    def test_retained_toc_is_reparsed_not_trusted(self):
        with tempfile.TemporaryDirectory()as tmp:
            root=Path(tmp);(root/'raw').mkdir()
            chapter='https://www.ksrevisor.gov/statutes/ksa_ch1.html'
            bodies={R.ROOT:f'<html><a href="{chapter}">one</a></html>'.encode(),chapter:f'<html><a href="{URL}">section</a></html>'.encode()}
            receipts=[]
            for url,body in bodies.items():
                sha=R.digest(body);(root/'raw'/sha).write_bytes(body)
                receipts.append(dict(source_url=url,final_url=url,http_status=200,sha256=sha,bytes=len(body),raw_file='raw/'+sha))
            ledger=''.join(json.dumps(r)+'\n'for r in receipts).encode();(root/'receipts.jsonl').write_bytes(ledger)
            toc=dict(root=R.ROOT,root_sha256=R.digest(bodies[R.ROOT]),receipts_sha256=R.digest(ledger),
                     chapters=[dict(url=chapter,section_urls=[URL])],section_urls=[URL])
            (root/'toc.json').write_text(json.dumps(toc),encoding='utf8');self.assertEqual(R.validate_toc(root),toc)
            toc['section_urls'].append(URL+'fake');(root/'toc.json').write_text(json.dumps(toc),encoding='utf8')
            with self.assertRaises(ValueError):R.validate_toc(root)


if __name__=='__main__':unittest.main()
