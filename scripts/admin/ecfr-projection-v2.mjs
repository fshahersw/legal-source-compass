/**
 * Bounded eCFR projection SQL. No network or database access.
 * Source slices are pinned to SHA-verified normalized originals and one private run.
 */
import { createHash } from "node:crypto";

export const PROJECTION_VERSION = "ecfr-metadata-projection/2";
export const FIELDS = [
  "dataset",
  "id",
  "category",
  "state",
  "title",
  "source_url",
  "ordinal",
  "item",
  "detail",
  "text",
  "filters",
  "county_geoids",
];
export const HIERARCHY_QUALIFICATION =
  "Dated eCFR editorial metadata, authoritative but unofficial. Tree relationships reflect the publisher hierarchy. A title currentness date or technical received_on value is not a provision legal effective date. Reserved headings and appendices are distinct node types. Full provisions, incorporated standards, official legal-edition verification, case-specific applicability, and PDF bytes are outside this metadata projection.";
export const NOTES_QUALIFICATION =
  "Selected dated XML authority and source notes for product safety and exposure research, with one historical February 1, 2026 Part 820 snapshot. Source/authority text is preserved without resolving legal applicability or incorporated standards. No full provision text or PDFs are projected. Selection is a research scope, not a finding that a rule governs a mass-tort case.";
export const esc = (s) => "'" + String(s).replaceAll("'", "''") + "'";
export const sha = (s) => createHash("sha256").update(s).digest("hex");
export const nativeSignature = (rows) =>
  sha(rows.map((r) => r.native_id + ":" + r.payload_sha256).join("\n"));
// PostgreSQL jsonb scalar escaping agrees with JSON.stringify within the audited
// original scalar domain; array ::text uses exactly comma-space separators.
export const observationSignature = (rows) =>
  sha(
    rows.map((r) => "[" + r.observation.map((v) => JSON.stringify(v)).join(", ") + "]").join("\n"),
  );
export const internalToken = (id) =>
  "'#record/ecfr_hierarchy/ecfr%3Anode%3A'||replace(replace(" + id + ",'%','%25'),'/','%2F')";
const hashSql = (s) => "encode(sha256(convert_to(" + s + ",'UTF8')),'hex')";
const rowHash = (alias) => hashSql("to_jsonb(" + alias + ")::text");
const aggregateHash = (alias) =>
  hashSql(
    "string_agg(" +
      alias +
      ".ordinal::text||':'||" +
      rowHash(alias) +
      ",E'\\n' order by " +
      alias +
      ".ordinal," +
      alias +
      '.id collate "C")',
  );

export function planSlices(source, pageSize) {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 10000)
    throw Error("Page size must be 1..10000");
  const sorted = [...source].sort((a, b) =>
    Buffer.compare(Buffer.from(a.native_id), Buffer.from(b.native_id)),
  );
  if (new Set(sorted.map((r) => r.native_id)).size !== sorted.length)
    throw Error("Duplicate native identity");
  const result = [];
  for (let lower = 0; lower < sorted.length; lower += pageSize) {
    const rows = sorted.slice(lower, lower + pageSize);
    result.push({
      lower,
      upper: lower + rows.length,
      first: rows[0].native_id,
      last: rows.at(-1).native_id,
      records: rows.length,
      signature: nativeSignature(rows),
      observation_signature: observationSignature(rows),
    });
  }
  return result;
}

export function sourceScopesSql(scopes) {
  return scopes
    .map(
      (s) =>
        "(" +
        [
          esc(s.dataset),
          esc(s.type),
          esc(s.schema),
          s.lower + "::bigint",
          s.upper + "::bigint",
          esc(s.first),
          esc(s.last),
          s.records + "::bigint",
          esc(s.signature),
          esc(s.observation_signature),
        ].join(",") +
        ")",
    )
    .join(",\n");
}
const sourceHead = (
  run,
  scopes,
) => `with scopes(dataset,entity_type,schema_version,lower_ordinal,upper_ordinal,first_native,last_native,expected_records,expected_signature,expected_observation_signature) as (
 values ${sourceScopesSql(scopes)}
), source_ids as materialized (
 select distinct on (s.dataset,o.native_id) s.dataset,s.entity_type,s.schema_version,
 o.source_system,o.native_id,o.payload_sha256,o.source_url,o.source_as_of,o.retrieved_at,s.lower_ordinal,
 o.source_sha256,o.provenance->>'source_as_of'original_source_as_of,o.provenance->>'retrieved_at'original_retrieved_at,
 o.provenance->>'derivation'derivation,o.provenance->>'hash_kind'hash_kind,o.provenance->'http_status'http_status,
 o.provenance->>'record_sha256'original_record_sha256,o.provenance->>'source_url'original_source_url,
 o.provenance->>'source_sha256'original_source_sha256
 from scopes s join corpus_ingest.observations o on o.source_system='ecfr' and o.entity_type=s.entity_type
 and o.run_id=${esc(run)}::uuid and o.native_id collate "C">=s.first_native collate "C" and o.native_id collate "C"<=s.last_native collate "C"
 join corpus_ingest.entity_versions v on (v.source_system,v.entity_type,v.native_id,v.payload_sha256)=(o.source_system,o.entity_type,o.native_id,o.payload_sha256)
 where v.schema_version=s.schema_version
 order by s.dataset,o.native_id,o.retrieved_at desc,o.source_url collate "C",o.payload_sha256 collate "C"
), source_checks as (
 select s.dataset,s.expected_records,s.expected_signature,s.expected_observation_signature,count(i.native_id) actual_records,
 ${hashSql("string_agg(i.native_id||':'||i.payload_sha256,E'\\n' order by i.native_id collate \"C\")")} actual_signature,
 ${hashSql("string_agg(jsonb_build_array(i.native_id,i.payload_sha256,i.source_url,i.source_sha256,i.original_source_as_of,i.original_retrieved_at,i.derivation,i.hash_kind,i.http_status)::text,E'\\n' order by i.native_id collate \"C\")")} actual_observation_signature,
 count(i.native_id)filter(where e.native_id is null or e.review_status='quarantined' or e.payload_sha256 is distinct from i.payload_sha256 or e.schema_version is distinct from i.schema_version) current_identity_mismatches,
 count(i.native_id)filter(where i.original_record_sha256 is distinct from i.payload_sha256 or i.original_source_url is distinct from i.source_url
 or i.original_source_sha256 is distinct from i.source_sha256 or i.original_source_as_of::date is distinct from i.source_as_of
 or i.original_retrieved_at::timestamptz is distinct from i.retrieved_at) observation_field_mismatches
 from scopes s left join source_ids i using(dataset)
 left join corpus_ingest.entities e on (e.source_system,e.entity_type,e.native_id)=(i.source_system,i.entity_type,i.native_id)
 group by s.dataset,s.expected_records,s.expected_signature,s.expected_observation_signature
), page as materialized (
 select i.*,v.data,o.provenance,i.lower_ordinal+row_number()over(partition by i.dataset order by i.native_id collate "C") ordinal,
 case i.dataset when 'ecfr_hierarchy' then 'ecfr:node:' else 'ecfr:notes:' end||i.native_id id
 from source_ids i join corpus_ingest.entity_versions v using(source_system,entity_type,native_id,payload_sha256)
 join corpus_ingest.observations o on (o.run_id,o.source_system,o.entity_type,o.native_id,o.payload_sha256,o.source_url)=
 (${esc(run)}::uuid,i.source_system,i.entity_type,i.native_id,i.payload_sha256,i.source_url)
), nodes as(select * from page where dataset='ecfr_hierarchy'),
 notes as(select * from page where dataset='ecfr_authority_notes'),
 child_refs as materialized (
 select n.native_id parent_id,j.id child_id,j.n child_ordinal from nodes n
 cross join lateral jsonb_array_elements_text(n.data->'child_native_ids')with ordinality j(id,n)
), child_versions as materialized (
 select distinct on (r.child_id) r.child_id,e.payload_sha256,v.data,v.schema_version
 from (select distinct child_id from child_refs) r
 left join corpus_ingest.entities e on e.source_system='ecfr' and e.entity_type='hierarchy-nodes' and e.native_id=r.child_id and e.review_status<>'quarantined'
 left join corpus_ingest.entity_versions v on (v.source_system,v.entity_type,v.native_id,v.payload_sha256)=(e.source_system,e.entity_type,e.native_id,e.payload_sha256)
 left join corpus_ingest.observations o on (o.run_id,o.source_system,o.entity_type,o.native_id,o.payload_sha256)=(${esc(run)}::uuid,e.source_system,e.entity_type,e.native_id,e.payload_sha256)
 where o.native_id is not null and v.schema_version='ecfr-hierarchy-metadata/1'
 order by r.child_id,o.retrieved_at desc,o.source_url collate "C"
), parent_versions as materialized (
 select distinct p.parent_id,e.payload_sha256,v.data from (
 select distinct data->>'parent_native_id' parent_id from nodes where data->>'parent_native_id' is not null
 )p left join corpus_ingest.entities e on e.source_system='ecfr' and e.entity_type='hierarchy-nodes' and e.native_id=p.parent_id and e.review_status<>'quarantined'
 left join corpus_ingest.entity_versions v on (v.source_system,v.entity_type,v.native_id,v.payload_sha256)=(e.source_system,e.entity_type,e.native_id,e.payload_sha256)
 where v.schema_version='ecfr-hierarchy-metadata/1' and exists(select 1 from corpus_ingest.observations o
 where (o.run_id,o.source_system,o.entity_type,o.native_id,o.payload_sha256)=(${esc(run)}::uuid,e.source_system,e.entity_type,e.native_id,e.payload_sha256))
), topology_checks as (
 select (select count(*)from child_refs r left join child_versions c on c.child_id=r.child_id
 where c.child_id is null or c.data->>'parent_native_id' is distinct from r.parent_id)
 +(select count(*)from nodes n left join parent_versions p on p.parent_id=n.data->>'parent_native_id'
 where n.data->>'parent_native_id' is not null and (p.parent_id is null or not(p.data->'child_native_ids' ? n.native_id))) mismatches
), child_items as (
 select r.parent_id,jsonb_agg(jsonb_build_object('title',c.data->>'heading','subtitle',c.data->>'node_type',
 'links',jsonb_build_array(jsonb_build_object('url',${internalToken("c.child_id")},'label','Open heading')))order by r.child_ordinal)items
 from child_refs r join child_versions c on c.child_id=r.child_id group by r.parent_id
)`;
export function expectedSql(run, scopes, template) {
  return (
    sourceHead(run, scopes) +
    ",\n" +
    template
      .replaceAll("__HIERARCHY_QUALIFICATION__", esc(HIERARCHY_QUALIFICATION))
      .replaceAll("__NOTES_QUALIFICATION__", esc(NOTES_QUALIFICATION))
      .replaceAll("__PARENT_TOKEN__", internalToken("n.data->>'parent_native_id'"))
  );
}
export function projectSql(run, plan, scopes, template) {
  return (
    expectedSql(run, scopes, template) +
    `,
 guard as(select not exists(select 1 from source_checks where actual_records<>expected_records or actual_signature is distinct from expected_signature
 or actual_observation_signature is distinct from expected_observation_signature or current_identity_mismatches<>0 or observation_field_mismatches<>0)
 and (select mismatches=0 from topology_checks)
 and not exists(select 1 from scopes s left join public.corpus_datasets d on d.id=s.dataset
 where d.id is null or d.ready or d.metadata->>'projection_plan_sha256' is distinct from ${esc(plan)}) ok),
 written as(insert into public.corpus_records(${FIELDS.join(",")})
 select ${FIELDS.map((f) => "e." + f).join(",")} from expected e where(select ok from guard)
 on conflict(dataset,id)do update set ${FIELDS.filter((f) => !["dataset", "id"].includes(f))
   .map((f) => f + "=excluded." + f)
   .join(",")}
 returning dataset,id)
 select jsonb_build_object('plan_sha256',${esc(plan)},'guard_passed',(select ok from guard),'written_records',(select count(*)from written),
 'source_checks',(select jsonb_agg(to_jsonb(c))from source_checks c),'native_topology_mismatches',(select mismatches from topology_checks))receipt;\n`
  );
}
export function verifySql(run, plan, scopes, template) {
  return (
    expectedSql(run, scopes, template) +
    `,
 actual as materialized(select ${FIELDS.map((f) => "r." + f).join(",")} from public.corpus_records r join scopes s on s.dataset=r.dataset
 where (r.ordinal>s.lower_ordinal and r.ordinal<=s.upper_ordinal)or exists(select 1 from expected e where(e.dataset,e.id)=(r.dataset,r.id))),
 differences as(
 select coalesce(e.dataset,a.dataset)dataset,count(e.id)expected_records,count(a.id)actual_records,
 count(*)filter(where e.id is null)unexpected,count(*)filter(where a.id is null)missing,
 count(*)filter(where e.id is not null and a.id is not null and row(${FIELDS.map((f) => "e." + f).join(",")})is distinct from row(${FIELDS.map((f) => "a." + f).join(",")}))mismatched
 from expected e full join actual a using(dataset,id)group by coalesce(e.dataset,a.dataset)
 ), expected_hashes as(select e.dataset,${aggregateHash("e")}fullfield_signature from expected e group by e.dataset),
 actual_hashes as(select a.dataset,${aggregateHash("a")}fullfield_signature from actual a group by a.dataset),
 canonical_inputs as materialized(
 select distinct on(dataset,native_id) * from(
 select dataset,native_id,payload_sha256,data from page
 union all select 'ecfr_hierarchy',child_id,payload_sha256,data from child_versions
 union all select 'ecfr_hierarchy',parent_id,payload_sha256,data from parent_versions
 )x order by dataset,native_id
 ), canonical_checks as(
 select dataset,count(*)filter(where corpus_ingest.canonical_integer_jsonb_sha256_v1(data)is distinct from payload_sha256)source_payload_mismatches
 from canonical_inputs group by dataset
 ), receipt_rows as(
 select ${esc(PROJECTION_VERSION)} projection_schema,${esc(plan)}plan_sha256,${esc(run)}::uuid run_id,s.dataset,s.lower_ordinal,s.upper_ordinal,s.expected_signature source_expected_signature,
 s.expected_records,coalesce(d.actual_records,0)actual_records,eh.fullfield_signature expected_fullfield_signature,ah.fullfield_signature actual_fullfield_signature,
 coalesce(d.missing,s.expected_records)missing,coalesce(d.unexpected,0)unexpected,coalesce(d.mismatched,0)mismatched,
 coalesce(c.source_payload_mismatches,s.expected_records)source_payload_mismatches,(select mismatches from topology_checks)native_topology_mismatches,
 coalesce(sc.actual_records=s.expected_records and sc.actual_signature=s.expected_signature and sc.actual_observation_signature=s.expected_observation_signature
 and sc.current_identity_mismatches=0 and sc.observation_field_mismatches=0
 and d.expected_records=s.expected_records and d.actual_records=s.expected_records and d.missing=0 and d.unexpected=0 and d.mismatched=0
 and eh.fullfield_signature=ah.fullfield_signature and c.source_payload_mismatches=0 and(select mismatches=0 from topology_checks)
 and exists(select 1 from public.corpus_datasets cd where cd.id=s.dataset and not cd.ready and cd.metadata->>'projection_plan_sha256'=${esc(plan)}),false)verified
 from scopes s left join differences d using(dataset)left join source_checks sc using(dataset)
 left join expected_hashes eh using(dataset)left join actual_hashes ah using(dataset)left join canonical_checks c using(dataset)
 ), written_receipts as(
 insert into corpus_ingest.projection_slice_checks_v2(projection_schema,plan_sha256,run_id,dataset,lower_ordinal,upper_ordinal,source_expected_signature,expected_records,actual_records,expected_fullfield_signature,actual_fullfield_signature,missing,unexpected,mismatched,source_payload_mismatches,native_topology_mismatches,verified)
 select * from receipt_rows returning *
 )select * from written_receipts order by dataset;\n`
  );
}
export function publishSql(run, plan, source, slices, facets) {
  const allScopes = source.map((s) => ({ ...s, lower: 0, upper: s.records }));
  const planRows = slices
    .map(
      (s) =>
        "(" +
        [
          esc(s.dataset),
          s.lower + "::bigint",
          s.upper + "::bigint",
          s.records + "::bigint",
          esc(s.signature),
        ].join(",") +
        ")",
    )
    .join(",\n");
  const facetRows = Object.entries(facets)
    .map(([d, f]) => "(" + esc(d) + "," + esc(JSON.stringify(f)) + "::jsonb)")
    .join(",\n");
  // No metadata payloads or expected row reconstruction for the entire corpus.
  return (
    sourceHead(run, allScopes).split(", page as materialized")[0] +
    `,
 planned_slices(dataset,lower_ordinal,upper_ordinal,expected_records,source_expected_signature)as(values ${planRows}),
 expected_facets(dataset,filters)as(values ${facetRows}),
 checks as materialized(
 select distinct on(dataset,lower_ordinal,upper_ordinal)c.* from corpus_ingest.projection_slice_checks_v2 c
 where c.plan_sha256=${esc(plan)} and c.projection_schema=${esc(PROJECTION_VERSION)} and c.run_id=${esc(run)}::uuid
 order by dataset,lower_ordinal,upper_ordinal,check_id desc
 ), current_slice_hashes as(
 select s.dataset,s.lower_ordinal,s.upper_ordinal,count(r.id)actual_records,
 ${aggregateHash("r")}fullfield_signature
 from planned_slices s left join lateral(select ${FIELDS.map((f) => "p." + f).join(",")} from public.corpus_records p
 where p.dataset=s.dataset and p.ordinal>s.lower_ordinal and p.ordinal<=s.upper_ordinal)r on true
 group by s.dataset,s.lower_ordinal,s.upper_ordinal
 ), ranges as(
 select s.*,lag(upper_ordinal,1,0::bigint)over(partition by dataset order by lower_ordinal)previous_upper from planned_slices s
 ), range_checks as(
 select dataset,min(lower_ordinal)=0 and bool_and(lower_ordinal=previous_upper)contiguous,
 max(upper_ordinal)last_ordinal,sum(expected_records)expected_records,count(*)slices from ranges group by dataset
 ), public_counts as(
 select s.dataset,count(r.id)records,count(distinct r.id)unique_ids,count(distinct r.ordinal)unique_ordinals,
 min(r.ordinal)first_ordinal,max(r.ordinal)last_ordinal,
 count(r.id)filter(where r.category is distinct from s.dataset or r.state is not null or r.county_geoids is distinct from '{}'::text[])metadata_mismatches
 from scopes s left join public.corpus_records r on r.dataset=s.dataset group by s.dataset
 ), slice_checks as(
 select p.dataset,bool_and(coalesce(c.verified and c.expected_records=p.expected_records and c.source_expected_signature=p.source_expected_signature
 and c.expected_fullfield_signature=h.fullfield_signature and h.actual_records=p.expected_records,false))verified,
 count(c.check_id)verified_slice_receipts
 from planned_slices p left join checks c using(dataset,lower_ordinal,upper_ordinal)
 left join current_slice_hashes h using(dataset,lower_ordinal,upper_ordinal)group by p.dataset
 ), final_checks as(
 select s.dataset,pc.records,sc.actual_signature source_signature,rc.slices,tc.verified_slice_receipts,
 coalesce(sc.actual_records=s.expected_records and sc.actual_signature=s.expected_signature and sc.actual_observation_signature=s.expected_observation_signature
 and sc.current_identity_mismatches=0 and sc.observation_field_mismatches=0
 and pc.records=s.expected_records and pc.unique_ids=s.expected_records and pc.unique_ordinals=s.expected_records
 and pc.first_ordinal=1 and pc.last_ordinal=s.expected_records and pc.metadata_mismatches=0
 and rc.contiguous and rc.last_ordinal=s.expected_records and rc.expected_records=s.expected_records and tc.verified and tc.verified_slice_receipts=rc.slices
 and d.expected_records=s.expected_records and d.metadata->>'projection_plan_sha256'=${esc(plan)}
 and d.metadata->'listing'->'filters'=ef.filters,false)verified
 from scopes s left join source_checks sc using(dataset)left join public_counts pc using(dataset)
 left join range_checks rc using(dataset)left join slice_checks tc using(dataset)
 left join public.corpus_datasets d on d.id=s.dataset left join expected_facets ef using(dataset)
 ), published as(
 update public.corpus_datasets d set imported_records=c.records,ready=c.verified,updated_at=now()
 from final_checks c where d.id=c.dataset returning d.id,d.ready,d.expected_records,d.imported_records
 )select p.*,to_jsonb(c)verification from published p join final_checks c on c.dataset=p.id order by p.id;\n`
  );
}
