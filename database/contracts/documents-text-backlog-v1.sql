-- documents-text-backlog-v1.sql — the extraction worklist for documents whose PDF text was never extracted.
--
-- Owner decision 2026-10-27: "dont withhold any data. If its accurate and valuable, USE IT".
-- documents_refresh_v1 (documents-v1.sql) sets text_status = 'not_extracted' when corpus_ingest.pdf_texts has no row
-- for a document's sha256. That is a processing backlog, not a policy: on 2026-10-27 17,531 documents (17,530 byte
-- sets, 6,484,847,536 bytes) were listed but not searchable or quotable, every one with its bytes stored in
-- corpus_ingest.pdf_objects (bucket corpus-originals, default content-addressed key) and every one with an OPEN
-- association under public.corpus_pdf_availability_v1 (open under both the v1 and the v2 rule: nothing here was held
-- by caution). 16,740 of them were registered after the 2026-10-03 text run; 790 were registered before it.
--
-- This function only READS. It lists those byte sets in pages so scripts/documents/text_backlog.py can write the
-- extractor worklist; the text itself is stored by the existing writer public.corpus_admin_register_pdf_texts_v1
-- (which refuses any sha256 without an open association) and folded in by documents_refresh_v1 /
-- documents_build_pages_v1.
-- Excluded on purpose: a byte set any listing of which is 'withheld_policy' (the docket source flagged the entry, or
-- a same-bytes listing of such an entry). Those 62 documents are governed by the docket-entry release workstream.
--
-- SECURITY DEFINER, search_path = '', revoked from public/anon/authenticated, granted to service_role.
-- Rollback: documents-text-backlog-v1.rollback.sql (drops this one function; nothing else is touched).

begin;

create or replace function public.documents_text_backlog_v1(p_after text default '', p_limit integer default 2000)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if p_limit is null or p_limit not between 1 and 5000 or length(coalesce(p_after, '')) > 64 then
    raise exception 'Invalid page' using errcode = '22023';
  end if;
  with b as (
    select d.sha256,
           -- extraction priority: the court's own MDL page orders (and GovInfo opinions) first, then CourtListener, then DocketBird
           min(case d.source_system when 'official-court' then 1 when 'govinfo' then 1 when 'courtlistener' then 2 else 3 end) as rank,
           array_agg(distinct d.source_system order by d.source_system) as sources,
           array_agg(distinct d.collection order by d.collection) as collections,
           (array_agg(distinct d.mdl order by d.mdl) filter (where d.mdl is not null))[1:8] as mdls,
           count(*) as documents,
           max(d.filed_date) as latest_filed
      from documents.documents d
     where d.text_status = 'not_extracted'
       and d.sha256 collate "C" > coalesce(p_after, '') collate "C"
       and not exists (select 1 from documents.documents w where w.sha256 = d.sha256 and w.text_status = 'withheld_policy')
     group by d.sha256
     order by d.sha256 collate "C"
     limit p_limit)
  select jsonb_build_object(
           'rows', coalesce(jsonb_agg(jsonb_build_object(
                     'sha256', b.sha256, 'bytes', o.bytes, 'bucket', o.bucket, 'storage_key', o.storage_key, 'rank', b.rank,
                     'sources', to_jsonb(b.sources), 'collections', to_jsonb(b.collections), 'mdls', coalesce(to_jsonb(b.mdls), '[]'::jsonb),
                     'documents', b.documents, 'latest_filed', b.latest_filed,
                     'open', exists (select 1 from corpus_ingest.pdf_document_assets a where a.sha256 = b.sha256
                                       and public.corpus_pdf_availability_v1(a.source_system, a.provider_flags) = 'open'))
                   order by b.sha256 collate "C"), '[]'::jsonb),
           'last', max(b.sha256 collate "C"))
    into v
    from b left join corpus_ingest.pdf_objects o on o.sha256 = b.sha256;
  return v;
end $$;

revoke all on function public.documents_text_backlog_v1(text, integer) from public, anon, authenticated;
grant execute on function public.documents_text_backlog_v1(text, integer) to service_role;

comment on function public.documents_text_backlog_v1(text, integer) is
  'Read-only extraction worklist: byte sets of documents.documents with text_status = not_extracted (no stored PDF text yet), excluding any byte set with a withheld_policy listing. Paged by sha256 (C collation).';

commit;
