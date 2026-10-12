"""Bounded, explicit historical RTF capture. No database or publication operations."""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import time
from urllib.parse import urljoin, urlsplit
import requests

SOURCES = {
    'AR': ('gov.ar.code', 'release78.2020.11.06', 'gov.ar.code', 28),
    'MS': ('gov.ms.code.ann.2018', 'release78.2020.07.08', 'gov.ms.code', 50),
    'TN': ('gov.tn.tca', 'release76.2021.05.21', 'gov.tn.tca', 68),
}
MAX_BYTES = 32 * 1024 * 1024


def sha256(raw):
    return hashlib.sha256(raw).hexdigest()


def make_plan(state, metadata_bytes):
    item, release, stem, expected = SOURCES[state]
    meta = json.loads(metadata_bytes)
    if meta.get('metadata', {}).get('identifier') != item:
        raise ValueError('Archive metadata identity mismatch')
    pattern = re.compile(re.escape(release + '/' + stem) + r'\.title\.(\d+)\.rtf')
    rows = []
    for source in meta['files']:
        match = pattern.fullmatch(source['name'])
        if not match:
            continue
        size = int(source['size'])
        if not 0 < size <= MAX_BYTES or not re.fullmatch('[a-f0-9]{40}', source['sha1']) or not re.fullmatch('[a-f0-9]{32}', source['md5']):
            raise ValueError('Original metadata lacks bounded checksums')
        rows.append({'state': state, 'source_edition': release.split('.', 1)[1].replace('.', '-'),
                     'title': match[1], 'archive_item': item, 'archive_path': source['name'],
                     'source_url': f'https://archive.org/download/{item}/{source["name"]}',
                     'bytes': size, 'archive_sha1': source['sha1'], 'archive_md5': source['md5'],
                     'metadata_sha256': sha256(metadata_bytes), 'file': source['name'].split('/')[-1]})
    if len(rows) != expected or len({r['file'] for r in rows}) != expected:
        raise ValueError('Exact reviewed title inventory required')
    return sorted(rows, key=lambda row: int(row['title']))


def allowed_url(url, row):
    parsed = urlsplit(url)
    if parsed.scheme != 'https' or parsed.username or parsed.password or parsed.port not in (None, 443) or parsed.query or parsed.fragment:
        raise ValueError('Unsafe archive URL')
    wanted = '/' + row['archive_item'] + '/' + row['archive_path']
    if parsed.hostname == 'archive.org' and parsed.path == '/download' + wanted:
        return
    if parsed.hostname and re.fullmatch(r'(?:ia\d+\.(?:us|ca)|dn\d+\.ca)\.archive\.org', parsed.hostname) and re.fullmatch(r'/\d+/items' + re.escape(wanted), parsed.path):
        return
    raise ValueError('Redirect is not the exact reviewed archive object')


def verify_bytes(raw, row):
    if len(raw) != row['bytes'] or not raw.startswith(b'{\\rtf') or hashlib.sha1(raw).hexdigest() != row['archive_sha1'] or hashlib.md5(raw).hexdigest() != row['archive_md5']:
        raise ValueError('Original bytes do not match pinned archive checksums')
    return sha256(raw)


def capture(row, out, get=requests.get):
    out = Path(out).resolve()
    if row['file'] != Path(row['file']).name or not re.fullmatch(r'gov\.(?:ar\.code|ms\.code|tn\.tca)\.title\.\d+\.rtf', row['file']):
        raise ValueError('Local original filename invalid')
    dest = out / row['file']
    receipt_path = out / (row['file'] + '.receipt.json')
    if dest.exists() or receipt_path.exists():
        if dest.is_symlink() or receipt_path.is_symlink() or not dest.is_file() or not receipt_path.is_file():
            raise ValueError('Incomplete or linked immutable capture')
        receipt = json.loads(receipt_path.read_bytes())
        digest = verify_bytes(dest.read_bytes(), row)
        if any(receipt.get(k) != v for k, v in row.items()) or receipt.get('sha256') != digest:
            raise ValueError('Existing receipt does not bind this original')
        allowed_url(receipt['final_url'], row)
        return {'file': row['file'], 'sha256': digest, 'resumed': True}
    url = row['source_url']
    for _ in range(6):
        allowed_url(url, row)
        response = get(url, stream=True, timeout=(15, 60), allow_redirects=False,
                       headers={'User-Agent': 'Legal-Source-Atlas-historical-archive/1'})
        with response:
            if response.status_code in (301, 302, 303, 307, 308):
                url = urljoin(url, response.headers.get('Location', ''))
                continue
            if response.status_code != 200:
                raise ValueError(f'Archive HTTP status {response.status_code}')
            chunks = []; count = 0
            for chunk in response.iter_content(1024 * 1024):
                count += len(chunk)
                if count > row['bytes'] or count > MAX_BYTES:
                    raise ValueError('Archive response exceeds exact bounded size')
                chunks.append(chunk)
            raw = b''.join(chunks)
        digest = verify_bytes(raw, row)
        receipt = {**row, 'sha256': digest, 'final_url': url, 'http_status': 200,
                   'retrieved_at': datetime.now(timezone.utc).isoformat(),
                   'provenance_class': 'third_party_historical_archive', 'official_direct': False,
                   'current_law_verified': False, 'calculation_activation_allowed': False}
        out.mkdir(parents=True, exist_ok=True)
        with dest.open('xb') as stream:
            stream.write(raw)
        with receipt_path.open('x', encoding='utf-8', newline='\n') as stream:
            json.dump(receipt, stream, indent=2); stream.write('\n')
        return {'file': row['file'], 'sha256': digest, 'resumed': False}
    raise ValueError('Archive redirect limit exceeded')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--capture', action='store_true', help='Explicitly retrieve the pinned title originals')
    args = parser.parse_args()
    plan = [row for state in SOURCES for row in make_plan(state, (args.evidence / (state.lower() + '-archive-metadata.json')).read_bytes())]
    plan_path = args.out / 'plan.json'
    args.out.mkdir(parents=True, exist_ok=True)
    plan_bytes = (json.dumps(plan, indent=2) + '\n').encode()
    if plan_path.exists():
        if plan_path.read_bytes() != plan_bytes:
            raise ValueError('Immutable plan differs')
    else:
        plan_path.write_bytes(plan_bytes)
    print(json.dumps({'files': len(plan), 'bytes': sum(r['bytes'] for r in plan), 'plan_sha256': sha256(plan_bytes)}), flush=True)
    if args.capture:
        def task(row):
            existed = (args.out / row['state'] / row['file']).exists()
            try:
                return capture(row, args.out / row['state'])
            except (requests.RequestException, ValueError) as error:
                return {'file': row['file'], 'error': type(error).__name__ + ': ' + str(error)}
            finally:
                if not existed:
                    time.sleep(1)
        failed = False
        with ThreadPoolExecutor(max_workers=3) as executor:
            for result in executor.map(task, plan):
                failed = failed or 'error' in result
                print(json.dumps(result), flush=True)
        if failed:
            raise SystemExit('Capture incomplete; retained verified originals are resumable')


if __name__ == '__main__':
    main()
