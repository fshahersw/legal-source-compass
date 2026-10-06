-- document-titles/2026-10-06.1
-- Private, versioned, reversible projection of derived document titles onto placeholder-titled records.
-- Datasets in scope (and nothing else): court_documents ("... (title not yet extracted)"), saved_pages and uscourts_pages
-- ("(untitled)" / "Untitled"). A row is only eligible while it still carries exactly that placeholder title.
--
-- Titles come only from the document's own text (first-page title block, first-page document-type heading, first Markdown H1);
-- rows with no unambiguous title are relabelled "<file name> (title not recorded)" and keep a recorded reason. Per-row provenance
-- (method, source id, source text SHA-256) is stored in corpus_ingest.title_projection_plan and in the row's own "Title basis" fact.
--
-- Safety properties:
--   * plan stores md5(to_jsonb(row)) read from the live row; apply touches a row only while that md5 still matches (a row edited
--     by a parallel worker is skipped, never overwritten);
--   * apply first archives the full pre-image (title, item, detail, text) in corpus_ingest.cleanup_decisions (label_override);
--   * rollback restores the pre-image only while the row still equals the post-image md5 recorded at apply time;
--   * no other column (source_url, filters, category, state, ordinal, county_geoids) is written; sealed/restricted/in camera/
--     ex parte/redacted material is never read or shown (these datasets hold published court-website files and page captures).
-- Installed by the administrative database role; callable only by service_role through public.corpus_admin_title_projection_v1.
-- Rollback of this whole contract: select public.corpus_admin_title_projection_v1('rollback', jsonb_build_object('dry', false));
--   then (optional) drop function public.corpus_admin_title_projection_v1(text, jsonb); drop table corpus_ingest.title_projection_plan;

create table if not exists corpus_ingest.title_projection_plan (
  run_id uuid not null references corpus_ingest.runs(id),
  dataset text not null check (dataset in ('court_documents', 'saved_pages', 'uscourts_pages')),
  record_id text not null,
  method text not null check (method in ('first_page_title_block', 'first_page_doctype_heading', 'first_h1_markdown', 'not_recorded')),
  reason text,
  source_id text not null,
  source_text_sha256 text check (source_text_sha256 is null or source_text_sha256 ~ '^[a-f0-9]{64}$'),
  old_title text not null,
  new_title text not null check (length(btrim(new_title)) between 1 and 400),
  file_name text,
  row_md5 text not null,
  after_md5 text,
  status text not null default 'planned' check (status in ('planned', 'applied', 'skipped', 'rolled_back')),
  status_note text,
  planned_at timestamptz not null default now(),
  applied_at timestamptz,
  primary key (run_id, dataset, record_id),
  check ((method = 'not_recorded') = (reason is not null))
);
create index if not exists title_projection_plan_status on corpus_ingest.title_projection_plan (run_id, status, dataset, record_id);
alter table corpus_ingest.title_projection_plan enable row level security;
revoke all on corpus_ingest.title_projection_plan from public, anon, authenticated;
grant all on corpus_ingest.title_projection_plan to service_role;

create or replace function corpus_ingest.title_projection_run_v1() returns uuid
language plpgsql stable set search_path = '' as $$
declare r uuid;
begin
  select id into r from corpus_ingest.runs
   where scope->>'contract' = 'document-titles/2026-10-06.1' and status in ('running', 'partial') order by started_at desc limit 1;
  if r is null then raise exception 'No open document-titles run. Call op open_run first.' using errcode = '22023'; end if;
  return r;
end $$;

create or replace function corpus_ingest.title_projection_placeholder_v1(p_dataset text, p_title text) returns boolean
language sql immutable set search_path = '' as $$
  select case p_dataset
    when 'court_documents' then p_title like '% (title not yet extracted)'
    else lower(btrim(p_title)) in ('(untitled)', 'untitled') end
$$;

create or replace function corpus_ingest.title_projection_reason_text_v1(p_reason text) returns text
language sql immutable set search_path = '' as $$
  select case p_reason
    when 'no_text_layer' then 'the saved PDF first page has no text layer (image only); no OCR was applied'
    when 'object_missing' then 'the saved file is no longer in private storage'
    when 'not_a_pdf' then 'the saved file is not a PDF whose first page can be read'
    when 'unreadable' then 'the saved PDF could not be opened'
    when 'encrypted' then 'the saved PDF is encrypted'
    when 'no_saved_file' then 'no saved file is registered for this record'
    when 'policy_withheld' then 'the document text mentions sealed, restricted, in camera, ex parte or redacted material, so no title is shown'
    when 'sha256_mismatch' then 'the saved file does not match its recorded SHA-256'
    when 'multiple_title_blocks' then 'the first page has several equally prominent heading blocks; no single title is unambiguous'
    when 'caption_only' then 'the most prominent first-page heading is only a court name or caption'
    when 'uniform_typography' then 'the first page has no typographically distinct title'
    when 'no_distinct_typography' then 'the first page has no typographically distinct title'
    when 'first_heading_is_not_h1' then 'the first heading of the stored text is not a level-1 heading'
    when 'no_heading' then 'the stored text has no heading'
    when 'court_caption_only' then 'the first level-1 heading is only a court name or caption'
    else 'the first-page or heading text does not give an unambiguous title (' || coalesce(p_reason, 'unspecified') || ')' end
$$;

create or replace function corpus_ingest.title_projection_facts_v1(p_plan corpus_ingest.title_projection_plan) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare facts jsonb := '[]'::jsonb; basis text;
begin
  if p_plan.method = 'not_recorded' then
    basis := 'Not recorded: ' || corpus_ingest.title_projection_reason_text_v1(p_plan.reason) || '. Checked 2026-10-06; the label above is the file name, not a title.';
  elsif p_plan.method = 'first_h1_markdown' then
    basis := 'First level-1 heading of the stored page text, wording kept (whitespace collapsed). Method first_h1_markdown; text SHA-256 ' || p_plan.source_text_sha256 || '; read 2026-10-06.';
  elsif p_plan.method = 'first_page_doctype_heading' then
    basis := 'Document-type heading printed on the first page of the saved PDF, with the court caption printed above it when present, wording kept. Method first_page_doctype_heading; file SHA-256 ' || split_part(p_plan.source_id, ':', 2) || '; text SHA-256 ' || p_plan.source_text_sha256 || '; read 2026-10-06.';
  else
    basis := 'Typeset title block on the first page of the saved PDF, wording kept (whitespace collapsed). Method first_page_title_block; file SHA-256 ' || split_part(p_plan.source_id, ':', 2) || '; text SHA-256 ' || p_plan.source_text_sha256 || '; read 2026-10-06.';
  end if;
  facts := facts || jsonb_build_array(jsonb_build_array('Title basis', basis));
  if p_plan.dataset = 'court_documents' then
    facts := facts || jsonb_build_array(jsonb_build_array('Title extracted from first page text',
      case when p_plan.method in ('first_page_title_block', 'first_page_doctype_heading') then 'yes' else 'no' end));
    if p_plan.file_name is not null then
      facts := facts || jsonb_build_array(jsonb_build_array('File name (from the source address)', p_plan.file_name));
    end if;
    facts := facts || jsonb_build_array(jsonb_build_array('Document date', 'Not recorded (the manifest holds download timestamps only, which are not document dates)'));
  end if;
  return facts;
end $$;

create or replace function corpus_ingest.title_projection_plan_v1(p_run uuid, p_rows jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare e jsonb; r public.corpus_records; planned int := 0; rejected jsonb := '[]'::jsonb; ds text; why text; n int;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 500 then
    raise exception 'Bounded rows array (1..500) required' using errcode = '22023';
  end if;
  for e in select value from jsonb_array_elements(p_rows) loop
    ds := e->>'dataset'; why := null;
    select * into r from public.corpus_records where dataset = ds and id = e->>'id';
    if ds is null or ds not in ('court_documents', 'saved_pages', 'uscourts_pages') then why := 'dataset_not_in_scope';
    elsif not found then why := 'record_not_found';
    elsif r.title is distinct from e->>'old_title' then why := 'title_changed_since_derivation';
    elsif not corpus_ingest.title_projection_placeholder_v1(ds, r.title) then why := 'title_is_not_a_placeholder';
    elsif e->>'method' not in ('first_page_title_block', 'first_page_doctype_heading', 'first_h1_markdown', 'not_recorded') then why := 'unknown_method';
    elsif coalesce(btrim(e->>'new_title'), '') = '' or length(e->>'new_title') > 400 then why := 'bad_new_title';
    elsif e->>'method' = 'not_recorded' and coalesce(e->>'reason', '') = '' then why := 'reason_required';
    elsif e->>'method' <> 'not_recorded' and coalesce(e->>'source_text_sha256', '') !~ '^[a-f0-9]{64}$' then why := 'source_text_sha256_required';
    elsif ds = 'court_documents' and e->>'method' <> 'first_h1_markdown' and coalesce(e->>'source_id', '') !~ '^corpus-originals:[a-f0-9]{64}$' then why := 'source_id_required';
    end if;
    if why is not null then
      rejected := rejected || jsonb_build_array(jsonb_build_object('id', e->>'id', 'why', why));
      continue;
    end if;
    insert into corpus_ingest.title_projection_plan(run_id, dataset, record_id, method, reason, source_id, source_text_sha256, old_title, new_title, file_name, row_md5)
    values (p_run, ds, r.id, e->>'method', nullif(e->>'reason', ''), coalesce(nullif(e->>'source_id', ''), ds || ':' || r.id), nullif(e->>'source_text_sha256', ''),
            r.title, btrim(e->>'new_title'), nullif(e->>'file_name', ''), md5(to_jsonb(r)::text))
    on conflict (run_id, dataset, record_id) do nothing;
    get diagnostics n = row_count;
    planned := planned + n;
  end loop;
  return jsonb_build_object('planned', planned, 'received', jsonb_array_length(p_rows), 'rejected', rejected);
end $$;

create or replace function corpus_ingest.title_projection_apply_v1(p_run uuid, p_limit int, p_dry boolean) returns jsonb
language plpgsql set search_path = '' as $$
declare pr corpus_ingest.title_projection_plan; r public.corpus_records; new_item jsonb; new_detail jsonb; new_text text; facts jsonb; labels text[];
        applied int := 0; skipped int := 0; would int := 0; after text;
begin
  if p_limit is null or p_limit not between 1 and 2000 then raise exception 'Bounded limit (1..2000) required' using errcode = '22023'; end if;
  for pr in select * from corpus_ingest.title_projection_plan where run_id = p_run and status = 'planned' order by dataset, record_id limit p_limit loop
    select * into r from public.corpus_records where dataset = pr.dataset and id = pr.record_id for update;
    if not found or md5(to_jsonb(r)::text) <> pr.row_md5 or r.title <> pr.old_title then
      if not p_dry then update corpus_ingest.title_projection_plan set status = 'skipped', status_note = 'row_changed_since_plan' where run_id = pr.run_id and dataset = pr.dataset and record_id = pr.record_id; end if;
      skipped := skipped + 1; continue;
    end if;
    if jsonb_typeof(r.detail->'facts') is distinct from 'array' or jsonb_typeof(r.item) is distinct from 'object' then
      if not p_dry then update corpus_ingest.title_projection_plan set status = 'skipped', status_note = 'unexpected_row_shape' where run_id = pr.run_id and dataset = pr.dataset and record_id = pr.record_id; end if;
      skipped := skipped + 1; continue;
    end if;
    if p_dry then would := would + 1; continue; end if;

    facts := corpus_ingest.title_projection_facts_v1(pr);
    select array_agg(f->>0) into labels from jsonb_array_elements(facts) f;
    new_item := replace(r.item::text, to_jsonb(pr.old_title)::text, to_jsonb(pr.new_title)::text)::jsonb;
    if pr.method <> 'not_recorded' and pr.method in ('first_page_title_block', 'first_page_doctype_heading') and jsonb_typeof(new_item->'badges') = 'array'
       and not (new_item->'badges') @> '["Title extracted from first page"]'::jsonb then
      new_item := jsonb_set(new_item, '{badges}', (new_item->'badges') || '["Title extracted from first page"]'::jsonb);
    end if;
    new_detail := replace(r.detail::text, to_jsonb(pr.old_title)::text, to_jsonb(pr.new_title)::text)::jsonb;
    new_detail := jsonb_set(new_detail, '{facts}',
      coalesce((select jsonb_agg(f order by ord) from jsonb_array_elements(new_detail->'facts') with ordinality t(f, ord) where not ((f->>0) = any (labels))), '[]'::jsonb) || facts);
    new_text := case when r.text is not null and left(r.text, length(r.id) + 1 + length(pr.old_title)) = r.id || ' ' || pr.old_title
                     then r.id || ' ' || pr.new_title || substr(r.text, length(r.id) + 2 + length(pr.old_title)) else r.text end;

    insert into corpus_ingest.cleanup_decisions(dataset, record_id, issue, disposition, reason, evidence, original_record, replacement, run_id)
    values (pr.dataset, pr.record_id, 'doc_titles_20261006_project_title', 'label_override',
            case when pr.method = 'not_recorded' then 'Placeholder title replaced by the file name with an explicit "title not recorded" label; no title was derived.'
                 else 'Placeholder title replaced by a title read from the document''s own text; wording kept.' end,
            jsonb_build_object('contract', 'document-titles/2026-10-06.1', 'method', pr.method, 'reason', pr.reason, 'source_id', pr.source_id, 'source_text_sha256', pr.source_text_sha256),
            jsonb_build_object('title', r.title, 'item', r.item, 'detail', r.detail, 'text', r.text, 'row_md5', pr.row_md5),
            jsonb_build_object('title', pr.new_title), p_run)
    on conflict (dataset, record_id, issue) do nothing;
    if not exists (select 1 from corpus_ingest.cleanup_decisions d where d.dataset = pr.dataset and d.record_id = pr.record_id and d.issue = 'doc_titles_20261006_project_title'
                   and d.original_record->>'row_md5' = pr.row_md5) then
      update corpus_ingest.title_projection_plan set status = 'skipped', status_note = 'ledger_conflict' where run_id = pr.run_id and dataset = pr.dataset and record_id = pr.record_id;
      skipped := skipped + 1; continue;
    end if;

    update public.corpus_records set title = pr.new_title, item = new_item, detail = new_detail, text = new_text where dataset = pr.dataset and id = pr.record_id;
    select md5(to_jsonb(x)::text) into after from public.corpus_records x where x.dataset = pr.dataset and x.id = pr.record_id;
    update corpus_ingest.title_projection_plan set status = 'applied', after_md5 = after, applied_at = now() where run_id = pr.run_id and dataset = pr.dataset and record_id = pr.record_id;
    applied := applied + 1;
  end loop;
  return jsonb_build_object('dry', p_dry, 'applied', applied, 'would_apply', would, 'skipped', skipped,
    'remaining_planned', (select count(*) from corpus_ingest.title_projection_plan where run_id = p_run and status = 'planned'));
end $$;

create or replace function corpus_ingest.title_projection_rollback_v1(p_run uuid, p_dry boolean) returns jsonb
language plpgsql set search_path = '' as $$
declare pr corpus_ingest.title_projection_plan; r public.corpus_records; d corpus_ingest.cleanup_decisions; restored int := 0; held int := 0;
begin
  for pr in select * from corpus_ingest.title_projection_plan where run_id = p_run and status = 'applied' order by dataset, record_id loop
    select * into r from public.corpus_records where dataset = pr.dataset and id = pr.record_id for update;
    select * into d from corpus_ingest.cleanup_decisions where dataset = pr.dataset and record_id = pr.record_id and issue = 'doc_titles_20261006_project_title';
    if d.dataset is null or r.id is null or md5(to_jsonb(r)::text) <> pr.after_md5 then
      held := held + 1;
      if not p_dry then update corpus_ingest.title_projection_plan set status_note = 'rollback_held_row_changed_since_apply' where run_id = pr.run_id and dataset = pr.dataset and record_id = pr.record_id; end if;
      continue;
    end if;
    if not p_dry then
      update public.corpus_records set title = d.original_record->>'title', item = d.original_record->'item', detail = d.original_record->'detail', text = d.original_record->>'text'
       where dataset = pr.dataset and id = pr.record_id;
      update corpus_ingest.title_projection_plan set status = 'rolled_back', status_note = null where run_id = pr.run_id and dataset = pr.dataset and record_id = pr.record_id;
    end if;
    restored := restored + 1;
  end loop;
  return jsonb_build_object('dry', p_dry, 'restored', restored, 'held_changed_since_apply', held);
end $$;

create or replace function public.corpus_admin_title_projection_v1(p_op text, p_args jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare run uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required' using errcode = '42501'; end if;
  if p_op = 'open_run' then
    insert into corpus_ingest.runs(id, status, scope)
    select gen_random_uuid(), 'running', jsonb_build_object('contract', 'document-titles/2026-10-06.1',
      'purpose', 'replace placeholder titles with titles read from the document''s own text, otherwise label the row title-not-recorded; reversible via corpus_ingest.cleanup_decisions',
      'datasets', jsonb_build_array('court_documents', 'saved_pages', 'uscourts_pages'),
      'excluded', jsonb_build_array('sealed', 'restricted', 'in camera', 'ex parte', 'redacted', 'matter PDFs', 'held collections'))
    where not exists (select 1 from corpus_ingest.runs where scope->>'contract' = 'document-titles/2026-10-06.1' and status in ('running', 'partial'));
    return jsonb_build_object('run', corpus_ingest.title_projection_run_v1());
  end if;
  run := corpus_ingest.title_projection_run_v1();
  if p_op = 'plan' then return corpus_ingest.title_projection_plan_v1(run, p_args->'rows');
  elsif p_op = 'apply' then return corpus_ingest.title_projection_apply_v1(run, coalesce((p_args->>'limit')::int, 500), coalesce((p_args->>'dry')::boolean, true));
  elsif p_op = 'rollback' then return corpus_ingest.title_projection_rollback_v1(run, coalesce((p_args->>'dry')::boolean, true));
  elsif p_op = 'status' then
    return jsonb_build_object('run', run,
      'plan', coalesce((select jsonb_agg(x) from (select dataset, method, status, count(*) as n from corpus_ingest.title_projection_plan where run_id = run group by 1, 2, 3 order by 1, 2, 3) x), '[]'::jsonb),
      'placeholders_remaining', coalesce((select jsonb_object_agg(dataset, n) from (select dataset, count(*) as n from public.corpus_records
         where (dataset = 'court_documents' and title like '% (title not yet extracted)') or (dataset in ('saved_pages', 'uscourts_pages') and lower(btrim(title)) in ('(untitled)', 'untitled')) group by dataset) q), '{}'::jsonb));
  elsif p_op = 'verify' then
    return jsonb_build_object('applied_without_ledger', (select count(*) from corpus_ingest.title_projection_plan p where p.run_id = run and p.status = 'applied'
          and not exists (select 1 from corpus_ingest.cleanup_decisions d where d.dataset = p.dataset and d.record_id = p.record_id and d.issue = 'doc_titles_20261006_project_title')),
      'applied_title_mismatch', (select count(*) from corpus_ingest.title_projection_plan p join public.corpus_records r on r.dataset = p.dataset and r.id = p.record_id where p.run_id = run and p.status = 'applied' and r.title <> p.new_title),
      'applied_row_changed_since_apply', (select count(*) from corpus_ingest.title_projection_plan p join public.corpus_records r on r.dataset = p.dataset and r.id = p.record_id where p.run_id = run and p.status = 'applied' and md5(to_jsonb(r)::text) <> p.after_md5),
      'counter_mismatch', (select count(*) from public.corpus_datasets d where d.imported_records is distinct from (select count(*) from public.corpus_records r where r.dataset = d.id)));
  elsif p_op = 'close_run' then
    update corpus_ingest.runs set status = 'completed', finished_at = now() where id = run;
    return jsonb_build_object('closed', run);
  end if;
  raise exception 'Unknown operation' using errcode = '22023';
end $$;

revoke all on function corpus_ingest.title_projection_run_v1() from public, anon, authenticated;
revoke all on function corpus_ingest.title_projection_plan_v1(uuid, jsonb) from public, anon, authenticated;
revoke all on function corpus_ingest.title_projection_apply_v1(uuid, int, boolean) from public, anon, authenticated;
revoke all on function corpus_ingest.title_projection_rollback_v1(uuid, boolean) from public, anon, authenticated;
revoke all on function public.corpus_admin_title_projection_v1(text, jsonb) from public, anon, authenticated;
grant execute on function public.corpus_admin_title_projection_v1(text, jsonb) to service_role;
