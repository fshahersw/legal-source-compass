"""Package exact FR page bytes plus acquisition metadata before local cleanup."""
import hashlib
import json
import pathlib
import sqlite3
import sys
import tarfile
import io

source, destination = map(pathlib.Path, sys.argv[1:3])
db = sqlite3.connect(f'file:{(source/"native.sqlite").as_posix()}?mode=ro', uri=True)
db.row_factory = sqlite3.Row
periods = [dict(r) for r in db.execute('select * from periods order by start_date')]
pages = [dict(r) for r in db.execute('select * from pages order by url')]
publications = db.execute('select count(*) from publications').fetchone()[0]
if len(periods) != 322 or any(r['actual'] != r['expected'] or r['status'] != 'acquired' for r in periods) or sum(r['actual'] for r in periods) != publications:
    raise ValueError('Acquisition counts do not reconcile')
db.close()
for row in pages:
    file = pathlib.Path(row['path'])
    if file.resolve().parent != (source/'pages').resolve() or hashlib.sha256(file.read_bytes()).hexdigest() != row['sha256']:
        raise ValueError('Original page checksum mismatch')
    row['archive_path'] = 'pages/' + file.name
manifest = {'schema_version': 'federal-register-retained-originals/1', 'publication_count': publications, 'periods': periods, 'pages': pages, 'source_audits_complete': False}
encoded = (json.dumps(manifest, ensure_ascii=False, indent=2)+'\n').encode('utf-8')
destination.parent.mkdir(parents=True, exist_ok=True)
if destination.exists():
    raise ValueError('Preserve an existing archive')
with tarfile.open(destination, 'w:gz', compresslevel=3) as archive:
    info = tarfile.TarInfo('acquisition-manifest.json'); info.size = len(encoded)
    archive.addfile(info, io.BytesIO(encoded))
    archive.add(source/'agencies.json', arcname='agencies.json')
    for file in sorted((source/'pages').glob('*.json')):
        if file.stem != hashlib.sha256(file.read_bytes()).hexdigest():
            raise ValueError('Unindexed page hash mismatch')
        archive.add(file, arcname='pages/'+file.name)
with tarfile.open(destination, 'r:gz') as archive:
    by_name = {r['archive_path']: r['sha256'] for r in pages}
    found = set()
    for member in archive:
        if member.name in by_name:
            if hashlib.file_digest(archive.extractfile(member), 'sha256').hexdigest() != by_name[member.name]:
                raise ValueError('Packaged original differs')
            found.add(member.name)
    if len(found) != len(by_name):
        raise ValueError('Missing packaged originals')
receipt = {'path': str(destination.resolve()), 'bytes': destination.stat().st_size, 'sha256': hashlib.file_digest(destination.open('rb'), 'sha256').hexdigest(),
           'provenance': {'source_name': 'Federal Register', 'source_url': 'https://www.federalregister.gov/api/v1/documents.json', 'from': '2000-01-01', 'through': '2026-10-02', 'publications': publications, 'periods': len(periods), 'original_pages': len(pages), 'archive_validation': 'Every indexed original page SHA-256 verified after packaging'}}
plan = {'project_id': 'xosqzzsnhxcyehcnirpa', 'bucket': 'corpus-originals', 'allowed_root': str(destination.parent.resolve()), 'files': [receipt]}
plan_path = destination.with_suffix(destination.suffix + '.plan.json')
plan_path.write_text(json.dumps(plan, indent=2)+'\n')
print(json.dumps(receipt), flush=True)
