"""Land the captured Pennsylvania Consolidated Statutes + Constitution via publisher-code-intake/2.

  python3 land.py --dry     parse and summarise only (no network, no credentials)
  python3 land.py --land    register manifest, open run, upload, intake, verify, finish

Status (no secrets) goes to STATUS_PATH.
"""
import json
import pathlib
import sys
import uuid

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from common.provenance_fetch import Fetcher  # noqa: E402
import acquire  # noqa: E402
import build  # noqa: E402
from land_v2 import land as lv2  # noqa: E402

STATUS_PATH = pathlib.Path('/cursor/stores/bc-24d6c4ee-e9c3-4d34-a42c-3fb9985ace6c/internal/state-codes/batch-a/pa/status.json')
OFFICIAL_URL = 'https://www.palegis.us/statutes/consolidated'


def load():
    fetcher = Fetcher('PA', acquire.ROOT)
    index = [r for r in fetcher.receipts() if r.get('proxy_options') and r.get('ok')][-1]
    titles = ['%02d' % int(t) for t in acquire.title_numbers(fetcher.read(index).decode())]
    units, missing = build.build_all(fetcher, titles)
    return fetcher, titles, units, missing


def receipt_counts(fetcher):
    receipts = fetcher.receipts()
    return {
        'proxied_firecrawl_requests_logged': sum(1 for r in receipts if r.get('retrieval_method') == 'proxied:firecrawl'),
        'proxied_firecrawl_title_documents_used': None,
        'proxied_tavily_requests_logged': sum(1 for r in receipts if r.get('retrieval_method') == 'proxied:tavily'),
        'direct_attempts_logged': sum(1 for r in receipts if r.get('retrieval_method') == 'direct'),
        'direct_successes': sum(1 for r in receipts if r.get('retrieval_method') == 'direct' and r.get('ok')),
    }


def base_status(fetcher, titles, units, missing):
    counts = receipt_counts(fetcher)
    counts['proxied_firecrawl_title_documents_used'] = len(units)
    empty = sorted(u['key'] for u in units if not u['sections'])
    return {
        'state': 'PA', 'parser': build.PARSER_LABEL, 'source_system': build.SOURCE_SYSTEM,
        'official_url': OFFICIAL_URL,
        'document_url_pattern': build.TITLE_URL % '<title>',
        'publisher': build.manifest()['publisher'],
        'edition': None,
        'currency': {
            'basis': 'publisher_metadata',
            'quote': 'Each title document carries <meta name="revised" content="YYYY-MM-DD hh:mm:ss AM|PM"> in its head. The index page prints no "current through" or edition statement; its footer shows only "Copyright 2026".',
            'through_date': None,
            'revised_by_unit': {u['key']: u['revised_value'] for u in units},
        },
        'titles_expected_from_index': len(titles), 'units_built': len(units), 'titles_missing': missing,
        'sections_parsed': sum(len(u['sections']) for u in units),
        'units_with_zero_sections': empty,
        'gates': {'public_projection_allowed': False, 'current_law_verified': False, 'calculation_activation_allowed': False,
                  'publisher_native_entity': False, 'schema_version': lv2.SCHEMA},
        'proxied': counts,
        'direct_access': {
            'result': 'No HTTP response from this environment (read/connect timeouts; fs host does not resolve) for www.palegis.us, www.legis.state.pa.us, legis.state.pa.us, www.fs.legis.state.pa.us. This is a network block, not a terms, login or captcha gate. Every document was retrieved through Firecrawl (proxied:firecrawl), which returns what the proxy fetched, not the publisher bytes.',
            'tested_alternatives': [
                'Fetcher.proxied firecrawl rawHtml of the iframe document URL: complete HTML for every title (used)',
                'Tavily extract of the same URL: returns markdown without the structure markers; lower grade, not used',
                'www.pacodeandbulletin.gov is reachable directly but publishes the Pennsylvania Code (agency regulations), not the statutes',
            ],
        },
        'gaps': [
            'Unconsolidated Statutes (palegis.us/statutes/unconsolidated: amendatory acts by year, "Amendatory acts prior to 1990 are not available") are session laws, not a codified code with section citations; not captured.',
            'Title appendices (Act text printed after each title, marked cax) are retained inside each unit text derivative but not parsed as sections.',
            'Editorial notes (Enactment, Cross References, Prior Provisions, annotations) are retained in each unit text derivative but excluded from section text; amendment history is stored separately.',
            'Hierarchy is read from printed division banners (TITLE/PART/SUBPART/ARTICLE/CHAPTER/SUBCHAPTER/DIVISION); nesting order is taken from first appearance within a title, so unusual titles may nest levels differently than the publisher index.',
            'Titles 8, 38, 57 and 72 print no TITLE banner in the body; the title level comes from the document <title> tag.',
            'The Title 20 table of contents lists "§ 8641 - § 8642 (Repealed)" as a range line; the two sections are parsed from their own markers.',
            'No "current through" date is printed; the revised metadata timestamp is quoted but not promoted to through_date.',
        ],
        'gates_hit': [],
    }


def write_status(status):
    STATUS_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATUS_PATH.write_text(json.dumps(status, indent=2, ensure_ascii=False) + '\n', encoding='utf8')


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else '--dry'
    fetcher, titles, units, missing = load()
    status = base_status(fetcher, titles, units, missing)
    print(json.dumps({k: status[k] for k in ('units_built', 'sections_parsed', 'titles_missing', 'units_with_zero_sections')}, indent=1))
    if mode == '--dry':
        return
    if missing:
        raise SystemExit('refusing to land with missing titles: %s' % missing)
    service = lv2.Service()
    run = str(uuid.uuid4())
    status['run'] = run
    status['run_status'] = 'running'
    write_status(status)
    result = lv2.land(service, build.manifest(), units, run, build.ST, build.SOURCE_SYSTEM, build.PARSER_LABEL,
                      expected={'units': len(units), 'sections': status['sections_parsed']}, log=lambda m: print(m, flush=True))
    status.update({'run_status': result.get('run_status'), 'sections_landed': result['sections_landed'],
                   'units_landed': result['units_landed'], 'batches_verified': result['batches'],
                   'objects_registered': result.get('objects'), 'object_bytes': result.get('object_bytes'),
                   'manifest_sha256': result.get('manifest_sha256'), 'error': result.get('error')})
    write_status(status)
    print(json.dumps({k: v for k, v in status.items() if k in ('run', 'run_status', 'sections_landed', 'units_landed', 'error')}, indent=1))


if __name__ == '__main__':
    main()
