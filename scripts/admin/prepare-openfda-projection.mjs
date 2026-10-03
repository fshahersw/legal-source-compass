/** Pinned FDA public whitelist projection. No network, no database calls. */
import fs from "node:fs/promises";
import path from "node:path";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import {
  FIELDS,
  esc,
  sha,
  planSlices,
  nativeSignature,
  observationSignature,
} from "./ecfr-projection-v2.mjs";
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((s, i, a) => (s.startsWith("--") ? [s.slice(2), a[i + 1]] : []))
    .filter((x) => x.length),
);
if (!/^[0-9a-f-]{36}$/.test(args.run ?? "") || !args.receipt || !args.output)
  throw Error("Require --run --receipt --output");
const receiptBytes = await fs.readFile(args.receipt),
  receipt = JSON.parse(receiptBytes);
if (receipt.schema_version !== "openfda-selected-metadata-receipt/1" || receipt.pdf_downloads !== 0)
  throw Error("Wrong selected-source contract");
const PAGE = 2500;
function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
        .map((k) => JSON.stringify(k) + ":" + canonical(value[k]))
        .join(",") +
      "}"
    );
  if (typeof value === "number" && !Number.isSafeInteger(value))
    throw Error("Unsupported canonical number");
  return JSON.stringify(value);
}
const provenanceSignature = (rows) =>
  sha(rows.map((r) => r.native_id + ":" + r.provenance_sha256).join("\n"));
const version = "openfda-native-metadata-view/1";
const qualification =
  receipt.qualification +
  " Publisher export dates are not legal effective dates. Source-reported recall causes and device-class flags do not establish a historical or current requirement. Classification-code/CFR links are exact references to separate dated metadata snapshots, not governing-law or historical-applicability findings. No addresses, firm names, contacts, patient narratives, lot codes, harmonized UDI arrays, free-form recall descriptions, reason text or actions are public.";
const config = {
  "device-classification": {
    id: "agency_safety_openfda_device_classification_20261002",
    category: "openfda_device_classification_metadata",
    label: "FDA device category metadata — October 2, 2026",
    prefix: "FDA device category",
    endpoint: "device/classification",
    identity: "product_code",
    facets: ["device_class", "medical_specialty", "implant_flag"],
    grain: "native FDA product-category code records",
  },
  "device-enforcement": {
    id: "agency_safety_openfda_device_enforcement_20260928",
    category: "openfda_device_enforcement_metadata",
    label: "FDA device enforcement metadata — September 28, 2026",
    prefix: "FDA device enforcement recall",
    endpoint: "device/enforcement",
    identity: "recall_number",
    facets: ["classification", "status", "product_type"],
    grain: "native recall enforcement-report records",
  },
  "drug-enforcement": {
    id: "agency_safety_openfda_drug_enforcement_20260928",
    category: "openfda_drug_enforcement_metadata",
    label: "FDA drug enforcement metadata — September 28, 2026",
    prefix: "FDA drug enforcement recall",
    endpoint: "drug/enforcement",
    identity: "recall_number",
    facets: ["classification", "status", "product_type"],
    grain: "native recall enforcement-report records",
  },
  "device-recalls": {
    id: "agency_safety_openfda_device_recalls_20261002",
    category: "openfda_device_recall_metadata",
    label: "FDA device recall metadata — October 2, 2026",
    prefix: "FDA device recall",
    endpoint: "device/recall",
    identity: "cfres_id",
    facets: ["recall_status", "root_cause_description"],
    grain: "documented native cfRes recall records",
  },
};
const labels = {
  native_id: "Native identifier",
  source_export_date: "Publisher export date",
  recall_number: "FDA recall tracking designation",
  event_id: "FDA source event ID",
  product_type: "Source product type",
  classification: "Recall hazard class (FDA)",
  status: "Status reported in export",
  recall_initiation_date: "Recall initiated (source)",
  report_date: "Enforcement report date",
  center_classification_date: "FDA hazard classified (source)",
  termination_date: "Termination date reported in export",
  voluntary_mandated: "Source initiation category",
  product_code: "FDA category code",
  device_name: "FDA source device name",
  device_class: "Device regulatory class (FDA)",
  medical_specialty: "FDA specialty code",
  medical_specialty_description: "FDA specialty description",
  review_panel: "FDA review panel",
  regulation_number: "Native Title21 CFR reference",
  implant_flag: "Implant flag (FDA source)",
  life_sustain_support_flag: "Life-support flag (FDA source)",
  gmp_exempt_flag: "GMP-exemption flag reported by FDA",
  submission_type_id: "Native submission type",
  third_party_flag: "Third-party flag (source)",
  review_code: "FDA review code",
  unclassified_reason: "FDA classification reason",
  summary_malfunction_reporting: "Native reporting category",
  cfres_id: "Documented cfRes ID",
  product_res_number: "Source product recall reference",
  res_event_number: "FDA source recall event",
  recall_status: "Recall status reported in export",
  event_date_initiated: "Initiated (source)",
  event_date_created: "Created (source)",
  event_date_posted: "Posted (source)",
  event_date_terminated: "Terminated date in export",
  root_cause_description: "FDA source cause category",
};
// Fail closed if a future receipt adds an unreviewed public field.
const PUBLIC_FIELDS = {
  "device-classification": [
    "product_code",
    "device_name",
    "device_class",
    "medical_specialty",
    "medical_specialty_description",
    "review_panel",
    "regulation_number",
    "implant_flag",
    "life_sustain_support_flag",
    "gmp_exempt_flag",
    "submission_type_id",
    "third_party_flag",
    "review_code",
    "unclassified_reason",
    "summary_malfunction_reporting",
  ],
  "device-enforcement": [
    "recall_number",
    "event_id",
    "product_type",
    "classification",
    "status",
    "recall_initiation_date",
    "report_date",
    "center_classification_date",
    "termination_date",
    "voluntary_mandated",
  ],
  "drug-enforcement": [
    "recall_number",
    "event_id",
    "product_type",
    "classification",
    "status",
    "recall_initiation_date",
    "report_date",
    "center_classification_date",
    "termination_date",
    "voluntary_mandated",
  ],
  "device-recalls": [
    "cfres_id",
    "product_res_number",
    "res_event_number",
    "product_code",
    "recall_status",
    "event_date_initiated",
    "event_date_created",
    "event_date_posted",
    "event_date_terminated",
    "root_cause_description",
  ],
};
const scopes = [],
  allSlices = [],
  allOriginals = [];
for (const type of Object.keys(config)) {
  const cfg = config[type],
    d = receipt.datasets.find((x) => x.entity_type === type);
  if (!d) throw Error("Missing native source: " + type);
  if (
    d.schema_version !== "openfda-selected-native-metadata/1" ||
    JSON.stringify(d.public_native_fields) !== JSON.stringify(PUBLIC_FIELDS[type])
  )
    throw Error("Unreviewed public field/schema contract: " + type);
  const file = path.join(path.dirname(args.receipt), d.file),
    stream = createReadStream(file),
    h = createHash("sha256");
  stream.on("data", (b) => h.update(b));
  const ids = [],
    counts = Object.fromEntries(cfg.facets.map((k) => [k, new Map()]));
  let rows = 0,
    eligible = 0;
  for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
    if (!line) continue;
    const r = JSON.parse(line);
    rows++;
    if (
      r.schema_version !== "openfda-selected-native-metadata/1" ||
      r.source_system !== "openfda" ||
      r.entity_type !== type ||
      !r.native_id
    )
      throw Error("Wrong normalized envelope");
    if (!r.data.public_eligible) continue;
    if (
      r.data.native_identity_field !== cfg.identity ||
      r.data[cfg.identity] !== r.native_id ||
      !/^[A-Za-z0-9._~-]+$/.test(r.native_id)
    )
      throw Error("Unreviewed public identity");
    eligible++;
    ids.push({
      native_id: r.native_id,
      payload_sha256: r.provenance.record_sha256,
      provenance_sha256: sha(canonical(r.provenance)),
      observation: [
        r.native_id,
        r.provenance.record_sha256,
        r.provenance.source_url,
        r.provenance.source_sha256,
        r.provenance.source_as_of,
        r.provenance.retrieved_at,
        r.provenance.derivation,
        r.provenance.hash_kind,
        r.provenance.http_status,
      ],
    });
    for (const key of cfg.facets) {
      const v = r.data[key];
      if (v !== null && v !== "") counts[key].set(String(v), (counts[key].get(String(v)) ?? 0) + 1);
    }
  }
  if (
    h.digest("hex") !== d.sha256 ||
    rows !== d.ingest_records ||
    eligible !== d.public_eligible_records
  )
    throw Error("Source receipt mismatch");
  const sorted = [...ids].sort((a, b) =>
    Buffer.compare(Buffer.from(a.native_id), Buffer.from(b.native_id)),
  );
  const slices = planSlices(sorted, PAGE).map((b) => ({
      ...b,
      provenance_signature: provenanceSignature(sorted.slice(b.lower, b.upper)),
    })),
    filters = cfg.facets.map((name) => ({
      name,
      label: labels[name],
      type: "select",
      options: [...counts[name]]
        .sort(([a], [b]) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
        .map(([value, count]) => ({ value, label: value, count })),
    }));
  scopes.push({
    ...cfg,
    type,
    schema: d.schema_version,
    records: eligible,
    private_records: d.ingest_records,
    private_signature: d.identity_signature,
    first: sorted[0].native_id,
    last: sorted.at(-1).native_id,
    signature: nativeSignature(sorted),
    observation_signature: observationSignature(sorted),
    provenance_signature: provenanceSignature(sorted),
    fields: d.public_native_fields,
    filters,
    slices,
    export_date: d.export_date,
  });
  allSlices.push(...slices.map((s) => ({ ...s, dataset: cfg.id, type })));
  allOriginals.push({ type, file: d.file, sha256: d.sha256, records: rows });
}
const pin = {
  schema_version: version,
  run_id: args.run,
  normalized_receipt_sha256: sha(receiptBytes),
  implementation_sha256: sha(await fs.readFile(new URL(import.meta.url))),
  shared_helper_sha256: sha(
    await fs.readFile(new URL("./ecfr-projection-v2.mjs", import.meta.url)),
  ),
  page_size: PAGE,
  originals: allOriginals,
  scopes: scopes.map(({ slices, ...s }) => ({ ...s, slices })),
};
const plan = sha(JSON.stringify(pin)),
  output = path.join(args.output, plan);
await fs.mkdir(output, { recursive: true });
const files = [];
async function save(name, sql) {
  const fn = path.join(output, name);
  try {
    if ((await fs.readFile(fn, "utf8")) !== sql) throw Error("Changed existing prepared artifact");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    await fs.writeFile(fn, sql, "utf8");
  }
  files.push({ file: name, sha256: sha(sql), bytes: Buffer.byteLength(sql) });
}
const hashSql = (s) => "encode(sha256(convert_to(" + s + ",'UTF8')),'hex')";
const rowHash = (a) => hashSql("to_jsonb(" + a + ")::text");
const combinedHash = (a) =>
  hashSql(
    "string_agg(" +
      a +
      ".ordinal::text||':'||" +
      rowHash(a) +
      ",E'\\n'order by " +
      a +
      ".ordinal," +
      a +
      '.id collate "C")',
  );
const rowFields = (a) => FIELDS.map((k) => a + "." + k).join(",");
function head(s, b) {
  return `with scope as(select ${esc(s.id)}::text dataset,${b.lower}::bigint lower_ordinal,${b.upper}::bigint upper_ordinal,${b.records}::bigint expected_records,${esc(b.signature)}::text expected_signature,${esc(b.observation_signature)}::text expected_observation_signature),
 source_ids as materialized(
 select distinct on(o.native_id)o.source_system,o.entity_type,o.native_id,o.payload_sha256,v.schema_version,o.source_url,o.source_sha256,o.source_as_of,o.retrieved_at,o.provenance source_provenance,
 o.provenance->>'source_as_of'original_source_as_of,o.provenance->>'retrieved_at'original_retrieved_at,o.provenance->>'derivation'derivation,o.provenance->>'hash_kind'hash_kind,o.provenance->'http_status'http_status,
 o.provenance->>'source_url'original_source_url,o.provenance->>'source_sha256'original_source_sha256,o.provenance->>'record_sha256'original_record_sha256
 from corpus_ingest.observations o join corpus_ingest.entity_versions v using(source_system,entity_type,native_id,payload_sha256)
 where o.source_system='openfda' and o.entity_type=${esc(s.type)} and o.run_id=${esc(args.run)}::uuid and v.schema_version=${esc(s.schema)}
 and o.native_id collate "C">=${esc(b.first)} collate "C"and o.native_id collate "C"<=${esc(b.last)} collate "C"
 and v.data->'public_eligible'='true'::jsonb and v.data->>'native_identity_field'=${esc(s.identity)} and v.data->>${esc(s.identity)}=o.native_id
 order by o.native_id,o.retrieved_at desc,o.source_url collate "C",o.payload_sha256 collate "C"
 ),source_checks as(
 select count(*)records,${hashSql("string_agg(i.native_id||':'||i.payload_sha256,E'\\n'order by i.native_id collate \"C\")")}signature,
 ${hashSql("string_agg(jsonb_build_array(i.native_id,i.payload_sha256,i.source_url,i.source_sha256,i.original_source_as_of,i.original_retrieved_at,i.derivation,i.hash_kind,i.http_status)::text,E'\\n'order by i.native_id collate \"C\")")}observation_signature,
 ${hashSql("string_agg(i.native_id||':'||corpus_ingest.canonical_integer_jsonb_sha256_v1(i.source_provenance),E'\\n'order by i.native_id collate \"C\")")}provenance_signature,
 count(*)filter(where e.native_id is null or e.review_status='quarantined' or e.payload_sha256 is distinct from i.payload_sha256 or e.schema_version is distinct from ${esc(s.schema)})identity_mismatches,
 count(*)filter(where i.original_source_as_of::date is distinct from i.source_as_of or i.original_retrieved_at::timestamptz is distinct from i.retrieved_at or i.original_source_url is distinct from i.source_url
 or i.original_source_sha256 is distinct from i.source_sha256 or i.original_record_sha256 is distinct from i.payload_sha256)observation_column_mismatches
 from source_ids i left join corpus_ingest.entities e using(source_system,entity_type,native_id)
 ),page as materialized(
 select i.*,v.data,o.provenance,${b.lower}+row_number()over(order by i.native_id collate "C")ordinal,
 'openfda:${s.type}:'||i.native_id id from source_ids i join corpus_ingest.entity_versions v using(source_system,entity_type,native_id,payload_sha256)
 join corpus_ingest.observations o on(o.run_id,o.source_system,o.entity_type,o.native_id,o.payload_sha256,o.source_url)=(${esc(args.run)}::uuid,i.source_system,i.entity_type,i.native_id,i.payload_sha256,i.source_url)
 ),cfr_matches as materialized(
 select r.item->'cells'->>'node_identifier'identifier,min(r.id)id,count(*)matches from public.corpus_records r
 where r.dataset='ecfr_hierarchy'and r.category='ecfr_hierarchy'and r.item->'cells'->>'title_number'='21'and r.item->'cells'->>'node_type'='section'
 and r.filters->>'snapshot_as_of'='2026-09-30'and r.detail->'provenance'->>'schema_version'='ecfr-hierarchy-metadata/1'
 and r.id='ecfr:node:'||(r.filters->>'native_id') and exists(select 1 from public.corpus_datasets d where d.id=r.dataset and d.ready)
 group by r.item->'cells'->>'node_identifier' having count(*)=1
 ),category_matches as materialized(
 select r.filters->>'product_code'code,min(r.id)id from public.corpus_records r
 where r.dataset='agency_safety_openfda_device_classification_20261002' and r.category='openfda_device_classification_metadata'
 and r.id='openfda:device-classification:'||(r.filters->>'native_id')and r.item->'cells'->>'product_code'=r.filters->>'product_code'
 and r.item->'cells'->>'source_export_date'='2026-10-02'
 and exists(select 1 from public.corpus_datasets d where d.id=r.dataset and d.ready and d.metadata->>'projection_plan_sha256'=${esc(plan)})
 group by r.filters->>'product_code' having count(*)=1
 ),safe as materialized(
 select p.*,(select jsonb_object_agg(k,p.data->k)from unnest(array[${s.fields.map(esc).join(",")}])k)||jsonb_build_object('native_id',p.native_id,'source_export_date',p.source_as_of::text)safe_metadata,
 jsonb_build_array(jsonb_build_object('url',p.source_url,'label','Original dated FDA JSON ZIP'),
 jsonb_build_object('url','https://api.fda.gov/${s.endpoint}.json?search=${s.identity}%3A%22'||p.native_id||'%22','label','FDA native-ID query (not individually retrieved)'),
 jsonb_build_object('url',p.provenance->>'field_reference_url','label','Official FDA field reference'))
 ${s.type === "device-classification" ? `||case when c.id is not null then jsonb_build_array(jsonb_build_object('url','#record/ecfr_hierarchy/'||replace(replace(replace(c.id,'%','%25'),':','%3A'),'/','%2F'),'label','Exact Title21 section heading — September30 snapshot'))else'[]'::jsonb end` : ""}
 ${s.type === "device-recalls" ? `||case when c.id is not null then jsonb_build_array(jsonb_build_object('url','#record/agency_safety_openfda_device_classification_20261002/'||replace(c.id,':','%3A'),'label','Exact category-code match — October2 snapshot'))else'[]'::jsonb end` : ""} links
 from page p ${s.type === "device-classification" ? "left join cfr_matches c on c.identifier=p.data->>'regulation_number'" : s.type === "device-recalls" ? "left join category_matches c on c.code=p.data->>'product_code'" : ""}
 ),expected as materialized(
 select ${esc(s.id)}::text dataset,id,${esc(s.category)}::text category,null::text state,${esc(s.prefix + " ")}||native_id title,source_url,ordinal,
 jsonb_build_object('id',id,'title',${esc(s.prefix + " ")}||native_id,'subtitle','Publisher export '||source_as_of::text,'cells',safe_metadata,'links',links)item,
 jsonb_build_object('id',id,'title',${esc(s.prefix + " ")}||native_id,'subtitle','Publisher export '||source_as_of::text,
 'facts',(select jsonb_agg(jsonb_build_array(case k ${["native_id", ...s.fields, "source_export_date"].map((k) => "when " + esc(k) + " then " + esc(labels[k] ?? k)).join(" ")} else k end,v)order by k collate "C")from jsonb_each(safe_metadata)j(k,v)),
 'links',links,'qualification',${esc(qualification)},'provenance',jsonb_build_object('source_system','openfda','projection_schema',${esc(version)},'schema_version',schema_version,'record_sha256',payload_sha256,'original_zip_sha256',source_sha256,
 'source_export_date',source_as_of,'retrieved_at',retrieved_at,'source_zip_member',provenance->>'source_zip_member','source_row_ordinal',provenance->'source_row_ordinal',
 'native_record_without_harmonized_annotation_sha256',provenance->>'native_record_without_harmonized_annotation_sha256'))detail,
 jsonb_pretty(safe_metadata)text,safe_metadata||jsonb_build_object('_listing','true')filters,'{}'::text[]county_geoids from safe
 )`;
}
const ledgerCols =
  "projection_schema,plan_sha256,run_id,dataset,lower_ordinal,upper_ordinal,source_expected_signature,expected_records,actual_records,expected_fullfield_signature,actual_fullfield_signature,missing,unexpected,mismatched,source_payload_mismatches,native_topology_mismatches,verified";
for (const s of scopes) {
  const columns = [
    "native_id",
    ...s.fields.filter(
      (k) => !["medical_specialty_description", "unclassified_reason"].includes(k),
    ),
    "source_export_date",
  ].map((key) => ({ key, label: labels[key] ?? key }));
  const metadata = {
    schema_version: version,
    projection_plan_sha256: plan,
    projection_run_id: args.run,
    source_system: "openfda",
    aliases: [s.id],
    grain: s.grain,
    qualification,
    listing: { columns, filters: s.filters },
  };
  await save(
    s.type + "-registration.sql",
    `insert into public.corpus_datasets(id,label,ready,expected_records,imported_records,metadata)values(${esc(s.id)},${esc(s.label)},false,${s.records},0,${esc(JSON.stringify(metadata))}::jsonb)
 on conflict(id)do update set label=excluded.label,ready=false,expected_records=excluded.expected_records,imported_records=0,metadata=excluded.metadata,updated_at=now()
 returning id,ready,expected_records;\n`,
  );
  for (let i = 0; i < s.slices.length; i++) {
    const b = s.slices[i],
      name = s.type + "-" + String(i + 1).padStart(3, "0"),
      base = head(s, b);
    const guard = `(select records=${b.records} and  signature=${esc(b.signature)} and  observation_signature=${esc(b.observation_signature)} and provenance_signature=${esc(b.provenance_signature)} and  identity_mismatches=0 and observation_column_mismatches=0 from source_checks)
  and exists(select 1 from public.corpus_datasets d where d.id=${esc(s.id)} and  not d.ready and d.metadata->>'projection_plan_sha256'=${esc(plan)})`;
    await save(
      name + "-project.sql",
      base +
        `,written as(insert into public.corpus_records(${FIELDS.join(",")})select ${rowFields("e")} from expected e where ${guard}
  on conflict(dataset,id)do update set ${FIELDS.filter((k) => !["dataset", "id"].includes(k))
    .map((k) => k + "=excluded." + k)
    .join(",")} returning id)
  select jsonb_build_object('written',(select count(*)from written),'guard_passed',${guard},'source_checks',(select to_jsonb(c)from source_checks c))receipt;\n`,
    );
    await save(
      name + "-verify.sql",
      base +
        `,
  actual as materialized(select ${rowFields("r")} from public.corpus_records r where r.dataset=${esc(s.id)} and ((r.ordinal>${b.lower} and  r.ordinal<=${b.upper})or exists(select 1 from expected e where e.id=r.id))),
  differences as(select count(e.id)expected_records,count(a.id)actual_records,count(*)filter(where a.id is null)missing,count(*)filter(where e.id is null)unexpected,
  count(*)filter(where e.id is not null and a.id is not null and row(${rowFields("e")})is distinct from row(${rowFields("a")}))mismatched from expected e full join actual a using(dataset,id)),
  expected_hash as(select ${combinedHash("e")}signature from expected e),actual_hash as(select ${combinedHash("a")}signature from actual a),
  canonical as(select count(*)filter(where corpus_ingest.canonical_integer_jsonb_sha256_v1(p.data)is distinct from p.payload_sha256 or e.data is distinct from p.data)payload_mismatches from page p left join corpus_ingest.entities e using(source_system,entity_type,native_id)),
  receipts as(insert into corpus_ingest.projection_slice_checks_v2(${ledgerCols})
  select ${esc(version)},${esc(plan)},${esc(args.run)}::uuid,${esc(s.id)},${b.lower},${b.upper},${esc(b.signature)},${b.records},d.actual_records,eh.signature,ah.signature,d.missing,d.unexpected,d.mismatched,c.payload_mismatches,0,
  coalesce((${guard})and d.expected_records=${b.records} and  d.actual_records=${b.records} and  d.missing=0 and d.unexpected=0 and d.mismatched=0 and c.payload_mismatches=0 and eh.signature=ah.signature,false)
  from differences d cross join expected_hash eh cross join actual_hash ah cross join canonical c returning *)
  select * from receipts;\n`,
    );
  }
  const b = {
    lower: 0,
    upper: s.records,
    records: s.records,
    first: s.first,
    last: s.last,
    signature: s.signature,
    observation_signature: s.observation_signature,
    provenance_signature: s.provenance_signature,
  };
  // Use the light source-only CTE prefix, not all record payloads.
  const prefix = head(s, b).split(",page as materialized")[0];
  const ranges = s.slices
    .map((x) => `(${x.lower}::bigint,${x.upper}::bigint,${x.records}::bigint,${esc(x.signature)})`)
    .join(",\n");
  await save(
    s.type + "-publish.sql",
    prefix +
      `,
  planned(lower_ordinal,upper_ordinal,expected_records,source_signature)as(values ${ranges}),
  latest as materialized(select distinct on(lower_ordinal,upper_ordinal)c.* from corpus_ingest.projection_slice_checks_v2 c where c.plan_sha256=${esc(plan)} and c.projection_schema=${esc(version)} and c.run_id=${esc(args.run)}::uuid and c.dataset=${esc(s.id)} order by lower_ordinal,upper_ordinal,check_id desc),
  hashes as(select p.lower_ordinal,p.upper_ordinal,count(r.id)records,${combinedHash("r")}signature from planned p left join lateral(select ${rowFields("x")} from public.corpus_records x where x.dataset=${esc(s.id)} and  x.ordinal>p.lower_ordinal and x.ordinal<=p.upper_ordinal)r on true group by p.lower_ordinal,p.upper_ordinal),
  intervals as(select *,lag(upper_ordinal,1,0::bigint)over(order by lower_ordinal)previous_upper from planned),
  proof as(select bool_and(coalesce(c.verified and c.source_expected_signature=p.source_signature and c.expected_records=p.expected_records and h.records=p.expected_records and h.signature=c.expected_fullfield_signature,false))valid,count(c.check_id)receipts from planned p left join latest c using(lower_ordinal,upper_ordinal)left join hashes h using(lower_ordinal,upper_ordinal)),
  totals as(select count(*)records,count(distinct id)unique_ids,count(distinct ordinal)unique_ordinals,min(ordinal)first_ordinal,max(ordinal)last_ordinal,count(*)filter(where category is distinct from ${esc(s.category)} or  state is not null or county_geoids is distinct from '{}'::text[])invalid_metadata from public.corpus_records where dataset=${esc(s.id)}),
  private_source as(select count(*)records,${hashSql("string_agg(e.native_id||':'||e.payload_sha256,E'\\n'order by e.native_id collate \"C\")")}signature from corpus_ingest.entities e where e.source_system='openfda'and e.entity_type=${esc(s.type)} and  e.last_run=${esc(args.run)}::uuid and e.schema_version=${esc(s.schema)} and  e.review_status<>'quarantined'),
  ready as(select coalesce((select records=${s.records} and  signature=${esc(s.signature)} and  observation_signature=${esc(s.observation_signature)} and provenance_signature=${esc(s.provenance_signature)} and  identity_mismatches=0 and observation_column_mismatches=0 from source_checks)
  and t.records=${s.records} and  t.unique_ids=${s.records} and  t.unique_ordinals=${s.records} and  t.first_ordinal=1 and t.last_ordinal=${s.records} and  t.invalid_metadata=0 and p.valid and p.receipts=${s.slices.length}
  and(select min(lower_ordinal)=0 and max(upper_ordinal)=${s.records} and  bool_and(lower_ordinal=previous_upper)from intervals)
  and ps.records=${s.private_records} and  ps.signature=${esc(s.private_signature)}
  and exists(select 1 from public.corpus_datasets d where d.id=${esc(s.id)} and  d.expected_records=${s.records} and d.label=${esc(s.label)} and d.metadata=${esc(JSON.stringify(metadata))}::jsonb),false)valid,t.records from totals t cross join proof p cross join private_source ps)
  update public.corpus_datasets d set ready=r.valid,imported_records=r.records,updated_at=now()from ready r where d.id=${esc(s.id)}returning d.id,d.ready,d.expected_records,d.imported_records;\n`,
  );
}
await save(
  "manifest.json",
  JSON.stringify(
    { ...pin, plan_sha256: plan, slices: allSlices, files, database_executed: false },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    output,
    plan_sha256: plan,
    public_eligible_records: scopes.reduce((n, s) => n + s.records, 0),
    project_verify_pairs: allSlices.length,
    database_executed: false,
  }),
);
