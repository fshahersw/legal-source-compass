import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from capture_originals import allowed_url, capture, make_plan, verify_bytes


RAW = b'{\\rtf synthetic source}'


def row():
    return {'state': 'AR', 'source_edition': '2020-11-06', 'title': '01',
            'archive_item': 'gov.ar.code', 'archive_path': 'release78.2020.11.06/gov.ar.code.title.01.rtf',
            'source_url': 'https://archive.org/download/gov.ar.code/release78.2020.11.06/gov.ar.code.title.01.rtf',
            'bytes': len(RAW), 'archive_sha1': hashlib.sha1(RAW).hexdigest(),
            'archive_md5': hashlib.md5(RAW).hexdigest(), 'metadata_sha256': 'a' * 64, 'file': 'gov.ar.code.title.01.rtf'}


class Response:
    def __init__(self, body=RAW, status=200, location=None):
        self.body = body; self.status_code = status; self.headers = {'Location': location} if location else {}
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def iter_content(self, size): yield self.body


class CaptureTests(unittest.TestCase):
    def test_exact_native_object_redirect_only(self):
        allowed_url(row()['source_url'], row())
        allowed_url('https://dn710000.ca.archive.org/0/items/gov.ar.code/' + row()['archive_path'], row())
        for url in ['http://archive.org/download/gov.ar.code/' + row()['archive_path'],
                    row()['source_url'] + '?alternate=1', row()['source_url'].replace('.01.', '.02.'),
                    'https://evil.archive.org/0/items/gov.ar.code/' + row()['archive_path'],
                    'https://archive.org.evil.test/download/gov.ar.code/' + row()['archive_path']]:
            with self.subTest(url=url), self.assertRaises(ValueError): allowed_url(url, row())

    def test_streamed_capture_and_hash_checked_resume(self):
        with tempfile.TemporaryDirectory() as temp:
            result = capture(row(), temp, get=lambda *a, **k: Response())
            self.assertFalse(result['resumed'])
            receipt = json.loads((Path(temp) / (row()['file'] + '.receipt.json')).read_bytes())
            self.assertFalse(receipt['official_direct'])
            self.assertFalse(receipt['calculation_activation_allowed'])
            self.assertTrue(capture(row(), temp, get=lambda *a, **k: self.fail('Resume must not fetch'))['resumed'])
            (Path(temp) / row()['file']).write_bytes(RAW.replace(b'synthetic', b'SYNTHETIC'))
            with self.assertRaisesRegex(ValueError, 'checksums'): capture(row(), temp)

    def test_oversized_and_bad_hash_bodies_leave_no_capture(self):
        for body in [RAW + b'!', RAW.replace(b'synthetic', b'SYNTHETIC')]:
            with tempfile.TemporaryDirectory() as temp:
                with self.assertRaises(ValueError): capture(row(), temp, get=lambda *a, **k: Response(body))
                self.assertEqual(list(Path(temp).iterdir()), [])

    def test_unreviewed_redirect_is_rejected_before_second_request(self):
        calls = []
        def get(url, **kwargs):
            calls.append(url)
            return Response(status=302, location='https://example.test/other.rtf')
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaisesRegex(ValueError, 'exact reviewed'): capture(row(), temp, get=get)
        self.assertEqual(len(calls), 1)

    def test_incomplete_inventory_is_not_silently_a_complete_plan(self):
        meta = {'metadata': {'identifier': 'gov.ar.code'}, 'files': []}
        with self.assertRaisesRegex(ValueError, 'inventory'): make_plan('AR', json.dumps(meta).encode())
        meta['metadata']['identifier'] = 'other'
        with self.assertRaisesRegex(ValueError, 'identity'): make_plan('AR', json.dumps(meta).encode())


if __name__ == '__main__': unittest.main()
