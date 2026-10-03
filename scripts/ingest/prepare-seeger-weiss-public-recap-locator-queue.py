"""Local-only source-qualified queue derivation; no network or PDF/DB operations."""
import collections,datetime,hashlib,importlib.util,json,re
from pathlib import Path
from urllib.parse import urlparse,unquote

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('html_evidence',HERE/'prepare-seeger-weiss-firecrawl-docket-metadata.py')
H=importlib.util.module_from_spec(spec);spec.loader.exec_module(H)
BASE=H.BASE;OLD=H.CACHE;PAG=OLD/'pagination-v1';OUT=PAG/'reviewed-v1'
STATE_SHA='6e943e670054194d45467c7b76dd24cb1e581a49e56740e4dbf2842425ed340f'
INITIAL_SHA='7547080bd0777bd743d50006f750b9cbd33dba2fa1073077054e9ec2d7ed6ad6'
def path_uri(uri):return Path(unquote(urlparse(uri).path).lstrip('/'))
def strip_urls(x):
 if isinstance(x,dict):return {k:strip_urls(v) for k,v in x.items() if k not in ('download_url','pdf_url')}
 if isinstance(x,list):return [strip_urls(v) for v in x]
 return x
def span_text(body,start,end,field):
 return {'source_field':field,'unicode_character_start':start,'unicode_character_end':end,
         'span_sha256':H.sha(body[start:end].encode('utf-8')),'span_codec':'python-unicode-substring-utf8/1'}
def main():
 OUT.mkdir(exist_ok=True)
 state_file=PAG/'final-capture-state.json';state_raw=state_file.read_bytes();assert H.sha(state_raw)==STATE_SHA
 state=json.loads(state_raw);assert state['successful_pages']==60
 scopes={r['native_case_id']:r for r in map(json.loads,(OLD/'targets-v1.jsonl').read_text(encoding='utf-8').splitlines())}
 initial=OLD/'reviewed-v1/direct-recap-pdf-candidates.jsonl';initial_raw=initial.read_bytes();assert H.sha(initial_raw)==INITIAL_SHA
 native_file=BASE/'tavily/reviewed-v1/courtlistener-private-pdf-seeds-v2.jsonl';assert H.sha(native_file.read_bytes())==H.KNOWN_SHA
 native=collections.defaultdict(list)
 with native_file.open(encoding='utf-8') as stream:
  for i,line in enumerate(stream,1):
   r=json.loads(line)
   if r.get('download_url'):native[(str(r['native_case_id']),r['download_url'])].append({'native_document_id':str(r['native_document_id']),'source_ordinal':i,'seed_record_sha256':H.sha(H.packed(r))})
 occurrences=[];pages=[];row_records=[];artifacts={};normalized=[]
 for ordinal,line in enumerate(initial_raw.decode('utf-8').splitlines(),1):
  r=json.loads(line);d=r['data'];p=r['provenance'];assert H.sha(H.packed(d))==p['record_sha256']
  origin={**strip_urls(p),'native_case_id':d['native_case_id'],'native_record_sha256':p['record_sha256'],
          'native_record_hash_codec':'frozen-initial-html-candidate-sorted-utf8-integer-json/1',
          'source_record_file_uri':initial.as_uri(),'source_record_file_sha256':INITIAL_SHA,'source_record_ordinal':ordinal,
          'source_link_spans':d['source_link_spans'],'source_document_span':d['source_document_span'],
          'source_format':'firecrawl_returned_raw_html','backend_api_id_verified':False}
  occurrences.append({'case':d['native_case_id'],'url':d['download_url'],'held':d['sealing_related_locator_held'],
                      'origin':origin,'labels':d['labels'],'from_initial':True})
 targets=sorted(state['successful_targets'],key=lambda t:(int(t['native_case_id']),int(re.search(r'page=(\d+)',t['source_url']).group(1))))
 for target_ordinal,t in enumerate(targets,1):
  case=t['native_case_id'];assert case in scopes
  capture_path=path_uri(t['capture_file_uri']);capture_raw=capture_path.read_bytes();cap=json.loads(capture_raw)
  result=cap['result'];assert not result.get('isError')
  provider='tavily' if t.get('provider')=='tavily' else 'firecrawl'
  if provider=='tavily':
   source_result=result['structuredContent']['results'][t['provider_result_ordinal']-1]
   assert source_result['url']==t['source_url'];body=source_result['raw_content']
   field='result.structuredContent.results['+str(t['provider_result_ordinal']-1)+'].raw_content'
   status=None;fmt='provider_cleaned_markdown';credits=None
  else:
   source_result=result['structuredContent'];assert source_result['metadata']['sourceURL']==t['source_url']
   body=source_result['rawHtml'];field='result.structuredContent.rawHtml';status=source_result['metadata']['statusCode'];assert status==200
   fmt='firecrawl_returned_raw_html';credits=source_result['metadata'].get('creditsUsed')
  artifacts[capture_path.as_uri()]={'file_uri':capture_path.as_uri(),'sha256':H.sha(capture_raw),'bytes':len(capture_raw),'provider':provider}
  discovery=path_uri(t['discovery_capture_file_uri']);discovery_raw=discovery.read_bytes();discovery_cap=json.loads(discovery_raw)
  if t.get('discovery_capture_sha256'):assert H.sha(discovery_raw)==t['discovery_capture_sha256']
  discovery_result=discovery_cap['result']['structuredContent']
  if t.get('discovery_source_format')=='provider_cleaned_markdown':
   discovery_body=discovery_result['results'][t['discovery_result_ordinal']-1]['raw_content'];assert t['source_url'] in discovery_body
  else:assert t['source_url'] in json.dumps(discovery_result,ensure_ascii=False)
  provenance={'source_url':t['source_url'],'source_sha256':H.sha(body.encode('utf-8')),'source_hash_codec':'provider-returned-content-utf8/1',
              'source_hash_is_origin_http_wire_hash':False,'original_provider_capture_file_uri':capture_path.as_uri(),
              'original_provider_capture_sha256':H.sha(capture_raw),'retrieved_at':cap['returned_at'],
              'http_status':status,'http_status_is_provider_reported':status is not None,'source_format':fmt,
              'capture_state_file_uri':state_file.as_uri(),'capture_state_sha256':STATE_SHA,'capture_target_ordinal':target_ordinal,
              'native_case_id':case,'firm_index_scope_evidence':scopes[case]['firm_index_scope_evidence'],
              'discovery_source_url':t['discovery_source_url'],'discovery_capture_file_uri':discovery.as_uri(),
              'discovery_capture_sha256':H.sha(discovery_raw),'discovery_link_span':t.get('discovery_link_span'),
              'discovery_provider_link_index':t.get('discovery_provider_link_index'),'discovery_result_ordinal':t.get('discovery_result_ordinal'),
              'discovery_text_url_span':t.get('discovery_text_url_span')}
  observations=[];page={'native_case_id':case,'source_url':t['source_url'],'source_docket_number':scopes[case]['docket_number'],
                       'source_format':fmt,'body_characters':len(body),'http_status':status,'credits_used_provider_reported':credits,
                       'source_body_sha256':provenance['source_sha256'],'source_coverage_complete_claimed':False}
  if provider=='firecrawl':
   root=H.Tree(body).root
   headers=[]
   for p in root.descendants('p'):
    hs=[x for x in p.descendants('span') if 'meta-data-header' in x.classes()];vs=[x for x in p.descendants('span') if 'meta-data-value' in x.classes()]
    if len(hs)==1 and len(vs)==1:headers.append({'label':hs[0].text(),'value':vs[0].text(),'value_links':H.anchors(vs[0],body),'source_span':H.proof(p,body)})
   page['case_fields']=headers
   table=next(n for n in root.descendants() if n.attrs.get('id')=='docket-entry-table')
   rows=[n for n in table.children if isinstance(n,H.Node) and 'row' in n.classes() and any(x in n.classes() for x in ('odd','even'))]
   page['visible_html_entry_rows']=len(rows)
   for ri,row in enumerate(rows,1):
    cells=[n for n in row.children if isinstance(n,H.Node) and n.tag=='div'];desc=next((n for n in cells[2].children if isinstance(n,H.Node) and n.tag=='p'),None) if len(cells)>2 else None
    row_data={'native_case_id':case,'source_row_ordinal':ri,'display_document_number':cells[0].text() if cells else None,
              'date_filed_literal':cells[1].text() if len(cells)>1 else None,'description':desc.text() if desc else None,'source_span':H.proof(row,body)}
    row_records.append({'data':row_data,'provenance':provenance,'record_sha256':H.sha(H.packed(row_data))})
    for di,doc in enumerate([n for n in row.descendants('div') if 'recap-documents' in n.classes()],1):
     links=H.anchors(doc,body);labels=[n.text() for n in doc.descendants('p')]
     for url in dict.fromkeys(a['url'] for a in links if H.safe_pdf(a['url'])):
      observations.append({'native_case_id':case,'publisher_observed_pdf_locator_url':url,'source_row_ordinal':ri,'source_document_section_ordinal':di,
                           'display_document_number':row_data['display_document_number'],'date_filed_literal':row_data['date_filed_literal'],
                           'labels':labels,'source_row_description':row_data['description'],'source_document_span':H.proof(doc,body),
                           'source_link_spans':[a['source_span'] for a in links if a['url']==url],
                           'sealing_related_locator_held':bool(re.search(r'\b(?:seal|sealed|sealing|restricted)\b',' '.join(labels)+' '+(row_data['description'] or ''),re.I))})
  else:
   markers=list(re.finditer(r'(?m)^([1-9]\d*)\s*\n\s*\n([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})\s*\n',body))
   row_ranges=[]
   for ri,m in enumerate(markers,1):
    end=markers[ri].start() if ri<len(markers) else len(body)
    row_ranges.append((m.start(),end,ri,m.group(1),m.group(2)))
    data={'native_case_id':case,'source_row_ordinal':ri,'display_document_number':m.group(1),'date_filed_literal':m.group(2),
          'row_marker_qualification':'Number/date pattern in cleaned Markdown; not a backend docket-entry ID or exhaustive row count.',
          'rendered_row_text':body[m.start():end],'source_span':span_text(body,m.start(),end,field)}
    row_records.append({'data':data,'provenance':provenance,'record_sha256':H.sha(H.packed(data))})
   page['numbered_dated_markdown_row_markers']=len(markers)
   page['case_header_source_text']=body[:min(len(body),body.find('Document Number') if body.find('Document Number')>0 else 14000)]
   page['case_header_source_span']=span_text(body,0,len(page['case_header_source_text']),field)
   matches=list(re.finditer(r'https://storage\.courtlistener\.com/recap/[A-Za-z0-9._/-]+\.pdf',body))
   grouped=collections.defaultdict(list)
   for m in matches:
    if H.safe_pdf(m.group(0)):grouped[m.group(0)].append(m)
   for url,url_matches in grouped.items():
    m=url_matches[0];row=next((r for r in row_ranges if r[0]<=m.start()<r[1]),None)
    start,end=(row[0],row[1]) if row else (max(0,m.start()-700),min(len(body),m.end()+700))
    context=body[start:end]
    observations.append({'native_case_id':case,'publisher_observed_pdf_locator_url':url,'source_row_ordinal':row[2] if row else None,
                         'display_document_number':row[3] if row else None,'date_filed_literal':row[4] if row else None,
                         'labels':[],'source_rendered_context':context,'source_document_span':span_text(body,start,end,field),
                         'source_link_spans':[span_text(body,x.start(),x.end(),field) for x in url_matches],
                         'sealing_related_locator_held':bool(re.search(r'\b(?:seal|sealed|sealing|restricted)\b',context,re.I))})
  page['pdf_locator_observations']=len(observations);pages.append({'data':page,'provenance':provenance,'record_sha256':H.sha(H.packed(page))})
  for ordinal,d in enumerate(observations,1):
   digest=H.sha(H.packed(d));origin={**provenance,'native_record_sha256':digest,'native_record_hash_codec':'extracted-public-recap-locator-json/1',
                                  'source_record_ordinal':ordinal,'source_link_spans':d['source_link_spans'],'source_document_span':d['source_document_span']}
   normalized.append({'data':d,'provenance':origin,'record_sha256':digest})
   occurrences.append({'case':case,'url':d['publisher_observed_pdf_locator_url'],'held':d['sealing_related_locator_held'],
                       'origin':origin,'labels':d['labels'],'from_initial':False})
 files={'pagination_page_records':H.jsonl(OUT/'page-records.jsonl',pages),'visible_row_records':H.jsonl(OUT/'visible-row-records.jsonl',row_records),
        'pagination_locator_observations':H.jsonl(OUT/'locator-observations.jsonl',normalized)}
 source_file=OUT/'locator-observations.jsonl'
 for occurrence in occurrences:
  if not occurrence['from_initial']:
   occurrence['origin'].update({'source_record_file_uri':source_file.as_uri(),'source_record_file_sha256':files['pagination_locator_observations']['sha256'],
                                'source_record_file_ordinal':next(i for i,x in enumerate(normalized,1) if x['record_sha256']==occurrence['origin']['native_record_sha256'])})
 groups=collections.defaultdict(list)
 for x in occurrences:groups[x['url']].append(x)
 queue=[];held=[]
 for url,obs in sorted(groups.items()):
  cases={x['case'] for x in obs};reasons=[]
  if len(cases)!=1:reasons.append('multiple_observed_parent_docket_ids')
  if any(x['held'] for x in obs):reasons.append('sealing_related_source_text')
  if any(native.get((x['case'],url)) for x in obs):reasons.append('exact_cached_native_API_document_match')
  if reasons:
   held.append({'locator_url':url,'observed_native_case_ids':sorted(cases),'reasons':reasons,'source_observations':len(obs),
                'source_record_sha256':[x['origin']['native_record_sha256'] for x in obs],
                'native_API_matches':[x for c in cases for x in native.get((c,url),[])]});continue
  case=next(iter(cases));assert H.safe_pdf(url) and case in scopes
  origins=[];seen=set()
  for x in sorted(obs,key=lambda x:(x['origin']['retrieved_at'],x['origin']['native_record_sha256'])):
   origin=strip_urls(x['origin']);key=(origin['native_record_sha256'],origin['original_provider_capture_sha256'],origin['retrieved_at'])
   if key not in seen:origins.append(origin);seen.add(key)
  selected=origins[-1]['native_record_sha256']
  queue.append({'schema_version':'source-qualified-pdf-queue/1','provider':'courtlistener-public-locator',
                'native_document_identity_kind':'publisher_observed_pdf_locator_url','native_document_id':url,'native_case_id':case,
                'durable_url':url,'download_url':url,'expected_sha1':None,'expected_bytes':None,'eligible':True,
                'provider_flags':{'public_pdf_link_observed':True,'sealing_related_locator_held':False,'backend_api_id_verified':False,'api_availability_verified':False},
                'source_privacy_qualification':{'source_seal_status':'unknown','private_quarantine_required':True,'public_projection_allowed':False},
                'selected_source_record_sha256':selected,'origins':origins,
                'provenance':{'normalizer_version':'seeger-weiss-public-recap-locator/1','capture_state_sha256':STATE_SHA,
                              'original_initial_locator_file_sha256':INITIAL_SHA,'pagination_locator_file_sha256':files['pagination_locator_observations']['sha256'],
                              'native_API_comparison_file_sha256':H.KNOWN_SHA,'backend_document_id_inferred':False,'pdf_body_fetched':False},
                'scope':{'source_system':'courtlistener-public-locator','native_case_id':case,'public_projection_allowed':False,
                         'calculation_activation_allowed':False,'legal_outcome_activation_allowed':False,'complete_docket_capture_claimed':False}})
 files['pdf_queue']=H.jsonl(OUT/'courtlistener-public-locator-queue-v1.jsonl',queue)
 files['held_locator_ledger']=H.jsonl(OUT/'held-locators.jsonl',held)
 H.dump(OUT/'original-pagination-provider-artifacts.json',list(artifacts.values()))
 manifest={'schema_version':'seeger-weiss-public-recap-pagination-review/1','created_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
           'successful_additional_pages':len(pages),'new_HTML_pages':25,'new_cleaned_Markdown_pages':35,'exact_native_dockets':len({t['native_case_id'] for t in targets}),
           'initial_locator_occurrences':884,'additional_locator_observations':len(normalized),'all_locator_observations':len(occurrences),
           'unique_publisher_pdf_URLs':len(groups),'queue_eligible_unique_URLs':len(queue),'held_unique_URLs':len(held),
           'held_reason_counts':dict(collections.Counter(reason for x in held for reason in x['reasons'])),
           'visible_HTML_entry_rows':sum(p['data'].get('visible_html_entry_rows',0) for p in pages),
           'numbered_dated_Markdown_row_markers':sum(p['data'].get('numbered_dated_markdown_row_markers',0) for p in pages),
           'retained_firecrawl_attempts':27,'retained_firecrawl_failures':2,'unsaved_initial_firecrawl_returns_due_local_capture_error':3,
           'Tavily_extract_calls':13,'Tavily_failed_page_targets':1,'reported_success_Firecrawl_credits':25,'other_Firecrawl_credit_use_unknown':True,
           'unfollowed_frontier_targets':len(state['unfollowed_frontier']),'no_full_docket_or_all_member_claim':True,
           'native_backend_document_ids_inferred':0,'PDF_bodies_fetched':0,'CourtListener_API_calls':0,'DB_writes':0,'uploads':0,'deletions':0,
           'scope_gate_public_projection_allowed':False,'scope_gate_calculation_activation_allowed':False,
           'capture_state_sha256':STATE_SHA,'original_initial_locator_sha256':INITIAL_SHA,'files':files,'original_provider_artifacts':list(artifacts.values())}
 H.dump(OUT/'manifest.json',manifest)
 print(json.dumps({k:v for k,v in manifest.items() if k not in ('files','original_provider_artifacts')},ensure_ascii=True))
 print(json.dumps({'files':files,'manifest_sha256':H.sha((OUT/'manifest.json').read_bytes())}))

if __name__=='__main__':main()
