"""Select source-native FDA metadata from SHA-verified ZIP originals. No DB/network.
Raw ZIP bytes remain private. Harmonized annotations and contact/address fields
are deliberately excluded from selected-record payloads, not erased from originals.
"""
import argparse,collections,concurrent.futures,hashlib,json,pathlib,re,zipfile
import ijson
SCHEMA="openfda-selected-native-metadata/1"
FIELDS={
 "device-enforcement":["recall_number","event_id","product_type","classification","status","recall_initiation_date","report_date","center_classification_date","termination_date","voluntary_mandated","initial_firm_notification","product_quantity","product_description","reason_for_recall","state","country"],
 "drug-enforcement":["recall_number","event_id","product_type","classification","status","recall_initiation_date","report_date","center_classification_date","termination_date","voluntary_mandated","initial_firm_notification","product_quantity","product_description","reason_for_recall","state","country"],
 "device-classification":["product_code","device_name","device_class","medical_specialty","medical_specialty_description","review_panel","regulation_number","implant_flag","life_sustain_support_flag","gmp_exempt_flag","submission_type_id","third_party_flag","review_code","unclassified_reason","summary_malfunction_reporting","definition"],
 "device-recalls":["cfres_id","product_res_number","res_event_number","product_code","recall_status","event_date_initiated","event_date_created","event_date_posted","event_date_terminated","root_cause_description","product_quantity","product_description","reason_for_recall","k_numbers","pma_numbers"],
}
IDENTITY={"device-enforcement":"recall_number","drug-enforcement":"recall_number","device-classification":"product_code","device-recalls":"cfres_id"}
SOURCE_FIELDS={
 "device-enforcement":"https://open.fda.gov/fields/deviceenforcement.yaml",
 "drug-enforcement":"https://open.fda.gov/fields/drugenforcement.yaml",
 "device-classification":"https://open.fda.gov/fields/deviceclass.yaml",
 "device-recalls":"https://open.fda.gov/fields/devicerecall.yaml",
}
PUBLIC={
 "device-enforcement":["recall_number","event_id","product_type","classification","status","recall_initiation_date","report_date","center_classification_date","termination_date","voluntary_mandated"],
 "drug-enforcement":["recall_number","event_id","product_type","classification","status","recall_initiation_date","report_date","center_classification_date","termination_date","voluntary_mandated"],
 "device-classification":["product_code","device_name","device_class","medical_specialty","medical_specialty_description","review_panel","regulation_number","implant_flag","life_sustain_support_flag","gmp_exempt_flag","submission_type_id","third_party_flag","review_code","unclassified_reason","summary_malfunction_reporting"],
 "device-recalls":["cfres_id","product_res_number","res_event_number","product_code","recall_status","event_date_initiated","event_date_created","event_date_posted","event_date_terminated","root_cause_description"],
}
QUALIFICATION="Dated FDA research metadata. Enforcement status is not a current recall-lifecycle or public-alert finding. Recall hazard class I/II/III is separate from device regulatory class 1/2/3. FDA flags and source-reported causes are metadata, not independent findings of legal applicability, causation, defect, liability, medical advice or litigation membership. No PDF bytes, adverse-event patient datasets or party-name joins."
def compact(v):return json.dumps(v,ensure_ascii=False,sort_keys=True,separators=(",",":"),allow_nan=False)
def digest(v):return hashlib.sha256(compact(v).encode()).hexdigest()
def file_hash(fn):
 h=hashlib.sha256()
 with fn.open("rb")as f:
  for b in iter(lambda:f.read(1024*1024),b""):h.update(b)
 return h.hexdigest()
def select_native(raw,kind):
 if not isinstance(raw,dict):raise ValueError("Non-object FDA result")
 key=IDENTITY[kind];value=raw.get(key);eligible=True
 if kind=="device-recalls" and value is None:
  key="product_res_number";value=raw.get(key);eligible=False
 if kind in ("device-enforcement","drug-enforcement") and value in (None,"", "N/A"):
  value=None;eligible=False
 unresolved=value is None and kind in ("device-enforcement","drug-enforcement")
 if not unresolved and (not isinstance(value,str)or not value or any(ord(c)<32 for c in value)):raise ValueError("Missing/invalid native identity: "+kind+"/"+key+"/"+repr(value))
 if key=="cfres_id" and not re.fullmatch(r"[0-9]+",value):raise ValueError("Unexpected documented cfRes identifier")
 selected={k:raw.get(k)for k in FIELDS[kind]}
 for k,v in selected.items():
  if v is not None and not isinstance(v,(str,list)):raise ValueError("Unexpected selected field type: "+k)
  if isinstance(v,list) and (k not in ("k_numbers","pma_numbers")or any(not isinstance(x,str)for x in v)):raise ValueError("Unexpected native array")
  if any("\x00"in x or any(0xd800<=ord(c)<=0xdfff for c in x)for x in (v if isinstance(v,list)else[v]if isinstance(v,str)else[])):raise ValueError("Unsupported JSONB string: "+k)
 selected["native_fields_present"]=[k for k in FIELDS[kind]if k in raw]
 selected["native_identity_field"]=key
 selected["public_eligible"]=eligible
 return value,selected
def worker(base,output,dataset):
 base=pathlib.Path(base);output=pathlib.Path(output)
 kind=dataset["category"]+"-"+("recalls"if dataset["endpoint"]=="recall"else dataset["endpoint"])
 selected_path=output/(kind+".jsonl");out_hash=hashlib.sha256();seen={};rows=0;held=0;unresolved=0;omitted=collections.Counter()
 by_facet=collections.defaultdict(collections.Counter);max_record=0;schema_refs=[];source_files=[]
 with selected_path.open("wb")as out,(output/(kind+"-unresolved-source-rows.jsonl")).open("wb")as unresolved_out:
  for part in dataset["partitions"]:
   fn=base/part["file"]
   if fn.stat().st_size!=part["bytes"]or file_hash(fn)!=part["source_sha256"]:raise ValueError("Original ZIP checksum mismatch")
   with zipfile.ZipFile(fn)as z:
    members=[n for n in z.namelist()if n.endswith(".json")]
    if len(members)!=1:raise ValueError("Unexpected ZIP JSON inventory")
    member=members[0];partition_rows=0
    with z.open(member)as f:
     for ordinal,raw in enumerate(ijson.items(f,"results.item"),1):
      native,data=select_native(raw,kind);row_sha=digest(data)
      if native is not None and native in seen:
       raise ValueError("Duplicate/colliding native identity: "+kind+"/"+native)
      if native is not None:seen[native]=row_sha
      rows+=1;partition_rows+=1;held+=not data["public_eligible"]
      excluded=sorted(set(raw)-set(FIELDS[kind]));omitted.update(excluded)
      # Full native top-level values are hashed, including omitted contact fields;
      # openFDA's repeated harmonization arrays are outside this native-row digest.
      raw_native_sha=digest({k:v for k,v in raw.items()if k!="openfda"})
      provenance={"source_url":part["source_url"],"source_sha256":part["source_sha256"],"retrieved_at":part["retrieved_at"],
       "source_as_of":dataset["export_date"],"source_date_kind":"publisher_export_date","http_status":part["http_status"],
       "source_zip_member":member,"source_row_ordinal":ordinal,"record_sha256":row_sha,
       "native_record_without_harmonized_annotation_sha256":raw_native_sha,
       "source_fields_omitted":excluded,"selection_schema":SCHEMA,"field_reference_url":SOURCE_FIELDS[kind],
       "hash_kind":"sorted-key-compact-utf8-json-of-selected-metadata","derivation":"whitelisted-native-fields-with-explicit-presence-and-identity-metadata"}
      envelope={"schema_version":SCHEMA,"source_system":"openfda","entity_type":kind,"native_id":native,"data":data,"provenance":provenance}
      b=(compact(envelope)+"\n").encode()
      if native is None:unresolved+=1;unresolved_out.write(b)
      else:out.write(b);out_hash.update(b)
      max_record=max(max_record,len(b))
      for k in PUBLIC[kind]:
       if k in ("device_class","classification","status","recall_status","medical_specialty","implant_flag","product_type"):
        if data[k] is not None:by_facet[k][data[k]]+=1
    if partition_rows!=part["expected_records"]:raise ValueError("Partition count mismatch")
    source_files.append({**part,"member":member,"records_read":partition_rows,"member_uncompressed_bytes":z.getinfo(member).file_size})
 if rows!=dataset["expected_records"]:raise ValueError("Publisher count mismatch")
 identity_sig=hashlib.sha256("\n".join(k+":"+v for k,v in sorted(seen.items())).encode()).hexdigest()
 return {"entity_type":kind,"schema_version":SCHEMA,"file":selected_path.name,"sha256":out_hash.hexdigest(),"records":rows,"ingest_records":rows-unresolved,"unresolved_source_rows":unresolved,"unique_native_ids":len(seen),
 "identity_signature":identity_sig,"public_eligible_records":rows-held,"held_records":held,"held_reason":"Missing documented native identity; originals and selected source references retained, no ID invented"if held else None,
 "selected_native_fields":FIELDS[kind],"public_native_fields":PUBLIC[kind],"omitted_field_occurrences":dict(omitted),
 "max_envelope_bytes":max_record,"export_date":dataset["export_date"],"sources":source_files,
 "facets":{k:dict(v)for k,v in by_facet.items()}}
def main():
 ap=argparse.ArgumentParser();ap.add_argument("--manifest",required=True);ap.add_argument("--output",required=True);a=ap.parse_args()
 manifest_file=pathlib.Path(a.manifest);m=json.loads(manifest_file.read_text());output=pathlib.Path(a.output);output.mkdir(parents=True,exist_ok=True)
 if any(output.glob("*.jsonl")):raise ValueError("Fresh normalization directory required")
 with concurrent.futures.ProcessPoolExecutor(max_workers=4)as ex:
  results=list(ex.map(worker,[str(manifest_file.parent)]*len(m["datasets"]),[str(output)]*len(m["datasets"]),m["datasets"]))
 refs=[]
 for name in ["deviceenforcement","deviceclass","devicerecall","drugenforcement"]:
  f=manifest_file.parent/(name+"-fields-original.yaml")
  refs.append({"source_url":"https://open.fda.gov/fields/"+name+".yaml","sha256":file_hash(f),"bytes":f.stat().st_size})
 receipt={"schema_version":"openfda-selected-metadata-receipt/1","selection_schema":SCHEMA,"metadata_only":True,"pdf_downloads":0,
 "acquisition_manifest_sha256":file_hash(manifest_file),"original_records":sum(x["records"]for x in results),
 "private_selected_records":sum(x["ingest_records"]for x in results),"public_eligible_records":sum(x["public_eligible_records"]for x in results),
 "unresolved_source_rows":sum(x["unresolved_source_rows"]for x in results),
 "held_records":sum(x["held_records"]for x in results),"originals_retained":True,"harmonized_annotations_imported":False,
 "datasets":results,"field_reference_originals":refs,"qualification":QUALIFICATION,"database_executed":False}
 (output/"normalized-receipt.json").write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+"\n")
 print(json.dumps({k:receipt[k]for k in ["original_records","private_selected_records","public_eligible_records","held_records","database_executed"]}))
if __name__=="__main__":main()
