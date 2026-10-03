"""Retain the official FJC export and join only exact, unique native identifiers."""
import argparse
import collections
import csv
import hashlib
import json
import pathlib


def prepare(source, people, destination):
    manifest = json.loads((source / 'source-manifest.json').read_text(encoding='utf-8'))
    captures = {r['id']: r for r in manifest['sources']}
    tables = {}
    for name, filename in [('fjc-demographics', 'fjc-demographics.csv'), ('fjc-service', 'fjc-service.csv')]:
        data = (source / 'raw' / filename).read_bytes()
        if hashlib.sha256(data).hexdigest() != captures[name]['sha256']:
            raise ValueError(f'Original checksum mismatch: {name}')
        with (source / 'raw' / filename).open(encoding='utf-8-sig', newline='') as stream:
            tables[name] = list(csv.DictReader(stream))
    services = collections.defaultdict(list)
    for row in tables['fjc-service']:
        services[row['nid']].append(row)
    by_jid = collections.defaultdict(list)
    for row in tables['fjc-demographics']:
        if row['jid'].strip():
            by_jid[row['jid'].strip()].append(row['nid'])
    people_by_jid = collections.defaultdict(list)
    with people.open(encoding='utf-8') as stream:
        for line in stream:
            row = json.loads(line)
            if row['data'].get('fjc_id') not in (None, ''):
                if str(row['data']['id']) != row['native_id']:
                    raise ValueError('CourtListener native ID mismatch')
                people_by_jid[str(row['data']['fjc_id'])].append(row)
    destination.mkdir(parents=True, exist_ok=True)
    native_path = destination / 'fjc-judges-native.jsonl'
    crosswalk_path = destination / 'fjc-person-crosswalk.jsonl'
    review = []
    joined = count = 0
    with native_path.open('x', encoding='utf-8') as output, crosswalk_path.open('x', encoding='utf-8') as crosswalk:
        for row in tables['fjc-demographics']:
            jid, nid = row['jid'].strip(), row['nid'].strip()
            matches = people_by_jid[jid]
            unique = len(by_jid[jid]) == 1 and len(matches) == 1
            candidates = [p['native_id'] for p in matches]
            if matches and not unique:
                review.append({'fjc_nid': nid, 'fjc_legacy_id': jid, 'courtlistener_candidates': candidates, 'reason': 'Native identifier join is not unique'})
            capture = captures['fjc-demographics']
            data = {'nid': nid, 'jid': jid, 'demographics': row, 'service': services[nid], 'courtlistener_person_id': candidates[0] if unique else None,
                    'courtlistener_candidates': candidates, 'service_provenance': captures['fjc-service']}
            provenance = {'source_url': capture['url'], 'retrieved_at': capture['fetchedAt'], 'source_sha256': capture['sha256'],
                          'record_sha256': hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False).encode()).hexdigest(), 'schema_version': 'fjc-official-export/1'}
            native = {'source_system': 'fjc', 'entity_type': 'judges', 'native_id': nid, 'data': data, 'provenance': provenance}
            output.write(json.dumps(native, ensure_ascii=False) + '\n')
            if unique:
                crosswalk.write(json.dumps({'source_system': 'fjc', 'entity_type': 'person-crosswalk', 'native_id': nid,
                                           'data': {'fjc_nid': nid, 'fjc_legacy_id': jid, 'courtlistener_person_id': candidates[0]},
                                           'provenance': {**provenance, 'courtlistener_provenance': matches[0]['provenance']}}) + '\n')
                joined += 1
            count += 1
    report = {'fjc_judges': count, 'service_rows': len(tables['fjc-service']), 'exact_unique_person_joins': joined,
              'ambiguous_joins': review, 'unmatched_fjc_judges': count - joined - len(review), 'complete': False}
    (destination / 'crosswalk-report.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    config = {'schema_version': 'legal-atlas/3.1', 'database': str(destination / 'stage.sqlite'), 'output': str(destination / 'reports'),
              'end_year': 2026, 'support_files': [], 'files': [str(native_path)]}
    (destination / 'config.json').write_text(json.dumps(config, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({**report, 'ambiguous_joins': len(review), 'path': str(destination)}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=pathlib.Path)
    parser.add_argument('people', type=pathlib.Path)
    parser.add_argument('destination', type=pathlib.Path)
    args = parser.parse_args()
    prepare(args.source, args.people, args.destination)
