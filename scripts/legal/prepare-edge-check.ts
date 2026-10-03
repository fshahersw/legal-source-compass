import fs from "node:fs";
import { legalEdge } from "../../src/lib/legal/schema.ts";
const packet = JSON.parse(fs.readFileSync(new URL("../../src/lib/legal/mdl2738.server.json", import.meta.url), "utf8"));
const edge = packet.edges[0];
const patches = [{}, { type: "unknown" }, { confidence: -1 }, { confidence: 1.01 }, { confidence: null }, { date: "2025-02-29" },
  { source_url: "https://user:password@example.com/" }, { evidence: { start: 1.5, end: 3 } }, { evidence: { start: 0, end: 3 } },
  { evidence: { paragraph_id: "known", extra: true } }, { evidence: {} }, { role: "PSC" }, { treatment: "follows" },
  { review_status: "imagined" }, { extraction_method: "unknown" }, { from: edge.to }, { from: { ...edge.from, extra: true } },
  { to: { ...edge.to, type: "opinion" } }, { from: { ...edge.from, type: "imagined" } }, { type: "same_as" }, { extra: true },
  { source_record: { ...edge.source_record, id_authority: "invented" } }];
const cases = patches.map((patch, n) => { const value = { ...edge, ...patch }; return { n, value, valid: legalEdge.safeParse(value).success }; });
const json = JSON.stringify(cases);
const low = { ...edge, extraction_method: "llm", confidence: .79, review_status: "approved" };
const missing = { ...edge, evidence: { paragraph_id: "not-a-retained-paragraph" } };
const lowJson = JSON.stringify(low), missingJson = JSON.stringify(missing);
const sql = `begin;
do $test$
declare item jsonb; result jsonb; run uuid; failures integer:=0;
begin
  for item in select value from jsonb_array_elements($vectors$${json}$vectors$::jsonb) loop
    if (cardinality(legal_atlas.edge_errors(item->'value'))=0) is distinct from (item->>'valid')::boolean then raise exception 'Edge validator disagreement at case %',item->>'n'; end if;
  end loop;
  select run_id into run from legal_atlas.ingest_runs limit 1;
  result:=public.corpus_legal_edges_v3(run,jsonb_build_array(jsonb_build_object('edge_key',repeat('0',63)||'1','payload',$low$${lowJson}$low$::jsonb),jsonb_build_object('edge_key',repeat('0',63)||'2','payload',$missing$${missingJson}$missing$::jsonb)));
  if (result->>'received')::integer<>2 or (result->>'resolved')::integer<>1 then raise exception 'Evidence intake boundary failed: %',result; end if;
  if not exists(select 1 from legal_atlas.edges where edge_key=repeat('0',63)||'1' and review_status='pending') then raise exception 'Intake accepted source approval'; end if;
  update legal_atlas.edges set review_status='approved' where edge_key=repeat('0',63)||'1';
  if exists(select 1 from legal_atlas.visible_edges where edge_key=repeat('0',63)||'1') then raise exception 'Low confidence LLM evidence became visible'; end if;
  if has_function_privilege('anon','public.corpus_legal_edges_v3(uuid,jsonb)','execute') or has_function_privilege('authenticated','public.corpus_legal_edges_v3(uuid,jsonb)','execute') then raise exception 'Administrative intake privilege leak'; end if;
end;
$test$;
rollback;
select ${cases.length} as edge_boundary_cases, true as evidence_gating_passed, true as no_test_rows_retained;
`;
fs.writeFileSync(process.argv[2]!, sql);
console.log(JSON.stringify({ cases: cases.length, output: process.argv[2] }));
