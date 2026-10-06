"""Match the CourtListener dockets bulk export against registry dockets on the EXACT provider-neutral docket key.

Read-only and local: verifies the archive SHA-256, streams the CSV (parallel bzip2 via indexed_bzip2 when available),
and keeps only rows whose (court_id, parsed docket number) key equals a registry key. No caption, judge, firm, product or
MDL similarity is used. Output rows keep the native docket id and the source row ordinal; ambiguity is decided later.

  python match-docket-bulk.py --bulk dockets-2026-09-30.csv.bz2 --targets registry-dockets.jsonl --out outdir [--parallel 4] [--python-deps dir]
"""
import argparse, bz2, csv, hashlib, io, json, pathlib, re, sys, time

p = argparse.ArgumentParser()
p.add_argument('--bulk', required=True)
p.add_argument('--targets', required=True)
p.add_argument('--out', required=True)
p.add_argument('--parallel', type=int, default=1)
p.add_argument('--python-deps')
p.add_argument('--source-url', default='https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/dockets-2026-09-30.csv.bz2')
p.add_argument('--snapshot-date', default='2026-09-30')
args = p.parse_args()
if args.python_deps:
    sys.path.insert(0, args.python_deps)

PATTERN = re.compile(r'^(\d{1,2}):(\d{2}|\d{4})-?([a-z]{2,4})-?(\d{1,6})(?:-[A-Za-z]{2,5})*$', re.I)


def docket_key(court, number):
    m = PATTERN.match((number or '').strip())
    if not m or not court:
        return None
    year = m.group(2)
    if len(year) == 2:
        year = ('20' if int(year) < 70 else '19') + year
    return f'{court}:{int(m.group(1))}:{year}-{m.group(3).lower()}-{m.group(4).zfill(5)}'


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        while chunk := f.read(8 * 1024 * 1024):
            h.update(chunk)
    return h.hexdigest()


def open_csv(path):
    if args.parallel <= 1:
        return bz2.open(path, 'rt', encoding='utf-8', newline='')
    import indexed_bzip2
    return io.TextIOWrapper(io.BufferedReader(indexed_bzip2.open(str(path), parallelization=args.parallel), buffer_size=1 << 20), encoding='utf-8', newline='')


out = pathlib.Path(args.out)
out.mkdir(parents=True, exist_ok=True)
t0 = time.time()
targets = {}
for line in open(args.targets, encoding='utf-8'):
    r = json.loads(line)
    k = docket_key(r['court_id'], r['docket_number']) or r.get('docket_key')
    if k and re.match(r'^[a-z0-9]+:\d{1,2}:\d{4}-[a-z]{2,4}-\d{5,6}$', k):
        targets.setdefault(k, []).append(r['id'])
archive_sha = sha256_file(args.bulk)
size = pathlib.Path(args.bulk).stat().st_size
print(json.dumps({'event': 'archive_verified', 'sha256': archive_sha, 'bytes': size, 'target_keys': len(targets), 'sec': round(time.time() - t0)}), flush=True)

csv.field_size_limit(1 << 30)
keep = ['id', 'court_id', 'docket_number', 'date_filed', 'date_terminated', 'case_name', 'case_name_full', 'pacer_case_id', 'date_last_filing', 'idb_data_id', 'docket_number_core', 'date_modified', 'date_created', 'source', 'blocked']
scanned = matched = unparsed = 0
cols = None
with open_csv(args.bulk) as f, open(out / 'matches.jsonl', 'w', encoding='utf-8') as w:
    reader = csv.reader(f)
    header = next(reader)
    cols = {name: i for i, name in enumerate(header)}
    need = ['id', 'court_id', 'docket_number']
    if any(n not in cols for n in need):
        raise SystemExit(f'missing columns {need} in {header[:12]}')
    idx = {k: cols[k] for k in keep if k in cols}
    for ordinal, row in enumerate(reader, start=1):
        scanned += 1
        if len(row) <= max(idx.values()):
            unparsed += 1
            continue
        k = docket_key(row[idx['court_id']], row[idx['docket_number']])
        if k is not None and k in targets:
            matched += 1
            rec = {n: (row[i] if row[i] != '' else None) for n, i in idx.items()}
            rec['docket_key'] = k
            rec['source_row_ordinal'] = ordinal
            w.write(json.dumps(rec, ensure_ascii=False) + '\n')
        if scanned % 5_000_000 == 0:
            print(json.dumps({'event': 'progress', 'scanned': scanned, 'matched': matched, 'sec': round(time.time() - t0)}), flush=True)

receipt = {'schema': 'bulk-docket-match/1', 'source_url': args.source_url, 'snapshot_date': args.snapshot_date, 'archive_sha256': archive_sha, 'archive_bytes': size,
           'rows_scanned': scanned, 'rows_matched': matched, 'rows_unparsed': unparsed, 'columns': list(cols), 'columns_kept': list(idx), 'target_keys': len(targets),
           'elapsed_sec': round(time.time() - t0), 'completed_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
(out / 'receipt.json').write_text(json.dumps(receipt, indent=2))
print(json.dumps({'event': 'done', **{k: receipt[k] for k in ('rows_scanned', 'rows_matched', 'elapsed_sec')}}))
