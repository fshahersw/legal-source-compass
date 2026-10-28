-- ingest-row-limit-v2.sql
-- Raises the row size guard in ingest.row_problem from 1,000,000 to 20,000,000 bytes of jsonb text.
--
-- Why: on 2026-10-27 the openFDA device-enforcement refresh stopped. The 2026-10-21 enforcement report reached the API
-- that day and includes device recall Z-0170-2027, whose more_code_info (a lot and serial list) is 510,259 characters.
-- A corpus row holds the publisher record in detail and again in text, so that row is about 1.09 MB. ingest.row_problem
-- answered 'row larger than 1 MB', ingest_upsert_v1 rolled back the whole batch (111 records read, none written), the
-- cursor stayed put, and every later run re-read the same window and failed the same way: 58 recalls of that report
-- are missing from agency_safety_openfda_device_enforcement (newest stored report_date 2026-10-14).
--
-- The corpus already stores device rows far over 1 MB (169 of 40,300; the largest is 17,742,718 bytes) because the bulk
-- builder never went through this guard, so the guard refused rows the dataset holds by design. 20,000,000 sits above
-- the largest stored row: the scheduled path accepts what the bulk path accepted and still refuses a runaway payload.
--
-- Only the size check and its message change; every other line is the live text of 2026-10-27, verbatim (md5 of the
-- function body 3f768e5b27fe64a1f302b24147533fbc, equal to the body in ingest-v1.sql). Same name, signature, language,
-- volatility, search_path, owner and grants: create or replace keeps them. ingest_upsert_v1 calls the function per row,
-- so the new limit applies at once, with no redeploy of any edge function.
--
-- Not changed here: src/lib/ingest/rows.ts boundBatches still refuses a single row over 1.5 MB (its own bound), so
-- rows between 1.5 MB and 20 MB (110 stored device rows are that large) need that bound raised before the scheduled
-- path can rewrite them. Re-applying ingest-v1.sql restores the 1 MB guard: apply this file after it.
-- Offline test: src/lib/ingest/contract-row-limit-v2.test.mjs (pglite).
-- Rollback: ingest-row-limit-v2.rollback.sql (the live text, verbatim).

create or replace function ingest.row_problem(p_row jsonb, p_dataset text, p_category text, p_id_pattern text) returns text
language plpgsql immutable set search_path = '' as $$
declare k text;
begin
  if jsonb_typeof(p_row) is distinct from 'object' then return 'row is not an object'; end if;
  for k in select jsonb_object_keys(p_row) loop
    if k not in ('dataset', 'id', 'category', 'state', 'county_geoids', 'title', 'source_url', 'ordinal', 'item', 'detail', 'text', 'filters') then
      return 'unexpected key ' || left(k, 40);
    end if;
  end loop;
  if p_row->>'dataset' is distinct from p_dataset then return 'dataset differs from the run''s dataset'; end if;
  if jsonb_typeof(p_row->'id') is distinct from 'string' or (p_row->>'id') !~ p_id_pattern then return 'id does not match the source pattern'; end if;
  if p_row->>'category' is distinct from p_category then return 'category differs from the source category'; end if;
  if jsonb_typeof(p_row->'title') is distinct from 'string' or length(p_row->>'title') > 4000 then return 'title missing or longer than 4000 characters'; end if;
  if jsonb_typeof(p_row->'text') is distinct from 'string' then return 'text missing'; end if;
  if jsonb_typeof(p_row->'source_url') is distinct from 'string' then return 'source_url missing'; end if;
  if (p_row->>'source_url') <> '' and (p_row->>'source_url') !~ '^https?://[^\s]+$' then return 'source_url is not an http(s) URL'; end if;
  if p_row ? 'state' and jsonb_typeof(p_row->'state') not in ('string', 'null') then return 'state is not text'; end if;
  if p_row ? 'county_geoids' and (jsonb_typeof(p_row->'county_geoids') <> 'array'
      or exists (select 1 from jsonb_array_elements(p_row->'county_geoids') g where jsonb_typeof(g) <> 'string')) then
    return 'county_geoids is not an array of text';
  end if;
  if p_row ? 'ordinal' and jsonb_typeof(p_row->'ordinal') <> 'number' then return 'ordinal is not a number'; end if;
  if jsonb_typeof(p_row->'item') is distinct from 'object' or p_row->'item'->>'id' is distinct from p_row->>'id' then return 'item missing or item.id differs from id'; end if;
  if jsonb_typeof(p_row->'detail') is distinct from 'object' then return 'detail is not an object'; end if;
  if jsonb_typeof(p_row->'filters') is distinct from 'object' then return 'filters is not an object'; end if;
  if octet_length(p_row::text) > 20000000 then return 'row larger than 20 MB'; end if;
  -- a recorded URL never carries a credential
  if p_row::text ~* '[?&](api[_-]?key|apikey|access_token|token|key)=' then return 'row contains a credential-like URL parameter'; end if;
  return null;
end $$;
