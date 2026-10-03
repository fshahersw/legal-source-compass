"""Exact, same-provider product-code references. No cross-provider graph fabrication."""
import argparse,hashlib,json,pathlib
def sha(b):return hashlib.sha256(b).hexdigest()
def quote(s):return "'"+s.replace("'","''")+"'"
def main():
 p=argparse.ArgumentParser();p.add_argument("--receipt",required=True);p.add_argument("--run",required=True);p.add_argument("--output",required=True);a=p.parse_args()
 receipt=pathlib.Path(a.receipt);m=json.loads(receipt.read_bytes());base=receipt.parent
 records={}
 for typ in ["device-recalls","device-classification"]:
  d=next(x for x in m["datasets"]if x["entity_type"]==typ);file=base/d["file"]
  assert sha(file.read_bytes())==d["sha256"]
  records[typ]=[json.loads(x)for x in file.read_text(encoding="utf-8").splitlines()if x]
 rec=records["device-recalls"];classes={x["native_id"]for x in records["device-classification"]}
 edges=[x for x in rec if x["data"]["product_code"]not in(None,"")]
 matched=sum(x["data"]["product_code"]in classes for x in edges)
 expected=[(x["entity_type"],x["ingest_records"],x["identity_signature"])for x in m["datasets"]if x["entity_type"]in records]
 run=quote(a.run)+"::uuid"
 cte="""with source as materialized(
 select distinct on(o.entity_type,o.native_id)o.entity_type,o.native_id,o.payload_sha256,v.data,e.review_status
 from corpus_ingest.observations o join corpus_ingest.entity_versions v using(source_system,entity_type,native_id,payload_sha256)
 left join corpus_ingest.entities e using(source_system,entity_type,native_id)
 where o.source_system='openfda'and o.entity_type in('device-recalls','device-classification')and o.run_id="""+run+""" and v.schema_version='openfda-selected-native-metadata/1'
 order by o.entity_type,o.native_id,o.retrieved_at desc,o.source_url collate "C",o.payload_sha256 collate "C"
 ),proof as(
 select entity_type,count(*)records,encode(sha256(convert_to(string_agg(native_id||':'||payload_sha256,E'\\n'order by native_id collate "C"),'UTF8')),'hex')signature,
 count(*)filter(where review_status is null or review_status='quarantined' or corpus_ingest.canonical_integer_jsonb_sha256_v1(data)is distinct from payload_sha256)invalid_sources
 from source group by entity_type
 ),expected_sources(entity_type,records,signature)as(values """+",".join("("+quote(t)+","+str(n)+","+quote(h)+")"for t,n,h in expected)+"""),source_guard as(
 select count(*)=2 and bool_and(coalesce(p.records=e.records and p.signature=e.signature and p.invalid_sources=0,false))valid from expected_sources e left join proof p using(entity_type)
 ),expected as materialized(
 select 'openfda'::text source_system,'device-recalls'::text from_type,r.native_id from_id,'product_code'::text field,'device-classification'::text to_type,
 r.data->>'product_code'to_id,r.payload_sha256 evidence_sha256,false inferred,c.native_id is not null target_present,"""+run+""" run_id
 from source r left join source c on c.entity_type='device-classification'and c.native_id=r.data->>'product_code'
 where r.entity_type='device-recalls'and nullif(r.data->>'product_code','')is not null
 )"""
 q=cte+",written as(insert into corpus_ingest.relationships(source_system,from_type,from_id,field,to_type,to_id,evidence_sha256,inferred,target_present,run_id)select * from expected where coalesce((select valid from source_guard),false)on conflict(source_system,from_type,from_id,field,to_type,to_id,evidence_sha256)do update set inferred=excluded.inferred,target_present=excluded.target_present,run_id=excluded.run_id returning 1)select jsonb_build_object('guard_passed',(select valid from source_guard),'expected_references',(select count(*)from expected),'written',(select count(*)from written),'source_checks',(select jsonb_agg(p)from proof p))receipt;\n"
 verify=cte+""",actual as(select r.* from corpus_ingest.relationships r where r.source_system='openfda'and r.from_type='device-recalls'and r.field='product_code'and r.run_id="""+run+"""),differences as(select count(*)filter(where e.from_id is not null and a.from_id is null)missing,count(*)filter(where e.from_id is null)unexpected,count(*)filter(where e.from_id is not null and a.from_id is not null and to_jsonb(e)is distinct from to_jsonb(a))mismatched from expected e full join actual a using(source_system,from_type,from_id,field,to_type,to_id,evidence_sha256))select jsonb_build_object('source_guard',(select valid from source_guard),'expected_references',(select count(*)from expected),'actual_references',(select count(*)from actual),'resolved_exact_codes',(select count(*)from actual where target_present),'unresolved_exact_codes',(select count(*)from actual where not target_present),'expected_original_references',"""+str(len(edges))+",'expected_original_resolved',"+str(matched)+",'differences',(select to_jsonb(d)from differences d))receipt;\n"
 out=pathlib.Path(a.output);out.mkdir(parents=True,exist_ok=True)
 for name,sql in [("native-product-code-graph.sql",q),("verify-native-product-code-graph.sql",verify)]:
  fn=out/name
  if fn.exists():assert fn.read_text()==sql
  else:fn.write_text(sql,encoding="utf-8")
 result={"schema_version":"openfda-native-code-reference-plan/1","run_id":a.run,"expected_references":len(edges),"resolved_exact_codes":matched,"unresolved_exact_codes":len(edges)-matched,"cross_provider_edges":0,"fields_inferred":0,"database_executed":False,"qualification":"Exact FDA source product-code references to the separate October 2 category snapshot. Codes may change; this is not historical applicability, causation, defect, liability or litigation membership. Missing targets remain unresolved. Title21 eCFR locators are public reference links only, never same-provider FDA-native entities."}
 (out/"native-graph-receipt.json").write_text(json.dumps(result,indent=2)+"\n")
 print(json.dumps(result))
if __name__=="__main__":main()
