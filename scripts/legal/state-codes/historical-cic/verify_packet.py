"""Offline replay of every historical packet row against exact retained original bytes."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import re

from capture_originals import allowed_url, make_plan, verify_bytes
from parse_cic_rtf import parse
from stage_historical import source_rows


def read_lines(path):
    with path.open(encoding='utf-8') as stream:
        return [json.loads(line) for line in stream if line.strip()]


def verify(packet, originals, evidence):
    packet, originals, evidence = Path(packet).resolve(), Path(originals).resolve(), Path(evidence).resolve()
    manifest = json.loads((packet / 'manifest.json').read_bytes()); state = manifest['jurisdiction']
    if manifest.get('provenance_class') != 'third_party_historical_archive' or manifest['retrieval']['official_source'] is not False or manifest.get('current_law_verified') is not False or manifest.get('calculation_activation_allowed') is not False:
        raise ValueError('Historical provenance or authority gates invalid')
    qualification = manifest['archive']['qualification']; edition = manifest['archive']['edition']
    plan = make_plan(state, (evidence / (state.lower() + '-archive-metadata.json')).read_bytes())
    if any(r['source_edition'] != edition for r in plan): raise ValueError('Edition differs from original archive metadata')
    sections = read_lines(packet / 'sections.jsonl'); units = read_lines(packet / 'units.jsonl')
    held = read_lines(packet / 'quarantine.jsonl'); objects = read_lines(packet / 'objects.jsonl')
    if len({o['sha256'] for o in objects}) != len(objects): raise ValueError('Duplicate object records')
    object_map = {o['sha256']: o for o in objects}
    for obj in objects:
        data = Path(obj['path']).read_bytes()
        if len(data) != obj['bytes'] or hashlib.sha256(data).hexdigest() != obj['sha256']:
            raise ValueError('Packet object hash or bytes mismatch')
        if obj['kind'] == 'unit_text_derivative' and len(data.decode('utf-8')) != obj['code_points']:
            raise ValueError('Derivative Unicode length mismatch')
    if len(units) != len(plan) or len(objects) != 2 * len(plan): raise ValueError('Title inventory or object count differs')
    expected_rows = []; expected_held = []; expected_pages = []
    for item, unit in zip(plan, units):
        raw_path = originals / state / item['file']; raw = raw_path.read_bytes(); digest = verify_bytes(raw, item)
        receipt = json.loads((raw_path.parent / (raw_path.name + '.receipt.json')).read_bytes())
        if any(receipt.get(k) != v for k, v in item.items()) or receipt['sha256'] != digest or receipt['http_status'] != 200:
            raise ValueError('Original receipt binding invalid')
        allowed_url(receipt['final_url'], item)
        if unit['original_sha256'] != digest or unit['unit_key'] != 'title-' + item['title'] or unit['retrieved_at'] != receipt['retrieved_at'] or unit['source_url'] != item['source_url']:
            raise ValueError('Unit source identity differs from retained original')
        source = {'source_url': item['source_url'], 'retrieved_at': receipt['retrieved_at'], 'http_status': 200, 'retrieval_method': 'publisher_bulk_download', 'proxy': None}
        if object_map[digest]['kind'] != 'publisher_original' or object_map[unit['text_sha256']]['kind'] != 'unit_text_derivative' or any(object_map[key]['sources'] != [source] for key in [digest, unit['text_sha256']]):
            raise ValueError('Packet object capture provenance differs from original receipt')
        if unit.get('source_qualification') != qualification or unit.get('archive_edition') != edition or unit.get('provenance_class') != manifest['provenance_class'] or unit['currency']['through_date'] is not None:
            raise ValueError('Unit historical qualification mismatch')
        parsed = parse(raw, state, edition)
        # Independent original marker tally catches missed native style occurrences.
        section_style = next(number for number, name in parsed['styles'].items() if name == 'Section')
        native_markers = len(re.findall(rb'\\s' + str(section_style).encode() + rb'\b', raw)) - 1  # stylesheet definition
        if native_markers != len(parsed['sections']): raise ValueError('Native Section-style count differs from parsed occurrences')
        rows, text, quarantined, heading = source_rows(parsed, raw, item['title'], qualification, unit['currency'])
        if Path(object_map[unit['text_sha256']]['path']).read_bytes() != text.encode('utf-8') or unit['heading'] != heading or unit['sections_expected'] != len(rows):
            raise ValueError('Unit derivative or counts differ from full original replay')
        if json.loads((packet / 'review' / (item['file'] + '.json')).read_bytes()) != json.loads(json.dumps(parsed)):
            raise ValueError('Annotation/unmapped review ledger differs from source replay')
        expected_rows.extend(rows); expected_held.extend(quarantined)
        expected_pages.append({'url': item['source_url'], 'markers': native_markers, 'sections': len(rows), 'original_sha256': digest})
    if sections != expected_rows or held != expected_held:
        raise ValueError('Packet rows or quarantine differ from exact original replay')
    toc = json.loads((packet / 'toc-proof.json').read_bytes())
    if toc['pages'] != expected_pages or toc['unfetched_child_pages'] != []:
        raise ValueError('Source inventory proof differs from retained original markers')
    return {'state': state, 'source_edition': edition, 'original_titles': len(plan), 'objects_verified': len(objects),
            'rows_replayed': len(sections), 'quarantined': len(held), 'native_source_occurrences': sum(p['markers'] for p in expected_pages),
            'packet_file_sha256': {name: hashlib.sha256((packet / name).read_bytes()).hexdigest() for name in ['manifest.json', 'objects.jsonl', 'units.jsonl', 'sections.jsonl', 'quarantine.jsonl', 'toc-proof.json']},
            'verified': True, 'publication_allowed': False, 'current_law_verified': False, 'calculation_activation_allowed': False}


if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('--packet', type=Path, required=True); cli.add_argument('--originals', type=Path, required=True); cli.add_argument('--evidence', type=Path, required=True)
    args = cli.parse_args(); print(json.dumps(verify(args.packet, args.originals, args.evidence), ensure_ascii=False))
