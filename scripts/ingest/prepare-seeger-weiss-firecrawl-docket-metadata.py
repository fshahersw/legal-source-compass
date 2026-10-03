"""Derive private, source-qualified visible rows from frozen Firecrawl docket returns.

No network, database, PDF access, or source mutations. Display document numbers
are never interpreted as CourtListener RECAP document IDs.
"""
import collections
import datetime
import hashlib
import html
import json
import re
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import parse_qs, urlparse

BASE = Path('C:/Users/firas/.codex/corpus-cache/seeger-weiss/2026-10-02')
CACHE = BASE / 'firecrawl-dockets'
OUT = CACHE / 'reviewed-v1'
TARGET_SHA = '91445a4ddc3856145a1fbcf57ce82dfc89f879b6f858128a9c89979a53222f60'
KNOWN_SHA = '01ce71081bb11c6919fe35fc4aafc5349f1725e57cbc7369ca39d47bcc17d72f'
VOID = {'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def packed(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')

def dump(path, value):
    path.write_bytes(json.dumps(value, ensure_ascii=False, indent=2).encode('utf-8') + b'\n')

def jsonl(path, rows):
    path.write_bytes(b''.join(packed(row) + b'\n' for row in rows))
    return {'file_uri': path.as_uri(), 'bytes': path.stat().st_size, 'sha256': sha(path.read_bytes()), 'rows': len(rows)}

class Node:
    def __init__(self, tag, attrs, start, parent=None):
        self.tag = tag
        self.attrs = dict(attrs)
        self.start = start
        self.end = start
        self.parent = parent
        self.children = []
    def text(self):
        return re.sub(r'\s+', ' ', ''.join(x.text() if isinstance(x, Node) else x for x in self.children)).strip()
    def descendants(self, tag=None):
        for child in self.children:
            if isinstance(child, Node):
                if tag is None or child.tag == tag:
                    yield child
                yield from child.descendants(tag)
    def classes(self):
        return self.attrs.get('class', '').split()

class Tree(HTMLParser):
    def __init__(self, source):
        super().__init__(convert_charrefs=True)
        self.source = source
        self.line_starts = [0]
        self.line_starts.extend(m.end() for m in re.finditer('\n', source))
        self.root = Node('root', [], 0)
        self.root.end = len(source)
        self.stack = [self.root]
        self.feed(source)
        self.close()
        for node in self.stack[1:]:
            node.end = len(source)
    def character_offset(self):
        line, col = self.getpos()
        return self.line_starts[line-1] + col
    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs, self.character_offset(), self.stack[-1])
        node.end = node.start + len(self.get_starttag_text())
        self.stack[-1].children.append(node)
        if tag not in VOID:
            self.stack.append(node)
    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.stack.pop()
    def handle_endtag(self, tag):
        end = self.source.find('>', self.character_offset()) + 1
        for i in range(len(self.stack)-1, 0, -1):
            if self.stack[i].tag == tag:
                for node in self.stack[i:]:
                    node.end = end
                del self.stack[i:]
                return
    def handle_data(self, data):
        self.stack[-1].children.append(data)

def proof(node, source):
    fragment = source[node.start:node.end]
    return {'source_field': 'result.structuredContent.rawHtml', 'unicode_character_start': node.start,
            'unicode_character_end': node.end, 'span_sha256': sha(fragment.encode('utf-8')),
            'span_codec': 'python-unicode-substring-utf8/1'}

def anchors(node, source):
    return [{'url': a.attrs['href'], 'label': a.text(), 'title': a.attrs.get('title'),
             'source_span': proof(a, source)} for a in node.descendants('a') if a.attrs.get('href')]

def gates():
    return {'metadata_only': True, 'pdf_body_fetched': False, 'public_projection_allowed': False,
            'calculation_activation_allowed': False, 'legal_outcome_activation_allowed': False,
            'complete_docket_capture_claimed': False, 'all_member_cases_claimed': False,
            'firm_participation_certified': False}

def envelope(kind, identity, data, provenance):
    return {'schema_version': 'seeger-weiss-firecrawl-visible-docket-metadata/1',
            'source_system': 'courtlistener-firecrawl-html', 'entity_type': kind,
            'native_id': identity, 'identity_qualification': 'Synthetic source-review identity; publisher IDs only in explicitly sourced fields.',
            'data': data, 'qualifications': gates(),
            'provenance': {**provenance, 'record_sha256': sha(packed(data)), 'record_hash_codec': 'sorted-utf8-integer-json/1'}}

def safe_pdf(url):
    p = urlparse(url)
    return (p.scheme == 'https' and p.hostname == 'storage.courtlistener.com' and
            not p.username and not p.password and not p.query and not p.fragment and
            re.fullmatch(r'/recap/[A-Za-z0-9._/-]+\.pdf', p.path) is not None and
            all(x not in ('.','..') for x in p.path.split('/')))

def main():
    OUT.mkdir(exist_ok=True)
    target_path = CACHE / 'targets-v1.jsonl'
    target_raw = target_path.read_bytes()
    assert sha(target_raw) == TARGET_SHA
    targets = [json.loads(line) for line in target_raw.decode('utf-8').splitlines()]
    known_path = BASE / 'tavily/reviewed-v1/courtlistener-private-pdf-seeds-v2.jsonl'
    assert sha(known_path.read_bytes()) == KNOWN_SHA
    known = collections.defaultdict(list)
    with known_path.open(encoding='utf-8') as stream:
        for ordinal, line in enumerate(stream, 1):
            row = json.loads(line)
            if row.get('download_url'):
                known[(str(row['native_case_id']), row['download_url'])].append({
                    'native_document_id': str(row['native_document_id']), 'seed_record_ordinal': ordinal,
                    'seed_record_sha256': sha(packed(row)), 'expected_sha1': row.get('expected_sha1'),
                    'expected_bytes': row.get('expected_bytes'), 'is_available': row.get('is_available'),
                    'is_sealed': row.get('is_sealed'), 'selected_source_record_sha256': row.get('selected_source_record_sha256')})
    records, pages, pdfs, errors, artifacts = [], [], [], [], []
    for target_ordinal, target in enumerate(targets, 1):
        case = target['native_case_id']
        original = CACHE / ('original-' + case + '.json')
        original_raw = original.read_bytes()
        capture = json.loads(original_raw)
        result = capture['result']
        artifacts.append({'file_uri': original.as_uri(), 'sha256': sha(original_raw), 'bytes': len(original_raw),
                          'native_case_id': case, 'source_url': target['source_url'], 'retrieved_at': capture['returned_at']})
        assert capture['requested_url'] == target['source_url'] and capture['native_case_id'] == case
        source = result.get('structuredContent', {})
        if result.get('isError') or not source.get('rawHtml'):
            errors.append({'native_case_id': case, 'source_url': target['source_url'],
                           'original_capture_sha256': sha(original_raw), 'original_capture_file_uri': original.as_uri(),
                           'retrieved_at': capture['returned_at'], 'provider_error': '\n'.join(x.get('text','') for x in result.get('content',[]) if x.get('type') == 'text'),
                           'http_status': source.get('metadata',{}).get('statusCode'), 'retried': False})
            continue
        raw_html = source['rawHtml']
        metadata = source['metadata']
        assert metadata['statusCode'] == 200 and metadata['sourceURL'] == target['source_url']
        root = Tree(raw_html).root
        common = {'source_url': target['source_url'], 'source_sha256': sha(raw_html.encode('utf-8')),
                  'source_hash_codec': 'provider-returned-rawHtml-utf8/1', 'source_hash_is_origin_http_wire_hash': False,
                  'original_provider_capture_file_uri': original.as_uri(), 'original_provider_capture_sha256': sha(original_raw),
                  'provider_request_started_at': capture['requested_at'], 'retrieved_at': capture['returned_at'],
                  'http_status': metadata['statusCode'], 'http_status_is_provider_reported': True,
                  'provider_scrape_id': metadata.get('scrapeId'), 'target_file_uri': target_path.as_uri(),
                  'target_file_sha256': TARGET_SHA, 'target_record_ordinal': target_ordinal,
                  'exact_firm_index_scope': target['firm_index_scope_evidence']}
        nodes = list(root.descendants())
        header = []
        for p in root.descendants('p'):
            heads = [x for x in p.descendants('span') if 'meta-data-header' in x.classes()]
            vals = [x for x in p.descendants('span') if 'meta-data-value' in x.classes()]
            if len(heads) == 1 and len(vals) == 1:
                header.append({'label': heads[0].text(), 'value': vals[0].text(), 'value_links': anchors(vals[0],raw_html), 'source_span': proof(p,raw_html)})
        table = next((n for n in nodes if n.attrs.get('id') == 'docket-entry-table'), None)
        visible = [] if table is None else [n for n in table.children if isinstance(n,Node) and 'row' in n.classes() and any(x in n.classes() for x in ('odd','even'))]
        all_links = anchors(root, raw_html)
        continuation = {a['url']: a for a in all_links if urlparse(a['url']).path == urlparse(target['source_url']).path and 'page' in parse_qs(urlparse(a['url']).query)}
        party_tabs = {a['url']:a for a in all_links if re.search('/docket/'+re.escape(case)+'/parties/',a['url'])}
        authority_tabs = {a['url']:a for a in all_links if re.search('/docket/'+re.escape(case)+'/authorities/',a['url'])}
        person_links = []
        for field in header:
            if field['label'] in ('Assigned To:','Referred To:'):
                for link in field['value_links']:
                    m = re.fullmatch(r'https://www\.courtlistener\.com/person/(\d+)/[^/?#]+/',link['url'])
                    person_links.append({'source_role_label':field['label'],'name':link['label'],'person_url':link['url'],'native_person_id':m.group(1) if m else None,'source_span':link['source_span']})
        court_headings = [{'text':n.text(),'source_span':proof(n,raw_html)} for n in root.descendants('h2') if re.match(r'^(?:District Court|Court of Appeals|Judicial Panel)',n.text())]
        page = {'native_case_id':case,'source_url':target['source_url'],'source_case_name':target['case_name'],
                'source_docket_number':target['docket_number'],'source_court_id':target['court'],
                'case_fields':header,'court_headings':court_headings,'judges':person_links,
                'visible_entry_row_count':len(visible),'continuation_links':list(continuation.values()),
                'pagination_observed':bool(continuation),'pagination_followed':False,
                'party_tab_links':list(party_tabs.values()),'party_body_rows_observed':0,
                'party_body_qualification':'Main docket page only; separate party tab was not fetched.',
                'authorities_tab_links':list(authority_tabs.values()),'authorities_tab_fetched':False,
                'credits_used_provider_reported':metadata.get('creditsUsed'),
                'body_link_count':len(all_links),'provider_link_count':len(source.get('links',[])),
                'h1':[{'text':n.text(),'source_span':proof(n,raw_html)} for n in root.descendants('h1')],
                'source_coverage_warning':'RECAP is community-collected and may not be up to date; the visible HTML is not a certified full docket.'}
        pages.append(page)
        records.append(envelope('docket-page',case+'@'+common['source_sha256'],page,common))
        for row_ordinal, row in enumerate(visible,1):
            cells = [n for n in row.children if isinstance(n,Node) and n.tag=='div']
            number = cells[0].text() if cells else None
            date = cells[1].text() if len(cells)>1 else None
            description_node = next((n for n in cells[2].children if isinstance(n,Node) and n.tag=='p'),None) if len(cells)>2 else None
            docs = [n for n in row.descendants('div') if 'recap-documents' in n.classes()]
            row_data = {'native_case_id':case,'visible_row_ordinal':row_ordinal,'source_dom_id':row.attrs.get('id'),
                        'display_document_number':number,'display_document_number_is_native_recap_document_id':False,
                        'date_filed_literal':date,'date_filed_iso':None,
                        'description':description_node.text() if description_node else None,
                        'description_source_span':proof(description_node,raw_html) if description_node else None,
                        'visible_document_sections':len(docs),'source_span':proof(row,raw_html)}
            records.append(envelope('docket-entry-visible-row',case+'@'+common['source_sha256']+':row:'+str(row_ordinal),row_data,common))
            for doc_ordinal, doc in enumerate(docs,1):
                links = anchors(doc,raw_html)
                urls = list(dict.fromkeys(x['url'] for x in links))
                details = [u for u in urls if re.match(r'https://www\.courtlistener\.com/docket/'+re.escape(case)+r'/\d+/',u)]
                cached = [u for u in urls if safe_pdf(u)]
                paid = [u for u in urls if (urlparse(u).hostname or '').startswith('ecf.')]
                labels = [n.text() for n in doc.descendants('p')]
                data = {'native_case_id':case,'visible_row_ordinal':row_ordinal,'visible_document_section_ordinal':doc_ordinal,
                        'display_document_number':number,'native_document_id':None,
                        'native_document_id_qualification':'No explicit native RECAP document ID in this HTML section; detail-URL number is a display document number.',
                        'labels':labels,'links':links,'courtlistener_document_detail_urls':details,
                        'direct_recap_pdf_urls':cached,'pacer_locator_urls':paid,'pacer_locators_fetched':False,
                        'date_filed_literal':date,'source_span':proof(doc,raw_html)}
                identity=case+'@'+common['source_sha256']+':row:'+str(row_ordinal)+':doc:'+str(doc_ordinal)
                records.append(envelope('visible-document-section',identity,data,common))
                for url in cached:
                    matching = known.get((case,url),[])
                    held = bool(re.search(r'\b(?:seal|sealed|sealing|restricted)\b',' '.join(labels)+' '+(row_data['description'] or ''),re.I))
                    locator = {'native_case_id':case,'native_document_id':matching[0]['native_document_id'] if len(matching)==1 else None,
                               'native_document_id_source':'Exact same-case URL match to frozen cached CourtListener native metadata' if len(matching)==1 else None,
                               'download_url':url,'durable_url':details[0] if len(details)==1 else url,
                               'display_document_number':number,'date_filed_literal':date,'labels':labels,
                               'sealing_related_locator_held':held,'sealing_qualification':'Conservative text flag; not a legal sealed-status determination.',
                               'locator_availability_verified':False,'pdf_http_status':None,'pdf_body_sha256':None,
                               'existing_cached_native_matches':matching,'new_to_frozen_native_pdf_packet':not matching,
                               'existing_seed_file_uri':known_path.as_uri(),'existing_seed_file_sha256':KNOWN_SHA,
                               'visible_row_ordinal':row_ordinal,'visible_document_section_ordinal':doc_ordinal,
                               'source_link_spans':[l['source_span'] for l in links if l['url']==url],
                               'source_document_span':proof(doc,raw_html)}
                    pdfs.append(envelope('direct-recap-pdf-locator-candidate',identity+':url:'+sha(url.encode()),locator,common))
    files = {'records':jsonl(OUT/'visible-docket-records.jsonl',records),
             'pdf_candidates':jsonl(OUT/'direct-recap-pdf-candidates.jsonl',pdfs),
             'pages':jsonl(OUT/'page-coverage.jsonl',pages)}
    dump(OUT/'failed-captures.json',errors)
    dump(OUT/'original-capture-artifacts.json',artifacts)
    unique_pdf = {(r['data']['native_case_id'],r['data']['download_url']) for r in pdfs}
    new = [r for r in pdfs if r['data']['new_to_frozen_native_pdf_packet']]
    manifest = {'schema_version':'seeger-weiss-firecrawl-docket-review-manifest/1','created_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
                'target_count':len(targets),'saved_original_returns':len(artifacts),'captured_html_pages':len(pages),
                'failed_capture_count':len(errors),'reported_success_credits':sum(p['credits_used_provider_reported'] or 0 for p in pages),
                'failed_capture_credits_unknown':len(errors),'visible_entry_rows':sum(p['visible_entry_row_count'] for p in pages),
                'visible_document_sections':sum(r['entity_type']=='visible-document-section' for r in records),
                'judge_observations':sum(len(p['judges']) for p in pages),'pages_with_pagination':sum(p['pagination_observed'] for p in pages),
                'visible_pdf_locator_occurrences':len(pdfs),'unique_same_case_pdf_locators':len(unique_pdf),
                'new_pdf_locator_occurrences':len(new),'new_unique_same_case_pdf_locators':len({(r['data']['native_case_id'],r['data']['download_url']) for r in new}),
                'exact_cached_native_document_match_occurrences':sum(r['data']['native_document_id'] is not None for r in pdfs),
                'explicit_recap_native_document_ids_from_html':0,'sealing_text_flag_held_occurrences':sum(r['data']['sealing_related_locator_held'] for r in pdfs),
                'party_body_rows_captured':0,'party_tabs_fetched':0,'authority_tabs_fetched':0,'pagination_pages_fetched':0,
                'maximum_parallel_firecrawl_requests':3,'target_file_sha256':TARGET_SHA,'frozen_native_seed_sha256':KNOWN_SHA,
                'source_bytes_qualification':'Original provider-return JSON and returned rawHtml UTF-8 hashes; neither is an asserted publisher HTTP-wire hash.',
                'fields_not_inferred':['RECAP backend document IDs','member-case relationships','closed/open status','party identities','complete docket counts','PDF availability/sealing/hash/bytes'],
                'qualifications':gates(),'files':files,'original_capture_artifacts':artifacts,'failed_captures':errors}
    dump(OUT/'manifest.json',manifest)
    print(json.dumps({k:v for k,v in manifest.items() if k not in ('original_capture_artifacts','failed_captures','files')},ensure_ascii=True))
    print(json.dumps({'files':files,'manifest_sha256':sha((OUT/'manifest.json').read_bytes())}))

if __name__ == '__main__':
    main()
