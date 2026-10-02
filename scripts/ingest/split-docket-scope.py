"""Split a completed native snapshot selection into exact-source and candidates.

This is an offline provenance operation. The exact IDB association is historical
FJC administrative metadata; it is not proof of current MDL membership or role.
"""
import collections, hashlib, json, pathlib, sys

root=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else 'C:/Users/firas/.codex/corpus-cache/courtlistener/2026-09-30/normalized').resolve()
receipt=json.loads((root/'dockets.manifest.json').read_text(encoding='utf-8'))
source=pathlib.Path(receipt['output_path']).resolve()
if source.suffix!='.jsonl' or not source.is_file():raise ValueError('Completed docket JSONL is required; .part files cannot be split')
with source.open('rb') as data:
    if hashlib.file_digest(data,'sha256').hexdigest()!=receipt['output_sha256']:raise ValueError('Docket source checksum does not match its completed receipt')
fjc_index=json.loads((root/'fjc-mdl-index.json').read_text(encoding='utf-8'))
fjc_receipt=json.loads((root/'fjc-integrated-database.manifest.json').read_text(encoding='utf-8'))
names=['dockets-known-native','dockets-fjc-linked','dockets-exact-native-or-idb','dockets-unconfirmed-candidates','docket-fjc-mdl-associations']
handles={name:(root/(name+'.jsonl.part')).open('w',encoding='utf-8',newline='\n') for name in names}
ids={name:set() for name in names};counts=collections.Counter();reasons=collections.Counter();mdls=collections.Counter();total=0
try:
    with source.open(encoding='utf-8') as data:
        for line in data:
            row=json.loads(line);total+=1;native=row['native_id'];selected=set(row['provenance']['selection_reasons']);reasons.update(selected)
            known='saved_native_docket_id' in selected
            linked='native_idb_fk_with_explicit_mdl_number' in selected
            targets=['dockets-exact-native-or-idb'] if known or linked else ['dockets-unconfirmed-candidates']
            if known:targets.append('dockets-known-native')
            if linked:targets.append('dockets-fjc-linked')
            for name in targets:
                if native in ids[name]:raise ValueError(f'Duplicate native docket ID in {name}')
                ids[name].add(native);counts[name]+=1;handles[name].write(line)
            if linked:
                fjc_id=row['data']['idb_data_id'];evidence=fjc_index[fjc_id];mdls[evidence['mdl_number']]+=1
                relation_id=f'{native}:{fjc_id}'
                association={'docket_id':native,'fjc_id':fjc_id,'mdl_number':evidence['mdl_number'],'native_mdl_value':evidence['native_mdl_value'],'association_type':'native_idb_fk_historical_fjc_mdl_number','current_member_inventory_complete':False,'master_member_role':'unknown'}
                canonical=json.dumps(association,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
                provenance={**row['provenance'],'record_sha256':hashlib.sha256(canonical).hexdigest(),'source_entity_type':'dockets','source_native_id':native,'derived_from_native_fields':['dockets.idb_data_id','fjc_integrated_database.multidistrict_litigation_docket_number'],'fjc_source_url':fjc_receipt['source_url'],'fjc_source_sha256':fjc_receipt['source_sha256'],'legal_membership_inference':False}
                result={'schema_version':'courtlistener-native-fk/1','source_system':'courtlistener','entity_type':'docket-fjc-mdl-associations','native_id':relation_id,'data':association,'provenance':provenance}
                if relation_id in ids['docket-fjc-mdl-associations']:raise ValueError('Duplicate native association')
                ids['docket-fjc-mdl-associations'].add(relation_id);counts['docket-fjc-mdl-associations']+=1
                handles['docket-fjc-mdl-associations'].write(json.dumps(result,ensure_ascii=False,separators=(',',':'))+'\n')
finally:
    for handle in handles.values():handle.close()
if total!=receipt['selected_records']:raise ValueError('Selection row count mismatch')
reports=[]
for name in names:
    temp=root/(name+'.jsonl.part');dest=root/(name+'.jsonl');temp.replace(dest)
    with dest.open('rb') as data:digest=hashlib.file_digest(data,'sha256').hexdigest()
    reports.append({'type':name,'path':str(dest),'records':counts[name],'distinct_native_ids':len(ids[name]),'bytes':dest.stat().st_size,'sha256':digest,'complete_file':True,'pdf_downloads':0})
report={'schema_version':'courtlistener-docket-scope-split/1','source_records_scanned':receipt['source_records'],'selected_docket_records':total,'source_snapshot':receipt['source_as_of'],'source_sha256':receipt['source_sha256'],'source_jsonl_sha256':receipt['output_sha256'],'selection_reason_counts':dict(reasons),'native_idb_associations_by_explicit_mdl_number':dict(mdls),'files':reports,'exact_scope_definition':'Known uploaded native IDs or native IDB foreign key with explicit FJC MDL number; requires structural and privacy review before publication. It does not establish current membership or master/member role.','complete_source_snapshot_scan':True,'complete_current_member_inventory':False,'pdf_downloads':0}
(root/'docket-scope-split.manifest.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report))
