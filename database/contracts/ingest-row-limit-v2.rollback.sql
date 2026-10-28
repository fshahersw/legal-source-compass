-- Rollback for ingest-row-limit-v2.sql: the live ingest.row_problem of 2026-10-27 (function body md5
-- 3f768e5b27fe64a1f302b24147533fbc), restoring the 1,000,000-byte row guard. Same name, signature and grants.

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
  if octet_length(p_row::text) > 1000000 then return 'row larger than 1 MB'; end if;
  -- a recorded URL never carries a credential
  if p_row::text ~* '[?&](api[_-]?key|apikey|access_token|token|key)=' then return 'row contains a credential-like URL parameter'; end if;
  return null;
end $$;
