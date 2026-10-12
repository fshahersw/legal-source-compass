"""Write a read-only, whole-payload cloud comparison for the reviewed GA packet."""
import argparse
import hashlib
import json
from pathlib import Path
import uuid

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('packet',type=Path);a=p.parse_args();packet=a.packet
    report=json.loads((packet/'independent-release-verification.json').read_text(encoding='utf-8'))
    digest=report['manifest_sha256']
    if len(digest)!=64 or any(c not in '0123456789abcdef' for c in digest):raise ValueError('Invalid manifest hash')
    run=str(uuid.uuid5(uuid.UUID('5b6f1c58-2a56-4e6a-9f7a-1c0de5a7c0de'),'GA:'+digest))
    query="""-- Read-only full payload comparison; compare ledger to independent-release-verification.json.
with source as materialized (
 select *,corpus_ingest.canonical_integer_jsonb_sha256_v1(data) actual_payload_sha
 from corpus_ingest.entities where source_system='ga-georgiacommons-2025'
), sections as materialized (select * from source where entity_type='code-section'),
ledger as (
 select encode(sha256(convert_to(string_agg(entity_type||E'\\t'||native_id||E'\\t'||actual_payload_sha||E'\\n',''
  order by entity_type collate "C",native_id collate "C"),'UTF8')),'hex') value from source
)
select jsonb_build_object(
 'observed_at',clock_timestamp(),
 'source_records',(select count(*) from sections),
 'units',(select count(*) from source where entity_type='code-source-unit'),
 'full_cloud_payload_ledger_sha256',(select value from ledger),
 'expected_cloud_payload_ledger_sha256','LEDGER',
 'whole_payload_match',(select value='LEDGER' from ledger),
 'payload_hash_errors',(select count(*) from source where actual_payload_sha is distinct from provenance->>'record_sha256'),
 'text_hash_errors',(select count(*) from sections where encode(sha256(convert_to(data->>'text','UTF8')),'hex') is distinct from data->>'text_sha256'),
 'unexpected_manifest_rows',(select count(*) from source where provenance->>'manifest_sha256' is distinct from 'MANIFEST'),
 'wrong_identity_kind',(select count(*) from sections where data->>'identity_kind' is distinct from 'third_party_source_occurrence'),
 'wrong_provenance_class',(select count(*) from source where data->>'provenance_class' is distinct from 'third_party_edition_archive'),
 'missing_qualification',(select count(*) from source where length(coalesce(data->>'source_qualification',''))<30 or strpos(coalesce(data->>'status_note',''),data->>'source_qualification')<1),
 'hidden_unresolved_comparisons',(select count(*) from sections where data->'source_pdf'->>'comparison'='unresolved_pdf_text_order_or_content' and coalesce(data->>'status_note','') not like '%PDF comparison unresolved%'),
 'pdf_comparisons',(select jsonb_object_agg(k,n) from (select data->'source_pdf'->>'comparison' k,count(*) n from sections group by 1) t),
 'status_only_records',(select count(*) from sections where data->>'text'=''),
 'status_only_binding_errors',(select count(*) from sections where data->>'text'='' and (data->'source_occurrence'->'text_field_empty' is distinct from 'true'::jsonb or data->'source_pdf'->>'comparison' is distinct from 'publisher_status_without_body')),
 'distinct_citations',(select count(distinct data->>'citation') from sections),
 'duplicate_citation_groups',(select count(*) from (select data->>'citation' from sections group by 1 having count(*)>1) t),
 'quarantined_rows',(select count(*) from source where review_status='quarantined'),
 'current_law_or_calculation_enabled',(select count(*) from source where data->'current_law_verified' is distinct from 'false'::jsonb or data->'calculation_activation_allowed' is distinct from 'false'::jsonb),
 'state',(select to_jsonb(s) from corpus_ingest.publisher_code_states_v2 s where jurisdiction='GA'),
 'run',(select jsonb_build_object('id',id,'status',status,'scope',scope,'counts',counts) from corpus_ingest.runs where id='RUN'),
 'open_runs',(select count(*) from corpus_ingest.runs where status in ('running','partial') and scope->>'source_system'='ga-georgiacommons-2025')
) as readback;
"""
    query=query.replace('LEDGER',report['expected_cloud_payload_ledger_sha256']).replace('MANIFEST',digest).replace('RUN',run)
    with (packet/'cloud-readback.sql').open('x',encoding='utf-8',newline='\n') as stream:stream.write(query)
    print(json.dumps(dict(manifest_sha256=digest,run_id=run,expected_cloud_payload_ledger_sha256=report['expected_cloud_payload_ledger_sha256'])))

if __name__=='__main__':main()
