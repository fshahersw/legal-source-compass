-- Private pure verification helper. Prepare only; the release owner applies this migration.
-- Matches Python json.dumps(ensure_ascii=False, sort_keys=True, separators=(',', ':'))
-- for JSON scalar strings, arrays, objects, booleans, null and integer numbers.
-- This is deliberately NOT a general Python floating-point JSON canonicalizer.
-- JSONB can erase exponent/float lexical distinctions. The source-domain audit is
-- required alongside the recomputed original payload hash; a stored SHA alone is insufficient.

create or replace function corpus_ingest.canonical_integer_jsonb_v1(p_value jsonb)
returns text
language plpgsql
immutable
strict
parallel safe
security invoker
set search_path = pg_catalog, corpus_ingest
as $canonical_integer_jsonb_v1$
declare
  v_kind text := pg_catalog.jsonb_typeof(p_value);
  v_text text;
begin
  if pg_catalog.current_setting('server_encoding') <> 'UTF8' then
    raise exception using errcode = '22023',
      message = 'canonical_integer_jsonb_v1 requires a UTF8 database';
  end if;
  case v_kind
    when 'object' then
      select '{' || coalesce(
        pg_catalog.string_agg(
          pg_catalog.to_jsonb(e.key)::text || ':' ||
          case
            when pg_catalog.jsonb_typeof(e.value) in ('string', 'boolean', 'null')
              or (pg_catalog.jsonb_typeof(e.value)='number' and e.value::text ~ '^-?(0|[1-9][0-9]*)$')
            then e.value::text
            else corpus_ingest.canonical_integer_jsonb_v1(e.value)
          end,
          ',' order by e.key collate "C"
        ), ''
      ) || '}' into v_text
      from pg_catalog.jsonb_each(p_value) as e(key, value);
      return v_text;
    when 'array' then
      select '[' || coalesce(
        pg_catalog.string_agg(
          case
            when pg_catalog.jsonb_typeof(e.value) in ('string', 'boolean', 'null')
              or (pg_catalog.jsonb_typeof(e.value)='number' and e.value::text ~ '^-?(0|[1-9][0-9]*)$')
            then e.value::text
            else corpus_ingest.canonical_integer_jsonb_v1(e.value)
          end,
          ',' order by e.ordinality
        ), ''
      ) || ']' into v_text
      from pg_catalog.jsonb_array_elements(p_value) with ordinality as e(value, ordinality);
      return v_text;
    when 'string' then
      -- PostgreSQL's JSON string encoder preserves UTF8 bytes and emits the same
      -- quote/backslash/C0 escape spellings as Python ensure_ascii=False.
      -- Do not trim, normalize Unicode, or strip spaces from a string value.
      return p_value::text;
    when 'number' then
      v_text := p_value::text;
      if v_text !~ '^-?(0|[1-9][0-9]*)$' then
        raise exception using errcode = '22023',
          message = 'canonical_integer_jsonb_v1 does not support fractional or exponent JSON numeric representations';
      end if;
      return v_text;
    when 'boolean' then
      return p_value::text;
    when 'null' then
      return 'null';
    else
      raise exception using errcode = '22023',
        message = 'canonical_integer_jsonb_v1 encountered an unsupported JSON type';
  end case;
end;
$canonical_integer_jsonb_v1$;

create or replace function corpus_ingest.canonical_integer_jsonb_sha256_v1(p_value jsonb)
returns text
language sql
immutable
strict
parallel safe
security invoker
set search_path = pg_catalog, corpus_ingest
as $canonical_integer_jsonb_sha256_v1$
  select pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(corpus_ingest.canonical_integer_jsonb_v1(p_value), 'UTF8')),
    'hex'
  );
$canonical_integer_jsonb_sha256_v1$;

revoke all on function corpus_ingest.canonical_integer_jsonb_v1(jsonb)
  from public, anon, authenticated;
revoke all on function corpus_ingest.canonical_integer_jsonb_sha256_v1(jsonb)
  from public, anon, authenticated;
grant execute on function corpus_ingest.canonical_integer_jsonb_v1(jsonb) to service_role;
grant execute on function corpus_ingest.canonical_integer_jsonb_sha256_v1(jsonb) to service_role;

comment on function corpus_ingest.canonical_integer_jsonb_v1(jsonb) is
  'Private integer-domain Python-compatible compact sorted-key UTF8 JSON serializer; unsupported numeric forms fail. Not a general float/exponent canonicalizer.';
comment on function corpus_ingest.canonical_integer_jsonb_sha256_v1(jsonb) is
  'Recomputes original integer-domain canonical payload SHA256 from current JSONB values. Requires separately audited original source domain.';
