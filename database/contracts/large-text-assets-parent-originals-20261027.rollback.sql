-- ROLLBACK for large-text-assets-parent-originals/2026-10-27.1 (run 5b8e0d47-2c19-4f6a-b3d1-9e7a42c0f815).
-- Removes exactly the link this contract appended to each of the 18 parent records (by url), leaving any other change
-- made to those records since (for example other releases' facets) in place, then checks that each detail.links equals
-- its ledgered before-image. Ledger rows are kept and marked rolled_back_at; the run is marked failed.

begin;
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from corpus_ingest.cleanup_decisions
       where issue = 'release20261027_large_text_parent_originals' and run_id = '5b8e0d47-2c19-4f6a-b3d1-9e7a42c0f815') <> 18 then
    raise exception 'rollback: 18 ledger rows not found' using errcode = '55000';
  end if;
end $$;

update public.corpus_records r
   set detail = jsonb_set(r.detail, '{links}',
                  coalesce((select jsonb_agg(x order by o) from jsonb_array_elements(r.detail->'links') with ordinality e(x, o)
                             where x->>'url' <> c.evidence->>'route'), '[]'::jsonb))
  from corpus_ingest.cleanup_decisions c
 where c.issue = 'release20261027_large_text_parent_originals' and c.run_id = '5b8e0d47-2c19-4f6a-b3d1-9e7a42c0f815'
   and r.dataset = c.dataset and r.id = c.record_id;

do $$
begin
  if exists (select 1 from public.corpus_records r join corpus_ingest.cleanup_decisions c
                on c.issue = 'release20261027_large_text_parent_originals' and c.run_id = '5b8e0d47-2c19-4f6a-b3d1-9e7a42c0f815'
               and r.dataset = c.dataset and r.id = c.record_id
              where coalesce(r.detail->'links', '[]'::jsonb) is distinct from coalesce(c.original_record->'detail'->'links', '[]'::jsonb)) then
    raise exception 'rollback postflight: a parent''s links differ from its before-image' using errcode = '55000';
  end if;
end $$;

update corpus_ingest.cleanup_decisions
   set replacement = coalesce(replacement, '{}'::jsonb) || jsonb_build_object('rolled_back_at', now())
 where issue = 'release20261027_large_text_parent_originals' and run_id = '5b8e0d47-2c19-4f6a-b3d1-9e7a42c0f815';
update corpus_ingest.runs set status = 'failed', counts = counts || jsonb_build_object('rolled_back_at', now()::text)
 where id = '5b8e0d47-2c19-4f6a-b3d1-9e7a42c0f815';

commit;
