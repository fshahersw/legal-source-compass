// Isolated PostgreSQL fixtures. No credentials, network, or corpus writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const runtime = process.env.PUBLISHER_CODE_PGLITE ?? path.resolve('private/tools/publisher-code-contract-tests/node_modules/@electric-sql/pglite/dist/index.js');
const { PGlite } = await import(pathToFileURL(runtime).href);
const contract = await fs.readFile(new URL('../../../database/contracts/corpus-publisher-code-projection-v4-outline.sql', import.meta.url), 'utf8');
const v3Contract = await fs.readFile(new URL('../../../database/contracts/corpus-publisher-code-projection-v3-outline.sql', import.meta.url), 'utf8');
const code = { level: 'code', number: 'PEN', node_id: 'CA:PEN', heading: 'Penal Code' };
const first = { level: 'heading', number: null, node_id: 'CA:PEN:2', heading: 'First publisher branch' };
const second = { level: 'heading', number: null, node_id: 'CA:PEN:3', heading: 'Second publisher branch' };
const part = { level: 'part', number: '3', node_id: 'CA:PEN:6', heading: 'Part 3' };
const title = { level: 'title', number: '4', node_id: 'CA:PEN:6.7', heading: 'Title 4' };
const step = ({ level, number, node_id }) => ({ level, number, ...(node_id ? { node_id } : {}) });

async function fixture() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema corpus_ingest;
    create table corpus_ingest.entities (source_system text, entity_type text, native_id text, data jsonb, review_status text, schema_version text);
    create table corpus_ingest.publisher_code_states_v2 (jurisdiction text, public_projection_allowed boolean, review_status text, source_system text, manifest jsonb);
    create function corpus_ingest.publisher_code_projected_gate_v2(p_jurisdiction text)
      returns table (jurisdiction text, source_system text, manifest jsonb)
      language sql stable security definer set search_path='' as $$
      select s.jurisdiction,s.source_system,s.manifest from corpus_ingest.publisher_code_states_v2 s
      where s.jurisdiction=p_jurisdiction and s.public_projection_allowed and s.review_status='reviewed'; $$;
    create function corpus_ingest.publisher_code_path_matches_v2(p_hierarchy jsonb,p_path jsonb)
      returns boolean language sql immutable set search_path='' as $$
      select jsonb_array_length(p_hierarchy)>=jsonb_array_length(p_path) and not exists (
        select 1 from jsonb_array_elements(p_path) with ordinality t(elem,ord)
        where p_hierarchy->(t.ord::integer-1)->>'level' is distinct from t.elem->>'level'
           or p_hierarchy->(t.ord::integer-1)->>'number' is distinct from t.elem->>'number'); $$;
    insert into corpus_ingest.publisher_code_states_v2 values ('CA',false,'landed','ca-fixture','{"structure":{"levels":["code","division","title","part","chapter","article","heading","section"]}}');`);
  for (const [id, hierarchy, quarantined] of [
    ['CA:PEN:1', [code, first], false], ['CA:PEN:2', [code, second], false],
    ['CA:PEN:3', [code, part, title], false], ['CA:PEN:4', [code, first], true],
  ]) {
    await db.query('insert into corpus_ingest.entities values ($1,$2,$3,$4,$5,$6)', [
      'ca-fixture','code-section',id,
      {citation:id,heading:'Section',hierarchy:[...hierarchy,{level:'section',number:id,heading:'Section'}],private_fixture_marker:'must-not-return'},
      quarantined ? 'quarantined' : 'pending','publisher-code-evidence/2',
    ]);
  }
  await db.exec(v3Contract);
  await db.exec(contract);
  return db;
}
async function outline(db, value) {
  return (await db.query('select public.corpus_publisher_code_projected_outline_v4($1,$2) as result',['CA',value])).rows[0].result;
}

test('native publisher node IDs keep identical printed paths distinct and do not expose held states', async () => {
  const db = await fixture();
  try {
    assert.deepEqual(await outline(db, []), {available:false});
    await db.exec("update corpus_ingest.publisher_code_states_v2 set public_projection_allowed=true,review_status='reviewed'");
    const groups = await outline(db,[step(code)]);
    assert.equal(groups.groups.length,3);
    assert.equal(groups.groups.find(g => g.node_id === first.node_id).count,1);
    assert.equal(groups.groups.find(g => g.node_id === second.node_id).count,1);
    const a = await outline(db,[step(code),step(first)]);
    const b = await outline(db,[step(code),step(second)]);
    assert.deepEqual(a.sections.map(s => s.native_id),['CA:PEN:1']);
    assert.deepEqual(b.sections.map(s => s.native_id),['CA:PEN:2']);
    assert.equal(JSON.stringify(a).includes('private_fixture_marker'),false);
    assert.equal((await outline(db,[step(code),{level:'heading',number:null}])).total,0);
    assert.equal((await outline(db,[step(first)])).total,0);
  } finally { await db.close(); }
});

test('source order permits part before title; reordered or forged identities never match', async () => {
  const db = await fixture();
  try {
    await db.exec("update corpus_ingest.publisher_code_states_v2 set public_projection_allowed=true,review_status='reviewed'");
    assert.deepEqual((await outline(db,[step(code),step(part),step(title)])).sections.map(s => s.native_id),['CA:PEN:3']);
    assert.equal((await outline(db,[step(code),step(title),step(part)])).total,0);
    assert.equal((await outline(db,[step(code),{...step(part),node_id:second.node_id}])).total,0);
    await assert.rejects(outline(db,[{level:'invented',number:'1'}]),/undeclared/);
    await assert.rejects(outline(db,[{level:'heading',number:null,node_id:12}]),/path entries/);
    await assert.rejects(outline(db,[{level:'section',number:'1'}]),/above the section/);
  } finally { await db.close(); }
});

test('legacy paths remain exact prefixes; service role only can read the projection', async () => {
  const db = await fixture();
  try {
    await db.exec("update corpus_ingest.publisher_code_states_v2 set public_projection_allowed=true,review_status='reviewed'; update corpus_ingest.entities set data=jsonb_set(data,'{hierarchy}','[{\"level\":\"title\",\"number\":\"1\",\"heading\":\"Title\"},{\"level\":\"section\",\"number\":\"1\"}]') where native_id='CA:PEN:1';");
    const legacy = await outline(db,[{level:'title',number:'1'}]);
    assert.equal(legacy.sections[0].native_id,'CA:PEN:1');
    await db.exec('set role anon');
    await assert.rejects(outline(db,[]),/permission denied/);
    await db.exec('reset role; set role service_role');
    assert.equal((await outline(db,[])).available,true);
  } finally { await db.close(); }
});

test('v4 and v3 give identical legacy results when declared optional levels are absent from source', async () => {
  const db = await fixture();
  try {
    const legacyPath = [
      {level:'title',number:'42'}, {level:'part',number:'VI'},
      {level:'chapter',number:'55'}, {level:'subchapter',number:'B'},
    ];
    const levels=['title','part','subpart','article','subarticle','chapter','subchapter','division','subdivision','schedule','section'];
    await db.query("update corpus_ingest.publisher_code_states_v2 set public_projection_allowed=true,review_status='reviewed',manifest=$1",[{structure:{levels}}]);
    await db.query("update corpus_ingest.entities set data=jsonb_set(data,'{hierarchy}',$1) where native_id='CA:PEN:1'",[[...legacyPath,{level:'section',number:'5524'}]]);
    for (const prefix of [legacyPath.slice(0,2),legacyPath]) {
      const old=(await db.query('select public.corpus_publisher_code_projected_outline_v3($1,$2) as result',['CA',prefix])).rows[0].result;
      const current=await outline(db,prefix);
      if (current.groups) current.groups=current.groups.map(({node_id,...group})=>group);
      assert.deepEqual(current,old);
    }
    assert.equal((await outline(db,legacyPath)).sections[0].native_id,'CA:PEN:1');
  } finally { await db.close(); }
});
