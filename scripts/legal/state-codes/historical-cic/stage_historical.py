"""Replay retained historical RTF originals into a private, qualified source-occurrence packet."""
from __future__ import annotations
import argparse
from collections import Counter
from datetime import datetime
import hashlib
import json
from pathlib import Path
import re

from capture_originals import SOURCES, allowed_url, make_plan, verify_bytes
from parse_cic_rtf import parse, render


def sha(raw): return hashlib.sha256(raw).hexdigest()


def write_json(path, value):
    with path.open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2); stream.write('\n')


def line(stream, value): stream.write(json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n')


def source_rows(parsed, raw, title, qualification, currency):
    """Native styles define each occurrence; no citation ranges are expanded or merged."""
    rows = []; text_parts = []; offset = 0; quarantined = []
    title_headings = [r['text'] for r in parsed['unmapped'] if r['style'] == 'Level1']
    title_heading = title_headings[0] if len(title_headings) == 1 else None
    for original in parsed['sections']:
        # Replay every retained paragraph's source bytes. Physical wrap handling is explicit in render().
        for part in original['parts'].values():
            for paragraph in part:
                span = paragraph['raw_span']
                if render(raw[span['start']:span['end']])[0] != paragraph['text']:
                    raise ValueError('Paragraph does not replay its exact raw span')
        body = original['heading'] + ('\n' + original['text'] if original['text'] else '')
        span = {'unit': 'unicode_code_points', 'start': offset, 'end': offset + len(body)}
        text_parts.append(body + '\n\n'); offset += len(body) + 2
        issues = original['issues']
        unsafe = [issue for issue in issues if issue.startswith('Unknown ') or issue.startswith('Embedded ')]
        note = qualification
        if not original['text']:
            note += ' This source occurrence has no original Text segment; its printed heading is retained without a fabricated statutory body.'
        if original.get('hidden_transcript_paragraphs'):
            note += (f" The publisher source contains {original['hidden_transcript_paragraphs']} hidden form/table transcript paragraph(s). "
                     'They are retained separately with raw byte spans. Referenced visual forms/tables are not represented in this text; consult the original source.')
        if issues:
            note += ' Source observations: ' + '; '.join(issues) + '.'
        raw_end = max([original['heading_raw_span']['end']] + [p['raw_span']['end'] for part in original['parts'].values() for p in part])
        row = {'identity_kind': 'third_party_source_occurrence',
               'citation_path': f"src-{parsed['raw_sha256']}-section-{original['ordinal']}",
               'citation': original['citation'] or original['heading'], 'heading': original['heading'], 'text': body,
               'hierarchy': [{'level': 'title', 'number': title, 'heading': title_heading},
                             {'level': 'section', 'number': original['citation'], 'heading': original['heading']}],
               'history': original['history'] or None, 'status_note': note, 'unit_key': 'title-' + title,
               'span': span, 'currency': currency, 'provenance_class': 'third_party_historical_archive',
               'archive_edition': parsed['source_edition'], 'source_qualification': qualification,
               'source_occurrence': {'kind': 'rtf_section', 'raw_sha256': parsed['raw_sha256'],
                   'ordinal': original['ordinal'], 'raw_span': [original['heading_raw_span']['start'], raw_end],
                   'printed_heading': original['heading'], 'unit_span': span}}
        if unsafe or not 3 <= len(row['citation']) <= 400 or not 1 <= len(original['heading']) <= 8000:
            quarantined.append({'row': row, 'issues': unsafe or ['Heading exceeds intake limits']})
        else:
            rows.append(row)
    return rows, ''.join(text_parts), quarantined, title_heading


def stage(originals, evidence, state, output):
    originals, evidence, output = Path(originals).resolve(), Path(evidence).resolve(), Path(output).resolve()
    if output.exists(): raise FileExistsError('Use a fresh versioned output; prior packets are immutable')
    plan = make_plan(state, (evidence / (state.lower() + '-archive-metadata.json')).read_bytes())
    recorded_plan = json.loads((originals / 'plan.json').read_bytes())
    if [r for r in recorded_plan if r['state'] == state] != plan:
        raise ValueError('Capture plan differs from exact retained archive metadata')
    edition = plan[0]['source_edition']
    qualification = (f'Third-party historical archive, source edition {edition}; current law is not verified. '
                     'Only retained original RTF code titles are represented; constitutions, indexes and other ancillary materials are excluded. '
                     'History is separate from statutory text; publisher annotations remain in the retained originals and private review ledger. '
                     'Referenced form/table graphics are not captured; hidden transcripts remain separately in the originals and private review ledger. '
                     'Printed occurrences are not canonical legal identities and cannot activate calculator rules.')
    currency = {'basis': 'archive_date', 'statement': SOURCES[state][1], 'through_date': None, 'edition': edition}
    output.mkdir(parents=True)
    (output / 'text').mkdir(); (output / 'review').mkdir()
    objects = []; units = []; pages = []; counts = Counter(); problems = []
    with (output / 'sections.jsonl').open('x', encoding='utf-8', newline='\n') as sections, (output / 'quarantine.jsonl').open('x', encoding='utf-8', newline='\n') as quarantine:
        for item in plan:
            path = originals / state / item['file']
            if path.is_symlink(): raise ValueError('Linked raw original rejected')
            raw = path.read_bytes(); digest = verify_bytes(raw, item)
            receipt = json.loads((path.parent / (path.name + '.receipt.json')).read_bytes())
            if any(receipt.get(k) != v for k, v in item.items()) or receipt.get('sha256') != digest or receipt.get('http_status') != 200:
                raise ValueError('Receipt differs from retained original')
            allowed_url(receipt['final_url'], item)
            if datetime.fromisoformat(receipt['retrieved_at']).tzinfo is None: raise ValueError('Retrieval timezone required')
            parsed = parse(raw, state, edition)
            candidates, text, held, title_heading = source_rows(parsed, raw, item['title'], qualification, currency)
            text_bytes = text.encode('utf-8'); text_sha = sha(text_bytes)
            if not text_bytes: raise ValueError('No styled section occurrences in title')
            text_path = output / 'text' / (item['file'] + '.txt'); text_path.write_bytes(text_bytes)
            source = {'source_url': item['source_url'], 'retrieved_at': receipt['retrieved_at'], 'http_status': 200, 'retrieval_method': 'publisher_bulk_download', 'proxy': None}
            objects.extend([{'sha256': digest, 'bytes': len(raw), 'kind': 'publisher_original', 'path': str(path), 'sources': [source]},
                            {'sha256': text_sha, 'bytes': len(text_bytes), 'code_points': len(text), 'kind': 'unit_text_derivative', 'path': str(text_path), 'sources': [source]}])
            units.append({'unit_key': 'title-' + item['title'], 'unit_kind': 'historical_rtf_title', 'heading': title_heading,
                          'original_sha256': digest, 'publisher_member': None, 'raw_member_sha256': None,
                          'text_sha256': text_sha, 'text_code_points': len(text), 'sections_expected': len(candidates),
                          'currency': currency, 'source_url': item['source_url'], 'retrieved_at': receipt['retrieved_at'],
                          'retrieval_method': 'publisher_bulk_download', 'proxy': None, 'provenance_class': 'third_party_historical_archive',
                          'archive_edition': edition, 'source_qualification': qualification, 'status_note': qualification})
            for row in candidates:
                if text[row['span']['start']:row['span']['end']] != row['text']: raise ValueError('Unit span mismatch')
                line(sections, row)
            for row in held: line(quarantine, row)
            # Keep annotation paragraphs and every unmapped native paragraph as review evidence.
            write_json(output / 'review' / (item['file'] + '.json'), parsed)
            for row in parsed['sections']: counts.update(row['issues'])
            pages.append({'url': item['source_url'], 'markers': len(parsed['sections']), 'sections': len(candidates), 'original_sha256': digest})
            problems.extend({'file': item['file'], 'ordinal': r['row']['source_occurrence']['ordinal'], 'issues': r['issues']} for r in held)
            print(json.dumps({'state': state, 'title': item['title'], 'source_occurrences': len(parsed['sections']), 'quarantined': len(held)}), flush=True)
    item, release, stem, _ = SOURCES[state]
    manifest = {'schema_version': 'publisher-code-manifest/2', 'jurisdiction': state,
        'publisher': 'Public.Resource.Org / Internet Archive (third-party historical source)', 'publisher_url': f'https://archive.org/details/{item}',
        'source_system': state.lower() + '-historical-rtf-' + edition.replace('-', ''),
        'code_title': state + ' code — historical source edition ' + edition,
        'parser': {'name': 'historical-cic-rtf', 'version': '2'}, 'provenance_class': 'third_party_historical_archive',
        'current_law_verified': False, 'calculation_activation_allowed': False,
        'archive': {'edition': edition, 'edition_date': edition, 'qualification': qualification, 'provider': 'Public.Resource.Org / Internet Archive', 'origin_url': f'https://archive.org/details/{item}'},
        'retrieval': {'methods': ['publisher_bulk_download'], 'source_url_patterns': ['^https://archive\\.org/download/' + re.escape(item + '/' + release + '/' + stem) + r'\.title\.\d+\.rtf$'], 'terms_gate': False, 'official_source': False, 'rate_limit_ms': 1000},
        'structure': {'levels': ['title', 'section'], 'unit': 'retained original historical RTF title'},
        'section_id': {'scheme': 'third_party_source_occurrence', 'regex': r'^src-[a-f0-9]{64}-section-[1-9][0-9]*$', 'example': 'src-' + objects[0]['sha256'] + '-section-1', 'citation_format': 'Literal historical edition heading, identified by original hash and occurrence'},
        'currency': {'basis': 'archive_date', 'location': 'Pinned original archive release directory; not current-law verification'},
        'review': {'reviewed_by': 'Automated exact-source replay; independent publication review pending', 'reviewed_at': datetime.now().date().isoformat()}}
    write_json(output / 'manifest.json', manifest)
    for name, rows in [('objects', objects), ('units', units)]:
        with (output / (name + '.jsonl')).open('x', encoding='utf-8', newline='\n') as stream:
            for row in rows: line(stream, row)
    write_json(output / 'toc-proof.json', {'marker': 'Every native RTF Section-style occurrence, not current-law or ancillary completeness', 'pages': pages, 'unfetched_child_pages': []})
    summary = {'state': state, 'source_edition': edition, 'original_titles': len(plan), 'original_bytes': sum(r['bytes'] for r in plan),
               'source_occurrences': sum(p['markers'] for p in pages), 'candidate_sections': sum(p['sections'] for p in pages),
               'quarantined': len(problems), 'issues': dict(counts), 'problems': problems,
               'publication_allowed': False, 'current_law_verified': False, 'calculation_activation_allowed': False}
    write_json(output / 'staging-report.json', summary)
    return summary


if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('--originals', type=Path, required=True); cli.add_argument('--evidence', type=Path, required=True)
    cli.add_argument('--state', choices=list(SOURCES), required=True); cli.add_argument('--out', type=Path, required=True)
    args = cli.parse_args()
    print(json.dumps(stage(args.originals, args.evidence, args.state, args.out), ensure_ascii=False))
