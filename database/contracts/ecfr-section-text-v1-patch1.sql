-- ecfr-section-text/1 patch 1: sections the current eCFR no longer contains get a 'Not recorded' fact stating why.
-- Replaces one function body only; grants are unchanged by create or replace. Idempotent.
begin;
-- Section row after the repoint: the unverified Open US Law text entry is replaced by the official eCFR text entry.
create or replace function corpus_ingest.ecfr_text_section_row_v1(p_row jsonb, p_native text, p_ent jsonb, p_retrieved timestamptz, p_reason text)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  detail jsonb := p_row->'detail';
  item jsonb := p_row->'item';
  filt jsonb := coalesce(p_row->'filters', '{}'::jsonb);
  gpo jsonb; has_gpo boolean; gpo_text text; official jsonb; texts jsonb; recon jsonb; sources jsonb;
  cmp text; cat text; new_text text; dts jsonb; token text; as_of_txt text;
begin
  select coalesce(jsonb_agg(x.t order by x.o), '[]'::jsonb) into gpo
    from jsonb_array_elements(coalesce(detail->'texts', '[]'::jsonb)) with ordinality x(t, o)
   where x.t->>'source' is distinct from 'open_us_law';
  has_gpo := jsonb_array_length(gpo) > 0;
  select string_agg(x.t->>'text', E'\n' order by x.o) into gpo_text
    from jsonb_array_elements(gpo) with ordinality x(t, o) where x.t->>'text' is not null;

  if p_ent is not null then
    token := corpus_ingest.ecfr_text_token_v1('ecfr:section-text:' || p_native);
    official := jsonb_build_object(
      'role', 'official_text', 'source', 'ecfr_api',
      'label', 'eCFR Versioner API (public eCFR full-text service; authoritative but unofficial, the official edition is the annual CFR)',
      'native_id', p_native, 'record_id', 'ecfr:section-text:' || p_native,
      'text', p_ent->>'text', 'text_length', p_ent->'text_length', 'text_sha256', p_ent->>'text_sha256',
      'text_hash_verified', encode(sha256(convert_to(p_ent->>'text', 'UTF8')), 'hex') = p_ent->>'text_sha256',
      'heading_as_printed', p_ent->>'heading', 'source_note_as_printed', p_ent->>'source_note',
      'authority_note_as_printed', p_ent->>'authority_note',
      'as_of', p_ent->>'as_of', 'title_latest_amended_on', p_ent->>'title_latest_amended_on',
      'raw_response_sha256', p_ent->>'raw_response_sha256', 'unavailable_reason', null,
      'temporal', jsonb_build_object(
        'captured_at', to_char(p_retrieved at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'source_as_of', p_ent->>'as_of', 'effective_from', null, 'effective_to', null, 'published_at', null,
        'captured_at_basis', 'eCFR Versioner API HTTP receipt',
        'source_as_of_basis', 'eCFR point-in-time date requested from the API (title currency date); not a legal effective date or annual-edition date',
        'effective_from_basis', 'not stated by the source; never inferred from an amendment, publication, issue, marker or snapshot date',
        'effective_to_basis', 'not stated by the source; never inferred from an amendment, publication, issue, marker or snapshot date',
        'published_at_basis', null));
    texts := jsonb_build_array(official) || gpo;
  else
    texts := gpo;
  end if;

  cmp := case when p_ent is null or not has_gpo then null
              when corpus_ingest.ecfr_text_norm_v1(gpo_text) = corpus_ingest.ecfr_text_norm_v1(p_ent->>'text') then 'identical'
              else 'text_differs' end;
  cat := case when p_ent is not null and has_gpo then cmp when p_ent is not null then 'ecfr_api_only'
              when has_gpo then 'gpo_only' else 'structure_only' end;
  recon := jsonb_build_object(
    'basis', 'comparison of the GPO eCFR XML bulk text with the eCFR API text (whitespace-normalised)',
    'in_gpo', has_gpo, 'in_ecfr_api', p_ent is not null, 'category', cat, 'text_comparison', cmp,
    'gpo_text_length', case when has_gpo then length(gpo_text) end,
    'ecfr_api_text_length', case when p_ent is not null then length(p_ent->>'text') end,
    'ecfr_api_unavailable_reason', p_reason,
    'in_ecfr_structure', coalesce(detail->'reconciliation'->'in_ecfr_structure', 'false'::jsonb));

  select coalesce(jsonb_agg(v), '[]'::jsonb) into sources from (
    select 'gpo_ecfr_xml' v where has_gpo union all select 'ecfr_api' where p_ent is not null) s;

  detail := jsonb_set(jsonb_set(jsonb_set(detail, '{texts}', texts), '{reconciliation}', recon), '{text_sources_available}', sources);
  item := jsonb_set(item, '{text_sources_available}', sources);
  if p_ent is not null then
    detail := detail || jsonb_build_object('links', jsonb_build_array(jsonb_build_object(
      'url', '#record/ecfr_section_text/' || token, 'label', 'Official eCFR text (as of ' || (p_ent->>'as_of') || ')')));
  end if;

  filt := filt - 'oul_snapshot_date';
  if filt ? 'date_types' or p_ent is not null then
    select coalesce(jsonb_agg(v), '[]'::jsonb) into dts from (
      select v from jsonb_array_elements_text(coalesce(filt->'date_types', '[]'::jsonb)) v where v <> 'oul_snapshot_date'
      union all select 'ecfr_text_as_of' where p_ent is not null
        and not (coalesce(filt->'date_types', '[]'::jsonb) ? 'ecfr_text_as_of')) d;
    filt := jsonb_set(filt, '{date_types}', dts);
  end if;
  if p_ent is not null then
    filt := filt || jsonb_build_object('ecfr_text_as_of', jsonb_build_array(p_ent->>'as_of'));
  end if;

  if p_ent is null then
    select max(e.data->>'as_of') into as_of_txt from corpus_ingest.entities e
     where e.source_system = 'ecfr' and e.entity_type = 'section-text' and e.data->>'title_number' = p_row->'item'->>'title';
    detail := jsonb_set(detail, '{facts}', coalesce(detail->'facts', '[]'::jsonb) || jsonb_build_array(
      jsonb_build_array('Official eCFR text', 'Not recorded'),
      jsonb_build_array('Why the official text is not recorded', case coalesce(p_reason, '')
        when 'section_not_in_ecfr' then 'This section is not in the current eCFR as of ' || coalesce(as_of_txt, 'the acquisition date')
        when 'part_not_in_ecfr' then 'This part is not in the current eCFR as of ' || coalesce(as_of_txt, 'the acquisition date')
        when 'title_unavailable' then 'This title is not available in the eCFR as of ' || coalesce(as_of_txt, 'the acquisition date')
        else 'The eCFR did not return official text for this section' end)));
  end if;
  new_text := case when p_ent is not null then p_ent->>'text' else coalesce(gpo_text, '') end;
  return jsonb_build_object('item', item, 'detail', detail, 'filters', filt, 'text', new_text);
end $$;
revoke all on function corpus_ingest.ecfr_text_section_row_v1(jsonb,text,jsonb,timestamptz,text) from public, anon, authenticated;
grant execute on function corpus_ingest.ecfr_text_section_row_v1(jsonb,text,jsonb,timestamptz,text) to service_role;
commit;
