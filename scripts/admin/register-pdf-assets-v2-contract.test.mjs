// Offline contract test for database/contracts/corpus-register-pdf-assets-v2.sql (release pdf-observation-privacy-label).
// Owner decision 2026-10-27: "dont withhold any data. If its accurate and valuable, USE IT". New PDF observations record the
// live availability rule instead of the caution quarantine; everything else in the registration RPC stays byte for byte.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

const read = (name) => fs.readFile(new URL(`../../database/contracts/${name}`, import.meta.url), 'utf8').then((t) => t.replace(/\r\n/g, '\n'));
// pg_get_functiondef text: from CREATE OR REPLACE to "end $function$", plus the trailing newline Postgres prints.
function functionDef(sql) {
  const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.corpus_admin_register_pdf_assets_v1(p_rows jsonb)');
  assert.ok(start >= 0, 'function header present');
  const end = sql.indexOf('end $function$', start);
  assert.ok(end > start, 'function end present');
  return sql.slice(start, end + 'end $function$'.length) + '\n';
}
const LIVE_V1_MD5 = 'beaf86b57d3ffadee3f029bbe93b7fb6'; // md5(pg_get_functiondef(...)) read-only on 2026-10-27
const LABEL_START = /^  (?:-- Replay guard|stored_observation:=row\|\|jsonb_build_object\('source_privacy_qualification')/;
const LABEL_END = /^  observation_digest:=/;
function withoutLabel(lines) {
  const s = lines.findIndex((l) => LABEL_START.test(l)), e = lines.findIndex((l) => LABEL_END.test(l));
  assert.ok(s > 0 && e > s, 'label block located');
  return { outside: [...lines.slice(0, s), ...lines.slice(e)], label: lines.slice(s, e) };
}
function v1LabelExpression(text) {
  const m = text.match(/:=row\|\|jsonb_build_object\('source_privacy_qualification',jsonb_build_object\(\n   'source_seal_status'[\s\S]*?'public_projection_allowed',false\)\);/);
  assert.ok(m, 'v1 label expression present');
  return m[0].replace(/^:=/, '');
}

test('rollback is the live v1 definition verbatim', async () => {
  const def = functionDef(await read('corpus-register-pdf-assets-v2.rollback.sql'));
  assert.equal(createHash('md5').update(def, 'utf8').digest('hex'), LIVE_V1_MD5);
  assert.match(def, /'public_projection_allowed',false\)\);/);
});

test('v2 changes only the declare line and the observation label block', async () => {
  const v1 = functionDef(await read('corpus-register-pdf-assets-v2.rollback.sql')).split('\n');
  const v2 = functionDef(await read('corpus-register-pdf-assets-v2.sql')).split('\n');
  const a = withoutLabel(v1).outside, b = withoutLabel(v2).outside;
  assert.equal(a.length, b.length);
  const differing = a.map((line, i) => (line === b[i] ? null : i)).filter((i) => i !== null);
  assert.equal(differing.length, 1, 'only one line outside the label block differs');
  assert.match(a[differing[0]], /^declare row jsonb;/);
  assert.equal(b[differing[0]], a[differing[0]] + ' legacy_observation jsonb; pdf_availability text;');
  for (const fixed of [' SECURITY DEFINER', " SET search_path TO ''", " return jsonb_build_object('received',n,'private_only',true,'bucket','corpus-originals');"]) assert.ok(v2.includes(fixed), fixed);
});

test('new observations record the live availability rule, never a caution quarantine', async () => {
  const v2 = functionDef(await read('corpus-register-pdf-assets-v2.sql'));
  const stored = v2.match(/  stored_observation:=row\|\|jsonb_build_object\('source_privacy_qualification'[\s\S]*?\n  observation_digest:=/)[0];
  assert.match(v2, /pdf_availability:=public\.corpus_pdf_availability_v1\(asset_row\.source_system,asset_row\.provider_flags\);/);
  assert.match(stored, /'rule','corpus_pdf_availability_v2'/);
  assert.match(stored, /'availability',pdf_availability/);
  assert.match(stored, /'public_projection_allowed',pdf_availability='open'/);
  assert.doesNotMatch(stored, /private_quarantine_required/);
  assert.doesNotMatch(stored, /'public_projection_allowed',false/);
  // The seal status stays descriptive (what the source reported), copied from the unchanged v1 expression.
  assert.match(stored, /'source_seal_status',legacy_observation->'source_privacy_qualification'->'source_seal_status'/);
});

test('hold_basis names only explicit hold flags of the availability rule', async () => {
  const v2 = functionDef(await read('corpus-register-pdf-assets-v2.sql'));
  const availability = await read('corpus-pdf-availability-v2.sql');
  const keys = v2.match(/unnest\(array\[([^\]]+)\]\) with ordinality/)[1].split(',').map((k) => k.replace(/'/g, ''));
  assert.deepEqual(keys, ['withheld_by_policy', 'is_sealed', 'restricted', 'sealing_related_locator_held']);
  for (const key of keys) assert.ok(availability.includes(`'${key}'`), `${key} is a hold flag of corpus_pdf_availability_v2`);
  assert.match(v2, /'hold_basis',case when pdf_availability='open' then null/);
  assert.match(v2, /,'source_system_not_listed'\) end\)\);/);
});

test('replay guard recomputes the exact v1 observation digest, so a replayed receipt is not observed twice', async () => {
  const v1 = functionDef(await read('corpus-register-pdf-assets-v2.rollback.sql'));
  const v2 = functionDef(await read('corpus-register-pdf-assets-v2.sql'));
  const legacy = v2.match(/  legacy_observation:=([\s\S]*?'public_projection_allowed',false\)\);)/);
  assert.ok(legacy, 'legacy label present');
  assert.equal(legacy[1], v1LabelExpression(v1), 'legacy label expression is the v1 expression verbatim');
  assert.match(v2, /if exists\(select 1 from corpus_ingest\.pdf_asset_observations where observation_sha256=encode\(extensions\.digest\(convert_to\(legacy_observation::text,'UTF8'\),'sha256'\),'hex'\)\) then n:=n\+1; continue; end if;/);
  // The guard runs after every validation and the immutable association checks, before the new observation is built.
  assert.ok(v2.indexOf('Immutable native PDF association conflict') < v2.indexOf('legacy_observation:='));
  assert.ok(v2.indexOf('if exists(select 1 from corpus_ingest.pdf_asset_observations') < v2.indexOf('pdf_availability:='));
});

test('grants stay service_role only', async () => {
  for (const name of ['corpus-register-pdf-assets-v2.sql', 'corpus-register-pdf-assets-v2.rollback.sql']) {
    const sql = await read(name);
    assert.match(sql, /revoke all on function public\.corpus_admin_register_pdf_assets_v1\(jsonb\) from public, anon, authenticated;/);
    assert.match(sql, /grant execute on function public\.corpus_admin_register_pdf_assets_v1\(jsonb\) to service_role;/);
    assert.doesNotMatch(sql, /grant[^;]*\b(anon|authenticated)\b/i);
  }
});
