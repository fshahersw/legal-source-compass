-- Explicit third-party edition provenance. Apply after publisher-code-source-occurrence-v1.
-- Private intake only. Publication review remains separate; never current-law/calculator approval.
begin;

create or replace function corpus_ingest.publisher_code_check_archive_record_v1(d jsonb, p jsonb, m jsonb, parent jsonb)
returns void language plpgsql stable set search_path='' as $$
declare cls text := coalesce(m->>'provenance_class','official_publisher'); o jsonb := d->'source_occurrence'; pdf jsonb := d->'source_pdf'; original_size bigint;
begin
  if cls = 'official_publisher' then
    if coalesce(d->>'provenance_class','official_publisher') <> cls or d->>'identity_kind' = 'third_party_source_occurrence' then
      raise exception 'Third-party evidence cannot be represented as official publisher evidence' using errcode='22023';
    end if;
    return;
  end if;
  if d->>'provenance_class' is distinct from cls
    or d->>'archive_edition' is distinct from m->'archive'->>'edition'
    or d->>'source_qualification' is distinct from m->'archive'->>'qualification'
    or strpos(coalesce(d->>'status_note',''),m->'archive'->>'qualification') < 1
    or d->'currency'->>'basis' is distinct from 'archive_date'
    or d->'currency'->>'edition' is distinct from m->'archive'->>'edition'
    or d->'currency'->'through_date' is distinct from 'null'::jsonb
    or d->'current_law_verified' is distinct from 'false'::jsonb
    or d->'calculation_activation_allowed' is distinct from 'false'::jsonb then
    raise exception 'Third-party edition, visible qualification or currency binding invalid' using errcode='22023';
  end if;
  if d->>'identity_kind' = 'publisher_source_unit' then return; end if;
  if d->>'identity_kind' is distinct from 'third_party_source_occurrence'
    or jsonb_typeof(o) is distinct from 'object'
    or jsonb_typeof(d->'span') is distinct from 'object'
    or o->'unit_span' is distinct from d->'span'
    or p->>'source_sha256' is distinct from parent->>'original_sha256'
    or parent->>'provenance_class' is distinct from cls
    or parent->>'archive_edition' is distinct from d->>'archive_edition' then
    raise exception 'Third-party source occurrence or parent binding invalid' using errcode='22023';
  end if;
  if o->>'kind' = 'rtf_section' then
    select bytes into original_size from corpus_ingest.publisher_code_objects_v2 where sha256=p->>'source_sha256' and kind='publisher_original';
    if o->>'raw_sha256' is distinct from p->>'source_sha256'
      or coalesce(o->>'ordinal','') !~ '^[1-9][0-9]{0,8}$'
      or jsonb_typeof(o->'ordinal') is distinct from 'number'
      or jsonb_typeof(o->'raw_span') is distinct from 'array'
      or jsonb_array_length(o->'raw_span') <> 2
      or coalesce(o->'raw_span'->>0,'') !~ '^[0-9]{1,9}$'
      or coalesce(o->'raw_span'->>1,'') !~ '^[0-9]{1,9}$'
      or (o->'raw_span'->>0)::bigint >= (o->'raw_span'->>1)::bigint
      or (o->'raw_span'->>1)::bigint > original_size
      or length(coalesce(o->>'printed_heading','')) not between 1 and 8000
      or strpos(d->>'text',o->>'printed_heading') <> 1
      or d->>'citation_path' is distinct from 'src-' || (p->>'source_sha256') || '-section-' || (o->>'ordinal') then
      raise exception 'RTF occurrence raw hash, heading or exact span binding invalid' using errcode='22023';
    end if;
  elsif o->>'kind' = 'jsonl_record' then
    if o->>'release_sha256' is distinct from p->>'source_sha256'
      or coalesce(o->>'record_ordinal','') !~ '^[1-9][0-9]{0,8}$'
      or jsonb_typeof(o->'record_ordinal') is distinct from 'number'
      or coalesce(o->>'record_sha256','') !~ '^[a-f0-9]{64}$'
      or jsonb_typeof(o->'source_status') is distinct from 'string'
      or length(coalesce(o->>'source_status','')) < 1
      or o->'text_field_empty' is distinct from to_jsonb(length(d->>'text') = 0)
      or (o->'text_field_empty' = 'true'::jsonb and length(o->>'source_status') < 1)
      or d->>'citation_path' is distinct from 'src-' || (p->>'source_sha256') || '-record-' || (o->>'record_ordinal')
      or jsonb_typeof(pdf) is distinct from 'object'
      or coalesce(pdf->>'sha256','') !~ '^[a-f0-9]{64}$'
      or coalesce(pdf->>'provenance_class','') not in ('official_publisher','third_party_historical_archive')
      or coalesce(pdf->>'page_start','') !~ '^[1-9][0-9]{0,5}$'
      or coalesce(pdf->>'page_end','') !~ '^[1-9][0-9]{0,5}$'
      or jsonb_typeof(pdf->'page_start') is distinct from 'number'
      or jsonb_typeof(pdf->'page_end') is distinct from 'number'
      or (pdf->>'page_start')::bigint > (pdf->>'page_end')::bigint
      or (pdf->>'page_end')::bigint > 100000
      or not exists (select 1 from corpus_ingest.publisher_code_objects_v2 ob
        join corpus_ingest.publisher_code_object_sources_v2 os on os.sha256=ob.sha256
        where ob.sha256=pdf->>'sha256' and ob.kind='publisher_original' and os.source_url=pdf->>'source_url') then
      raise exception 'JSONL occurrence exact release/record, status or original PDF binding invalid' using errcode='22023';
    end if;
  else
    raise exception 'Unsupported third-party occurrence kind' using errcode='22023';
  end if;
end $$;

create or replace function corpus_ingest.publisher_code_check_manifest_v2(m jsonb)
returns void language plpgsql immutable set search_path='' as $$
declare p text; lvl jsonb;
begin
  if jsonb_typeof(m) is distinct from 'object'
    or m->>'schema_version' is distinct from 'publisher-code-manifest/2'
    or coalesce(m->>'jurisdiction','') !~ '^[A-Z]{2}$'
    or length(coalesce(m->>'publisher','')) not between 3 and 200
    or coalesce(m->>'publisher_url','') !~ '^https://'
    or coalesce(m->>'source_system','') !~ ('^' || lower(m->>'jurisdiction') || '-[a-z0-9-]{3,60}$')
    or length(coalesce(m->>'code_title','')) not between 3 and 200
    or jsonb_typeof(m->'parser') is distinct from 'object'
    or coalesce(m->'parser'->>'name','') !~ '^[a-z][a-z0-9-]{2,60}$'
    or coalesce(m->'parser'->>'version','') !~ '^[1-9][0-9]{0,3}$'
    or jsonb_typeof(m->'retrieval') is distinct from 'object'
    or jsonb_typeof(m->'retrieval'->'methods') is distinct from 'array'
    or jsonb_array_length(m->'retrieval'->'methods') not between 1 and 5
    or exists (select 1 from jsonb_array_elements_text(m->'retrieval'->'methods') x
               where x not in ('publisher_bulk_download','publisher_page','publisher_zip_member','publisher_api','proxied_fetch'))
    or jsonb_typeof(m->'retrieval'->'source_url_patterns') is distinct from 'array'
    or jsonb_array_length(m->'retrieval'->'source_url_patterns') not between 1 and 50
    or m->'retrieval'->'terms_gate' is distinct from 'false'::jsonb
    or coalesce(m->>'provenance_class','official_publisher') not in ('official_publisher','third_party_historical_archive','third_party_edition_archive')
    or m->'retrieval'->'official_source' is distinct from to_jsonb(coalesce(m->>'provenance_class','official_publisher') = 'official_publisher')
    or coalesce(m->'retrieval'->>'rate_limit_ms','') !~ '^[0-9]{3,6}$'
    or jsonb_typeof(m->'structure') is distinct from 'object'
    or jsonb_typeof(m->'structure'->'levels') is distinct from 'array'
    or jsonb_array_length(m->'structure'->'levels') not between 1 and 12
    or length(coalesce(m->'structure'->>'unit','')) not between 3 and 200
    or jsonb_typeof(m->'section_id') is distinct from 'object'
    or coalesce(m->'section_id'->>'scheme','') not in ('official_citation_path','publisher_source_occurrence','third_party_source_occurrence')
    or not corpus_ingest.publisher_code_regex_ok_v2(m->'section_id'->>'regex')
    or length(coalesce(m->'section_id'->>'example','')) not between 1 and 200
    or (m->'section_id'->>'example') !~ (m->'section_id'->>'regex')
    or length(coalesce(m->'section_id'->>'citation_format','')) not between 3 and 200
    or jsonb_typeof(m->'currency') is distinct from 'object'
    or coalesce(m->'currency'->>'basis','') not in ('publisher_statement','publisher_metadata','archive_date')
    or length(coalesce(m->'currency'->>'location','')) not between 3 and 500
    or jsonb_typeof(m->'review') is distinct from 'object'
    or length(coalesce(m->'review'->>'reviewed_by','')) not between 3 and 200
    or coalesce(m->'review'->>'reviewed_at','') !~ '^\d{4}-\d{2}-\d{2}' then
    raise exception 'Invalid publisher-code manifest (shape, identity, gate or review fields)' using errcode='22023';
  end if;
  if coalesce(m->>'provenance_class','official_publisher') <> 'official_publisher' then
    if m->'section_id'->>'scheme' is distinct from 'third_party_source_occurrence'
      or m->'currency'->>'basis' is distinct from 'archive_date'
      or jsonb_typeof(m->'archive') is distinct from 'object'
      or length(coalesce(m->'archive'->>'edition','')) not between 3 and 200
      or (m->'archive'->'edition_date' is distinct from 'null'::jsonb and coalesce(m->'archive'->>'edition_date','') !~ '^\d{4}-\d{2}-\d{2}$')
      or length(coalesce(m->'archive'->>'qualification','')) not between 30 and 2000
      or strpos(m->'archive'->>'qualification',m->'archive'->>'edition') < 1
      or length(coalesce(m->'archive'->>'provider','')) not between 3 and 200
      or coalesce(m->'archive'->>'origin_url','') !~ '^https://'
      or m->'current_law_verified' is distinct from 'false'::jsonb
      or m->'calculation_activation_allowed' is distinct from 'false'::jsonb then
      raise exception 'Third-party edition manifest requires exact edition, qualified provenance and disabled legal authority gates' using errcode='22023';
    end if;
  elsif m->'section_id'->>'scheme' = 'third_party_source_occurrence' then
    raise exception 'Third-party identities require explicit third-party provenance' using errcode='22023';
  end if;
  for p in select x from jsonb_array_elements_text(m->'retrieval'->'source_url_patterns') x loop
    if p !~ '^\^https://' or not corpus_ingest.publisher_code_regex_ok_v2(p) then
      raise exception 'Every source URL pattern must be an anchored https regex' using errcode='22023';
    end if;
  end loop;
  for lvl in select x from jsonb_array_elements(m->'structure'->'levels') x loop
    if jsonb_typeof(lvl) is distinct from 'string' or (lvl #>> '{}') !~ '^[a-z][a-z_]{1,40}$' then
      raise exception 'Structure levels must be lowercase identifiers' using errcode='22023';
    end if;
  end loop;
  if exists (select 1 from jsonb_array_elements_text(m->'structure'->'levels') x group by x having count(*) > 1)
    or not (m->'structure'->'levels') @> '["section"]'::jsonb then
    raise exception 'Structure levels must be distinct and include section' using errcode='22023';
  end if;
end $$;

create or replace function public.corpus_publisher_code_intake_v2(p_run uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s jsonb; m jsonb; r jsonb; d jsonb; p jsonb; cur jsonb; h text; prior jsonb; result jsonb; next_index integer;
        v_jur text; v_source text; v_parser text; unit_cp bigint; parent jsonb; lvl jsonb; rec record; pos bigint;
begin
  s := corpus_ingest.publisher_code_open_run_v2(p_run);
  v_jur := s->>'jurisdiction'; v_source := s->>'source_system'; v_parser := s->>'parser';
  select manifest into m from corpus_ingest.publisher_code_manifests_v2 where manifest_sha256 = s->>'manifest_sha256';
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 500
    or octet_length(p_rows::text) > 8388608 then
    raise exception 'Bounded batch required (1..500 rows, 8 MiB)' using errcode='22023';
  end if;
  h := corpus_ingest.canonical_integer_jsonb_sha256_v1(p_rows);
  select b.result into prior from corpus_ingest.publisher_code_batches_v2 b where b.run_id = p_run and b.batch_sha256 = h;
  if prior is not null then return prior || jsonb_build_object('replayed', true); end if;
  if exists (select 1 from jsonb_array_elements(p_rows) x group by x->>'entity_type', x->>'native_id' having count(*) <> 1) then
    raise exception 'Duplicate identities in batch' using errcode='22023';
  end if;
  for rec in select value, ordinality from jsonb_array_elements(p_rows) with ordinality loop
    r := rec.value; pos := rec.ordinality;
    d := r->'data'; p := r->'provenance'; cur := d->'currency';
    -- Envelope, gates, provenance common to both entity types.
    if r->>'source_system' is distinct from v_source or r->>'schema_version' is distinct from 'publisher-code-evidence/2'
      or coalesce(r->>'entity_type','') not in ('code-source-unit','code-section')
      or jsonb_typeof(d) is distinct from 'object' or jsonb_typeof(p) is distinct from 'object'
      or length(coalesce(r->>'native_id','')) not between 4 and 512 or octet_length(r::text) > 2097152 then
      raise exception 'Invalid record envelope (%)', left(coalesce(r->>'native_id','?'), 80) using errcode='22023';
    end if;
    if d->>'jurisdiction' is distinct from v_jur
      or d->'publisher_native_entity' is distinct from 'false'::jsonb
      or d->'public_projection_allowed' is distinct from 'false'::jsonb
      or d->'current_law_verified' is distinct from 'false'::jsonb
      or d->'calculation_activation_allowed' is distinct from 'false'::jsonb then
      raise exception 'Private-only gates must all be false (%)', left(r->>'native_id', 80) using errcode='22023';
    end if;
    if p->>'record_hash_codec' is distinct from 'canonical-integer-jsonb/1'
      or corpus_ingest.canonical_integer_jsonb_sha256_v1(d) is distinct from p->>'record_sha256' then
      raise exception 'Canonical payload hash mismatch (%)', left(r->>'native_id', 80) using errcode='22023';
    end if;
    if p->>'parser' is distinct from v_parser or p->>'manifest_sha256' is distinct from s->>'manifest_sha256'
      or coalesce(p->>'retrieved_at','') = '' or coalesce(p->>'source_sha256','') !~ '^[a-f0-9]{64}$' then
      raise exception 'Parser, manifest or retrieval provenance mismatch (%)', left(r->>'native_id', 80) using errcode='22023';
    end if;
    if not exists (select 1 from corpus_ingest.publisher_code_object_sources_v2 os
                   join corpus_ingest.publisher_code_objects_v2 ob on ob.sha256 = os.sha256
                   where os.sha256 = p->>'source_sha256' and os.source_url = p->>'source_url'
                     and os.retrieved_at = (p->>'retrieved_at')::timestamptz
                     and os.retrieval_method = p->>'retrieval_method'
                     and os.proxy is not distinct from p->>'proxy'
                     and ob.kind = 'publisher_original') then
      raise exception 'Source bytes are not registered for this run (%)', left(r->>'native_id', 80) using errcode='22023';
    end if;
    -- Currency: verbatim statement, stated through-date (or null), edition, basis.
    if jsonb_typeof(cur) is distinct from 'object'
      or coalesce(cur->>'basis','') not in ('publisher_statement','publisher_metadata','archive_date','none')
      or jsonb_typeof(cur->'statement') is distinct from 'string'
      or (cur->>'basis' <> 'none' and length(cur->>'statement') < 1)
      or (cur->>'basis' = 'none' and (cur->>'statement' <> '' or cur->'through_date' is distinct from 'null'::jsonb))
      or not (cur->'through_date' = 'null'::jsonb or coalesce(cur->>'through_date','') ~ '^\d{4}-\d{2}-\d{2}$')
      or not (cur->'edition' = 'null'::jsonb or jsonb_typeof(cur->'edition') = 'string')
      or p->'source_as_of' is distinct from cur->'through_date' then
      raise exception 'Currency statement/through-date/edition/basis invalid (%)', left(r->>'native_id', 80) using errcode='22023';
    end if;
    if r->>'entity_type' = 'code-source-unit' then
      perform corpus_ingest.publisher_code_check_archive_record_v1(d,p,m,null);
    end if;
    if r->>'entity_type' = 'code-source-unit' then
      if d->>'identity_kind' is distinct from 'publisher_source_unit'
        or length(coalesce(d->>'unit_key','')) not between 1 and 300
        or r->>'native_id' is distinct from v_jur || ':unit:' || (d->>'unit_key')
        or length(coalesce(d->>'unit_kind','')) not between 2 and 40
        or jsonb_typeof(d->'heading') not in ('string','null')
        or d->>'original_sha256' is distinct from p->>'source_sha256'
        or not (d->'publisher_member' = 'null'::jsonb or jsonb_typeof(d->'publisher_member') = 'string')
        or not (d->'raw_member_sha256' = 'null'::jsonb or coalesce(d->>'raw_member_sha256','') ~ '^[a-f0-9]{64}$')
        or ((d->'publisher_member' = 'null'::jsonb) <> (d->'raw_member_sha256' = 'null'::jsonb))
        or coalesce(d->>'text_sha256','') !~ '^[a-f0-9]{64}$'
        or coalesce(d->>'text_code_points','') !~ '^[1-9][0-9]{0,8}$'
        or not exists (select 1 from corpus_ingest.publisher_code_objects_v2 ob
                       where ob.sha256 = d->>'text_sha256' and ob.kind = 'unit_text_derivative'
                         and ob.code_points = (d->>'text_code_points')::bigint)
        or not (d->'sections_expected' = 'null'::jsonb or coalesce(d->>'sections_expected','') ~ '^[0-9]{1,7}$') then
        raise exception 'Source unit identity, original or text derivative binding invalid (%)', left(r->>'native_id', 80) using errcode='22023';
      end if;
    else
      if d->>'identity_kind' is distinct from m->'section_id'->>'scheme'
        or length(coalesce(d->>'citation_path','')) not between 1 and 300
        or (d->>'citation_path') !~ (m->'section_id'->>'regex')
        or r->>'native_id' is distinct from v_jur || ':' || (d->>'citation_path')
        or length(coalesce(d->>'citation','')) not between 3 and 400
        or jsonb_typeof(d->'heading') not in ('string','null')
        or jsonb_typeof(d->'text') is distinct from 'string'
        or (length(d->>'text') < 1 and not coalesce((d->>'identity_kind' = 'third_party_source_occurrence' and d->'source_occurrence'->>'kind' = 'jsonl_record' and d->'source_occurrence'->'text_field_empty' = 'true'::jsonb),false))
        or encode(sha256(convert_to(d->>'text', 'UTF8')), 'hex') is distinct from d->>'text_sha256'
        or to_jsonb(length(d->>'text')) is distinct from d->'text_code_points'
        or jsonb_typeof(d->'hierarchy') is distinct from 'array'
        or jsonb_array_length(d->'hierarchy') not between 1 and 12
        or not (d->'history' = 'null'::jsonb or jsonb_typeof(d->'history') = 'string')
        or not (d->'status_note' = 'null'::jsonb or jsonb_typeof(d->'status_note') = 'string')
        or length(coalesce(d->>'unit_id','')) < 6
        or coalesce(d->>'unit_text_sha256','') !~ '^[a-f0-9]{64}$' then
        raise exception 'Section identity, text hash, hierarchy or unit reference invalid (%)', left(r->>'native_id', 80) using errcode='22023';
      end if;
      for lvl in select value from jsonb_array_elements(d->'hierarchy') loop
        if jsonb_typeof(lvl) is distinct from 'object'
          or not (m->'structure'->'levels') @> jsonb_build_array(lvl->>'level')
          or jsonb_typeof(lvl->'number') not in ('string','null')
          or jsonb_typeof(lvl->'heading') not in ('string','null') then
          raise exception 'Hierarchy level not declared by the manifest (%)', left(r->>'native_id', 80) using errcode='22023';
        end if;
      end loop;
      if (d->'hierarchy'->(jsonb_array_length(d->'hierarchy') - 1))->>'level' is distinct from 'section' then
        raise exception 'Hierarchy must end at the section (%)', left(r->>'native_id', 80) using errcode='22023';
      end if;
      -- The parent unit must be retained, or appear earlier in this batch, with the same text and original.
      select v.data into parent from corpus_ingest.entity_versions v
        where v.source_system = v_source and v.entity_type = 'code-source-unit' and v.native_id = d->>'unit_id'
          and v.data->>'text_sha256' = d->>'unit_text_sha256' and v.data->>'original_sha256' = p->>'source_sha256'
        order by 1 limit 1;
      if parent is null then
        select x.value->'data' into parent from jsonb_array_elements(p_rows) with ordinality x(value, ordinality)
          where x.ordinality < pos and x.value->>'entity_type' = 'code-source-unit' and x.value->>'native_id' = d->>'unit_id'
            and x.value->'data'->>'text_sha256' = d->>'unit_text_sha256'
            and x.value->'data'->>'original_sha256' = p->>'source_sha256'
          limit 1;
      end if;
      if parent is null then
        raise exception 'Parent source unit not retained for this original (%)', left(r->>'native_id', 80) using errcode='22023';
      end if;
      select code_points into unit_cp from corpus_ingest.publisher_code_objects_v2 where sha256 = d->>'unit_text_sha256';
      if d->'span' is distinct from 'null'::jsonb then
        if jsonb_typeof(d->'span') is distinct from 'object'
          or d->'span'->>'unit' is distinct from 'unicode_code_points'
          or coalesce(d->'span'->>'start','') !~ '^[0-9]{1,9}$' or coalesce(d->'span'->>'end','') !~ '^[0-9]{1,9}$'
          or (d->'span'->>'end')::bigint < (d->'span'->>'start')::bigint
          or ((d->'span'->>'end')::bigint = (d->'span'->>'start')::bigint and not coalesce((d->>'identity_kind' = 'third_party_source_occurrence' and d->'source_occurrence'->>'kind' = 'jsonl_record' and d->'source_occurrence'->'text_field_empty' = 'true'::jsonb),false))
          or (d->'span'->>'end')::bigint > unit_cp
          or (d->'span'->>'end')::bigint - (d->'span'->>'start')::bigint <> (d->>'text_code_points')::bigint then
          raise exception 'Section span is outside its unit text or disagrees with the text length (%)', left(r->>'native_id', 80) using errcode='22023';
        end if;
      end if;
      perform corpus_ingest.publisher_code_check_archive_record_v1(d,p,m,parent);
      if d->>'identity_kind' <> 'third_party_source_occurrence' then
        perform corpus_ingest.publisher_code_check_source_occurrence_v1(d,p,parent);
      end if;
    end if;
    if exists (select 1 from corpus_ingest.observations o where o.run_id = p_run and o.source_system = v_source
               and o.entity_type = r->>'entity_type' and o.native_id = r->>'native_id') then
      raise exception 'Identity already observed in this run (%)', left(r->>'native_id', 80) using errcode='22023';
    end if;
  end loop;
  result := corpus_ingest.ingest_entities(p_run, p_rows);
  select coalesce(max(batch_index) + 1, 0) into next_index from corpus_ingest.publisher_code_batches_v2 where run_id = p_run;
  insert into corpus_ingest.publisher_code_batches_v2(run_id, batch_sha256, batch_index, records, result)
    values (p_run, h, next_index, jsonb_array_length(p_rows), result || jsonb_build_object('batch_sha256', h, 'batch_index', next_index));
  return result || jsonb_build_object('batch_sha256', h, 'batch_index', next_index, 'replayed', false, 'published', false);
end $$;

create or replace function public.corpus_publisher_code_projected_section_for_token_v2(
  p_jurisdiction text,
  p_token text
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare gate record; ids text[]; section_row corpus_ingest.entities; source text;
begin
  if coalesce(p_jurisdiction, '') !~ '^[A-Z]{2}$'
     or p_token is null
     or length(p_token) < 1
     or length(p_token) > 80
     or not (
       p_token ~ '^[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*$'
       or p_token ~ '^[0-9]+[A-Za-z]?/[0-9]+$'
       or p_token ~ '^[0-9]+(?:-[A-Za-z])?/[0-9]+(?:-[A-Za-z]+)?$'
     ) then
    raise exception 'Jurisdiction and section token are required' using errcode = '22023';
  end if;
  select * into gate from corpus_ingest.publisher_code_projected_gate_v2(p_jurisdiction);
  if gate.jurisdiction is null then return null; end if;
  select coalesce(array_agg(hit.native_id), '{}'::text[]) into ids
  from (
    select e.native_id
    from corpus_ingest.entities e
    where e.source_system = gate.source_system
      and e.entity_type = 'code-section'
      and e.review_status <> 'quarantined'
      and e.schema_version = 'publisher-code-evidence/2'
      and coalesce(e.data->>'identity_kind','') not in ('publisher_source_occurrence','third_party_source_occurrence')
      and (
        substring(regexp_replace(coalesce(e.data->>'citation_path', ''), '^.*/', '') from '^sec_(.+)$') = p_token
        or (
          strpos(coalesce(e.data->>'citation_path', ''), '/') = 0
          and strpos(coalesce(e.data->>'citation_path', ''), '-') > 0
          and regexp_replace(e.data->>'citation_path', '^.*-', '') = p_token
        )
        or exists (
          select 1
          from jsonb_array_elements(
            case
              when jsonb_typeof(e.data->'hierarchy') = 'array' then e.data->'hierarchy'
              else '[]'::jsonb
            end
          ) h
          where h->>'level' = 'section'
            and h->>'number' = p_token
        )
        or (
          (
            p_token ~ '^[0-9]+[A-Za-z]?/[0-9]+$'
            or p_token ~ '^[0-9]+(?:-[A-Za-z])?/[0-9]+(?:-[A-Za-z]+)?$'
          )
          and split_part(p_token, '/', 1) = (
            select h->>'number'
            from jsonb_array_elements(
              case
                when jsonb_typeof(e.data->'hierarchy') = 'array' then e.data->'hierarchy'
                else '[]'::jsonb
              end
            ) h
            where h->>'level' = 'title'
            limit 1
          )
          and split_part(p_token, '/', 2) = (
            select h->>'number'
            from jsonb_array_elements(
              case
                when jsonb_typeof(e.data->'hierarchy') = 'array' then e.data->'hierarchy'
                else '[]'::jsonb
              end
            ) h
            where h->>'level' = 'section'
            limit 1
          )
        )
      )
    limit 2
  ) hit;
  if coalesce(array_length(ids, 1), 0) <> 1 then return null; end if;
  select * into section_row from corpus_ingest.entities e
  where e.source_system = gate.source_system
    and e.entity_type = 'code-section'
    and e.native_id = ids[1]
    and e.review_status <> 'quarantined'
    and e.schema_version = 'publisher-code-evidence/2';
  if not found then return null; end if;
  source := section_row.provenance->>'source_url';
  if source is null or source !~ '^https://' then source := null; end if;
  return jsonb_build_object(
    'native_id', section_row.native_id,
    'jurisdiction', p_jurisdiction,
    'citation', section_row.data->>'citation',
    'citation_path', section_row.data->>'citation_path',
    'heading', section_row.data->>'heading',
    'text', section_row.data->>'text',
    'history', section_row.data->'history',
    'status_note', section_row.data->'status_note',
    'hierarchy', section_row.data->'hierarchy',
    'currency', section_row.data->'currency',
    'source_url', source
  );
end $$;


create or replace function public.corpus_publisher_code_projected_states_v2()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'jurisdiction', st.jurisdiction,
    'code_title', mm.manifest->>'code_title',
    'publisher', st.publisher,
    'publisher_url', mm.manifest->>'publisher_url',
    'source_system', st.source_system,
    'sections', st.sections,
    'units', st.units,
    'currency', st.currency,
    'structure_levels', mm.manifest->'structure'->'levels',
    'source_qualification', coalesce(mm.manifest->'archive'->>'qualification', mm.manifest->>'source_qualification')
  ) order by st.jurisdiction), '[]'::jsonb)
  from corpus_ingest.publisher_code_states_v2 st
  join corpus_ingest.publisher_code_manifests_v2 mm on mm.manifest_sha256 = st.current_manifest_sha256
  where st.public_projection_allowed and st.review_status = 'reviewed' and st.source_system is not null;
$$;

revoke all on function public.corpus_publisher_code_projected_states_v2() from public,anon,authenticated;
grant execute on function public.corpus_publisher_code_projected_states_v2() to service_role;
revoke all on function corpus_ingest.publisher_code_check_archive_record_v1(jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function corpus_ingest.publisher_code_check_manifest_v2(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.corpus_publisher_code_intake_v2(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.corpus_publisher_code_projected_section_for_token_v2(text,text) from public,anon,authenticated;
grant execute on function public.corpus_publisher_code_intake_v2(uuid,jsonb) to service_role;
grant execute on function public.corpus_publisher_code_projected_section_for_token_v2(text,text) to service_role;
comment on function corpus_ingest.publisher_code_check_archive_record_v1(jsonb,jsonb,jsonb,jsonb) is
  'Explicit third-party edition evidence with source occurrence identities and mandatory visible qualifications; no current-law or calculator authority.';
commit;
