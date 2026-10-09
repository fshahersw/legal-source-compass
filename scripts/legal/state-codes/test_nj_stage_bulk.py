"""Staging retains source evidence and never promotes unreviewed law."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

ROOT=Path(__file__).parent

def module(name,file):
 spec=importlib.util.spec_from_file_location(name,ROOT/file)
 m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

P=module('nj_source_parser','nj-parse-bulk.py')
S=module('nj_stager','nj-stage-bulk.py')

def jsonwrite(path,value):path.write_text(json.dumps(value)+'\n',encoding='utf-8')

def fixture(root,headings=None):
 base=root/'capture'; parsed=root/'parsed'; base.mkdir()
 headings=headings or [('1:1-1 One','Body one.'),('1:1-2 Two','Body two.')]
 text='STATUTES UPDATED THROUGH c.30\n\nTITLE 1 ACTS\n'
 rtf='\\pard \\s2 TITLE 1 ACTS\\par\n'
 for heading,body in headings:
  text+=heading+'\n'+body+'\n'; rtf+='\\pard \\s3 '+heading+'\\par\n'
 for name,txt,rich in [('STATUTES',text,rtf),('LCTOC','\n\nTOC UPDATED THROUGH c.90\n','TOC'),('NJCONST','Constitution source\n','Constitution')]:
  archive=base/(name+'-TEXT.zip');entries=[]
  with zipfile.ZipFile(archive,'w') as z:
   for ext,body in [('TXT',txt),('RTF',rich)]:
    data=body.encode('cp1252');member=name+'.'+ext;z.writestr(member,data)
    entries.append(dict(name=member,bytes=len(data),sha256=P.sha(data)))
  raw=archive.read_bytes()
  jsonwrite(base/(archive.name+'.receipt.json'),dict(raw_file=archive.name,http_status=200,bytes=len(raw),sha256=P.sha(raw),source_url='https://pub.njleg.gov/statutes/'+archive.name,finished_at='2026-10-08T12:00:00Z'))
  jsonwrite(base/(archive.name+'.receipt.json.inventory.json'),dict(archive_sha256=P.sha(raw),entries=entries))
 P.run(base,parsed)
 return base,parsed

class StageTest(unittest.TestCase):
 def test_exact_spans_and_holds_survive(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);base,parsed=fixture(root);out=root/'staged'
   result=S.stage(base,parsed,out)
   self.assertEqual(result['candidate_sections'],2)
   self.assertFalse(result['publication_allowed'])
   self.assertFalse(result['calculation_activation_allowed'])
   self.assertIn('c.90',result['toc_version_marker'])
   self.assertIn('c.30',result['statutes_version_marker'])
   rows=[json.loads(s) for s in (out/'sections.jsonl').read_text().splitlines()]
   self.assertEqual(rows[0]['citation_path'],'1:1-1')
   self.assertIn('Body one.',rows[0]['text'])
   self.assertTrue((out/'release-holds.json').exists())

 def test_cross_title_occurrence_is_quarantined_not_mapped(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);base,parsed=fixture(root,[('1:1-1 One','Body.'),('2A:14-2 Misplaced','Body.')]);out=root/'staged'
   result=S.stage(base,parsed,out)
   self.assertEqual(result['candidate_sections'],1)
   self.assertEqual(result['quarantined_sections'],1)
   q=json.loads((out/'quarantine.jsonl').read_text())
   self.assertEqual(q['citation'],'2A:14-2')
   self.assertIn('Body.',q['text'])
   proof=json.loads((out/'toc-proof.json').read_text())
   self.assertNotEqual(proof['pages'][0]['markers'],proof['pages'][0]['sections'])

 def test_modified_span_with_rehashed_index_is_still_rejected(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);base,parsed=fixture(root)
   index=parsed/'sections.jsonl';rows=[json.loads(s) for s in index.read_text().splitlines()]
   rows[0]['start']+=1;index.write_text(''.join(json.dumps(r)+'\n' for r in rows))
   report=json.loads((parsed/'parse-report.json').read_text());report['sections_sha256']=P.sha(index.read_bytes());jsonwrite(parsed/'parse-report.json',report)
   with self.assertRaisesRegex(ValueError,'span|source|heading'):
    S.stage(base,parsed,root/'staged')

 def test_repeated_citations_are_distinct_occurrences_and_held(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);base,parsed=fixture(root,[('1:1-1 One','Body A.'),('1:1-1 Second','Body B.')]);out=root/'staged'
   result=S.stage(base,parsed,out)
   rows=[json.loads(s) for s in (out/'sections.jsonl').read_text().splitlines()]
   self.assertEqual([r['citation_path'] for r in rows],['1:1-1','1:1-1~2'])
   self.assertEqual(result['repeated_citation_groups'],1)
   self.assertFalse(result['publication_allowed'])

 def test_output_is_never_overwritten(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);base,parsed=fixture(root);out=root/'staged';out.mkdir();(out/'saved').write_text('keep')
   with self.assertRaises(FileExistsError):S.stage(base,parsed,out)
   self.assertEqual((out/'saved').read_text(),'keep')

if __name__=='__main__':unittest.main()
