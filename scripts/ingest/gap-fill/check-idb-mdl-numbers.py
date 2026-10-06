"""For saved native dockets with no recorded MDL number, read the sha256-verified FJC IDB bulk row they join to (exact idb_data_id)
and report whether the FJC multidistrict_litigation_docket_number field is populated. Read-only; no inference.
usage: check-idb-mdl-numbers.py <fjc.csv.bz2> <ids.txt (one idb id per line)> <out.json>"""
import bz2, csv, json, sys, hashlib
src, idsf, out = sys.argv[1:4]
ids = {l.strip() for l in open(idsf) if l.strip()}
csv.field_size_limit(1 << 30)
sha = hashlib.sha256(open(src, 'rb').read()).hexdigest()
found = {}
with bz2.open(src, 'rt', encoding='utf-8', newline='') as f:
    r = csv.reader(f); h = next(r); c = {n: i for i, n in enumerate(h)}
    mcol = next(n for n in h if 'multidistrict' in n)
    n = 0
    for row in r:
        n += 1
        if row[c['id']] in ids:
            found[row[c['id']]] = {'mdl': row[c[mcol]] or None, 'origin': row[c['origin']] if 'origin' in c else None, 'date_filed': row[c['date_filed']] if 'date_filed' in c else None}
res = {'archive_sha256': sha, 'rows_scanned': n, 'mdl_column': mcol, 'requested': len(ids), 'found': len(found), 'mdl_populated': sum(1 for v in found.values() if v['mdl']), 'found_rows': found}
json.dump(res, open(out, 'w'), indent=2); print(json.dumps(res))
