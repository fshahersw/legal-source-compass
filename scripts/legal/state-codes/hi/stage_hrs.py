"""Stage /tmp/sc/HI/staged from parsed sections and receipts. Does not land."""
import gzip
import hashlib
import json
import shutil
from collections import defaultdict
from pathlib import Path

ROOT = Path('/tmp/sc/HI')
STAGED = ROOT / 'staged'


def sha_bytes(data):
    return hashlib.sha256(data).hexdigest()


def main():
    if STAGED.exists():
        shutil.rmtree(STAGED)
    chapters = STAGED / 'chapters'
    chapters.mkdir(parents=True)
    sections_path = ROOT / 'parsed' / 'sections.jsonl'
    raw = sections_path.read_bytes()
    gz_path = STAGED / 'sections.jsonl.gz'
    with gzip.open(gz_path, 'wb', compresslevel=9) as handle:
        handle.write(raw)
    gz_sha = sha_bytes(gz_path.read_bytes())

    grouped = defaultdict(list)
    for line in raw.decode('utf-8').splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        # Group derivative text by volume + chapter (or article) number.
        numbers = {item['level']: item.get('number') for item in row['citation_path']}
        key = '%s-%s-%s' % (numbers.get('volume') or 'x', numbers.get('chapter') or numbers.get('article') or 'x',
                            row['source']['url'].rstrip('/').split('/')[-2])
        parts = []
        if row.get('citation'):
            parts.append(row['citation'])
        if row.get('heading'):
            parts.append(row['heading'])
        if row.get('text'):
            parts.append(row['text'])
        if row.get('history'):
            parts.append(row['history'])
        grouped[key].append('\n'.join(parts))

    derivatives = []
    for key in sorted(grouped):
        body = ('\n\n'.join(grouped[key]) + '\n').encode('utf-8')
        digest = sha_bytes(body)
        dest = chapters / digest
        dest.write_bytes(body)
        derivatives.append({
            'sha256': digest,
            'bytes': len(body),
            'url': None,
            'retrieved_at': None,
            'retrieval_method': 'derivative:hi-hrs-html/1',
            'kind': 'unit_text_derivative',
            'path': 'chapters/' + digest,
            'group': key,
            'member': key,
        })

    manifest = []
    seen = set()
    for line in (ROOT / 'receipts.jsonl').read_text(encoding='utf8').splitlines():
        if not line.strip():
            continue
        rec = json.loads(line)
        if not rec.get('ok') or not rec.get('sha256') or rec['sha256'] in seen:
            continue
        if not rec.get('stored_path'):
            continue
        seen.add(rec['sha256'])
        path = ROOT / rec['stored_path']
        manifest.append({
            'sha256': rec['sha256'],
            'bytes': rec['bytes'],
            'url': rec.get('final_url') or rec['url'],
            'requested_url': rec['url'],
            'retrieved_at': rec['retrieved_at'],
            'retrieval_method': rec['retrieval_method'],
            'kind': 'publisher_original',
            'stored_path': rec['stored_path'],
            'exists': path.exists(),
        })
    manifest.extend(derivatives)
    manifest.append({
        'sha256': gz_sha,
        'bytes': gz_path.stat().st_size,
        'url': None,
        'retrieved_at': None,
        'retrieval_method': 'derivative:hi-hrs-html/1',
        'kind': 'sections.jsonl.gz',
        'path': 'sections.jsonl.gz',
    })
    shutil.copyfile(ROOT / 'source.json', STAGED / 'source.json')
    (STAGED / 'manifest.json').write_text(json.dumps({
        'state': 'HI',
        'code_id': 'hi-hrs',
        'parser': 'hi-hrs-html/1',
        'sections_jsonl_gz_sha256': gz_sha,
        'sections_jsonl_sha256': sha_bytes(raw),
        'files': manifest,
        'derivatives': derivatives,
    }, indent=2, ensure_ascii=False) + '\n', encoding='utf8')
    print('originals', len(seen), 'derivatives', len(derivatives), 'gz', gz_sha, 'bytes', gz_path.stat().st_size)


if __name__ == '__main__':
    main()
