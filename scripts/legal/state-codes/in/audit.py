"""Independent integrity and cross-format audit for the Indiana packet."""
import argparse
import hashlib
import io
import json
import pathlib
import re
import zipfile

from pypdf import PdfReader

HTML_URL = 'https://iga.in.gov/ic/2026/2026-Indiana-Code-html.zip'
BOTH_URL = 'https://iga.in.gov/ic/2026/2026-Indiana-Code.zip'
DIRECT_PDFS = {
    '2026_Acts.pdf': 'https://iga.in.gov/ic/2026/2026%20Acts.pdf',
    '2026_Noncode_Statutes.pdf': 'https://iga.in.gov/ic/2026/2026%20Non-code.pdf',
    'Indiana_Constitution.pdf': (
        'https://iga.in.gov/publications/indiana_constitution/'
        'Constitution%20(as%20amended%202024).pdf'
    ),
}
SECTION_MARKER = re.compile(br'<div\s+class=["\']section["\']', re.I)
HTML_MEMBER = re.compile(r'/(\d+)\.html$')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def receipts(root):
    return [
        json.loads(line) for line in (root / 'receipts.jsonl').read_text().splitlines()
        if line.strip()
    ]


def receipt_for(items, url, content_prefix):
    found = [
        item for item in items
        if item.get('ok') and item.get('url') == url
        and item.get('headers', {}).get('Content-Type', '').startswith(content_prefix)
    ]
    if not found:
        raise ValueError(f'missing receipt: {url}')
    return found[-1]


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', default='/tmp/sc/IN')
    args = ap.parse_args(argv)
    root = pathlib.Path(args.root)
    items = receipts(root)
    html_receipt = receipt_for(items, HTML_URL, 'application/zip')
    both_receipt = receipt_for(items, BOTH_URL, 'application/zip')
    html_path = root / html_receipt['stored_path']
    both_path = root / both_receipt['stored_path']
    report_path = root / 'parsed' / 'parse-report.json'
    parse_report = json.loads(report_path.read_text())

    html_matches = 0
    html_mismatches = []
    raw_section_markers = 0
    supplemental_matches = {}
    sample_pdf = {}
    with zipfile.ZipFile(html_path) as html_zip, zipfile.ZipFile(both_path) as both_zip:
        if html_zip.testzip() or both_zip.testzip():
            raise SystemExit('ZIP CRC audit failed')
        html_members = {
            HTML_MEMBER.search(info.filename).group(1): info
            for info in html_zip.infolist() if HTML_MEMBER.search(info.filename)
        }
        both_members = {
            HTML_MEMBER.search(info.filename).group(1): info
            for info in both_zip.infolist()
            if '/2026_Indiana_Code_HTML/' in info.filename and HTML_MEMBER.search(info.filename)
        }
        for title in sorted(html_members, key=int):
            left = html_zip.read(html_members[title])
            right = both_zip.read(both_members[title])
            raw_section_markers += len(SECTION_MARKER.findall(left))
            if sha(left) == sha(right):
                html_matches += 1
            else:
                html_mismatches.append(title)

        for archive_name, url in DIRECT_PDFS.items():
            direct = receipt_for(items, url, 'application/pdf')
            member = next(
                info for info in html_zip.infolist()
                if info.filename.endswith('/' + archive_name)
            )
            member_bytes = html_zip.read(member)
            direct_bytes = (root / direct['stored_path']).read_bytes()
            supplemental_matches[archive_name] = {
                'member_sha256': sha(member_bytes),
                'direct_sha256': sha(direct_bytes),
                'match': member_bytes == direct_bytes,
            }

        parsed_by_title = {'1': [], '17': [], '34': []}
        with (root / 'parsed' / 'sections.jsonl').open(encoding='utf8') as source:
            for line in source:
                row = json.loads(line)
                title = row['citation_path'][0]['number']
                if title in parsed_by_title:
                    parsed_by_title[title].append(row['citation'])
        for title, citations in parsed_by_title.items():
            pdf_info = next(
                info for info in both_zip.infolist()
                if info.filename.endswith(f'/2026_Indiana_Code_PDF/{title}.pdf')
            )
            pdf_bytes = both_zip.read(pdf_info)
            reader = PdfReader(io.BytesIO(pdf_bytes))
            text = '\n'.join(page.extract_text() or '' for page in reader.pages)
            missing = [citation for citation in citations if citation not in text]
            sample_pdf[title] = {
                'pages': len(reader.pages),
                'parsed_citations': len(citations),
                'citations_found': len(citations) - len(missing),
                'missing': missing,
            }

    parsed_rows = sum(
        1 for line in (root / 'parsed' / 'sections.jsonl').open(encoding='utf8')
        if line.strip()
    )
    audit = {
        'method': (
            'stdlib raw-HTML marker count; duplicate-archive member SHA-256 comparison; '
            'ZIP CRC; direct-vs-bundled supplementary PDF byte comparison; sampled '
            'PDF text citation presence'
        ),
        'zip_crc': {'html': 'passed', 'pdf_html': 'passed'},
        'html_member_comparison': {
            'matched': html_matches,
            'mismatched_titles': html_mismatches,
        },
        'raw_section_markers': raw_section_markers,
        'parsed_rows': parsed_rows,
        'section_count_match': raw_section_markers == parsed_rows,
        'supplementary_pdf_matches': supplemental_matches,
        'pdf_crosscheck_samples': sample_pdf,
        'result': 'passed' if (
            not html_mismatches
            and raw_section_markers == parsed_rows
            and all(item['match'] for item in supplemental_matches.values())
            and all(not item['missing'] for item in sample_pdf.values())
        ) else 'review',
    }
    parse_report['independent_archive_audit'] = audit
    parse_report['status'] = 'audited' if audit['result'] == 'passed' else 'parsed-review'
    report_path.write_text(json.dumps(parse_report, indent=2, sort_keys=True) + '\n')
    (root / 'parsed' / 'audit-report.json').write_text(
        json.dumps(audit, indent=2, sort_keys=True) + '\n'
    )
    print(json.dumps(audit, sort_keys=True))


if __name__ == '__main__':
    main()
