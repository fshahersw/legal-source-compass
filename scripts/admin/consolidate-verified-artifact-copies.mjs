// Pinned October 5 maintenance: retain every route, hold, canonical object and source ledger.
// Preparation is local only. Mapping SQL is reviewed/applied separately before API removal.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { rest } from '../ingest/members-pgrest.mjs';

const ROOT = 'private/audit-2026-10-05';
const PROJECT = 'xosqzzsnhxcyehcnirpa';
const BUCKET = 'corpus-originals';
const ISSUE = 'artifact_storage_alias_20261005';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const read = async file => JSON.parse(await fs.readFile(file, 'utf8'));

export function buildConsolidationPlan(report, recovery, runId) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(runId)) throw Error('INVALID_RUN_ID');
  if (report.candidate_groups !== 30 || report.candidate_keys !== 60 || report.groups?.length !== 30
    || recovery.target_project !== PROJECT || recovery.bucket !== BUCKET || !recovery.summary?.all_groups_verified)
    throw Error('AUDIT_SCOPE_MISMATCH');
  const objects = [], rows = [], retained = [];
  for (const group of report.groups) {
    const hash = group.sha256;
    if (!/^[a-f0-9]{64}$/.test(hash) || group.keys?.length !== 2) throw Error('INVALID_GROUP');
    const legacy = group.keys.find(k => k.object_key === `${hash.slice(0, 2)}/${hash}`);
    if (!legacy) { retained.push(hash); continue; }
    const target = group.keys.find(k => k !== legacy);
    const proof = recovery.groups?.find(g => g.sha256 === hash);
    if (!proof?.all_object_bodies_sha256_verified || !proof.byte_equal || proof.recovery_sha256 !== hash
      || proof.recovery_file !== `${hash}.bin`
      || ![legacy, target].every(k => k.storage_object_present && k.stored_bytes === proof.bytes
        && k.declared_bytes === proof.bytes && proof.verified_object_keys.includes(k.object_key))) throw Error('BODY_PROOF_MISMATCH');
    if (!legacy.references?.length || legacy.references.some(r => r.ref_kind !== 'corpus_artifacts'
      || r.expected_sha256 !== hash || r.expected_bytes !== proof.bytes)) throw Error('LEGACY_REFERENCE_NOT_MUTABLE_ARTIFACT');
    if (!target.references?.some(r => ['pdf_objects', 'private_bundle_manifest', 'seeger_full_matter_archive_file'].includes(r.ref_kind)
      && r.expected_sha256 === hash && r.expected_bytes === proof.bytes)) throw Error('CANONICAL_REFERENCE_MISSING');
    const artifacts = report.corpus_artifact_rows.filter(r => r.object_key === legacy.object_key);
    if (artifacts.length !== legacy.references.length || artifacts.some(r => r.sha256 !== hash || r.bytes !== proof.bytes)
      || legacy.references.some(r => !artifacts.some(a => a.route === r.source_id))) throw Error('ARTIFACT_SET_MISMATCH');
    objects.push({ sha256: hash, bytes: proof.bytes, old_key: legacy.object_key, retained_key: target.object_key, recovery_file: proof.recovery_file });
    rows.push(...artifacts.map(before => ({ before, after: { ...before, object_key: target.object_key } })));
  }
  if (objects.length !== 29 || rows.length !== 30 || retained.length !== 1
    || new Set(rows.map(r => r.before.route)).size !== 30) throw Error('EXPECTED_PINNED_29_OBJECTS_30_ROUTES');
  return { schema_version: 'verified-artifact-copy-consolidation/1', project: PROJECT, bucket: BUCKET,
    run_id: runId, issue: ISSUE, objects, rows, retained,
    redundant_bytes: objects.reduce((n, o) => n + o.bytes, 0) };
}

function mappingSql(plan, planHash) {
  return `-- Exact before-images and replacement equality; changes only artifact object_key.
begin;
set local statement_timeout='120s';
lock table public.corpus_artifacts in share row exclusive mode;
create temporary table artifact_copy_plan on commit drop as
select * from jsonb_to_recordset($plan$${JSON.stringify(plan.rows)}$plan$::jsonb) as p(before jsonb,after jsonb);
do $$ begin
 if (select count(*) from artifact_copy_plan)<>30 then raise exception 'Unexpected plan'; end if;
 if (select count(*) from artifact_copy_plan p join public.corpus_artifacts a on a.route=p.before->>'route'
 where to_jsonb(a)=p.before or to_jsonb(a)=p.after)<>30 then raise exception 'Artifact changed since review'; end if;
 if exists(select 1 from artifact_copy_plan p where not exists(select 1 from storage.objects o
 where o.bucket_id='${BUCKET}' and o.name=p.after->>'object_key' and (o.metadata->>'size')::bigint=(p.after->>'bytes')::bigint))
 then raise exception 'Retained object missing or wrong size'; end if;
end $$;
insert into corpus_ingest.runs(id,status,scope) values('${plan.run_id}','running',
jsonb_build_object('contract','verified-artifact-copy-consolidation/1','plan_sha256','${planHash}','routes',30,'objects',29)) on conflict(id) do nothing;
insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
select 'corpus_artifacts',before->>'route','${ISSUE}','canonical_alias',
'Retain route and readiness while sharing identical fully verified bytes with an existing preserved object.',
jsonb_build_object('plan_sha256','${planHash}','full_body_hash_verified',true),before,after,'${plan.run_id}'::uuid
from artifact_copy_plan on conflict(dataset,record_id,issue) do nothing;
do $$ begin
 if (select count(*) from artifact_copy_plan p join corpus_ingest.cleanup_decisions d
 on d.dataset='corpus_artifacts' and d.record_id=p.before->>'route' and d.issue='${ISSUE}'
 where d.original_record=p.before and d.replacement=p.after and d.run_id='${plan.run_id}')<>30
 then raise exception 'Before-image ledger conflict'; end if;
end $$;
update public.corpus_artifacts a set object_key=p.after->>'object_key'
from artifact_copy_plan p where a.route=p.before->>'route' and to_jsonb(a)=p.before;
do $$ begin
 if (select count(*) from artifact_copy_plan p join public.corpus_artifacts a on a.route=p.after->>'route' where to_jsonb(a)=p.after)<>30
 then raise exception 'Mapping readback failed'; end if;
end $$;
update corpus_ingest.runs set status='partial',counts=jsonb_build_object('artifact_routes_consolidated',30,'objects_removed',0)
where id='${plan.run_id}';
commit;
select jsonb_build_object('run_id','${plan.run_id}','routes_verified',count(*),'readiness_unchanged',bool_and(a.ready=(d.original_record->>'ready')::boolean)) as consolidation_result
from corpus_ingest.cleanup_decisions d join public.corpus_artifacts a on a.route=d.record_id
where d.dataset='corpus_artifacts' and d.issue='${ISSUE}' and d.run_id='${plan.run_id}' and to_jsonb(a)=d.replacement;
-- Recovery: restore only missing old objects from hash-verified recovery files first;
-- then update object_key from original_record only where the entire current row equals replacement.
`;
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map(a => {
    const i = a.indexOf('='); return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)];
  }));
  const planFile = `${ROOT}/artifact-copy-consolidation-plan.json`;
  if (args.prepare !== undefined) {
    const report = await read(`${ROOT}/storage-duplicate-reference-details.json`);
    // Browser accessibility can normalize whitespace inside JSON string cells.
    // Before-images therefore come directly from the typed REST representation.
    const exactRows = [];
    for (const observed of report.corpus_artifact_rows) {
      const current = (await rest(`corpus_artifacts?select=*&route=eq.${encodeURIComponent(observed.route)}`)).data;
      if (current.length !== 1) throw Error('ARTIFACT_NO_LONGER_UNIQUE');
      exactRows.push(current[0]);
    }
    report.corpus_artifact_rows = exactRows;
    const recovery = await read(`${ROOT}/duplicate-recovery/manifest.json`);
    const plan = buildConsolidationPlan(report, recovery, randomUUID());
    for (const o of plan.objects) {
      const body = await fs.readFile(`${ROOT}/duplicate-recovery/${o.recovery_file}`);
      if (sha(body) !== o.sha256 || body.length !== o.bytes) throw Error('RECOVERY_COPY_MISMATCH');
    }
    const bytes = JSON.stringify(plan, null, 2) + '\n';
    await fs.writeFile(`${ROOT}/storage-duplicate-reference-exact.json`, JSON.stringify(report, null, 2), { flag: 'wx' });
    await fs.writeFile(planFile, bytes, { flag: 'wx' });
    await fs.writeFile(`${ROOT}/artifact-copy-consolidation.sql`, mappingSql(plan, sha(bytes)), { flag: 'wx' });
    console.log(JSON.stringify({ prepared: true, run: plan.run_id, plan_sha256: sha(bytes), objects: plan.objects.length, routes: plan.rows.length, redundant_bytes: plan.redundant_bytes }));
    return;
  }
  const planBytes = await fs.readFile(planFile), plan = JSON.parse(planBytes);
  if (args['plan-sha256'] !== sha(planBytes) || plan.project !== PROJECT || plan.bucket !== BUCKET
    || plan.objects.length !== 29 || plan.rows.length !== 30) throw Error('EXACT_PLAN_HASH_REQUIRED');
  const original = buildConsolidationPlan(await read(`${ROOT}/storage-duplicate-reference-exact.json`), await read(`${ROOT}/duplicate-recovery/manifest.json`), plan.run_id);
  if (!isDeepStrictEqual(plan, original)) throw Error('PLAN_EVIDENCE_CHANGED');
  const post = await read(`${ROOT}/storage-duplicate-reference-after-mapping.json`);
  if (!Number.isFinite(Date.parse(post.observed_at)) || Math.abs(Date.now() - Date.parse(post.observed_at)) > 30 * 60_000) throw Error('FRESH_REFERENCE_READBACK_REQUIRED');
  for (const o of plan.objects) {
    const checked = post.groups?.find(g => g.sha256 === o.sha256)?.keys.find(k => k.object_key === o.old_key);
    if (!checked || checked.references.length !== 0) throw Error('LEGACY_KEY_STILL_REFERENCED');
    if ((await rest(`corpus_artifacts?select=route&object_key=eq.${encodeURIComponent(o.old_key)}`)).data.length) throw Error('ARTIFACT_STILL_REFERENCES_LEGACY');
    const backup = await fs.readFile(`${ROOT}/duplicate-recovery/${o.recovery_file}`);
    if (sha(backup) !== o.sha256 || backup.length !== o.bytes) throw Error('RECOVERY_COPY_MISMATCH');
  }
  for (const row of plan.rows) {
    const current = (await rest(`corpus_artifacts?select=*&route=eq.${encodeURIComponent(row.after.route)}`)).data;
    if (current.length !== 1 || !isDeepStrictEqual(current[0], row.after)) throw Error('LIVE_MAPPING_CHANGED');
  }
  const cfg = await read('C:/Users/firas/.codex/private/legal-source-compass.preview.json');
  if (cfg.EXTERNAL_SUPABASE_URL !== `https://${PROJECT}.supabase.co`) throw Error('WRONG_PROJECT');
  const client = createClient(cfg.EXTERNAL_SUPABASE_URL, cfg.EXTERNAL_SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const store = client.storage.from(BUCKET);
  const verify = async (key, o) => {
    const { data, error } = await store.download(key);
    if (error) throw Error(`STORAGE_READ_FAILED_${error.statusCode ?? 'unknown'}`);
    const body = Buffer.from(await data.arrayBuffer());
    if (body.length !== o.bytes || sha(body) !== o.sha256) throw Error('FRESH_CLOUD_HASH_MISMATCH');
  };
  for (const o of plan.objects) { await verify(o.retained_key, o); await verify(o.old_key, o); }
  if (args.execute === undefined) { console.log(JSON.stringify({ dry_run: true, objects: 29, routes: 30, redundant_bytes: plan.redundant_bytes })); return; }
  const receiptFile = `${ROOT}/artifact-copy-removal-receipt.json`;
  const receipt = { run_id: plan.run_id, plan_sha256: sha(planBytes), started_at: new Date().toISOString(), state: 'preflight_verified', objects: plan.objects };
  await fs.writeFile(receiptFile, JSON.stringify(receipt, null, 2), { flag: 'wx' });
  // Official Storage API removes bytes and storage metadata together; never DELETE storage.objects in SQL.
  const { data, error } = await store.remove(plan.objects.map(o => o.old_key));
  if (error) throw Error(`STORAGE_REMOVE_FAILED_${error.statusCode ?? 'unknown'}_INSPECT_RECEIPT`);
  receipt.state = 'api_acknowledged'; receipt.removed = data.map(x => ({ name: x.name, id: x.id }));
  await fs.writeFile(receiptFile, JSON.stringify(receipt, null, 2));
  if (data.length !== 29 || plan.objects.some(o => !data.some(x => x.name === o.old_key))) throw Error('REMOVE_ACK_SET_MISMATCH');
  for (const o of plan.objects) await verify(o.retained_key, o);
  receipt.state = 'removed_and_retained_bytes_verified'; receipt.finished_at = new Date().toISOString(); receipt.bytes_removed = plan.redundant_bytes;
  await fs.writeFile(receiptFile, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ state: receipt.state, objects_removed: 29, bytes_removed: receipt.bytes_removed, run: plan.run_id }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
