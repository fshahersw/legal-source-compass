"""Lossless selected-FDA columnar transport with exact <=750k SQL-byte cap."""
import argparse,hashlib,json,pathlib
def compact(v):return json.dumps(v,ensure_ascii=False,separators=(",",":"),allow_nan=False)
def canonical(v):return json.dumps(v,ensure_ascii=False,sort_keys=True,separators=(",",":"),allow_nan=False)
def sha(s):return hashlib.sha256(s.encode()if isinstance(s,str)else s).hexdigest()
def query_for(doc,run):
 text=compact(doc);delimiter="$fda_"+sha(text)[:20]+"$"
 if delimiter in text:raise ValueError("SQL delimiter collision")
 return ("with source as(select "+delimiter+text+delimiter+"::jsonb doc),rows as(select jsonb_build_object("
 "'schema_version',doc->'schema_version','source_system','openfda','entity_type',doc->'entity_type','native_id',r->0,"
 "'data',(select jsonb_object_agg(k.key,(r->5)->(k.n::int-1))from jsonb_array_elements_text(doc->'columns')with ordinality k(key,n)),"
 "'provenance',doc->'common_provenance'||jsonb_build_object('record_sha256',r->1,"
 "'native_record_without_harmonized_annotation_sha256',r->2,'source_row_ordinal',r->3,'source_fields_omitted',(doc->'omitted_field_sets')->(r->>4)::int))"
 "envelope from source cross join lateral jsonb_array_elements(doc->'rows')r)"
 "select corpus_ingest.ingest_entities('"+run+"'::uuid,(select jsonb_agg(envelope)from rows))result;\n")
def prepare(input_file,expected,out,run):
 out.mkdir(parents=True,exist_ok=True)
 if list(out.glob("batch-*.sql")):raise ValueError("Fresh import output required")
 template=None;rows=[];sets=[];set_index={};approx=0;input_hash=hashlib.sha256();batches=[];count=0;roundtrips=0;max_sql=0
 def flush():
  nonlocal rows,sets,set_index,approx,max_sql
  if not rows:return
  doc={**template,"omitted_field_sets":sets,"rows":rows};q=query_for(doc,run);b=q.encode()
  if len(b)>750000:raise ValueError("SQL byte cap exceeded")
  fn="batch-"+str(len(batches)).zfill(5)+".sql";(out/fn).write_bytes(b)
  batches.append({"name":fn,"records":len(rows),"bytes":len(b),"sha256":sha(b)})
  max_sql=max(max_sql,len(b));rows=[];sets=[];set_index={};approx=0
 with input_file.open("rb")as f:
  for b in f:
   input_hash.update(b)
   if not b.strip():continue
   e=json.loads(b);count+=1
   if e["schema_version"]!="openfda-selected-native-metadata/1"or e["source_system"]!="openfda"or not e["native_id"]:raise ValueError("Wrong source contract")
   if sha(canonical(e["data"]))!=e["provenance"]["record_sha256"]:raise ValueError("Selected source payload hash mismatch")
   variable=["record_sha256","native_record_without_harmonized_annotation_sha256","source_row_ordinal","source_fields_omitted"]
   common={k:v for k,v in e["provenance"].items()if k not in variable}
   t={"schema_version":e["schema_version"],"entity_type":e["entity_type"],"columns":list(e["data"]),"common_provenance":common}
   if template is None:template=t
   if t!=template:flush();template=t
   omitted=e["provenance"]["source_fields_omitted"];key=compact(omitted)
   values=[e["data"][k]for k in template["columns"]]
   raw=[e["native_id"],e["provenance"]["record_sha256"],e["provenance"]["native_record_without_harmonized_annotation_sha256"],e["provenance"]["source_row_ordinal"],0,values]
   size=len(compact(raw).encode())+len(key.encode())+2
   if rows and(approx+size>735000 or len(rows)>=10000):flush()
   if key not in set_index:set_index[key]=len(sets);sets.append(omitted)
   raw[4]=set_index[key]
   decoded={**e,"data":dict(zip(template["columns"],raw[5])),"provenance":{**common,"record_sha256":raw[1],"native_record_without_harmonized_annotation_sha256":raw[2],"source_row_ordinal":raw[3],"source_fields_omitted":sets[raw[4]]}}
   if decoded!=e:raise ValueError("Source envelope lossless round trip failed")
   roundtrips+=1;rows.append(raw);approx+=size
 flush()
 actual_hash=input_hash.hexdigest()
 if actual_hash!=expected["sha256"]or count!=expected["ingest_records"]:raise ValueError("Normalized input receipt mismatch")
 manifest={"schema_version":"openfda-selected-columnar-batches/1","run_id":run,"entity_type":expected["entity_type"],
 "input_file":input_file.name,"input_sha256":actual_hash,"records":count,"source_identity_signature":expected["identity_signature"],
 "round_trips_verified":roundtrips,"sql_bytes":sum(x["bytes"]for x in batches),"max_sql_bytes":max_sql,"batches":batches,"database_executed":False}
 (out/"manifest.json").write_text(json.dumps(manifest,indent=2)+"\n")
 return manifest
def main():
 a=argparse.ArgumentParser();a.add_argument("--receipt",required=True);a.add_argument("--output",required=True);a.add_argument("--run",required=True);p=a.parse_args()
 import re
 if not re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",p.run):raise ValueError("Valid run UUID required")
 receipt_file=pathlib.Path(p.receipt);receipt=json.loads(receipt_file.read_text())
 result=[prepare(receipt_file.parent/d["file"],d,pathlib.Path(p.output)/d["entity_type"],p.run)for d in receipt["datasets"]]
 all_receipt={"schema_version":"openfda-selected-import-plan/1","run_id":p.run,"records":sum(x["records"]for x in result),
 "sql_bytes":sum(x["sql_bytes"]for x in result),"batches":sum(len(x["batches"])for x in result),"datasets":result,"database_executed":False}
 (pathlib.Path(p.output)/"manifest.json").write_text(json.dumps(all_receipt,indent=2)+"\n")
 print(json.dumps({k:all_receipt[k]for k in["records","sql_bytes","batches","database_executed"]}))
if __name__=="__main__":main()
