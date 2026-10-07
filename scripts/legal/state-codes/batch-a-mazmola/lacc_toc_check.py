"""Compare the retained official Civil Code table of contents with the parsed article pages, and write the manifest and TOC proof.

Official contents: https://legis.la.gov/legis/Laws_Toc.aspx?folder=67&level=Parent (one flat list, two anchors per article:
the CC label and the heading, each linking Law.aspx?d=<id>). Checks, all from retained bytes:
  1. distinct article documents listed == anchors / 2 == retained LawPrint pages == parsed pages;
  2. each TOC label equals the page's LabelName and its printed article number, and each TOC heading equals the page's printed words;
  3. the printed article numbers 1..max have no gap that the publisher's own range rows ("Arts. 3550 to 3555 Repealed ...") do not cover.
Writes /tmp/sc/LACC/landing/manifest.json and toc-proof.json (the shared lander's format). Registers nothing, lands nothing.
"""
import collections
import json
import os
import pathlib
import re
import sys

from bs4 import BeautifulSoup

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lacc_parse as P  # noqa: E402

ROOT = pathlib.Path('/tmp/sc/LACC')
OUT = ROOT / 'landing'
TOC_URL = 'https://legis.la.gov/legis/Laws_Toc.aspx?folder=67&level=Parent'
SECTION_PATH = r'^[0-9]+(\.[0-9]+)?(-[A-Z])?$'

MANIFEST = {
    'schema_version': 'publisher-code-manifest/2', 'jurisdiction': 'LA',
    'publisher': 'Louisiana State Legislature (legis.la.gov Louisiana Laws)',
    'publisher_url': 'https://legis.la.gov/legis/LawSearch.aspx', 'source_system': 'la-civil-code',
    'code_title': 'Louisiana Civil Code',
    'parser': {'name': 'la-civil-code-lawprint', 'version': '1'},
    'retrieval': {'methods': ['publisher_page'],
                  'source_url_patterns': [r'^https://legis\.la\.gov/legis/LawPrint\.aspx\?d=[0-9]+$',
                                          r'^https://legis\.la\.gov/legis/Laws_Toc\.aspx\?folder=67&level=Parent$',
                                          r'^https://legis\.la\.gov/legis/LawSearch\.aspx$'],
                  'terms_gate': False, 'official_source': True, 'rate_limit_ms': 1000},
    'structure': {'levels': ['book', 'title', 'chapter', 'section_group', 'subsection_group', 'section'],
                  'unit': 'one LawPrint.aspx article page'},
    'section_id': {'scheme': 'official_citation_path', 'regex': SECTION_PATH, 'example': '2315', 'citation_format': 'La. C.C. art. <path>'},
    'currency': {'basis': 'publisher_statement',
                 'location': 'LawSearch.aspx notice: laws have been updated through a stated session, and the site is not official or authoritative'},
    'review': {'reviewed_by': 'batch A lead', 'reviewed_at': '2026-10-07'},
}


def norm(s):
    return re.sub(r'\s+', ' ', s or '').strip()


def fold(s):
    """Compare words, not punctuation: drop a leading 'Art. N.', the section sign, brackets, case and trailing period."""
    s = re.sub(r'^Art\.?\s*[0-9.]+\s*\.?\s*', '', norm(s))
    return re.sub(r'[^a-z0-9]+', '', s.lower())


def runs(nums):
    out = []
    for n in nums:
        if out and n == out[-1][1] + 1:
            out[-1][1] = n
        else:
            out.append([n, n])
    return out


def main():
    receipts = [json.loads(x) for x in open(ROOT / 'receipts.jsonl') if x.strip()]
    toc_rec = next(r for r in receipts if r.get('label') == 'cc-toc' and r.get('ok'))
    toc = (ROOT / toc_rec['stored_path']).read_text(encoding='utf8', errors='replace')
    soup = BeautifulSoup(toc, 'html.parser')
    anchors = [(re.search(r'd=(\d+)', a['href']).group(1), norm(a.get_text(' '))) for a in soup.find_all('a', href=re.compile(r'^Law\.aspx\?d=\d+$'))]
    by_doc = collections.OrderedDict()
    for d, t in anchors:
        by_doc.setdefault(d, []).append(t)
    pages = {}
    for r in receipts:
        if 'LawPrint.aspx?d=' in r['url'] and r.get('ok') and r.get('status') == 200:
            pages[r['url'].rsplit('=', 1)[1]] = r
    problems = collections.defaultdict(list)
    parsed = {}
    for d, texts in by_doc.items():
        if d not in pages:
            problems['not_retained'].append(d)
            continue
        pg = P.parse_page((ROOT / pages[d]['stored_path']).read_text(encoding='utf8', errors='replace'))
        rec = P.article_record(pg)
        parsed[d] = (pg, rec)
        label, heading = texts[0], texts[-1]
        if label != pg['label']:
            problems['label'].append((d, label, pg['label']))
        printed = norm(pg['heading'])
        if len(texts) < 2:
            problems['heading'].append((d, heading, printed))
        elif norm(heading) != printed:
            if fold(heading) == fold(printed):
                problems['heading_punctuation_only'].append(d)
            else:
                problems['heading_wording'].append((d, pg['label'], heading, printed))
    nums = collections.defaultdict(list)
    for d, (pg, rec) in parsed.items():
        nums[pg['path']].append(d)
    covered = set()
    ranges = []
    for d, (pg, rec) in parsed.items():
        m = re.search(r'\bArts?\.\s*([0-9]+)\s*(?:to|through|-|\u2013)\s*([0-9]+)', pg['heading'] or '')
        if m:
            lo, hi = int(m.group(1)), int(m.group(2))
            ranges.append((pg['label'], lo, hi))
            covered.update(range(lo, hi + 1))
    present = {int(float(p.split('-')[0])) for p in nums}
    top = max(present)
    gaps = [n for n in range(1, top + 1) if n not in present and n not in covered]
    result = {
        'toc_url': TOC_URL, 'toc_sha256': toc_rec['sha256'], 'toc_bytes': toc_rec['bytes'], 'toc_retrieved_at': toc_rec['retrieved_at'],
        'anchors': len(anchors), 'distinct_documents': len(by_doc), 'anchors_per_document': sorted(set(len(v) for v in by_doc.values())),
        'retained_pages': len([d for d in by_doc if d in pages]), 'parsed_pages': len(parsed),
        'duplicate_article_paths': [p for p, v in nums.items() if len(v) > 1],
        'label_mismatches': problems['label'], 'heading_missing_anchor': problems['heading'],
        'heading_punctuation_only': len(problems['heading_punctuation_only']), 'heading_wording_differences': problems['heading_wording'], 'not_retained': problems['not_retained'],
        'article_number_range': [min(present), top], 'range_rows': ranges, 'unexplained_number_gaps': gaps, 'unexplained_gap_runs': runs(gaps),
        'child_toc_folders_linked': sorted(set(re.findall(r'Laws_Toc\.aspx\?folder=(\d+)', toc))),
    }
    result['matches'] = (result['anchors'] == 2 * result['distinct_documents'] == 2 * result['retained_pages'] == 2 * result['parsed_pages']
                         and not problems['label'] and not problems['heading'] and not problems['not_retained']
                         and not result['duplicate_article_paths'])
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'manifest.json').write_text(json.dumps(MANIFEST, indent=1, sort_keys=True))
    json.dump(result, open(OUT / 'toc-check.json', 'w'), indent=1)
    print(json.dumps({k: (v if not isinstance(v, (list, dict)) or len(v) < 8 else '%d items' % len(v)) for k, v in result.items()}, default=str))


if __name__ == '__main__':
    main()
