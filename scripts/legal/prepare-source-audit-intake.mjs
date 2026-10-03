import fs from 'node:fs';
const [reportFile, destination] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
if (report.required !== 50 || report.reviewed !== 50 || report.reviews.length !== 50 || !report.source_audit_passed || !/^[a-f0-9]{64}$/.test(report.population_sha256)) throw Error('Completed fixed FJC source audit required');
const json = JSON.stringify(report);
if (json.includes('$audit_json$')) throw Error('Unexpected SQL delimiter');
const sql = `do $audit_intake$
declare report jsonb:=$audit_json$${json}$audit_json$::jsonb; identity text; keys jsonb; review jsonb;
begin
  identity:='fjc-source-'||(report->>'population_sha256');
  select jsonb_agg(r->'record_key' order by r->'record_key') into keys from jsonb_array_elements(report->'reviews') r;
  if exists(select 1 from jsonb_array_elements(keys) k where not exists(select 1 from legal_atlas.records r where r.record_key=k)) then raise exception 'Audited source records missing from Supabase'; end if;
  insert into legal_atlas.audit_samples(sample_key,population_sha256,seed,source_name,required,record_keys)
    values(identity,report->>'population_sha256',report->>'seed','fjc',50,keys) on conflict do nothing;
  if exists(select 1 from legal_atlas.audit_samples where sample_key=identity and (seed<>report->>'seed' or record_keys<>keys)) then raise exception 'Immutable sample conflict'; end if;
  for review in select value from jsonb_array_elements(report->'reviews') loop
    insert into legal_atlas.audit_reviews(sample_key,record_key,type_correct,title_correct,source_matches,source_status,checked_at,reviewer)
      values(identity,review->'record_key',(review->>'type_correct')::boolean,(review->>'title_correct')::boolean,(review->>'source_matches')::boolean,
        (review->>'source_status')::integer,(review->>'checked_at')::timestamptz,review->>'reviewer') on conflict do nothing;
  end loop;
end;
$audit_intake$;
select source_name,required,(select count(*) from legal_atlas.audit_reviews r where r.sample_key=s.sample_key) as source_checks from legal_atlas.audit_samples s where source_name='fjc';
`;
fs.writeFileSync(destination, sql);
console.log(JSON.stringify({ source: 'fjc', checks: 50, global_entity_audit_complete: false, destination }));
