// Offline checks of database/contracts/corpus-counsel-contact-v1.sql (+ rollback): decision recorded, service_role only, explicit-evidence holds only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const read = (name) => fs.readFile(new URL(`../../database/contracts/${name}`, import.meta.url), 'utf8');
const strip = (sql) => sql.replace(/--[^\n]*/g, '');

test('the contract records the decision that lifts the 2026-10-03 counsel rule', async () => {
  const sql = await read('corpus-counsel-contact-v1.sql');
  assert.match(sql, /DECISION:/);
  assert.match(sql, /2026-10-03/);
  assert.match(sql, /2026-10-27/);
});

test('the function is security definer, has an empty search_path and is callable by service_role only', async () => {
  const sql = strip(await read('corpus-counsel-contact-v1.sql'));
  assert.match(sql, /create or replace function public\.corpus_counsel_contact_v1\(p_ids text\[\] default null, p_after text default null, p_limit integer default 500\)/);
  assert.match(sql, /stable security definer/);
  assert.match(sql, /set search_path to ''/);
  assert.match(sql, /revoke all on function public\.corpus_counsel_contact_v1\(text\[\], text, integer\) from public, anon, authenticated;/);
  assert.match(sql, /grant execute on function public\.corpus_counsel_contact_v1\(text\[\], text, integer\) to service_role;/);
  assert.doesNotMatch(sql, /grant[^;]*\b(anon|authenticated)\b/i);
  assert.doesNotMatch(sql, /\b(insert|update|delete|truncate)\b/i);
});

test('holds are limited to explicit source evidence and blank contact fields', async () => {
  const sql = strip(await read('corpus-counsel-contact-v1.sql'));
  const holds = [...sql.matchAll(/then '([a-z_]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(holds, ['blocked_docket', 'sealed_group_role']);
  assert.match(sql, /r\.role = '3'/); // CourtListener people_db Role 3 = Attorney in sealed group
  // blocked is stored as boolean true or the string 't': the registry's rule, plus date_blocked
  assert.match(sql, /lower\(coalesce\(b\.data->>'blocked', ''\)\) not in \('false', 'f', '0'\)/);
  assert.match(sql, /nullif\(b\.data->>'date_blocked', ''\) is not null/);
  assert.doesNotMatch(sql, /b\.data->>'blocked' = 'true'/);
  for (const field of ['contact_raw', 'email', 'phone', 'fax']) {
    assert.match(sql, new RegExp(`'${field}', case when y\\.hold is null then nullif\\(btrim\\(y\\.data->>'${field}'\\), ''\\) end`));
  }
  assert.doesNotMatch(sql, /seal\|restricted|EXCLUDE_RE|~\*/); // no keyword-based withholding
  assert.match(sql, /review_status <> 'quarantined'/);
});

test('the result carries source facts and a page cursor', async () => {
  const sql = strip(await read('corpus-counsel-contact-v1.sql'));
  for (const key of ['native_attorney_id', 'as_of', 'retrieved_at', 'payload_sha256', 'source_system', 'source_api_url', 'collected_docket_ids', 'contact_hold']) {
    assert.match(sql, new RegExp(`'${key}'`));
  }
  assert.match(sql, /least\(greatest\(coalesce\(p_limit, 500\), 1\), 1000\)/);
  assert.match(sql, /'next', case when n >= lim then last_id else null end/);
});

test('the rollback drops exactly the new function', async () => {
  const sql = strip(await read('corpus-counsel-contact-v1.rollback.sql')).trim();
  assert.equal(sql, 'drop function if exists public.corpus_counsel_contact_v1(text[], text, integer);');
});
