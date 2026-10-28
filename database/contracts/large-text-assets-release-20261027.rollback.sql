-- ROLLBACK for large-text-assets-release/2026-10-27.1 (database/contracts/large-text-assets-release-20261027.sql).
-- Restores the exact before-images surveyed on 2026-10-27: the Grady County row back in large_text_assets (row md5 without
-- search_vector 32eeb8bdf92a1b10d2ccf7f9c627efda), its two /api/text routes ready = false, the large_text_assets catalog row
-- (metadata md5 6a920e34bc334ea6fedfee88e35ea31d, expected 155, imported 78, updated_at 2026-09-28 01:13:43.16307+00), and
-- removes the large_text_official catalog row. Refuses unless large_text_official holds only that one row.
-- Storage is not touched by the release or by this rollback.
-- Run as one transaction (psql -v ON_ERROR_STOP=1 -1 -f).

begin;
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from public.corpus_records where dataset = 'large_text_official') <> 1
     or not exists (select 1 from public.corpus_records where dataset = 'large_text_official' and id = 'large-text:f6f572ee6ca009b460712aac316397d6') then
    raise exception 'large_text_official does not hold exactly the released Grady County row; resolve by hand' using errcode = '55000';
  end if;
  if exists (select 1 from public.corpus_records where dataset = 'large_text_assets' and id = 'large-text:f6f572ee6ca009b460712aac316397d6') then
    raise exception 'The Grady County row already exists in large_text_assets' using errcode = '55000';
  end if;
end $$;

update public.corpus_artifacts set ready = false
where route in ('/api/text?id=f6f572ee6ca009b460712aac316397d6', '/api/text?id=doc%3A82bcbc88fd1263e613f5f6c7ba832166');

update public.corpus_records r set
  dataset = 'large_text_assets',
  ordinal = 72,
  item = $j${"id": "large-text:f6f572ee6ca009b460712aac316397d6", "kind": "cleaned_full_text", "state": "Georgia", "title": "Grady County Ordinances", "dataset": "large_text_assets", "category": "statutes", "has_text": false, "text_url": "", "source_url": "https://gradycountyga.gov/wp-content/uploads/2025/04/Updated-Grady-County.pdf", "has_original": true, "original_url": "/api/text?id=f6f572ee6ca009b460712aac316397d6"}$j$::jsonb,
  detail = $j${"id": "large-text:f6f572ee6ca009b460712aac316397d6", "kind": "cleaned_full_text", "state": "Georgia", "title": "Grady County Ordinances", "dataset": "large_text_assets", "category": "statutes", "has_text": false, "metadata": {"encoding": "UTF-8", "utf8_bytes": 3153723, "reader_aliases": ["doc:82bcbc88fd1263e613f5f6c7ba832166", "f6f572ee6ca009b460712aac316397d6"], "source_dataset": "pending_publication", "derivative_note": "Exact complete cleaned-reader text from the validated core export; original publisher sources remain separate.", "source_record_id": "f6f572ee6ca009b460712aac316397d6", "display_text_sha256": "2ee81cc5208a0b5f8116dc14711c7d513d4c8e914951d5268cb7a5c854c12660"}, "saved_at": "2026-09-18T21:30:34+00:00", "text_url": "", "source_url": "https://gradycountyga.gov/wp-content/uploads/2025/04/Updated-Grady-County.pdf", "has_original": true, "original_url": "/api/text?id=f6f572ee6ca009b460712aac316397d6", "source_as_of": null, "date_evidence": {"saved_at_basis": null, "saved_at_field": "captured_at", "source_as_of_field": null, "effective_date_field": null}, "effective_date": null, "text_truncated": false, "text_characters": 0, "source_text_characters": 3148045}$j$::jsonb,
  filters = $j${"kind": "cleaned_full_text", "_listing": "no", "availability": ["original"], "source_dataset": "pending_publication", "source_record_id": "f6f572ee6ca009b460712aac316397d6"}$j$::jsonb
where r.dataset = 'large_text_official' and r.id = 'large-text:f6f572ee6ca009b460712aac316397d6';

delete from public.corpus_datasets where id = 'large_text_official';

update public.corpus_datasets set
  expected_records = 155,
  imported_records = 78,
  metadata = $j${"id": "large_text_assets", "path": "large_text_assets.jsonl", "rows": 155, "bytes": 505543, "label": "Complete large reader-text downloads", "sha256": "f6b06b77d11fcf4588199895102b09cd4b326e4435b601084d51259966509db4", "listing": {"results": [], "available": true}, "categories": {"guidance": 6, "statutes": 64, "regulations": 82, "constitutions": 3}, "reader_only": true}$j$::jsonb,
  updated_at = '2026-09-28 01:13:43.16307+00'
where id = 'large_text_assets';

do $$
declare v_md5 text;
begin
  select md5((to_jsonb(r) - 'search_vector')::text) into v_md5
    from public.corpus_records r where r.dataset = 'large_text_assets' and r.id = 'large-text:f6f572ee6ca009b460712aac316397d6';
  if v_md5 is distinct from '32eeb8bdf92a1b10d2ccf7f9c627efda'
     or (select md5(metadata::text) from public.corpus_datasets where id = 'large_text_assets') is distinct from '6a920e34bc334ea6fedfee88e35ea31d'
     or (select count(*) from public.corpus_records where dataset = 'large_text_assets') <> 78
     or exists (select 1 from public.corpus_datasets where id = 'large_text_official')
     or exists (select 1 from public.corpus_artifacts where route in ('/api/text?id=f6f572ee6ca009b460712aac316397d6', '/api/text?id=doc%3A82bcbc88fd1263e613f5f6c7ba832166') and ready) then
    raise exception 'Rollback readback differs from the surveyed before-image (row md5 %)', v_md5 using errcode = '55000';
  end if;
end $$;

commit;
