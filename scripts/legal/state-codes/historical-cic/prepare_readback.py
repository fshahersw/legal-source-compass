"""Generate read-only cloud comparisons from an independently verified historical packet."""
from __future__ import annotations
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import uuid

SPEC = importlib.util.spec_from_file_location('historical_packet_lander', Path(__file__).resolve().parent.parent / 'common' / 'land_publisher_code_v2.py')
LANDER = importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(LANDER)


def canon(value): return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)
def sha(value): return hashlib.sha256((value if isinstance(value, bytes) else value.encode('utf-8'))).hexdigest()
def quoted(value): return "'" + str(value).replace("'", "''") + "'"
def digest(rows, key): return sha(''.join(canon(r) + '\n' for r in sorted(rows, key=key)))


def prepare(packet, proof, out):
    packet, proof, out = Path(packet), Path(proof), Path(out)
    verified = json.loads(proof.read_bytes()); manifest = json.loads((packet / 'manifest.json').read_bytes())
    if verified.get('verified') is not True or verified.get('quarantined') != 0 or verified.get('state') != manifest['jurisdiction']:
        raise ValueError('Passed full original replay proof without quarantine required')
    for name in ['manifest.json', 'objects.jsonl', 'units.jsonl', 'sections.jsonl', 'quarantine.jsonl', 'toc-proof.json']:
        if verified.get('packet_file_sha256', {}).get(name) != sha((packet / name).read_bytes()):
            raise ValueError('Packet changed since full original replay: ' + name)
    manifest_sha = sha(canon(manifest)); run_id = str(uuid.uuid5(LANDER.NS, manifest['jurisdiction'] + ':' + manifest_sha))
    units, sections = LANDER.build_rows(str(packet), manifest_sha, manifest)
    if len(units) != verified['original_titles'] or len(sections) != verified['rows_replayed']:
        raise ValueError('Proof counts differ from packet')
    ledger = [{'native_id': r['native_id'], 'text_sha256': r['data']['text_sha256'],
               'hierarchy_sha256': sha(canon(r['data']['hierarchy'])),
               'source_occurrence_sha256': sha(canon(r['data']['source_occurrence'])),
               'display_sha256': sha(canon({k: r['data'][k] for k in ['citation', 'heading', 'status_note', 'currency', 'history']}))} for r in sections]
    whole = [{'entity_type': r['entity_type'], 'native_id': r['native_id'], 'payload_sha256': r['provenance']['record_sha256'],
              'provenance_sha256': sha(canon(r['provenance']))} for r in units + sections]
    expected = {'source_system': manifest['source_system'], 'manifest_sha256': manifest_sha, 'run_id': run_id,
        'source_occurrences': len(sections), 'units': len(units),
        'full_identity_text_hierarchy_occurrence_ledger_sha256': digest(ledger, lambda r: r['native_id']),
        'whole_payload_provenance_ledger_sha256': digest(whole, lambda r: (r['entity_type'], r['native_id'])),
        'zero_fields': ['text_hash_errors', 'payload_hash_errors', 'wrong_identity_kind', 'missing_qualification',
                        'unexpected_manifest_rows', 'quarantined_rows', 'authority_gate_errors', 'source_binding_errors', 'span_binding_errors', 'open_runs']}
    system, jurisdiction, expected_manifest, expected_run = map(quoted, [manifest['source_system'], manifest['jurisdiction'], manifest_sha, run_id])
    qualification = quoted(manifest['archive']['qualification']); edition = quoted(manifest['archive']['edition'])
    sql = f"""-- Read-only comparison of every current row against expected.json; not a publication mutation.
begin transaction isolation level repeatable read read only;
set local statement_timeout='120s';
set local lock_timeout='3s';
with source as materialized (
 select * from corpus_ingest.entities where source_system={system}
), sections as materialized (
 select *,encode(sha256(convert_to(data->>'text','UTF8')),'hex') actual_text_sha from source where entity_type='code-section'
), ledger as (
 select native_id,corpus_ingest.canonical_integer_jsonb_v1(jsonb_build_object(
 'native_id',native_id,'text_sha256',actual_text_sha,
 'hierarchy_sha256',corpus_ingest.canonical_integer_jsonb_sha256_v1(data->'hierarchy'),
 'source_occurrence_sha256',corpus_ingest.canonical_integer_jsonb_sha256_v1(data->'source_occurrence'),
 'display_sha256',corpus_ingest.canonical_integer_jsonb_sha256_v1(jsonb_build_object(
 'citation',data->'citation','heading',data->'heading','status_note',data->'status_note','currency',data->'currency','history',data->'history')))) value from sections
), whole as (
 select entity_type,native_id,corpus_ingest.canonical_integer_jsonb_v1(jsonb_build_object(
 'entity_type',entity_type,'native_id',native_id,'payload_sha256',corpus_ingest.canonical_integer_jsonb_sha256_v1(data),
 'provenance_sha256',corpus_ingest.canonical_integer_jsonb_sha256_v1(provenance))) value from source
)
select jsonb_build_object(
 'source_system',{system},'manifest_sha256',{expected_manifest},'run_id',{expected_run},
 'source_occurrences',(select count(*) from sections),
 'units',(select count(*) from source where entity_type='code-source-unit'),
 'full_identity_text_hierarchy_occurrence_ledger_sha256',(select encode(sha256(convert_to(string_agg(value,E'\\n' order by native_id collate "C")||E'\\n','UTF8')),'hex') from ledger),
 'whole_payload_provenance_ledger_sha256',(select encode(sha256(convert_to(string_agg(value,E'\\n' order by entity_type collate "C",native_id collate "C")||E'\\n','UTF8')),'hex') from whole),
 'text_hash_errors',(select count(*) from sections where actual_text_sha is distinct from data->>'text_sha256' or length(data->>'text') is distinct from (data->>'text_code_points')::bigint),
 'payload_hash_errors',(select count(*) from source where corpus_ingest.canonical_integer_jsonb_sha256_v1(data) is distinct from provenance->>'record_sha256' or payload_sha256 is distinct from provenance->>'record_sha256'),
 'wrong_identity_kind',(select count(*) from sections where data->>'identity_kind' is distinct from 'third_party_source_occurrence'),
 'missing_qualification',(select count(*) from source where data->>'provenance_class' is distinct from 'third_party_historical_archive' or data->>'archive_edition' is distinct from {edition} or data->>'source_qualification' is distinct from {qualification} or strpos(coalesce(data->>'status_note',''),{qualification})<1 or data->'currency'->'through_date' is distinct from 'null'::jsonb),
 'unexpected_manifest_rows',(select count(*) from source where provenance->>'manifest_sha256' is distinct from {expected_manifest} or last_run is distinct from {expected_run}::uuid),
 'quarantined_rows',(select count(*) from source where review_status='quarantined'),
 'authority_gate_errors',(select count(*) from source where data->'public_projection_allowed' is distinct from 'false'::jsonb or data->'publisher_native_entity' is distinct from 'false'::jsonb or data->'current_law_verified' is distinct from 'false'::jsonb or data->'calculation_activation_allowed' is distinct from 'false'::jsonb),
 'source_binding_errors',(select count(*) from source e where not exists(select 1 from corpus_ingest.publisher_code_object_sources_v2 os join corpus_ingest.publisher_code_objects_v2 ob using(sha256) where os.sha256=e.provenance->>'source_sha256' and os.source_url=e.provenance->>'source_url' and os.retrieved_at=(e.provenance->>'retrieved_at')::timestamptz and os.retrieval_method=e.provenance->>'retrieval_method' and os.proxy is null and os.http_status=200 and ob.kind='publisher_original')),
 'span_binding_errors',(select count(*) from sections s where not exists(select 1 from source u join corpus_ingest.publisher_code_objects_v2 ob on ob.sha256=u.data->>'original_sha256' where u.entity_type='code-source-unit' and u.native_id=s.data->>'unit_id' and u.data->>'text_sha256'=s.data->>'unit_text_sha256' and u.provenance->>'source_sha256'=s.provenance->>'source_sha256' and s.data->'source_occurrence'->>'raw_sha256'=s.provenance->>'source_sha256' and s.data->'source_occurrence'->'unit_span'=s.data->'span' and s.data->'span'->>'unit'='unicode_code_points' and (s.data->'span'->>'start')::bigint>=0 and (s.data->'span'->>'end')::bigint<=(u.data->>'text_code_points')::bigint and (s.data->'span'->>'end')::bigint-(s.data->'span'->>'start')::bigint=length(s.data->>'text') and (s.data->'source_occurrence'->'raw_span'->>0)::bigint>=0 and (s.data->'source_occurrence'->'raw_span'->>1)::bigint<=ob.bytes and (s.data->'source_occurrence'->'raw_span'->>0)::bigint<(s.data->'source_occurrence'->'raw_span'->>1)::bigint)),
 'state',(select to_jsonb(s) from corpus_ingest.publisher_code_states_v2 s where jurisdiction={jurisdiction}),
 'run',(select jsonb_build_object('id',id,'status',status,'scope',scope,'counts',counts) from corpus_ingest.runs where id={expected_run}::uuid),
 'open_runs',(select count(*) from corpus_ingest.runs where status in ('running','partial') and scope->>'source_system'={system})
) as readback;
commit;
"""
    out.mkdir(parents=True, exist_ok=True)
    for name, content in [('readback.sql', sql), ('expected.json', json.dumps(expected, indent=2) + '\n')]:
        with (out / name).open('x', encoding='utf-8', newline='\n') as stream: stream.write(content)
    return expected


if __name__ == '__main__':
    cli=argparse.ArgumentParser(description=__doc__)
    cli.add_argument('--packet', type=Path, required=True); cli.add_argument('--proof', type=Path, required=True); cli.add_argument('--out', type=Path, required=True)
    args=cli.parse_args(); print(json.dumps(prepare(args.packet,args.proof,args.out)))
