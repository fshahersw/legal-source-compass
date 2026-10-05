import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const candidatePath = path.join(root, 'private/audit-2026-10-05/storage-hash-duplicate-candidates.json');
const fullQueryPath = path.join(root, 'private/audit-2026-10-05/storage-reconcile-complete-query.sql');
const bundleManifestPath = path.join(root, 'src/lib/private-data/manifest.server.json');
const archiveEvidencePath = path.join(root, 'private/audit-2026-10-05/legal-archive-chunk-refs.json');
const outputPath = path.join(root, 'private/audit-2026-10-05/storage-duplicate-reference-compact.sql');

async function main() {
const candidateReport = JSON.parse(await fs.readFile(candidatePath, 'utf8'));
if (!Array.isArray(candidateReport.groups) || candidateReport.groups.length !== 30) throw new Error('EXPECTED_30_DUPLICATE_GROUPS');
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const candidates = [];
const byKey = new Map();
for (const group of candidateReport.groups) {
  if (group.bucket_id !== 'corpus-originals' || !/^[a-f0-9]{64}$/.test(group.path_sha256)
    || group.distinct_key_count !== 2 || group.min_declared_bytes !== group.max_declared_bytes) throw new Error('INVALID_DUPLICATE_GROUP');
  for (const [key, bytes] of group.keys_and_declared_bytes) {
    if (typeof key !== 'string' || !Number.isSafeInteger(bytes) || bytes !== group.max_declared_bytes) throw new Error('INVALID_CANDIDATE_KEY');
    const row = { group_sha256: group.path_sha256, object_key: key, declared_bytes: bytes };
    candidates.push(row);
    byKey.set(key, row);
  }
}
if (candidates.length !== 60 || byKey.size !== 60) throw new Error('EXPECTED_60_UNIQUE_CANDIDATE_KEYS');

const privateRefs = [];
const bundle = JSON.parse(await fs.readFile(bundleManifestPath, 'utf8'));
if (bundle.project_id !== 'xosqzzsnhxcyehcnirpa' || bundle.bucket !== 'corpus-originals' || !bundle.files) throw new Error('BUNDLE_MANIFEST_SCOPE_MISMATCH');
for (const [name, row] of Object.entries(bundle.files)) {
  const candidate = byKey.get(row.storage_key);
  if (!candidate) continue;
  privateRefs.push({ ref_kind: 'private_bundle_manifest', bucket_id: bundle.bucket, object_key: row.storage_key, expected_sha256: row.sha256, expected_bytes: row.bytes, source_id: name });
}

const archiveEvidence = JSON.parse(await fs.readFile(archiveEvidencePath, 'utf8'));
if (archiveEvidence.target_project !== 'xosqzzsnhxcyehcnirpa' || archiveEvidence.target_bucket !== 'corpus-originals'
  || !Array.isArray(archiveEvidence.chunk_references)) throw new Error('ARCHIVE_EVIDENCE_SCOPE_MISMATCH');
for (const row of archiveEvidence.chunk_references) {
  const candidate = byKey.get(row.object_key);
  if (!candidate) continue;
  privateRefs.push({ ref_kind: 'legal_archive_chunk_manifest', bucket_id: 'corpus-originals', object_key: row.object_key, expected_sha256: row.sha256, expected_bytes: row.bytes, source_id: row.archive_manifest_key });
}

const fullQuery = await fs.readFile(fullQueryPath, 'utf8');
const preserveStart = fullQuery.indexOf('), preservation_object_refs(ref_kind, bucket_id, object_key, sha256, bytes) AS (');
const preserveEnd = fullQuery.indexOf('), refs(ref_kind, bucket_id, object_key, expected_sha256, expected_bytes) AS (', preserveStart);
if (preserveStart < 0 || preserveEnd < 0) throw new Error('PRESERVATION_LEDGER_CTE_NOT_FOUND');
const preserveValues = fullQuery.slice(preserveStart, preserveEnd);
const tuplePattern = /\('([^']+)','([^']+)','([^']+)','([^']+)',([0-9]+)\)/g;
for (const match of preserveValues.matchAll(tuplePattern)) {
  const [, ref_kind, bucket_id, object_key, expected_sha256, expected_bytes] = match;
  if (!byKey.has(object_key)) continue;
  privateRefs.push({ ref_kind, bucket_id, object_key, expected_sha256, expected_bytes: Number(expected_bytes), source_id: 'validated-private-preservation-ledger' });
}

const uniquePrivate = new Map();
for (const row of privateRefs) {
  if (row.bucket_id !== 'corpus-originals' || !/^[a-f0-9]{64}$/.test(row.expected_sha256 ?? '')
    || !Number.isSafeInteger(row.expected_bytes) || row.expected_bytes <= 0) throw new Error('INVALID_MATCHED_PRIVATE_REFERENCE');
  const key = [row.ref_kind, row.object_key, row.expected_sha256, row.expected_bytes, row.source_id].join('|');
  uniquePrivate.set(key, row);
}

const candidateValues = candidates.map(row => `    (${quote(row.group_sha256)},${quote(row.object_key)},${row.declared_bytes})`).join(',\n');
const privateValues = [...uniquePrivate.values()].map(row =>
  `    (${quote(row.ref_kind)},${quote(row.bucket_id)},${quote(row.object_key)},${quote(row.expected_sha256)},${row.expected_bytes},${quote(row.source_id)})`).join(',\n');

const sql = `-- READ-ONLY exact reference details for the 60 hash-verified candidate keys.
-- Private bundle/archive/preservation values are filtered locally to these candidate keys only.
-- This proves registered references in listed database tables and supplied private ledgers; it cannot prove absence of opaque external clients.
WITH candidate_keys(group_sha256, object_key, declared_bytes) AS (
  VALUES
${candidateValues}
), private_known_refs(ref_kind, bucket_id, object_key, expected_sha256, expected_bytes, source_id) AS (
  ${privateValues ? `VALUES\n${privateValues}` : "SELECT NULL::text,NULL::text,NULL::text,NULL::text,NULL::bigint,NULL::text WHERE false"}
), refs(ref_kind, bucket_id, object_key, expected_sha256, expected_bytes, source_id) AS (
  SELECT 'pdf_objects', p.bucket, p.storage_key, p.sha256, p.bytes::bigint, p.sha256
  FROM corpus_ingest.pdf_objects p
  UNION ALL
  SELECT 'corpus_artifacts', 'corpus-originals', a.object_key, a.sha256, a.bytes::bigint, a.route
  FROM public.corpus_artifacts a
  UNION ALL
  SELECT 'pdf_backfill_capture', 'corpus-originals', c.capture_storage_key, c.capture_sha256, c.capture_bytes::bigint, c.source_system
  FROM corpus_ingest.pdf_backfill_captures c
  UNION ALL
  SELECT 'pdf_backfill_metadata', 'corpus-originals', c.metadata_storage_key, c.metadata_sha256, c.metadata_bytes::bigint, c.source_system
  FROM corpus_ingest.pdf_backfill_captures c
  UNION ALL
  SELECT 'pdf_asset_observation', 'corpus-originals', o.observation->>'storage_key', o.observation->>'sha256',
         CASE WHEN o.observation->>'bytes' ~ '^[0-9]+$' THEN (o.observation->>'bytes')::bigint END, o.observation->>'source'
  FROM corpus_ingest.pdf_asset_observations o
  WHERE nullif(o.observation->>'storage_key','') IS NOT NULL
  UNION ALL
  SELECT 'local_pdf_expected_occurrence', 'corpus-originals', e.occurrence->>'intended_storage_key', e.occurrence->>'pdf_sha256',
         CASE WHEN e.occurrence->>'pdf_bytes' ~ '^[0-9]+$' THEN (e.occurrence->>'pdf_bytes')::bigint END, e.local_occurrence_id
  FROM corpus_ingest.local_pdf_asset_expected_occurrences e
  WHERE nullif(e.occurrence->>'intended_storage_key','') IS NOT NULL
  UNION ALL
  SELECT 'local_pdf_cloud_verification', 'corpus-originals', o.cloud_verification->>'storage_key', o.cloud_verification->>'sha256',
         CASE WHEN o.cloud_verification->>'bytes' ~ '^[0-9]+$' THEN (o.cloud_verification->>'bytes')::bigint END, o.local_occurrence_id
  FROM corpus_ingest.local_pdf_asset_observations o
  WHERE nullif(o.cloud_verification->>'storage_key','') IS NOT NULL
  UNION ALL
  SELECT 'legal_archive_manifest', a.bucket, a.manifest_key, a.manifest_sha256, NULL::bigint, a.sha256
  FROM legal_atlas.original_archives a
  UNION ALL
  SELECT 'legal_record_image_object_key', 'corpus-originals', r.payload->'attributes'->>'object_key', NULL::text, NULL::bigint, r.id
  FROM legal_atlas.records r
  WHERE r.type::text='image' AND nullif(r.payload->'attributes'->>'object_key','') IS NOT NULL
  UNION ALL
  SELECT 'legal_staging_candidate_object_key', 'corpus-originals', attrs.value->>'object_key', NULL::text, NULL::bigint, s.input_key
  FROM legal_atlas.staging s
  CROSS JOIN LATERAL jsonb_path_query(s.candidate_records, '$[*] ? (@.type == "image").attributes') attrs(value)
  WHERE nullif(attrs.value->>'object_key','') IS NOT NULL
  UNION ALL
  SELECT 'legal_staging_source_object_key', 'corpus-originals', attrs.value->>'object_key', NULL::text, NULL::bigint, s.input_key
  FROM legal_atlas.staging s
  CROSS JOIN LATERAL jsonb_path_query(s.source_record, '$ ? (@.type == "image").attributes') attrs(value)
  WHERE nullif(attrs.value->>'object_key','') IS NOT NULL
  UNION ALL
  SELECT 'legal_mdl_packet_image_object_key', 'corpus-originals', attrs.value->>'object_key', NULL::text, NULL::bigint, p.mdl_id
  FROM legal_atlas.mdl_packets p
  CROSS JOIN LATERAL jsonb_path_query(p.packet, '$.records[*] ? (@.type == "image").attributes') attrs(value)
  WHERE nullif(attrs.value->>'object_key','') IS NOT NULL
  UNION ALL
  SELECT r.ref_kind, r.bucket_id, r.object_key, r.expected_sha256, r.expected_bytes, r.source_id
  FROM private_known_refs r
), matched_refs AS (
  SELECT c.group_sha256, c.object_key, r.ref_kind, r.expected_sha256, r.expected_bytes, r.source_id,
         o.id IS NOT NULL AS storage_object_present,
         CASE WHEN o.metadata->>'size' ~ '^[0-9]+$' THEN (o.metadata->>'size')::bigint END AS stored_bytes
  FROM candidate_keys c
  LEFT JOIN refs r ON r.bucket_id='corpus-originals' AND r.object_key=c.object_key
  LEFT JOIN storage.objects o ON o.bucket_id='corpus-originals' AND o.name=c.object_key
)
SELECT jsonb_build_object(
  'candidate_groups', (SELECT count(DISTINCT group_sha256) FROM candidate_keys),
  'candidate_keys', (SELECT count(*) FROM candidate_keys),
  'matched_registered_reference_rows', (SELECT count(*) FROM matched_refs WHERE ref_kind IS NOT NULL),
  'groups', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'sha256', g.group_sha256,
      'keys', (
        SELECT jsonb_agg(jsonb_build_object(
          'object_key', c.object_key,
          'declared_bytes', c.declared_bytes,
          'stored_bytes', (SELECT max(m.stored_bytes) FROM matched_refs m WHERE m.object_key=c.object_key),
          'storage_object_present', EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='corpus-originals' AND o.name=c.object_key),
          'references', coalesce((
            SELECT jsonb_agg(jsonb_build_object('ref_kind',m.ref_kind,'expected_sha256',m.expected_sha256,
              'expected_bytes',m.expected_bytes,'source_id',m.source_id,'storage_object_present',m.storage_object_present,'stored_bytes',m.stored_bytes)
              ORDER BY m.ref_kind,m.source_id)
            FROM matched_refs m WHERE m.group_sha256=c.group_sha256 AND m.object_key=c.object_key AND m.ref_kind IS NOT NULL
          ), '[]'::jsonb)
        ) ORDER BY c.object_key)
        FROM candidate_keys c WHERE c.group_sha256=g.group_sha256
      )
    ) ORDER BY g.group_sha256)
    FROM (SELECT DISTINCT group_sha256 FROM candidate_keys) g
  ), '[]'::jsonb),
  'corpus_artifact_rows', coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.object_key) FROM public.corpus_artifacts a WHERE EXISTS (SELECT 1 FROM candidate_keys c WHERE c.object_key=a.object_key)), '[]'::jsonb),
  'pdf_object_rows', coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.sha256) FROM corpus_ingest.pdf_objects p WHERE EXISTS (SELECT 1 FROM candidate_keys c WHERE c.object_key=p.storage_key)), '[]'::jsonb),
  'corpus_artifacts_constraints', coalesce((SELECT jsonb_agg(jsonb_build_object('name',c.conname,'definition',pg_get_constraintdef(c.oid,true)) ORDER BY c.conname) FROM pg_constraint c WHERE c.conrelid='public.corpus_artifacts'::regclass), '[]'::jsonb),
  'corpus_artifacts_triggers', coalesce((SELECT jsonb_agg(jsonb_build_object('name',t.tgname,'definition',pg_get_triggerdef(t.oid,true)) ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgrelid='public.corpus_artifacts'::regclass AND NOT t.tgisinternal), '[]'::jsonb),
  'pdf_objects_constraints', coalesce((SELECT jsonb_agg(jsonb_build_object('name',c.conname,'definition',pg_get_constraintdef(c.oid,true)) ORDER BY c.conname) FROM pg_constraint c WHERE c.conrelid='corpus_ingest.pdf_objects'::regclass), '[]'::jsonb),
  'pdf_objects_triggers', coalesce((SELECT jsonb_agg(jsonb_build_object('name',t.tgname,'definition',pg_get_triggerdef(t.oid,true)) ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgrelid='corpus_ingest.pdf_objects'::regclass AND NOT t.tgisinternal), '[]'::jsonb),
  'storage_reference_named_columns', coalesce((
    SELECT jsonb_agg(jsonb_build_object('schema',c.table_schema,'table',c.table_name,'column',c.column_name,'data_type',c.data_type)
      ORDER BY c.table_schema,c.table_name,c.ordinal_position)
    FROM information_schema.columns c
    WHERE c.table_schema IN ('public','corpus_ingest','legal_atlas')
      AND c.column_name ~* '(object|storage|manifest|capture|bucket).*(key|path)|(key|path).*(object|storage|manifest|capture|bucket)'
  ), '[]'::jsonb)
) AS duplicate_reference_compact_report;
`;

await fs.writeFile(outputPath, sql);
console.log(JSON.stringify({ output: outputPath, bytes: Buffer.byteLength(sql), candidate_groups: candidateReport.groups.length,
  candidate_keys: candidates.length, private_ledger_matches: uniquePrivate.size, private_ledger_kinds: [...new Set([...uniquePrivate.values()].map(row => row.ref_kind))].sort() }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
