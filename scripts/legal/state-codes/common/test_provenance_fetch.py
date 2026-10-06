import http.server
import pathlib
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from provenance_fetch import Fetcher, verify_store  # noqa: E402


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/missing':
            self.send_response(404)
            self.end_headers()
            return
        body = b'<html>statute text</html>'
        self.send_response(200)
        self.send_header('Content-Type', 'text/html')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


class FetcherTest(unittest.TestCase):
    def setUp(self):
        self.server = http.server.HTTPServer(('127.0.0.1', 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = 'http://127.0.0.1:%d' % self.server.server_port

    def tearDown(self):
        self.server.shutdown()

    def test_capture_resume_and_verify(self):
        with tempfile.TemporaryDirectory() as tmp:
            fetcher = Fetcher('XX', tmp, min_interval=0)
            first = fetcher.get(self.base + '/a')
            self.assertTrue(first['ok'])
            self.assertEqual(first['bytes'], 25)
            again = fetcher.get(self.base + '/a')
            self.assertEqual(len(fetcher.receipts()), 1)
            self.assertEqual(again['sha256'], first['sha256'])
            missing = fetcher.get(self.base + '/missing')
            self.assertFalse(missing['ok'])
            self.assertEqual(missing['status'], 404)
            self.assertEqual(verify_store(tmp), (1, []))
            (pathlib.Path(tmp) / first['stored_path']).write_bytes(b'tampered')
            self.assertEqual(verify_store(tmp)[1], [self.base + '/a'])


if __name__ == '__main__':
    unittest.main()
