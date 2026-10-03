"""Independent source comparison of the fixed 50-row FJC source sample.

This is an automated source audit, not the global 100-record judge-type audit.
It uses freshly fetched CSV originals, including the separately published
service table's Judge Name column for its title check.
"""
import csv
import hashlib
import json
import pathlib
import sqlite3
import sys

root = pathlib.Path(sys.argv[1])
fresh = pathlib.Path(sys.argv[2])
receipts = json.loads((fresh/'fresh-source-receipts.json').read_text())
tables = {}
for receipt in receipts:
    file = pathlib.Path(receipt['path'])
    if receipt['status'] != 200 or hashlib.sha256(file.read_bytes()).hexdigest() != receipt['sha256']:
        raise ValueError('Fresh original validation failed')
    with file.open(encoding='utf-8-sig', newline='') as stream:
        tables[receipt['id']] = list(csv.DictReader(stream))
demographics = {r['nid']: r for r in tables['fjc-demographics']}
services = {}
for row in tables['fjc-service']:
    services.setdefault(row['nid'], []).append(row)
samples = json.loads((root/'reports/audit-samples.json').read_text())
keys = samples['source_samples']['fjc']['keys']
if len(keys) != 50 or len(set(keys)) != 50:
    raise ValueError('The source audit requires its fixed 50-row random sample')
db = sqlite3.connect(f'file:{(root/"stage.sqlite").as_posix()}?mode=ro', uri=True)
reviews = []
for key in keys:
    candidates = json.loads(db.execute('select candidates_json from inputs where input_key=?', (key,)).fetchone()[0])
    if len(candidates) != 1:
        raise ValueError('Unexpected FJC candidate multiplicity')
    record = candidates[0]
    nid = record['id']
    source = demographics.get(nid)
    native_service = services.get(nid, [])
    names = []
    for row in native_service:
        # FJC service export is Last, First Middle [Suffix]. The display title
        # retains its spelling; suffix punctuation is normalized for comparison.
        parts = [p.strip() for p in row['Judge Name'].split(',')]
        names.append(' '.join(parts[1:2] + parts[:1] + parts[2:]))
    normalize = lambda value: ' '.join(value.replace(',', '').split()).casefold()
    title_correct = any(normalize(record['title']) == normalize(name) for name in names)
    reviews.append({'input_key': key, 'record_key': [record[k] for k in ('id_authority','type','id','version')],
                    'type_correct': record['type'] == 'judge' and source is not None and bool(native_service),
                    'title_correct': title_correct, 'source_matches': source == record['attributes']['native']['demographics'] and native_service == record['attributes']['service'],
                    'source_status': 200, 'checked_at': receipts[0]['checked_at'], 'reviewer': 'Codex automated independent FJC CSV comparison',
                    'source_url': record['source_url'], 'original_sha256': receipts[0]['sha256'], 'service_original_sha256': receipts[1]['sha256']})
db.close()
passed = all(r['type_correct'] and r['title_correct'] and r['source_matches'] for r in reviews)
report = {'scope': 'FJC source sample only; global entity audit still pending', 'population_sha256': samples['population_sha256'], 'seed': samples['seed'],
          'required': 50, 'reviewed': len(reviews), 'source_audit_passed': passed, 'complete_historical_load': False, 'reviews': reviews, 'fresh_source_receipts': receipts}
destination = root/'reports/source-audit-fjc.json'
if destination.exists():
    raise ValueError('Preserve the existing source audit')
destination.write_text(json.dumps(report, indent=2, ensure_ascii=False)+'\n')
print(json.dumps({k: report[k] for k in ('scope','required','reviewed','source_audit_passed','complete_historical_load')}))
if not passed:
    print(json.dumps({'review_needed': [r['record_key'][2] for r in reviews if not (r['type_correct'] and r['title_correct'] and r['source_matches'])]}))
