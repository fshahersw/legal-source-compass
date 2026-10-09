#!/usr/bin/env python3
"""Repackage a verified CA export without changing its legal text or identities.

One immutable code-text derivative per code replaces hundreds of thousands of
individual tiny upload objects. Every section retains a direct ZIP-member
locator, member hash, official row/version ID and exact Unicode span. The
original publisher ZIP is retained once; no source is labelled as current law.
"""
from __future__ import annotations
import argparse
from collections import Counter
from contextlib import ExitStack
import hashlib
from itertools import zip_longest
import json
from pathlib import Path
import re
import sys
import zipfile
sys.path.insert(0,str(Path(__file__).parent))
from common.publisher_xml import xml_plain_text

def digest(data):return hashlib.sha256(data).hexdigest()
def load(p):return json.loads(p.read_text(encoding='utf-8'))
def dump(p,x):
 with p.open('x',encoding='utf-8',newline='\n') as f:json.dump(x,f,ensure_ascii=False,indent=2);f.write('\n')
def line(f,x):f.write(json.dumps(x,ensure_ascii=False,separators=(',',':'))+'\n')
def hash_file(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()

def compact(root:Path, parsed_name:str, output:Path):
 root=root.resolve();output=output.resolve()
 if output.exists():raise FileExistsError('Use a fresh compact packet directory')
 receipts=sorted(p for p in (root/'receipts').glob('pubinfo_*.zip.json') if re.fullmatch(r'pubinfo_[0-9]{4}\.zip\.json',p.name))
 if not receipts:raise ValueError('Missing archive receipt')
 receipt=load(receipts[-1]);archive=(root/receipt['raw_file']).resolve()
 if not archive.is_relative_to(root) or not archive.is_file():raise ValueError('Untrusted archive path')
 if receipt.get('http_status')!=200 or archive.stat().st_size!=receipt['bytes'] or hash_file(archive)!=receipt['sha256']:raise ValueError('Source archive fingerprint mismatch')
 parsed=(root/parsed_name).resolve()
 if not parsed.is_relative_to(root):raise ValueError('Untrusted parsed path')
 codes=load(parsed/'codes.json');manifest=load(root/'landing/manifest.json')
 if manifest.get('jurisdiction')!='CA' or manifest.get('source_system')!='ca-leginfo-pubinfo':raise ValueError('Wrong state/source packet')
 manifest['parser']={'name':'california-pubinfo-xml','version':'3'}
 manifest['structure']['unit']='One code-specific text derivative of the retained official pubinfo ZIP; per-section source ZIP member and Unicode span retained'
 manifest['currency']={'basis':'publisher_metadata','location':'Official export filename and recorded capture only; legislative-through date not established'}
 manifest['review']={'reviewed_by':'source-byte and structural checks; current-law effect not certified','reviewed_at':receipt['retrieved_at'][:10]}
 manifest['retrieval']['methods']=['publisher_bulk_download']
 currency={'basis':'publisher_metadata','statement':'Publisher export '+archive.name+'; compilation-through date not established.','through_date':None,'edition':archive.name}
 source={'source_url':receipt['source_url'],'retrieved_at':receipt['retrieved_at'],'http_status':200,'retrieval_method':'publisher_bulk_download','proxy':None}
 output.mkdir(parents=True);(output/'code-text').mkdir()
 objects=[{'sha256':receipt['sha256'],'bytes':receipt['bytes'],'kind':'publisher_original','path':str(archive),'sources':[source]}]
 units=[];counts=Counter();offsets=Counter();seen=set();n=0;members_seen={}
 with ExitStack() as stack:
  z=stack.enter_context(zipfile.ZipFile(archive));actual={i.filename.upper():i.filename for i in z.infolist()}
  if len(actual)!=len(z.infolist()):raise ValueError('Duplicate archive member identity')
  a=stack.enter_context((root/'landing/sections.jsonl').open(encoding='utf-8'))
  b=stack.enter_context((parsed/'sections.jsonl').open(encoding='utf-8'))
  target=stack.enter_context((output/'sections.jsonl').open('x',encoding='utf-8',newline='\n'))
  handles={}
  for one,two in zip_longest(a,b):
   if one is None or two is None:raise ValueError('Parsed and staged inventories differ')
   s=json.loads(one);p=json.loads(two);code=p.get('law_code','')
   if code not in codes or not re.fullmatch(r'[A-Z]{2,5}',code):raise ValueError('Code identity missing from publisher code table')
   if s['citation_path']!=p['citation_path'] or s['citation_path'] in seen:raise ValueError('Mismatched/duplicate citation identity')
   seen.add(s['citation_path'])
   member=actual.get(p['lob_member'].upper())
   if not member:raise ValueError('Source member missing')
   raw=z.read(member)
   if digest(raw)!=p['lob_sha256']:raise ValueError('Source member hash differs')
   body=xml_plain_text(raw)
   if body!=s['text'] or body!=p['text'] or not body.strip():raise ValueError('Source text differs from parsed or staged body')
   if code not in handles:handles[code]=stack.enter_context((output/'code-text'/f'{code}.txt').open('xb'))
   if counts[code]:handles[code].write(b'\n\n');offsets[code]+=2
   start=offsets[code];handles[code].write(body.encode('utf-8'));offsets[code]+=len(body);counts[code]+=1
   locator={'archive_sha256':receipt['sha256'],'member':member,'member_sha256':p['lob_sha256'],'native_row_id':p['id'],'section_version_id':p['law_section_version_id'],'citation_path':s['citation_path'],'display_url':p['source_url'],'display_url_retrieved':False}
   line(target,{**s,'unit_key':'code-'+code,'span':{'unit':'unicode_code_points','start':start,'end':offsets[code]},'currency':currency,'source_locator':locator})
   n+=1
 for code in sorted(counts):
  path=output/'code-text'/f'{code}.txt';sha=hash_file(path)
  objects.append({'sha256':sha,'bytes':path.stat().st_size,'kind':'unit_text_derivative','path':str(path),'code_points':offsets[code],'sources':[source]})
  units.append({'unit_key':'code-'+code,'unit_kind':'publisher_code_export','heading':codes[code],'original_sha256':receipt['sha256'],'publisher_member':None,'raw_member_sha256':None,'text_sha256':sha,'text_code_points':offsets[code],'sections_expected':counts[code],'currency':currency,**{k:v for k,v in source.items() if k!='http_status'}})
 with (output/'units.jsonl').open('x',encoding='utf-8',newline='\n') as f:
  for u in units:line(f,u)
 with (output/'objects.jsonl').open('x',encoding='utf-8',newline='\n') as f:
  for o in objects:line(f,o)
 dump(output/'manifest.json',manifest)
 dump(output/'toc-proof.json',{'marker':'Exact original parsed/staged citation inventory and ZIP-member re-rendered text; code-specific unit counts','pages':[{'url':receipt['source_url'],'markers':n,'sections':n}],'unfetched_child_pages':[]})
 dump(output/'gaps.json',[])
 report={'objects':len(objects),'units':len(units),'sections':n,'per_code':dict(sorted(counts.items())),'archive_sha256':receipt['sha256'],'sections_sha256':hash_file(output/'sections.jsonl'),'publication_allowed':False,'calculation_activation_allowed':False,'currency_basis':'publisher_metadata','through_date':None}
 dump(output/'compact-report.json',report)
 return report
if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--root',type=Path,required=True);ap.add_argument('--parsed',default='parsed-v2');ap.add_argument('--output',type=Path,required=True);args=ap.parse_args();print(json.dumps(compact(args.root,args.parsed,args.output),indent=2))
