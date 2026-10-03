-- Native API relationships for CourtListener REST rows written by mdl-members: incremental form (supersedes the windowed v2/v3 templates for repeat runs).
-- Each statement scopes the versions of ONE run that have no recorded edge yet ("versions without edges"), so it can be re-run after every import
-- without windows and is idempotent (on conflict updates target_present only). Substitute __RUN__ (uuid of the courtlistener run) and execute once per statement.
-- No inference: every edge is a field recorded in the stored source version. Unresolved targets stay target_present=false until the target is imported (see E).
-- Field names match native-live-api-relationships-v1.sql / -v2 / -v3.

-- (A) docket-entries : field 'docket' -> dockets ; 'recap_documents[N].resource_uri' -> recap-documents
with scoped as (
  select v.* from corpus_ingest.entity_versions v
  where v.source_system='courtlistener' and v.entity_type='docket-entries' and v.first_run='__RUN__'::uuid
    and not exists (select 1 from corpus_ingest.relationships r where r.source_system=v.source_system and r.from_type=v.entity_type and r.from_id=v.native_id and r.evidence_sha256=v.payload_sha256)
), ranked as (select *, row_number() over(order by native_id, payload_sha256) as source_ordinal from scoped),
batch as (select * from ranked where source_ordinal > 0 and source_ordinal <= 6000),
edges as (
  select b.source_system, b.entity_type, b.native_id, b.payload_sha256, 'docket'::text as field, 'dockets'::text as to_type,
    substring(b.data->>'docket' from '^https://www[.]courtlistener[.]com/api/rest/v4/dockets/([0-9]+)/$') as to_id
  from batch b
  union all
  select b.source_system, b.entity_type, b.native_id, b.payload_sha256, 'recap_documents['||(a.n-1)||'].resource_uri', 'recap-documents',
    substring(a.d->>'resource_uri' from '^https://www[.]courtlistener[.]com/api/rest/v4/recap-documents/([0-9]+)/$')
  from batch b cross join lateral jsonb_array_elements(case when jsonb_typeof(b.data->'recap_documents')='array' then b.data->'recap_documents' else '[]'::jsonb end) with ordinality a(d, n)
), written as (
  insert into corpus_ingest.relationships(source_system, from_type, from_id, field, to_type, to_id, evidence_sha256, inferred, target_present, run_id)
  select distinct e.source_system, e.entity_type, e.native_id, e.field, e.to_type, e.to_id, e.payload_sha256, false,
    exists(select 1 from corpus_ingest.entities t where t.source_system=e.source_system and t.entity_type=e.to_type and t.native_id=e.to_id and t.review_status<>'quarantined'),
    '__RUN__'::uuid
  from edges e where nullif(e.to_id,'') is not null
  on conflict(source_system, from_type, from_id, field, to_type, to_id, evidence_sha256) do update set target_present=excluded.target_present
  returning to_type, target_present
)
select jsonb_build_object('entity_type','docket-entries','source_versions',(select count(*) from batch),
  'recorded_field_edges',(select count(*) from edges),'unparsed_nonempty_references',(select count(*) from edges where to_id is null),
  'written_edges',(select count(*) from written),'unresolved_edges',(select count(*) from written where not target_present),'checked_at',now()) as receipt;

-- (B) recap-documents : field 'docket_entry_id' -> docket-entries ; 'docket_id' -> dockets
with scoped as (
  select v.* from corpus_ingest.entity_versions v
  where v.source_system='courtlistener' and v.entity_type='recap-documents' and v.first_run='__RUN__'::uuid
    and not exists (select 1 from corpus_ingest.relationships r where r.source_system=v.source_system and r.from_type=v.entity_type and r.from_id=v.native_id and r.evidence_sha256=v.payload_sha256)
), ranked as (select *, row_number() over(order by native_id, payload_sha256) as source_ordinal from scoped),
batch as (select * from ranked where source_ordinal > 0 and source_ordinal <= 8000),
edges as (
  select b.source_system, b.entity_type, b.native_id, b.payload_sha256, 'docket_entry_id'::text as field, 'docket-entries'::text as to_type, b.data->>'docket_entry_id' as to_id from batch b
  union all select b.source_system, b.entity_type, b.native_id, b.payload_sha256, 'docket_id', 'dockets', b.data->>'docket_id' from batch b
), written as (
  insert into corpus_ingest.relationships(source_system, from_type, from_id, field, to_type, to_id, evidence_sha256, inferred, target_present, run_id)
  select distinct e.source_system, e.entity_type, e.native_id, e.field, e.to_type, e.to_id, e.payload_sha256, false,
    exists(select 1 from corpus_ingest.entities t where t.source_system=e.source_system and t.entity_type=e.to_type and t.native_id=e.to_id and t.review_status<>'quarantined'),
    '__RUN__'::uuid
  from edges e where nullif(e.to_id,'') is not null
  on conflict(source_system, from_type, from_id, field, to_type, to_id, evidence_sha256) do update set target_present=excluded.target_present
  returning to_type, target_present
)
select jsonb_build_object('entity_type','recap-documents','source_versions',(select count(*) from batch),
  'recorded_field_edges',(select count(*) from edges),'unparsed_nonempty_references',(select count(*) from edges where nullif(to_id,'') is null),
  'written_edges',(select count(*) from written),'unresolved_edges',(select count(*) from written where not target_present),'checked_at',now()) as receipt;

-- (C) attorneys : 'parties_represented[i].docket' -> dockets ; 'parties_represented[i].party' -> parties
with scoped as (select v.* from corpus_ingest.entity_versions v where v.source_system='courtlistener' and v.entity_type='attorneys' and v.first_run='__RUN__'::uuid
    and not exists (select 1 from corpus_ingest.relationships r where r.source_system=v.source_system and r.from_type=v.entity_type and r.from_id=v.native_id and r.evidence_sha256=v.payload_sha256)),
edges as (
  select s.source_system, s.entity_type, s.native_id, s.payload_sha256, 'parties_represented['||(a.n-1)||'].docket' as field, 'dockets' as to_type,
    substring(a.d->>'docket' from '^https://www[.]courtlistener[.]com/api/rest/v4/dockets/([0-9]+)/$') as to_id
  from scoped s cross join lateral jsonb_array_elements(case when jsonb_typeof(s.data->'parties_represented')='array' then s.data->'parties_represented' else '[]'::jsonb end) with ordinality a(d,n)
  union all
  select s.source_system, s.entity_type, s.native_id, s.payload_sha256, 'parties_represented['||(a.n-1)||'].party', 'parties',
    substring(a.d->>'party' from '^https://www[.]courtlistener[.]com/api/rest/v4/parties/([0-9]+)/$')
  from scoped s cross join lateral jsonb_array_elements(case when jsonb_typeof(s.data->'parties_represented')='array' then s.data->'parties_represented' else '[]'::jsonb end) with ordinality a(d,n)
), written as (
  insert into corpus_ingest.relationships(source_system, from_type, from_id, field, to_type, to_id, evidence_sha256, inferred, target_present, run_id)
  select distinct e.source_system, e.entity_type, e.native_id, e.field, e.to_type, e.to_id, e.payload_sha256, false,
    exists(select 1 from corpus_ingest.entities t where t.source_system=e.source_system and t.entity_type=e.to_type and t.native_id=e.to_id and t.review_status<>'quarantined'), '__RUN__'::uuid
  from edges e where nullif(e.to_id,'') is not null
  on conflict(source_system, from_type, from_id, field, to_type, to_id, evidence_sha256) do update set target_present=excluded.target_present
  returning to_type, target_present)
select jsonb_build_object('entity_type','attorneys','source_versions',(select count(*) from scoped),'recorded_field_edges',(select count(*) from edges),'unparsed',(select count(*) from edges where nullif(to_id,'') is null),'written_edges',(select count(*) from written),'unresolved_edges',(select count(*) from written where not target_present),'checked_at',now()) as receipt;

-- (D) parties : 'party_types[i].docket' -> dockets ; 'attorneys[i].docket' -> dockets ; 'attorneys[i].attorney' -> attorneys (incremental form of native-live-api-relationships-v3-members.sql (A))
with scoped as (select v.* from corpus_ingest.entity_versions v where v.source_system='courtlistener' and v.entity_type='parties' and v.first_run='__RUN__'::uuid
    and not exists (select 1 from corpus_ingest.relationships r where r.source_system=v.source_system and r.from_type=v.entity_type and r.from_id=v.native_id and r.evidence_sha256=v.payload_sha256)),
edges as (
  select s.source_system, s.entity_type, s.native_id, s.payload_sha256, 'party_types['||(a.n-1)||'].docket' as field, 'dockets' as to_type,
    substring(a.d->>'docket' from '^https://www[.]courtlistener[.]com/api/rest/v4/dockets/([0-9]+)/$') as to_id
  from scoped s cross join lateral jsonb_array_elements(case when jsonb_typeof(s.data->'party_types')='array' then s.data->'party_types' else '[]'::jsonb end) with ordinality a(d,n)
  union all
  select s.source_system, s.entity_type, s.native_id, s.payload_sha256, 'attorneys['||(a.n-1)||'].docket', 'dockets',
    substring(a.d->>'docket' from '^https://www[.]courtlistener[.]com/api/rest/v4/dockets/([0-9]+)/$')
  from scoped s cross join lateral jsonb_array_elements(case when jsonb_typeof(s.data->'attorneys')='array' then s.data->'attorneys' else '[]'::jsonb end) with ordinality a(d,n)
  union all
  select s.source_system, s.entity_type, s.native_id, s.payload_sha256, 'attorneys['||(a.n-1)||'].attorney', 'attorneys',
    substring(a.d->>'attorney' from '^https://www[.]courtlistener[.]com/api/rest/v4/attorneys/([0-9]+)/$')
  from scoped s cross join lateral jsonb_array_elements(case when jsonb_typeof(s.data->'attorneys')='array' then s.data->'attorneys' else '[]'::jsonb end) with ordinality a(d,n)
), written as (
  insert into corpus_ingest.relationships(source_system, from_type, from_id, field, to_type, to_id, evidence_sha256, inferred, target_present, run_id)
  select distinct e.source_system, e.entity_type, e.native_id, e.field, e.to_type, e.to_id, e.payload_sha256, false,
    exists(select 1 from corpus_ingest.entities t where t.source_system=e.source_system and t.entity_type=e.to_type and t.native_id=e.to_id and t.review_status<>'quarantined'), '__RUN__'::uuid
  from edges e where nullif(e.to_id,'') is not null
  on conflict(source_system, from_type, from_id, field, to_type, to_id, evidence_sha256) do update set target_present=excluded.target_present
  returning to_type, target_present)
select jsonb_build_object('entity_type','parties','source_versions',(select count(*) from scoped),'recorded_field_edges',(select count(*) from edges),'unparsed',(select count(*) from edges where nullif(to_id,'') is null),'written_edges',(select count(*) from written),'unresolved_edges',(select count(*) from written where not target_present),'checked_at',now()) as receipt;

-- (E) refresh target_present for edges whose target has been imported since the edge was written (idempotent; DML on the run's own rows)
update corpus_ingest.relationships r set target_present = true
where r.source_system='courtlistener' and r.run_id='__RUN__'::uuid and not r.target_present
  and exists (select 1 from corpus_ingest.entities t where t.source_system=r.source_system and t.entity_type=r.to_type and t.native_id=r.to_id and t.review_status<>'quarantined');
