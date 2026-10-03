"""Build a versioned, private evidence packet from retained official originals."""
import csv
import hashlib
import html as html_module
import json
import pathlib
import re
import sys
from pypdf import PdfReader

cache = pathlib.Path(sys.argv[1])
root = pathlib.Path(__file__).resolve().parents[2]
receipts = [json.loads(p.read_text()) for p in cache.glob('*.provenance.json')]
by_url = {r['source_url']: r for r in receipts}


def retained(url, extension):
    receipt = by_url[url]
    file = cache / (receipt['sha256'] + extension)
    if hashlib.sha256(file.read_bytes()).hexdigest() != receipt['sha256']:
        raise ValueError('Original checksum mismatch')
    return receipt, file


def record(id, kind, title, url, date, date_type, attributes, authority='publisher', court_id='njd', identifiers=None):
    receipt = by_url[url]
    return dict(id=id, type=kind, id_authority=authority, title=title, title_source='heading', jurisdiction='US', court_id=court_id,
                date=date, date_type=date_type, source_url=url, source_name='United States District Court, District of New Jersey',
                licence='Public domain — US federal government work', retrieved_at=receipt['retrieved_at'], version=receipt['sha256'],
                confidence=1, extraction_method='pdf_text' if url.endswith('.pdf') else 'html', identifiers=identifiers or {'publisher_url': url}, attributes=attributes)


def ref(row):
    return {k: row[k] for k in ('id', 'type', 'id_authority', 'version')}


records, documents = [], []
specs = [
    ('https://www.njd.uscourts.gov/sites/njd/files/JohnsonTransferOrder.pdf', 'JPML transfer order', '2016-10-04', 'other', 'transfer_order', 'jpml'),
    ('https://www.njd.uscourts.gov/sites/njd/files/JohnsonCTO-1.pdf', 'Conditional transfer order CTO-1', '2016-10-14', 'other', 'transfer_order', 'jpml'),
    ('https://www.njd.uscourts.gov/sites/njd/files/J-JCMO2.pdf', 'Case management order No. 2 — direct filing', '2017-02-07', 'cmo', 'order', 'njd'),
    ('https://www.govinfo.gov/content/pkg/USCOURTS-njd-3_16-md-02738/pdf/USCOURTS-njd-3_16-md-02738-11.pdf', 'Memorandum opinion and order on motion to stay', '2026-05-26', 'other', 'order', 'njd'),
    ('https://www.govinfo.gov/content/pkg/USCOURTS-njd-3_16-md-02738/pdf/USCOURTS-njd-3_16-md-02738-12.pdf', 'Memorandum opinion and order on motion for order to show cause', '2026-07-22', 'other', 'order', 'njd'),
]
for url, title, date, classification, purpose, court_id in specs:
    receipt, file = retained(url, '.pdf')
    pages = {f'page-{i+1}': p.extract_text() or '' for i, p in enumerate(PdfReader(file).pages)}
    text = '\n\n'.join(pages.values())
    if not re.search(r'0?2738', text):
        raise ValueError('Wrong MDL original')
    if 'govinfo.gov' in url:
        expected = {'2026-05-26': ('44997', '05/26/26'), '2026-07-22': ('45694', '07/22/26')}[date]
        if not re.search(r'Document\s+'+expected[0]+r'\s+Filed\s+'+expected[1], text):
            raise ValueError('Filed date and document number do not match the original')
    source = record(url, 'source_doc', title, url, date, 'filed', {'paragraphs': pages, 'text': text, 'order_class': classification, 'document_role': purpose, 'sha256': receipt['sha256'], 'mdl_number': 'MDL-2738'}, court_id=court_id)
    records.append(source)
    documents.append({'record': ref(source), 'section': 'jpml' if court_id == 'jpml' else 'pinned', 'classification': classification})

court_url = 'https://www.njd.uscourts.gov/johnson-johnson-talcum-powder-litigation'
receipt, court_file = retained(court_url, '.html')
html = court_file.read_text(encoding='utf-8')
if 'Michael A. Shipp' not in html or '3:16-md-02738' not in html or 'Rukhsanah L. Singh' not in html:
    raise ValueError('Current official assignment not found')
presiding_start = html.index('Presiding Judge')
presiding_end = html.index('Instructions for Opening', presiding_start)
presiding_text = html_module.unescape(re.sub(r'<[^>]+>', ' ', html[presiding_start:presiding_end]))
presiding_text = re.sub(r'\s+', ' ', presiding_text).strip()
source = record(court_url, 'source_doc', 'Johnson & Johnson Talcum Powder Litigation — court case page', court_url, receipt['retrieved_at'][:10], 'retrieved',
                {'paragraphs': {'presiding-judges': presiding_text}, 'document_role': 'case_page'})
records.append(source)
mdl = record('MDL-2738', 'mdl', 'Johnson & Johnson Talcum Powder Products Marketing, Sales Practices and Products Liability Litigation', specs[0][0],
             '2016-10-04', 'filed', {'pacer_case_number': '3:16-md-02738', 'courtlistener_docket_id': '6245245', 'status': None,
             'status_qualification': 'Current disposition status has not been verified from a current order.', 'as_of': receipt['retrieved_at'][:10]}, authority='jpml',
             identifiers={'jpml_mdl_number': 'MDL-2738', 'courtlistener_docket_id': '6245245', 'pacer_case_number': '3:16-md-02738'})
records.append(mdl)

raw = root / 'private/data/research/raw'
manifest = json.loads((root/'private/data/research/source-manifest.json').read_text())
fjc_capture = next(s for s in manifest['sources'] if s['id'] == 'fjc-demographics')
if hashlib.sha256((raw/'fjc-demographics.csv').read_bytes()).hexdigest() != fjc_capture['sha256']:
    raise ValueError('FJC original mismatch')
with (raw/'fjc-demographics.csv').open(encoding='utf-8-sig', newline='') as stream:
    fjc = next(r for r in csv.DictReader(stream) if r['nid'] == '1394031')
with (raw/'fjc-service.csv').open(encoding='utf-8-sig', newline='') as stream:
    service = [r for r in csv.DictReader(stream) if r['nid'] == fjc['nid']]
service_capture = next(s for s in manifest['sources'] if s['id'] == 'fjc-service')
if hashlib.sha256((raw/'fjc-service.csv').read_bytes()).hexdigest() != service_capture['sha256']:
    raise ValueError('FJC service original mismatch')
people = root.parent/'audit/2026-10-02/metadata/normalized/people-db-people.jsonl'
matches = [json.loads(line) for line in people.open(encoding='utf-8') if '"fjc_id":"3440"' in line]
matches = [row for row in matches if row['data']['fjc_id'] == fjc['jid'] and row['native_id'] == '2955']
if len(matches) != 1:
    raise ValueError('The native FJC/CL crosswalk is not unique')
judge = dict(id=fjc['nid'], type='judge', id_authority='fjc', title='Michael Andre Shipp', title_source='api', jurisdiction='US', court_id='njd',
             date=fjc_capture['fetchedAt'][:10], date_type='retrieved', source_url=fjc_capture['url'], source_name='Federal Judicial Center',
             licence='Public domain — US federal government work', retrieved_at=fjc_capture['fetchedAt'], version=fjc_capture['sha256'], confidence=1,
             extraction_method='bulk', identifiers={'fjc_nid': fjc['nid'], 'fjc_legacy_id': fjc['jid'], 'courtlistener_person_id': '2955'},
             attributes={'service': service, 'source_sha256': fjc_capture['sha256'], 'service_source_url': service_capture['url'], 'service_sha256': service_capture['sha256'], 'biography_url': fjc_capture['page']})
records.append(judge)
edges = [
    dict(type='presided_by', **{'from': ref(mdl), 'to': ref(judge)}, source_record=ref(source), source_url=court_url, date=source['date'], extraction_method='regex', confidence=1, evidence={'paragraph_id': 'presiding-judges'}, review_status='approved', treatment=None, role=None),
    dict(type='transferred_by', **{'from': ref(mdl), 'to': ref(records[0])}, source_record=ref(records[0]), source_url=records[0]['source_url'], date=records[0]['date'], extraction_method='regex', confidence=1, evidence={'paragraph_id': 'page-4'}, review_status='approved', treatment=None, role=None),
]
packet = dict(schema_version='legal-atlas/3.1', mdl=ref(mdl), records=records, edges=edges, documents=documents, leadership=[],
              as_of=receipt['retrieved_at'][:10], complete=False,
              qualifications=['Current leadership requires further appointment-order review. The May 26, 2026 order discusses removal of Beasley Allen from the PSC; a 2016 roster alone cannot establish current leadership.', 'The retained court and GovInfo documents are a source selection, not a complete RECAP docket.', 'No reviewed portrait or court seal is available in this packet.'])
destination = root/'src/lib/legal/mdl2738.server.json'
destination.write_text(json.dumps(packet, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
print(json.dumps({'records': len(records), 'edges': len(edges), 'source_pdfs': len(specs), 'leadership_rows': 0, 'complete': False, 'path': str(destination)}))
