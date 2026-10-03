-- Anonymous local checks only: no persistent data/schema mutation.
-- A helper that unexpectedly accepts one of these JSONB fractional values fails.
do $canonical_rejections_v1$
declare
  v_input text;
  v_rejected integer := 0;
begin
  foreach v_input in array array['1.0', '-0.0', '0.0000001', '[1, {"n": 1.5}]'] loop
    begin
      perform corpus_ingest.canonical_integer_jsonb_v1(v_input::jsonb);
      raise exception 'Expected canonical numeric rejection was absent';
    exception when invalid_parameter_value then
      v_rejected := v_rejected + 1;
    end;
  end loop;
  if v_rejected<>4 then raise exception 'Canonical numeric rejection checks failed'; end if;
  raise notice 'Four unsupported JSONB numeric representations rejected';
end;
$canonical_rejections_v1$;
