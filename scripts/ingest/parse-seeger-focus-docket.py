"""Extract observed docket rows/locators without making CourtListener API calls."""
import datetime
import importlib.util
import json
import re
import sys
from pathlib import Path
from urllib.parse import parse_qs, urljoin, urlparse, urlunparse, urlencode

spec = importlib.util.spec_from_file_location('docket_tree', Path(__file__).with_name('prepare-seeger-weiss-firecrawl-docket-metadata.py'))
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
Node, Tree, sha = mod.Node, mod.Tree, mod.sha

def parse_capture(file):
    raw = file.read_bytes()
    capture = json.loads(raw)
    result = capture['result']
    data = result.get('structuredContent') or result.get('data') or result
    source = data.get('rawHtml') or data.get('html')
    source_field = 'result.' + ('structuredContent.' if result.get('structuredContent') else 'data.' if result.get('data') else '') + ('rawHtml' if data.get('rawHtml') else 'html')
    def proof(node, source):
        return {**mod.proof(node, source), 'source_field': source_field}
    meta = data.get('metadata', {})
    url = capture.get('requested_url') or meta.get('sourceURL')
    parsed = urlparse(url)
    match = re.fullmatch(r'/docket/([1-9][0-9]*)/[^/]+/', parsed.path)
    if parsed.scheme != 'https' or parsed.netloc != 'www.courtlistener.com' or not match:
        raise ValueError('Expected a source-qualified CourtListener docket page')
    case = match.group(1)
    final = urlparse(meta.get('url', url))
    if meta.get('statusCode') != 200 or not source or final.scheme != 'https' or final.netloc != parsed.netloc or not re.fullmatch('/docket/'+case+r'/[^/]+/', final.path):
        raise ValueError('Successful same-docket HTML response required')
    root = Tree(source).root
    nodes = list(root.descendants())
    table = next((n for n in nodes if n.attrs.get('id') == 'docket-entry-table'), None)
    if table is None:
        raise ValueError('Docket table absent: page is not a usable docket capture')
    retrieved = capture.get('retrieved_at') or capture.get('returned_at') or capture['requested_at']
    origin = {'capture_file': str(file), 'capture_file_sha256': sha(raw), 'source_response_sha256': sha(source.encode()),
              'source_url': url, 'retrieved_at': retrieved, 'native_case_id': case,
              'source_hash_codec': 'provider-returned-rawHtml-utf8/1', 'source_hash_is_origin_http_wire_hash': False}
    pagination = set()
    for a in root.descendants('a'):
        href = urljoin(meta.get('url', url), a.attrs.get('href', ''))
        p = urlparse(href)
        qs = parse_qs(p.query)
        if p.scheme == 'https' and p.netloc == parsed.netloc and p.path in {parsed.path, final.path} and qs.get('page') and re.fullmatch('[1-9][0-9]*', qs['page'][0]):
            if set(qs) <= {'page'}:
                page = qs['page'][0]
                pagination.add(urlunparse((p.scheme, p.netloc, p.path, '', '' if page == '1' else urlencode({'page': page}), '')))
    fields = []
    for p in root.descendants('p'):
        heads = [x for x in p.descendants('span') if 'meta-data-header' in x.classes()]
        vals = [x for x in p.descendants('span') if 'meta-data-value' in x.classes()]
        if len(heads) == len(vals) == 1:
            fields.append({'label': heads[0].text(), 'value': vals[0].text(), 'source_span': proof(p, source)})
    rows, queue, held = [], [], []
    visible = [n for n in table.children if isinstance(n, Node) and 'row' in n.classes() and set(n.classes()) & {'odd', 'even'}]
    for ordinal, row in enumerate(visible, 1):
        cells = [n for n in row.children if isinstance(n, Node) and n.tag == 'div']
        number = cells[0].text() if cells else None
        date = cells[1].text() if len(cells) > 1 else None
        description_node = next((n for n in cells[2].children if isinstance(n, Node) and n.tag == 'p'), None) if len(cells) > 2 else None
        description = description_node.text() if description_node else None
        date_iso = None
        if date:
            for fmt in ('%b %d, %Y', '%B %d, %Y', '%Y-%m-%d'):
                try:
                    date_iso = datetime.datetime.strptime(date, fmt).date().isoformat()
                    break
                except ValueError:
                    pass
        documents = []
        for doc in (n for n in row.descendants('div') if 'recap-documents' in n.classes()):
            links = [{'url': urljoin(url, a.attrs['href']), 'label': a.text(), 'source_span': proof(a, source)}
                     for a in doc.descendants('a') if a.attrs.get('href')]
            labels = [p.text() for p in doc.descendants('p')]
            item = {'labels': labels, 'links': links, 'source_span': proof(doc, source)}
            documents.append(item)
            for pdf in dict.fromkeys(link['url'] for link in links if mod.safe_pdf(link['url'])):
                record = {'native_case_id': case, 'source_page': url, 'display_document_number': number,
                          'display_number_is_backend_id': False, 'date_filed_literal': date, 'filing_date': date_iso,
                          'description': description, 'document': item, 'pdf_url': pdf}
                native_hash = sha(mod.packed(record))
                if re.search(r'\b(?:seal|sealed|sealing|restricted)\b', ' '.join(labels)+' '+(description or ''), re.I):
                    held.append({**record, 'reason': 'Sealing-related text; private review required'})
                    continue
                queue.append({'schema_version': 'source-qualified-pdf-queue/1', 'provider': 'courtlistener-public-locator',
                              'native_document_id': pdf, 'native_document_identity_kind': 'publisher_observed_pdf_locator_url',
                              'native_case_id': case, 'durable_url': pdf, 'download_url': pdf,
                              'expected_sha1': None, 'expected_bytes': None, 'title': description or ' '.join(labels), 'filing_date': date_iso,
                              'selected_source_record_sha256': native_hash, 'eligible': True,
                              'provider_flags': {'public_pdf_link_observed': True, 'sealing_related_locator_held': False,
                                                 'backend_api_id_verified': False, 'api_availability_verified': False},
                              'origins': [{**origin, 'native_record_sha256': native_hash, 'source_document_span': proof(doc, source)}]})
        rows.append({'row_ordinal': ordinal, 'display_document_number': number, 'source_dom_id': row.attrs.get('id'),
                     'date_filed_literal': date, 'filing_date': date_iso, 'description': description,
                     'documents': documents, 'source_span': proof(row, source)})
    return {'schema_version': 'seeger-weiss-focused-docket-page/1', 'native_case_id': case, 'source_url': url,
            'provenance': origin, 'case_fields': fields, 'titles': [n.text() for n in root.descendants('h1')],
            'rows': rows, 'pdf_queue': queue, 'held_pdf_locators': held, 'pagination': sorted(pagination),
            'credits_used': meta.get('creditsUsed'), 'public_projection_allowed': False,
            'courtlistener_api_requests': 0, 'complete_docket_claimed': False}

if __name__ == '__main__':
    source_file = Path(sys.argv[1])
    out = Path(sys.argv[2])
    data = parse_capture(source_file)
    out.write_bytes(mod.packed(data)+b'\n')
    print(json.dumps({'case': data['native_case_id'], 'rows': len(data['rows']), 'pdfs': len(data['pdf_queue']),
                      'held': len(data['held_pdf_locators']), 'pagination': len(data['pagination'])}))
