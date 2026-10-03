create or replace function legal_atlas.refresh_source_coverage()
returns void language sql volatile security invoker set search_path='' as $$
  insert into legal_atlas.source_coverage(source_name,year,source_rows,accepted_rows,rejected_rows,status,as_of,original_source_checks)
  select source::text,y,
    count(s.input_key),count(s.input_key) filter(where jsonb_array_length(s.candidate_records)>0 and jsonb_array_length(s.schema_errors)=0),
    count(s.input_key) filter(where jsonb_array_length(s.schema_errors)>0),
    case when count(s.input_key)>0 then 'partial' else 'not_started' end::legal_atlas.load_status,now(),0
  from unnest(enum_range(null::legal_atlas.data_source)) source cross join generate_series(2000,extract(year from now())::integer) y
  left join legal_atlas.staging s on s.source_name=source::text and s.source_year=y
  group by source,y
  on conflict(source_name,year) do update set source_rows=excluded.source_rows,accepted_rows=excluded.accepted_rows,rejected_rows=excluded.rejected_rows,status=excluded.status,as_of=excluded.as_of;
$$;
revoke all on function legal_atlas.refresh_source_coverage() from public,anon,authenticated;
grant execute on function legal_atlas.refresh_source_coverage() to service_role;
select cron.schedule('legal-atlas-v3-nightly-schema','0 8 * * *','select legal_atlas.refresh_source_coverage(); select legal_atlas.nightly_schema_report();');
