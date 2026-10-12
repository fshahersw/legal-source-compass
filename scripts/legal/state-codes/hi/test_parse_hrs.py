import unittest
import json
from pathlib import Path
import tempfile
from copy import deepcopy
from unittest.mock import patch
from types import SimpleNamespace

from parse_hrs import parse_section_html,parse_chapter_index
from stage_hrs import ROOT,digest,exact_capture,discovery,stage
from capture_assets import verified_references
from verify_packet import verify,chapter_identity_matches
from source_review import selected_urls
from review_export import expected_groups,check
from source_boundaries import REVIEWED_LEADING_XNOTES
from prepare_original_upload import prepare
from preupload_originals import validate_plan,valid_receipt,cloud_type,retry_after


def source(body):
    return '<html><body><div class="WordSection1">'+body+'</div><div id="pageLinks">Navigation</div></body></html>'


class HawaiiSourceTests(unittest.TestCase):
    def test_printed_lowercase_chapter_suffix_retains_exact_source_label(self):
        body=source('<p>CHAPTER 327k</p><p>pROVIDER oRDERS</p><p>Section</p>').encode()
        parsed=parse_chapter_index(body,'HRS_0327K-.htm')
        self.assertEqual(parsed['chapter'],'327k');self.assertEqual(parsed['heading'],'pROVIDER oRDERS')
        self.assertTrue(chapter_identity_matches(body,'327k','HRS0327K'))
        self.assertFalse(chapter_identity_matches(body,'327K','HRS0327K'))
        self.assertFalse(chapter_identity_matches(body,'327k','HRS0327L'))
        self.assertFalse(chapter_identity_matches(source('<p>CHAPTER 327k is only a prose mention.</p>').encode(),'327k','HRS0327K'))

    def test_evidence_rule_requires_literal_bold_label_and_matching_native_identity(self):
        body=source('<p>ARTICLE IV.</p><p><b>[Rule 409.5] Admissibility.</b> Complete text.</p>'
            '<p class="XNotes">Rule commentary.</p>')
        parsed=parse_section_html(body,'HRS_0626-0001-0409_0005.htm')
        self.assertEqual(parsed['citation'],'Rule 409.5');self.assertEqual(parsed['heading'],'Admissibility.')
        self.assertEqual(parsed['text'],'[Rule 409.5] Admissibility. Complete text.')
        self.assertEqual(parsed['leading_context'],'ARTICLE IV.');self.assertTrue(parsed['evidence_rule_page'])
        self.assertFalse(parsed['unclassified']);self.assertEqual(parsed['printed_citation_markers'],1)
        self.assertIn('literal printed Rule label',parsed['status_note'])
        for name in ['HRS_0626-0001-0409_0006.htm','HRS_0625-0001-0409_0005.htm']:
            self.assertTrue(parse_section_html(body,name)['unclassified'])
        prose=parse_section_html(source('<p>Rule 100 is mentioned in prose.</p>'),'HRS_0626-0001-0100.htm')
        self.assertTrue(prose['unclassified'])

    def test_reserved_chapter_range_remains_an_index_without_fabricated_sections(self):
        body=source('<p><b>[CHAPTERS 807 to 830 RESERVED.]</b></p><p> </p>')
        parsed=parse_chapter_index(body,'HRS_0807-.htm')
        self.assertEqual(parsed['chapter'],'807');self.assertEqual(parsed['heading'],'[CHAPTERS 807 to 830 RESERVED.]')
        self.assertTrue(parsed['reserved_chapter_range']);self.assertFalse(parsed['chapter_headers'])
        self.assertEqual(parse_section_html(body,'HRS_0807-.htm')['kind'],'chapter_index')
        with self.assertRaisesRegex(ValueError,'range differs'):parse_chapter_index(body,'HRS_0808-.htm')
        ambiguous=parse_chapter_index(source('<p>[CHAPTERS 807 to 830 RESERVED.]</p><p>Unknown text.</p>'),'HRS_0807-.htm')
        self.assertIsNone(ambiguous['heading'])

    def test_literal_old_filename_and_reserved_article_are_preserved(self):
        old=parse_section_html(source('<p><b>§§431:9A-101 to 431:9A-108 REPEALED.</b> Source history.</p>'),
            'HRS_0431-0009A-0101_[OLD].htm')
        self.assertEqual(old['citation_path'],'HRS_0431-0009A-0101_[OLD]')
        self.assertEqual(old['citation'],'431:9A-101 to 431:9A-108')
        literal=parse_section_html(source('<p><b>§663E-10 Source heading.</b> Body.</p>'),'HRS_0663E-0010.docx.htm')
        self.assertEqual(literal['citation_path'],'HRS_0663E-0010.docx')
        body=source('<p>ARTICLE 18</p><p>[RESERVED]</p>')
        reserved=parse_section_html(body,'HRS_0431-0018-0101.htm')
        self.assertEqual(reserved['citation'],'ARTICLE 18');self.assertEqual(reserved['text'],'ARTICLE 18\n[RESERVED]')
        self.assertTrue(reserved['reserved_article_page']);self.assertFalse(reserved['unclassified'])
        self.assertIn('no section citation is printed',reserved['status_note'])
        self.assertTrue(parse_section_html(body,'HRS_0431-0019-0101.htm')['unclassified'])
        extra=parse_section_html(source('<p>ARTICLE 18</p><p>[RESERVED]</p><p>Additional unknown text.</p>'),'HRS_0431-0018-0101.htm')
        self.assertTrue(extra['unclassified'])

    def test_mixed_xnotes_requires_exact_reviewed_response_hash(self):
        body=source('<p class="XNotes"><b>§1-1 Title.</b> Complete statute.</p>'
            '<p class="XNotesHeading">Case Notes</p><p class="XNotes">Separate commentary.</p>')
        self.assertTrue(parse_section_html(body,'HRS_0001-0001.htm')['unclassified'])
        with patch.dict(REVIEWED_LEADING_XNOTES,{'HRS_0001-0001.htm':digest(body.encode())}):
            parsed=parse_section_html(body,'HRS_0001-0001.htm')
            self.assertFalse(parsed['unclassified']);self.assertEqual(parsed['text'],'§1-1 Title. Complete statute.')
            self.assertEqual([item['text']for item in parsed['annotations']],['Case Notes','Separate commentary.'])
            self.assertTrue(parse_section_html(body+' ','HRS_0001-0001.htm')['unclassified'])
            self.assertTrue(parse_section_html(body,'HRS_0001-0002.htm')['unclassified'])

    def test_editorial_notes_are_retained_separately(self):
        result=parse_section_html(source('<p class="RegularParagraphs"><b>§1-1 Title.</b> Body. [L 2000, c 1]</p>'
            '<p class="XNotesHeading">Case Notes</p><p class="XNotes">Editorial commentary.</p>'),'HRS_0001-0001.htm')
        self.assertEqual(result['text'],'§1-1 Title. Body. [L 2000, c 1]')
        self.assertEqual([r['text']for r in result['annotations']],['Case Notes','Editorial commentary.'])
        self.assertTrue(result['source_character_sequence_preserved'])
        self.assertFalse(result['current_law_verified'])

    def test_split_bold_citation_and_nonbreaking_hyphen(self):
        for body in ['<b>§1</b>-<b>2 Title.</b> Body.','§<b>26H‑2 Policy.</b> Body.']:
            parsed=parse_section_html(source('<p>'+body+'</p>'),'HRS_0001-0002.htm')
            self.assertIsNotNone(parsed['citation']);self.assertIsNotNone(parsed['heading'])
        self.assertEqual(parsed['citation'],'26H‑2')

    def test_leading_part_text_remains_in_unit_with_exact_span(self):
        parsed=parse_section_html(source('<p><b>PART I. TITLE</b></p><p><b>[§1-2] Title.</b> Body.</p>'),'HRS_0001-0002.htm')
        self.assertEqual(parsed['leading_context'],'PART I. TITLE')
        self.assertEqual(parsed['unit_text'][parsed['span']['start']:parsed['span']['end']],parsed['text'])
        self.assertEqual(parsed['text'],'[§1-2] Title. Body.')

    def test_unknown_printed_tail_fails_completeness(self):
        parsed=parse_section_html(source('<p><b>§1-2 Title.</b> Body.</p> Unclassified printed tail'),'HRS_0001-0002.htm')
        self.assertFalse(parsed['source_character_sequence_preserved'])
        self.assertTrue(parsed['unclassified'])

    def test_table_cells_not_duplicated_and_images_not_invented(self):
        parsed=parse_section_html(source('<p><b>§1-2 Title.</b></p><table><tr><td><p>Amount</p></td><td><p>$5</p></td></tr></table>'
            '<p><img src="chart.png" alt="Official chart"></p>'),'HRS_0001-0002.htm')
        self.assertEqual(parsed['text'],'§1-2 Title.\nAmount\t$5')
        self.assertEqual(parsed['attachments'][0]['src'],'chart.png')
        self.assertTrue(parsed['source_character_sequence_preserved'])

    def test_index_is_not_a_statute_and_retains_publisher_chapter(self):
        parsed=parse_chapter_index(source('<p>CHAPTER 6E</p><p>HISTORIC PRESERVATION</p><p>Section</p><p>6E-1 Purpose</p>'),'HRS_0006E-.htm')
        self.assertEqual(parsed['chapter'],'6E');self.assertEqual(parsed['heading'],'HISTORIC PRESERVATION')

    def test_exact_filename_and_content_boundary_required(self):
        with self.assertRaises(ValueError):parse_section_html(source('<p>x</p>'),'../secret.htm')
        with self.assertRaises(ValueError):parse_section_html('<html><p>§1-1 Fake outside container</p></html>','HRS_0001-0001.htm')

    def test_bracketed_and_wrapped_chapter_heading_preserved(self):
        parsed=parse_chapter_index(source('<p align="center">[Chapter 14D]</p><p align="center">Agreement among the states</p>'
            '<p align="center">to elect the president</p><p>Section</p>'),'HRS_0014D-.htm')
        self.assertEqual(parsed['chapter'],'14D')
        self.assertEqual(parsed['heading'],'Agreement among the states\nto elect the president')
        parsed=parse_chapter_index(source('<p align="center">[CHAPTER 56</p><p align="center">PARKING]</p><p>Section</p>'),'HRS_0056-.htm')
        self.assertEqual(parsed['heading'],'PARKING]')

    def test_old_and_new_chapter_headings_are_both_retained(self):
        parsed=parse_chapter_index(source('<p align="center">CHAPTER 14 [OLD]</p><p align="center">ABSENTEE VOTING</p>'
            '<p>REPEALED. Source citation.</p><p align="center">CHAPTER 14 [NEW]</p>'
            '<p align="center">PRESIDENTIAL ELECTIONS</p><p>Section</p>'),'HRS_0014-.htm')
        self.assertEqual(parsed['chapter'],'14')
        self.assertEqual(parsed['heading'],'CHAPTER 14 [OLD]\nABSENTEE VOTING\nCHAPTER 14 [NEW]\nPRESIDENTIAL ELECTIONS')
        self.assertEqual(len(parsed['chapter_headers']),2)

    def test_index_chapter_cannot_take_another_native_identity(self):
        with self.assertRaisesRegex(ValueError,'identity differs'):
            parse_chapter_index(source('<p>CHAPTER 2</p><p>OTHER CHAPTER</p>'),'HRS_0001-.htm')

    def test_fresh_sample_covers_every_volume_deterministically(self):
        volumes=[ROOT+f'Vol{i:02}_Sample/'for i in range(1,15)]
        inventory=dict(volumes=volumes,pages=[v+f'HRS0001/HRS_0001-{i:04}.htm'for v in volumes for i in range(1,4)])
        selected=selected_urls(inventory)
        self.assertEqual(len(selected),20);self.assertEqual(selected,selected_urls(inventory))
        self.assertTrue(all(any(url.startswith(v)for url in selected)for v in volumes))
        with self.assertRaises(ValueError):selected_urls(inventory,101)

    def test_source_style_exception_requires_exact_native_citation(self):
        page=source('<p class="XNotes"><b>[§291C-130.5] Title.</b> Complete statute.</p><p> </p>')
        parsed=parse_section_html(page,'HRS_0291C-0130_0005.htm')
        self.assertEqual(parsed['citation'],'291C-130.5');self.assertEqual(parsed['annotations'],[])
        self.assertTrue(parsed['source_style_exceptions']);self.assertTrue(parsed['source_character_sequence_preserved'])
        wrong=parse_section_html(page,'HRS_0291C-0130_0006.htm')
        self.assertIsNone(wrong['citation']);self.assertTrue(wrong['unclassified']);self.assertFalse(wrong['source_style_exceptions'])

    def test_ambiguous_note_sequence_does_not_become_statute(self):
        parsed=parse_section_html(source('<p class="XNotes"><b>[§1-1] Title.</b> Quoted text.</p>'
            '<p class="XNotes">Editorial continuation.</p>'),'HRS_0001-0001.htm')
        self.assertIsNone(parsed['citation']);self.assertEqual(len(parsed['annotations']),2)


class HawaiiCaptureTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.base=Path(self.temp.name)
        self.capture=self.base/'capture';self.capture.mkdir();(self.capture/'raw').mkdir();(self.capture/'receipts').mkdir()
        self.volumes=[ROOT+f'Vol{i:02}_Sample/'for i in range(1,15)]
        self.chapter=self.volumes[0]+'HRS0001/';self.index=self.chapter+'HRS_0001-.htm';self.section=self.chapter+'HRS_0001-0001.htm'
        self.keep(ROOT,''.join(f'<a href="{url}">Volume</a>'for url in self.volumes))
        for url in self.volumes:self.keep(url,f'<a href="{self.chapter}">Chapter</a>'if url==self.volumes[0]else'<html></html>')
        receipt=self.keep(self.chapter,f'<a href="{self.index}">Index</a><a href="{self.section}">Section</a>')
        self.keep(self.index,source('<p>CHAPTER 1</p><p>GENERAL</p><p>Section</p>'))
        self.keep(self.section,source('<p><b>§1-1 Title.</b> Published body.</p><p class="XNotes">Separate annotation.</p>'))
        self.inventory=dict(schema_version='hi-publisher-directory/1',root=ROOT,volumes=self.volumes,
            chapters=[dict(source_url=self.chapter,sha256=receipt['sha256'],pages=[self.index,self.section])],pages=[self.index,self.section],errors=[])
        self.save_inventory()

    def tearDown(self):self.temp.cleanup()

    def save_inventory(self):
        (self.capture/'directory-inventory.json').write_text(json.dumps(self.inventory),encoding='utf8')

    def keep(self,url,text):
        body=text.encode('utf8');sha=digest(body);receipt=dict(source_url=url,final_url=url,http_status=200,sha256=sha,
            raw_file='raw/'+sha,bytes=len(body),retrieved_at='2026-10-12T12:00:00+00:00',retrieval_method='publisher_page',proxy=None)
        (self.capture/'raw'/sha).write_bytes(body)
        (self.capture/'receipts'/(digest(url.encode())+'.json')).write_text(json.dumps(receipt),encoding='utf8')
        return receipt

    def test_packet_preserves_source_bytes_and_separates_annotations(self):
        out=self.base/'packet';report=stage(self.capture,out,True)
        self.assertTrue(report['ready_for_private_intake']);self.assertFalse(report['publication_allowed'])
        rows=[json.loads(line)for line in (out/'sections.jsonl').read_text('utf8').splitlines()]
        self.assertEqual(len(rows),1);self.assertEqual(rows[0]['citation_path'],'HRS_0001-0001')
        self.assertEqual(rows[0]['text'],'§1-1 Title. Published body.')
        self.assertIn('Separate annotation.',(out/'annotations.jsonl').read_text('utf8'))
        objects=[json.loads(line)for line in (out/'objects.jsonl').read_text('utf8').splitlines()]
        self.assertTrue(all(digest(Path(row['path']).read_bytes())==row['sha256']for row in objects))
        self.assertTrue(verify(self.capture,out)['passed'])

    def test_raw_upload_plan_never_claims_complete_or_approved_intake(self):
        report=prepare(self.capture,self.base/'raw-plan')
        rows=[json.loads(line)for line in(self.base/'raw-plan/objects.jsonl').read_text('utf8').splitlines()]
        self.assertEqual(report['captured_pages'],2)
        self.assertTrue(all(row['kind']=='publisher_original'for row in rows))
        self.assertFalse(report['private_intake_allowed']);self.assertFalse(report['publication_allowed'])
        self.assertEqual(report['objects_file_sha256'],digest((self.base/'raw-plan/objects.jsonl').read_bytes()))
        self.assertEqual(len(validate_plan(self.capture,self.base/'raw-plan')[1]),len(rows))
        with self.assertRaises(FileExistsError):prepare(self.capture,self.base/'raw-plan')


    def test_group_digest_binds_provenance_and_is_order_independent(self):
        rows=[dict(entity_type='code-section',native_id='HI:HRS_0001-000'+str(i),provenance=dict(
            source_url=ROOT+'Vol01_Sample/HRS0001/HRS_0001-000'+str(i)+'.htm',record_sha256='a'*64,retrieved_at='2026-10-12T00:00:00Z'))for i in [1,2]]
        self.assertEqual(expected_groups(rows),expected_groups(list(reversed(rows))))
        changed=deepcopy(rows);changed[0]['provenance']['retrieved_at']='2026-10-11T00:00:00Z'
        self.assertNotEqual(expected_groups(rows),expected_groups(changed))

    def test_readback_requires_private_scope_all_proofs_and_baseline(self):
        expected=dict(manifest_sha256='a'*64,run_id='00000000-0000-5000-8000-000000000001',sections=1,units=1,
            groups=[],baseline_current_groups=[{'records':1500}],baseline_version_groups=[{'versions':1500}])
        state=dict(last_run=expected['run_id'],current_manifest_sha256=expected['manifest_sha256'],
            review_status='landed',public_projection_allowed=False,sections=1,units=1501)
        actual=dict(schema='hi-post-intake-readback/1',read_only='on',groups=[],state=state,run=dict(id=expected['run_id'],status='completed'),
            open_runs=0,baseline_current_groups=expected['baseline_current_groups'],baseline_version_groups=expected['baseline_version_groups'],
            totals=dict(sections=1,units=1,**{key:0 for key in ['bad_payload','bad_scope','bad_gates','bad_version','bad_original','bad_unit_or_derivative','bad_native']}))
        with tempfile.TemporaryDirectory()as temp:
            ep=Path(temp)/'expected.json';rp=Path(temp)/'readback.json';ep.write_text(json.dumps(expected))
            rp.write_text(json.dumps(actual));self.assertTrue(check(ep,rp)['passed'])
            for mutate in [lambda value:value['totals'].update(bad_payload=1),lambda value:value.update(open_runs=1),
                    lambda value:value['state'].update(public_projection_allowed=True),lambda value:value['state'].update(units=1),
                    lambda value:value.update(baseline_version_groups=[])]:
                changed=deepcopy(actual);mutate(changed);rp.write_text(json.dumps(changed));self.assertFalse(check(ep,rp)['passed'])

    def test_incomplete_capture_refuses_packet(self):
        (self.capture/'receipts'/(digest(self.section.encode())+'.json')).unlink()
        with self.assertRaisesRegex(ValueError,'incomplete'):stage(self.capture,self.base/'partial',True)
        self.assertFalse((self.base/'partial/sections.jsonl').exists())

    def test_rehashed_inventory_cannot_invent_publisher_anchor(self):
        invented=self.chapter+'HRS_0001-0999.htm'
        self.inventory['pages'].append(invented);self.inventory['chapters'][0]['pages'].append(invented);self.save_inventory()
        with self.assertRaisesRegex(ValueError,'anchors differ'):discovery(self.capture)

    def test_tampered_source_bytes_rejected(self):
        receipt,_=exact_capture(self.capture,self.section);(self.capture/'raw'/receipt['sha256']).write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError,'hash/length'):exact_capture(self.capture,self.section)

    def test_receipt_cannot_substitute_redirected_or_proxy_source(self):
        path=self.capture/'receipts'/(digest(self.section.encode())+'.json');receipt=json.loads(path.read_text())
        receipt['final_url']=self.index;path.write_text(json.dumps(receipt))
        with self.assertRaisesRegex(ValueError,'identity differs'):exact_capture(self.capture,self.section)

    def test_missing_image_blocks_intake_and_forged_reference_cannot_fetch(self):
        receipt=self.keep(self.section,source('<p><b>§1-1 Title.</b> Text.</p><p><img src="chart.gif"></p>'))
        out=self.base/'images';report=stage(self.capture,out)
        self.assertFalse(report['ready_for_private_intake'])
        refs=verified_references(self.capture,out/'attachments.jsonl');self.assertEqual(list(refs),[self.chapter+'chart.gif'])
        forged=dict(source_url=self.section,source_sha256=receipt['sha256'],src='absent.gif',asset_url=self.chapter+'absent.gif',alt=None,title=None)
        path=self.base/'forged.jsonl';path.write_text(json.dumps(forged)+'\n')
        with self.assertRaisesRegex(ValueError,'differs from exact'):verified_references(self.capture,path)

    def test_independent_verifier_rejects_shifted_source_span(self):
        out=self.base/'packet';stage(self.capture,out,True)
        path=out/'sections.jsonl';row=json.loads(path.read_text('utf8'));row['span']['start']=1
        path.write_text(json.dumps(row)+'\n',encoding='utf8')
        with self.assertRaisesRegex(ValueError,'span differs'):verify(self.capture,out)

    def test_independent_verifier_rejects_annotation_loss(self):
        out=self.base/'packet';stage(self.capture,out,True)
        (out/'annotations.jsonl').write_text('',encoding='utf8')
        with self.assertRaisesRegex(ValueError,'annotations were omitted'):verify(self.capture,out)

    def test_independent_verifier_rejects_invented_metadata(self):
        out=self.base/'packet';stage(self.capture,out,True)
        path=out/'sections.jsonl';original=json.loads(path.read_text('utf8'))
        for change in [lambda row:row.update(citation='99-999'),lambda row:row['hierarchy'][0].update(number='99'),
                lambda row:row['hierarchy'][0].update(heading='Invented chapter heading')]:
            row=deepcopy(original);change(row);path.write_text(json.dumps(row)+'\n',encoding='utf8')
            with self.assertRaisesRegex(ValueError,'citation or heading|hierarchy'):verify(self.capture,out)

    def test_source_style_exception_has_complete_independent_text_proof(self):
        self.keep(self.section,source('<p class="XNotes"><b>[§1-1] Title.</b> Published statute.</p>'))
        out=self.base/'packet';report=stage(self.capture,out,True)
        self.assertEqual(report['source_style_exception_pages'],1)
        self.assertTrue(verify(self.capture,out)['passed'])

    def test_independent_rule_proof_requires_literal_label_and_disclosure(self):
        self.chapter=self.volumes[0]+'HRS0626/';self.index=self.chapter+'HRS_0626-.htm'
        self.section=self.chapter+'HRS_0626-0001-0504_0001.htm'
        self.keep(self.volumes[0],f'<a href="{self.chapter}">Chapter</a>')
        receipt=self.keep(self.chapter,f'<a href="{self.index}">Index</a><a href="{self.section}">Rule</a>')
        self.keep(self.index,source('<p>CHAPTER 626</p><p>HAWAII RULES OF EVIDENCE</p><p>Section</p>'))
        self.keep(self.section,source('<p><b>Rule 504.1 Privilege.</b> Complete rule.</p><p class="XNotes">Commentary.</p>'))
        self.inventory['chapters']=[dict(source_url=self.chapter,sha256=receipt['sha256'],pages=[self.index,self.section])]
        self.inventory['pages']=[self.index,self.section];self.save_inventory()
        out=self.base/'packet';report=stage(self.capture,out,True)
        self.assertEqual(report['evidence_rule_pages'],1);self.assertTrue(verify(self.capture,out)['passed'])
        path=out/'sections.jsonl';row=json.loads(path.read_text('utf8'));row['status_note']=None
        path.write_text(json.dumps(row)+'\n',encoding='utf8')
        with self.assertRaisesRegex(ValueError,'Evidence rule requires'):verify(self.capture,out)


class StorageOnlyTransportTests(unittest.TestCase):
    class TransportError(Exception):pass
    class Response:
        def __init__(self,status=200,headers=None,body=None,blocks=None,error=None):
            self.status_code=status;self.headers=headers or{};self.body=body;self.blocks=blocks or[b'raw'];self.error=error;self.closed=False;self.text=''
        def json(self):return self.body
        def close(self):self.closed=True
        def iter_content(self,size):
            if self.error:raise self.error
            yield from self.blocks
    class Gate:
        def __init__(self):self.delays=[];self.paused=False
        def defer(self,seconds):self.delays.append(seconds)
        def pause(self):self.paused=True
        def wait(self):
            if self.paused:raise RuntimeError('paused')
    def cloud(self,responses):
        queue=list(responses)
        class Base:
            def __init__(self):self.url='https://synthetic.invalid';self.h={};self.s=SimpleNamespace(get=lambda*args,**kwargs:queue.pop(0))
        class Digest:
            def __init__(self):self.n=0
            def update(self,block):self.n+=len(block)
        codec=SimpleNamespace(Cloud=Base,Digest=Digest,requests=SimpleNamespace(RequestException=self.TransportError))
        self.gate=self.Gate();self.events=[]
        return cloud_type(codec,self.gate,SimpleNamespace(append=self.events.append))()
    def test_retry_after_closes_failed_response_and_shares_delay(self):
        throttled=self.Response(429,{'Retry-After':'15'});ok=self.Response()
        cloud=self.cloud([throttled,ok]);response=cloud._retry(lambda:cloud.s.get('fixture'))
        self.assertIs(response,ok);self.assertTrue(throttled.closed);self.assertEqual(self.gate.delays,[15])
        self.assertEqual(retry_after('Thu, 01 Jan 1970 00:00:10 GMT',clock=lambda:0),10)
        self.assertEqual(retry_after('Infinity'),0)
    def test_long_retry_after_pauses_all_workers_without_ignoring_wait(self):
        response=self.Response(503,{'Retry-After':'120'});cloud=self.cloud([response])
        with self.assertRaisesRegex(RuntimeError,'60 seconds'):cloud._retry(lambda:cloud.s.get('fixture'))
        self.assertTrue(response.closed);self.assertTrue(self.gate.paused)
        self.assertEqual(self.events[0]['resume_after_seconds'],120)
    def test_interrupted_stream_is_closed_before_complete_retry(self):
        interrupted=self.Response(error=self.TransportError());ok=self.Response(blocks=[b'abc',b'def'])
        cloud=self.cloud([interrupted,ok]);status,body=cloud.readback('synthetic')
        self.assertEqual((status,body.n),(200,6));self.assertTrue(interrupted.closed);self.assertTrue(ok.closed)
    def test_permission_failure_is_not_treated_as_missing_object(self):
        response=self.Response(403);cloud=self.cloud([response])
        with self.assertRaisesRegex(RuntimeError,'denied'):cloud.readback('synthetic')
        self.assertTrue(response.closed)
    def test_storage_missing_error_and_private_bucket_are_explicit(self):
        missing=self.Response(400,body={'statusCode':'404'});cloud=self.cloud([missing])
        self.assertEqual(cloud.readback('synthetic'),(400,None));self.assertTrue(missing.closed)
        response=self.Response(body={'id':'corpus-originals','public':True});cloud=self.cloud([response])
        with self.assertRaisesRegex(RuntimeError,'not confirmed private'):cloud.assert_private_bucket()
        self.assertTrue(response.closed)
    def test_storage_only_wrapper_cannot_call_rpc(self):
        with self.assertRaisesRegex(RuntimeError,'cannot call'):self.cloud([]).rpc('any',{})
    def test_checkpoint_binds_exact_bucket_key_hash_length_and_time(self):
        row=dict(sha256='a'*64,bytes=3)
        receipt=dict(bucket='corpus-originals',object_key='state-codes/sha256/aa/'+'a'*64,readback_sha256='a'*64,
            bytes=3,readback_bytes=3,http_status=200,verification_method='authenticated-whole-object-get-sha256',verified_at='2026-10-12T00:00:00Z')
        valid_receipt(row,receipt)
        for change in [dict(bucket='public'),dict(readback_bytes=4),dict(readback_sha256='b'*64),dict(verified_at='not recorded')]:
            with self.assertRaises(ValueError):valid_receipt(row,{**receipt,**change})


if __name__=='__main__':unittest.main()
