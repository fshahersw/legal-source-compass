with ss(s) as (values __SYSTEMS__),
samp as (
  select e.source_system, e.native_id, e.data, e.provenance
  from ss cross join lateral (
    select * from corpus_ingest.entities e
    where e.source_system = ss.s and e.entity_type = 'code-section' and e.review_status <> 'quarantined'
    order by md5(e.native_id || ':twoway-20261007') limit 20) e),
su as (select distinct source_system, data->>'unit_id' uid from samp),
cand as (
  select x.source_system, x.native_id, x.data
  from corpus_ingest.entities x join su on su.source_system = x.source_system and x.data->>'unit_id' = su.uid
  where x.entity_type = 'code-section' and x.review_status <> 'quarantined'),
nb as (
  select s.native_id sample_id, n.native_id, n.source_system, n.data
  from samp s cross join lateral (
    select c.* from cand c
    where c.source_system = s.source_system and c.data->>'unit_id' = s.data->>'unit_id' and c.native_id <> s.native_id
      and case when jsonb_typeof(s.data->'span') = 'object' and jsonb_typeof(c.data->'span') = 'object'
               then (c.data->'span'->>'start')::bigint >= (s.data->'span'->>'end')::bigint
               else c.native_id > s.native_id end
    order by case when jsonb_typeof(c.data->'span') = 'object' then (c.data->'span'->>'start')::bigint end nulls last, c.native_id
    limit 5) n),
un as (
  select u.source_system, u.native_id, u.data, u.provenance from corpus_ingest.entities u
  join su on su.source_system = u.source_system and u.native_id = su.uid
  where u.entity_type = 'code-source-unit'),
mf as (
  select distinct on (m.source_system) m.source_system, m.manifest_sha256, m.manifest
  from corpus_ingest.publisher_code_manifests_v2 m
  where m.manifest_sha256 in (select provenance->>'manifest_sha256' from samp)
  order by m.source_system, m.registered_at desc)
select jsonb_build_object(
  'samples', (select jsonb_agg(jsonb_build_object('source_system', source_system, 'native_id', native_id, 'data', data, 'provenance', provenance)) from samp),
  'neighbors', (select jsonb_agg(jsonb_build_object('sample_id', sample_id, 'source_system', source_system, 'native_id', native_id,
      'unit_id', data->>'unit_id', 'citation_path', data->>'citation_path', 'heading', data->>'heading', 'hierarchy', data->'hierarchy',
      'span', data->'span', 'text_head', left(data->>'text', 400))) from nb),
  'units', (select jsonb_agg(jsonb_build_object('source_system', source_system, 'native_id', native_id, 'data', data, 'provenance', provenance)) from un),
  'manifests', (select jsonb_agg(jsonb_build_object('source_system', source_system, 'manifest_sha256', manifest_sha256, 'manifest', manifest)) from mf)
) packet
