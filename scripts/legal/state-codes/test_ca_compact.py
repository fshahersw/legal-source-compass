"""Verified export packaging must not change statute text or evidence identity."""
from pathlib import Path
import hashlib, importlib.util, json, tempfile, unittest, zipfile
P=Path(__file__).with_name('ca-compact.py')
S=importlib.util.spec_from_file_location('ca_compact',P);C=importlib.util.module_from_spec(S);S.loader.exec_module(C)
def j(p,x):p.write_text(json.dumps(x)+'\n',encoding='utf-8')
def h(b):return hashlib.sha256(b).hexdigest()
class CompactTests(unittest.TestCase):
 def fixture(self,root):
  (root/'landing').mkdir();(root/'parsed-v2').mkdir();(root/'raw').mkdir();(root/'receipts').mkdir()
  xml=b'<section><p>Text one.</p></section>'
  archive=root/'raw/pubinfo_2025.zip'
  with zipfile.ZipFile(archive,'w') as z:z.writestr('LAW_SECTION_TBL_1.lob',xml)
  b=archive.read_bytes(); receipt=dict(raw_file='raw/pubinfo_2025.zip',sha256=h(b),bytes=len(b),source_url='https://downloads.leginfo.legislature.ca.gov/pubinfo_2025.zip',retrieved_at='2026-10-08T00:00:00Z',http_status=200)
  j(root/'receipts/pubinfo_2025.zip.json',receipt)
  j(root/'receipts/pubinfo_load.zip.json',{'source_url':'helper archive without legal source metadata'})
  j(root/'parsed-v2/codes.json',{'CIV':'Civil Code'})
  row=dict(citation_path='CIV:1.',law_code='CIV',section_num='1.',id='CIV1',law_section_version_id='v1',lob_member='LAW_SECTION_TBL_1.lob',lob_sha256=h(xml),text='Text one.',source_url='https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1.')
  j(root/'parsed-v2/sections.jsonl',row)
  sec=dict(citation_path='CIV:1.',citation='CIV § 1.',text='Text one.',unit_key='old',heading='Heading',hierarchy=[{'level':'section','number':'1.','heading':'Heading'}],history=None,status_note=None,span={'unit':'unicode_code_points','start':0,'end':9},currency={'basis':'none','statement':'bad old metadata','through_date':None,'edition':None})
  j(root/'landing/sections.jsonl',sec)
  j(root/'landing/manifest.json',{'jurisdiction':'CA','source_system':'ca-leginfo-pubinfo','parser':{'name':'california-pubinfo-xml','version':'2'},'currency':{},'review':{},'retrieval':{'methods':[]},'structure':{'levels':['section'],'unit':'old'}})
  return receipt
 def test_compaction_preserves_exact_text_and_original_member(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);r=self.fixture(root);out=root/'compact';result=C.compact(root,'parsed-v2',out)
   sec=json.loads((out/'sections.jsonl').read_text());units=[json.loads(x) for x in (out/'units.jsonl').open()]
   self.assertEqual(result['sections'],1);self.assertEqual(result['objects'],2)
   self.assertEqual(sec['text'],'Text one.');self.assertEqual(sec['source_locator']['archive_sha256'],r['sha256'])
   self.assertEqual(sec['source_locator']['member'],'LAW_SECTION_TBL_1.lob')
   self.assertEqual(sec['currency']['basis'],'publisher_metadata');self.assertIsNone(sec['currency']['through_date'])
   self.assertEqual(units[0]['original_sha256'],r['sha256'])
 def test_rejects_corrupt_archive(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);self.fixture(root);a=root/'raw/pubinfo_2025.zip';a.write_bytes(a.read_bytes()+b'changed')
   with self.assertRaisesRegex(ValueError,'archive'):C.compact(root,'parsed-v2',root/'out')
 def test_rejects_reassigned_text_or_id(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);self.fixture(root);p=root/'landing/sections.jsonl';x=json.loads(p.read_text());x['text']='Wrong law';j(p,x)
   with self.assertRaisesRegex(ValueError,'text'):C.compact(root,'parsed-v2',root/'out')
 def test_never_overwrites_packet(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);self.fixture(root);out=root/'out';out.mkdir()
   with self.assertRaises(FileExistsError):C.compact(root,'parsed-v2',out)
if __name__=='__main__':unittest.main()
