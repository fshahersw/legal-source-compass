"""Independent audit of SQL transport bytes against normalized source envelopes.
No database or network access. Output is a private receipt; no original rows printed.
"""
import argparse,collections,hashlib,json,pathlib,re
def sha(b):return hashlib.sha256(b).hexdigest()
def canonical(v):return json.dumps(v,ensure_ascii=False,sort_keys=True,separators=(",",":"),allow_nan=False)
def main():
 p=argparse.ArgumentParser();p.add_argument("--receipt",required=True);p.add_argument("--imports",required=True);p.add_argument("--output",required=True);a=p.parse_args()
 base=pathlib.Path(a.receipt).parent;source=json.loads(pathlib.Path(a.receipt).read_bytes());imports=pathlib.Path(a.imports)
 domain=collections.Counter();rows=0;batches=0;bytes_read=0;source_sha={};payloads={}
 def walk(v):
  if v is None:domain["nulls"]+=1
  elif isinstance(v,bool):domain["booleans"]+=1
  elif isinstance(v,int):domain["integers"]+=1
  elif isinstance(v,float):raise ValueError("Unsupported floating-point selected metadata")
  elif isinstance(v,str):
   domain["strings"]+=1
   if "\x00"in v or any(0xd800<=ord(c)<=0xdfff for c in v):raise ValueError("Unsupported JSONB string domain")
  elif isinstance(v,list):
   for x in v:walk(x)
  elif isinstance(v,dict):
   for k,x in v.items():walk(k);walk(x)
  else:raise ValueError("Unsupported value")
 for d in source["datasets"]:
  file=base/d["file"];h=hashlib.sha256();identity={};out=imports/d["entity_type"]
  manifest=json.loads((out/"manifest.json").read_bytes())
  with file.open("rb")as original:
   for b in manifest["batches"]:
    q=(out/b["name"]).read_bytes();batches+=1;bytes_read+=len(q)
    assert len(q)==b["bytes"]<=750000 and sha(q)==b["sha256"]
    s=q.decode("utf-8");m=re.search(r"select (\$fda_[a-f0-9]{20}\$)",s)
    assert m
    start=m.end();end=s.index(m.group(1),start);doc=json.loads(s[start:end])
    assert len(doc["rows"])==b["records"]
    assert "(r->5)->(k.n::int-1)"in s and "'native_id',r->0"in s and "'source_fields_omitted',(doc->'omitted_field_sets')->(r->>4)::int"in s
    for r in doc["rows"]:
     line=next(original);h.update(line);e=json.loads(line)
     assert len(r)==6 and len(r[5])==len(doc["columns"])
     decoded={"schema_version":doc["schema_version"],"source_system":"openfda","entity_type":doc["entity_type"],"native_id":r[0],"data":dict(zip(doc["columns"],r[5])),"provenance":{**doc["common_provenance"],"record_sha256":r[1],"native_record_without_harmonized_annotation_sha256":r[2],"source_row_ordinal":r[3],"source_fields_omitted":doc["omitted_field_sets"][r[4]]}}
     assert decoded==e
     assert sha(canonical(e["data"]).encode())==r[1]
     assert r[0]not in identity;identity[r[0]]=r[1]
     walk(e["data"]);rows+=1
    assert int(manifest["run_id"].replace("-",""),16)>0
   assert original.read()==b""
  signature=sha("\n".join(k+":"+v for k,v in sorted(identity.items())).encode())
  assert h.hexdigest()==d["sha256"]==manifest["input_sha256"]
  assert len(identity)==d["ingest_records"]==manifest["records"]
  assert signature==d["identity_signature"]==manifest["source_identity_signature"]
  source_sha[d["entity_type"]]=h.hexdigest();payloads[d["entity_type"]]=len(identity)
 assert rows==source["private_selected_records"]
 receipt={"schema_version":"openfda-prepared-transport-independent-audit/1","rows_compared":rows,"batches_hash_verified":batches,"sql_bytes":bytes_read,"decoded_envelope_mismatches":0,"selected_payload_sha256_mismatches":0,"source_identity_mismatches":0,"unsupported_floats_or_strings":0,"integer_only_jsonb_hash_domain":True,"selected_value_counts":dict(domain),"source_sha256":source_sha,"dataset_records":payloads,"database_executed":False}
 pathlib.Path(a.output).write_text(json.dumps(receipt,indent=2)+"\n")
 print(json.dumps({k:receipt[k]for k in ["rows_compared","batches_hash_verified","decoded_envelope_mismatches","unsupported_floats_or_strings","database_executed"]}))
if __name__=="__main__":main()
