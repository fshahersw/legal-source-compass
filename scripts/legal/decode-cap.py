"""Decode a retained CAP volume without extracting paths from its ZIP."""
import hashlib
import json
import pathlib
import sys
import zipfile

archive, output = map(pathlib.Path, sys.argv[1:3])
receipt = json.loads(pathlib.Path(str(archive) + '.provenance.json').read_text())
if hashlib.sha256(archive.read_bytes()).hexdigest() != receipt['sha256']:
    raise ValueError('CAP archive checksum mismatch')
count = excluded = 0
with zipfile.ZipFile(archive) as zipped, output.open('x', encoding='utf-8') as sink:
    for member in zipped.infolist():
        if not member.filename.startswith('json/') or not member.filename.endswith('.json'):
            continue
        if member.file_size > 32 * 1024 * 1024:
            raise ValueError('Case exceeds bounded JSON decode size')
        raw = zipped.read(member)
        row = json.loads(raw)
        date = row.get('decision_date', '')
        if date and date < '2000-01-01':
            excluded += 1
            continue
        provenance = dict(source_url=receipt['source_url'], source_sha256=receipt['sha256'],
                          record_sha256=hashlib.sha256(raw).hexdigest(), retrieved_at=receipt['retrieved_at'],
                          archive_member=member.filename, schema_version='cap-static-case-json/1', licence=receipt['licence'])
        sink.write(json.dumps(dict(source_system='cap', entity_type='cases', native_id=str(row['id']), data=row, provenance=provenance), ensure_ascii=False) + '\n')
        count += 1
print(json.dumps(dict(staged=count, excluded_pre_2000=excluded, source_archive=receipt['source_url'], complete=False)))
