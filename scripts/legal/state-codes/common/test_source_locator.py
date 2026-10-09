"""Bulk code sections must retain their precise original ZIP member locator."""
from pathlib import Path
import json, sys, tempfile, unittest
sys.path.insert(0,str(Path(__file__).parent))
import land_publisher_code_v2 as L
from test_land_publisher_code_v2 import write_packet

class SourceLocatorTests(unittest.TestCase):
 def fixture(self,root):
  manifest=write_packet(root)
  p=Path(root)/'sections.jsonl';s=json.loads(p.read_text())
  s['source_locator']={'archive_sha256':'a'*64,'member':'LAW_SECTION_TBL_1.lob','member_sha256':'d'*64,'citation_path':s['citation_path'],'native_row_id':'native1','section_version_id':'version1','display_url':'https://example.gov/section1','display_url_retrieved':False}
  p.write_text(json.dumps(s)+'\n');return manifest,s
 def test_source_locator_is_in_canonical_persisted_record(self):
  with tempfile.TemporaryDirectory() as root:
   manifest,s=self.fixture(root);_,rows=L.build_rows(root,'c'*64,manifest)
   self.assertEqual(rows[0]['data'].get('source_locator'),s['source_locator'])
   self.assertEqual(rows[0]['provenance']['record_sha256'],L.sha(rows[0]['data']))
 def test_wrong_archive_and_wrong_citation_rejected(self):
  for field,val in [('archive_sha256','b'*64),('citation_path','other-section')]:
   with tempfile.TemporaryDirectory() as root:
    manifest,s=self.fixture(root);s['source_locator'][field]=val
    (Path(root)/'sections.jsonl').write_text(json.dumps(s)+'\n')
    with self.assertRaisesRegex(ValueError,'locator'):L.build_rows(root,'c'*64,manifest)
 def test_path_traversal_and_fake_page_capture_rejected(self):
  for field,val in [('member','../private'),('display_url_retrieved',True)]:
   with tempfile.TemporaryDirectory() as root:
    manifest,s=self.fixture(root);s['source_locator'][field]=val
    (Path(root)/'sections.jsonl').write_text(json.dumps(s)+'\n')
    with self.assertRaisesRegex(ValueError,'locator'):L.build_rows(root,'c'*64,manifest)
if __name__=='__main__':unittest.main()
