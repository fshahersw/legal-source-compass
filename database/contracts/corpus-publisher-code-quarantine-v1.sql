-- publisher-code-quarantine/1 — reversible hide of publisher-code entities the publisher no longer prints.
-- Lands only add/update rows; this contract sets corpus_ingest.entities.review_status = 'quarantined' with a
-- corpus_ingest.cleanup_decisions before-image. Public publisher-code projection already excludes quarantined rows.
-- Apply after corpus-publisher-code-intake-v2.sql and corpus-publisher-code-projection-v2.sql. Service role only.
begin;

create or replace function corpus_ingest.publisher_code_quarantine_dataset_v1(p_source_system text, p_entity_type text, p_native_id text)
returns text language sql immutable set search_path = '' as $$
  select p_source_system || ':' || p_entity_type || ':' || p_native_id;
$$;

create or replace function corpus_ingest.publisher_code_quarantine_restore_one_v1(
  p_dataset text, p_record_id text, p_issue text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare d corpus_ingest.cleanup_decisions; e corpus_ingest.entities; prev text;
begin
  select * into d from corpus_ingest.cleanup_decisions
   where dataset = p_dataset and record_id = p_record_id and issue = p_issue and disposition = 'quarantine';
  if not found then return false; end if;
  prev := coalesce(d.original_record->>'review_status', 'source_metadata');
  update corpus_ingest.entities ent
     set review_status = prev
   where ent.source_system = d.original_record->>'source_system'
     and ent.entity_type = d.original_record->>'entity_type'
     and ent.native_id = d.original_record->>'native_id'
     and ent.review_status = 'quarantined';
  return true;
end $$;

-- p_rows: [{ "jurisdiction":"DE", "entity_type":"code-section"|"code-source-unit", "native_id":"DE:...", "reason": "...", "evidence": {...} }, ...]
create or replace function public.corpus_publisher_code_quarantine_apply_v1(p_run uuid, p_issue text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  it jsonb; e corpus_ingest.entities; st corpus_ingest.publisher_code_states_v2;
  v_dataset text; v_jurisdiction text; v_updated bigint;
  n_ledger int := 0; n_quarantine int := 0; n_skip int := 0; n_missing int := 0;
  jurisdictions text[] := '{}';
begin
  if p_run is null or coalesce(p_issue, '') = '' then
    raise exception 'run id and issue are required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) < 1 or jsonb_array_length(p_rows) > 500 then
    raise exception 'p_rows must be a jsonb array with 1..500 entries' using errcode = '22023';
  end if;
  if not exists (select 1 from corpus_ingest.runs where id = p_run) then
    insert into corpus_ingest.runs(id, contract_version, status, scope, finished_at, counts)
    values (
      p_run, 'publisher-code-quarantine/1', 'completed',
      jsonb_build_object('issue', p_issue, 'apply', 'publisher_code_quarantine'),
      now(), jsonb_build_object('planned', jsonb_array_length(p_rows))
    );
  end if;

  for it in select value from jsonb_array_elements(p_rows) loop
    v_jurisdiction := it->>'jurisdiction';
    if coalesce(v_jurisdiction, '') !~ '^[A-Z]{2}$'
      or coalesce(it->>'entity_type', '') not in ('code-section', 'code-source-unit')
      or coalesce(it->>'native_id', '') = '' then
      raise exception 'Each row needs jurisdiction, entity_type, and native_id' using errcode = '22023';
    end if;
    select * into st from corpus_ingest.publisher_code_states_v2 where jurisdiction = v_jurisdiction;
    if not found or st.source_system is null then
      raise exception 'Unknown publisher-code jurisdiction %', v_jurisdiction using errcode = '22023';
    end if;
    select * into e from corpus_ingest.entities
     where source_system = st.source_system
       and entity_type = it->>'entity_type'
       and native_id = it->>'native_id'
     for update;
    if not found then
      n_missing := n_missing + 1;
      continue;
    end if;
    if e.schema_version is distinct from 'publisher-code-evidence/2' then
      raise exception 'Entity % is not publisher-code-evidence/2', e.native_id using errcode = '22023';
    end if;
    v_dataset := 'publisher_code_entities';
    if exists (
      select 1 from corpus_ingest.cleanup_decisions d
       where d.dataset = v_dataset
         and d.record_id = corpus_ingest.publisher_code_quarantine_dataset_v1(e.source_system, e.entity_type, e.native_id)
         and d.issue = p_issue
         and d.disposition = 'quarantine'
    ) then
      if e.review_status = 'quarantined' then
        n_skip := n_skip + 1;
        continue;
      end if;
    end if;
    if e.review_status = 'quarantined' then
      n_skip := n_skip + 1;
      continue;
    end if;
    insert into corpus_ingest.cleanup_decisions(
      dataset, record_id, issue, disposition, reason, evidence, original_record, replacement, run_id
    ) values (
      v_dataset,
      corpus_ingest.publisher_code_quarantine_dataset_v1(e.source_system, e.entity_type, e.native_id),
      p_issue,
      'quarantine',
      coalesce(it->>'reason',
        'Publisher no longer prints this code-section or code-source-unit on the live site; hide from public projection while retaining intake payload and provenance.'),
      coalesce(it->'evidence', '{}'::jsonb) || jsonb_build_object(
        'contract', 'publisher-code-quarantine/1',
        'jurisdiction', v_jurisdiction,
        'source_system', e.source_system,
        'entity_type', e.entity_type,
        'native_id', e.native_id,
        'payload_sha256', e.payload_sha256,
        'applied_at', now()
      ),
      to_jsonb(e),
      jsonb_build_object('review_status', 'quarantined'),
      p_run
    )
    on conflict (dataset, record_id, issue) do nothing;
    if found then
      n_ledger := n_ledger + 1;
      update corpus_ingest.entities
         set review_status = 'quarantined'
       where source_system = e.source_system and entity_type = e.entity_type and native_id = e.native_id
         and review_status is distinct from 'quarantined';
      get diagnostics v_updated = row_count;
      if v_updated > 0 then
        n_quarantine := n_quarantine + v_updated::int;
        jurisdictions := array_append(jurisdictions, v_jurisdiction);
      end if;
    end if;
  end loop;

  if jurisdictions <> '{}'::text[] then
    perform corpus_ingest.publisher_code_summarize_state_v2(j)
    from (select distinct x from unnest(jurisdictions) x) u(j);
  end if;

  return jsonb_build_object(
    'run_id', p_run,
    'issue', p_issue,
    'ledger_rows', n_ledger,
    'quarantined', n_quarantine,
    'skipped', n_skip,
    'missing', n_missing
  );
end $$;

create or replace function public.corpus_publisher_code_quarantine_restore_v1(p_run uuid, p_issue text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d record; n int := 0; jurisdictions text[] := '{}';
begin
  if p_run is null or coalesce(p_issue, '') = '' then
    raise exception 'run id and issue are required' using errcode = '22023';
  end if;
  for d in
    select dataset, record_id, issue
      from corpus_ingest.cleanup_decisions
     where run_id = p_run and issue = p_issue and disposition = 'quarantine'
     order by dataset, record_id
  loop
    if corpus_ingest.publisher_code_quarantine_restore_one_v1(d.dataset, d.record_id, d.issue) then
      n := n + 1;
      jurisdictions := array_append(
        jurisdictions,
        (select coalesce(evidence->>'jurisdiction', original_record->>'jurisdiction')
           from corpus_ingest.cleanup_decisions
          where dataset = d.dataset and record_id = d.record_id and issue = d.issue)
      );
    end if;
  end loop;
  if jurisdictions <> '{}'::text[] then
    perform corpus_ingest.publisher_code_summarize_state_v2(j)
    from (select distinct x from unnest(jurisdictions) x) u(j);
  end if;
  return jsonb_build_object('run_id', p_run, 'issue', p_issue, 'restored', n);
end $$;

revoke all on function corpus_ingest.publisher_code_quarantine_dataset_v1(text, text, text) from public, anon, authenticated;
revoke all on function corpus_ingest.publisher_code_quarantine_restore_one_v1(text, text, text) from public, anon, authenticated;
revoke all on function public.corpus_publisher_code_quarantine_apply_v1(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.corpus_publisher_code_quarantine_restore_v1(uuid, text) from public, anon, authenticated;
grant execute on function corpus_ingest.publisher_code_quarantine_dataset_v1(text, text, text) to service_role;
grant execute on function corpus_ingest.publisher_code_quarantine_restore_one_v1(text, text, text) to service_role;
grant execute on function public.corpus_publisher_code_quarantine_apply_v1(uuid, text, jsonb) to service_role;
grant execute on function public.corpus_publisher_code_quarantine_restore_v1(uuid, text) to service_role;

comment on function public.corpus_publisher_code_quarantine_apply_v1(uuid, text, jsonb) is
  'Ledgered quarantine of publisher-code entities (sets review_status quarantined). Reversible via corpus_publisher_code_quarantine_restore_v1.';
comment on function public.corpus_publisher_code_quarantine_restore_v1(uuid, text) is
  'Restore review_status from cleanup_decisions.original_record for one quarantine issue/run.';

notify pgrst, 'reload schema';
commit;
