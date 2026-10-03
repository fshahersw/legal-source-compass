import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec=importlib.util.spec_from_file_location('focus_parser',Path(__file__).with_name('parse-seeger-focus-docket.py'))
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class DocketPageBoundaryTests(unittest.TestCase):
    def capture(self,final_url):
        return {'requested_at':'2026-10-02T20:00:00Z','requested_url':'https://www.courtlistener.com/docket/123/old-title/',
                'result':{'data':{'rawHtml':'<div id="docket-entry-table"></div><a href="?page=2">Next</a><a href="https://www.courtlistener.com/docket/999/unrelated/?page=2">Other</a><a href="https://www.courtlistener.com/api/rest/v4/dockets/?page=2">API</a>',
                                   'metadata':{'statusCode':200,'url':final_url}}}}
    def parse(self,body):
        with tempfile.TemporaryDirectory() as folder:
            file=Path(folder)/'capture.json'
            file.write_text(json.dumps(body),encoding='utf-8')
            return mod.parse_capture(file)
    def test_observed_same_case_canonical_slug_keeps_pagination(self):
        result=self.parse(self.capture('https://www.courtlistener.com/docket/123/new-title/'))
        self.assertEqual(result['pagination'],['https://www.courtlistener.com/docket/123/new-title/?page=2'])
        self.assertEqual(result['native_case_id'],'123')
        self.assertEqual(result['courtlistener_api_requests'],0)
    def test_cross_case_and_non_page_redirects_are_rejected(self):
        for url in ('https://www.courtlistener.com/docket/999/other/','https://www.courtlistener.com/docket/123/45/file/','http://www.courtlistener.com/docket/123/old-title/'):
            with self.assertRaises(ValueError):
                self.parse(self.capture(url))

if __name__=='__main__':unittest.main()
