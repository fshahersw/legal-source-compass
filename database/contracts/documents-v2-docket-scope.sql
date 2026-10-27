-- SUPERSEDED 2026-10-27, NOT APPLIED: release/documents-matter-case-scope (documents-v2-scope.sql) ships the same scope
-- change and is live on corpussite. It also carries this branch's review fixes: litviz_refresh_v1 skips filings without
-- an MDL (the not-null blocker), and exact master-docket keys from the mdls records link 1,595 filings on 13 dockets to
-- their MDL. Do not apply or merge this file; it would replace the live refresh body.
-- documents/2 docket scope — the documents layer also serves open filings of dockets that no published page lists.
--
-- Owner decision 2026-10-27: "dont withhold any data. If its accurate and valuable, USE IT". Until now scope rule 2 of
-- documents_refresh_v1 (documents-v1.sql) admitted only case ids that the matter registry (sw_matters_v1
-- registry.pdf_case_ids) or the 180 pending MDLs of the `mdls` dataset list, and the table required an MDL on every row.
-- On 2026-10-27 that left 25,828 open filings outside the layer (DocketBird 22,959 on 2,706 dockets, CourtListener
-- 1,614 on 41, court websites 1,255 on 39), among them 11,948 distinct PDFs with extracted text, although none carried
-- a seal, restriction, policy or sealing-locator flag: master dockets of terminated or unregistered MDLs
-- (cand-5:2018-md-02827, mad-1:2013-md-02428, njd-3:2017-md-02779, nyed-1:2023-md-03089 ...) and other firm dockets.
-- One more open DocketBird PDF (txed-4:2025-cv-01277-00023) stays out under rule 3: the matter bundle's docket CSV
-- records is_sealed = true for it (local occurrence 'locally_flagged_sealed').
--
-- Rule (replaces scope rule 2 of documents-v1.sql; rules 1 and 3 are unchanged):
--   2a. an association whose case id a published page lists for exactly one MDL keeps that listing, dataset and MDL
--       exactly as before (registry_pdf_case_id, court_mdl_label, derived_master_docket);
--   2b. every other open association with a recorded case id enters on its own docket: listed_by 'native_case_id',
--       dataset 'docket', record_id = the native case id, mdl NULL. The MDL is never inferred: not from an 'md' docket
--       type, a caption, a court page, a case id listed for two MDLs, or a citation in the text (AGENTS MDL rule).
--   Associations without a case id stay out (84 official-court rows on 2026-10-27, whose bytes the layer already
--   serves through another association).
-- Rule 1 (open under public.corpus_pdf_availability_v1) and rule 3 (bytes carrying an explicit seal, restriction,
-- policy hold or sealing-related locator anywhere, or a local seal occurrence, are left out) hold only what carries
-- explicit source or owner evidence.
-- Metadata for the new rows uses the existing bases only (published docket rows, the court listing, the DocketBird id,
-- the ECF header printed on the document), plus two exact ones: the court prefix of a DocketBird case id when the court
-- directory has that exact id, and the case number the court's own page gives (official-court, govinfo) when it parses
-- as a federal docket number. Anything else shows as "Not recorded".
-- Read RPCs: MDL facets and 'listed_in' links skip rows without an MDL; nothing else reads mdl as not null.
--
-- Apply after documents-v1.sql (and again after any re-apply of documents-v1.sql, which would restore the v1 scope).
-- Idempotent. SECURITY DEFINER, search_path = '', revoked from public/anon/authenticated, granted to service_role.
-- Rollback: documents-v2-docket-scope.rollback.sql. The lead applies; workers never write to production.

begin;

alter table documents.documents alter column mdl drop not null;
alter table documents.documents drop constraint if exists documents_dataset_check;
alter table documents.documents add constraint documents_dataset_check
  check (dataset in ('sw_matters_v1', 'mdls', 'docket'));
alter table documents.documents drop constraint if exists documents_listed_by_check;
alter table documents.documents add constraint documents_listed_by_check
  check (listed_by in ('registry_pdf_case_id', 'court_mdl_label', 'derived_master_docket', 'native_case_id'));
-- a docket-only row never carries an MDL or an MDL dataset; a listed row always carries both
alter table documents.documents drop constraint if exists documents_docket_scope_check;
alter table documents.documents add constraint documents_docket_scope_check
  check (case when listed_by = 'native_case_id' then mdl is null and dataset = 'docket' and record_id = native_case_id
              else mdl is not null and dataset <> 'docket' end);
create index if not exists documents_case on documents.documents (native_case_id);

create or replace function public.documents_refresh_v1(p_build text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_counts jsonb; v_changed integer; v_removed integer; v_excluded jsonb; v_n integer;
begin
  if p_build is null or p_build !~ '^[a-z0-9_.-]{1,40}$' then raise exception 'Invalid build' using errcode = '22023'; end if;
  insert into documents.builds(build) values (p_build) on conflict (build) do nothing;
  -- the work tables are dropped at commit; a second call in the same transaction starts from fresh ones
  if to_regclass('pg_temp._doc_keys') is not null then
    drop table if exists pg_temp._doc_keys, pg_temp._doc_cand, pg_temp._doc_out, pg_temp._doc_db, pg_temp._doc_cl,
      pg_temp._doc_dk, pg_temp._doc_new;
  end if;

  -- case ids the published matter pages request, each with its one MDL
  create temp table _doc_keys on commit drop as
  with reg as (
    select r.detail -> 'registry' ->> 'mdl' as mdl, x.case_id
      from public.corpus_records r
     cross join lateral jsonb_array_elements_text(case when jsonb_typeof(r.detail -> 'registry' -> 'pdf_case_ids') = 'array'
                                                     then r.detail -> 'registry' -> 'pdf_case_ids' else '[]'::jsonb end) x(case_id)
     where r.dataset = 'sw_matters_v1' and r.detail -> 'registry' ->> 'mdl' ~ '^[1-9][0-9]{0,5}$'),
  mdl as (
    select r.id as mdl, lower(btrim(r.detail ->> 'cl_court_id')) as court,
           regexp_match(btrim(r.detail ->> 'master_docket'), '^(\d{1,2}):(\d{2}|\d{4})-([A-Za-z]{2})-0*(\d{1,6})$') as g
      from public.corpus_records r where r.dataset = 'mdls' and r.id ~ '^[1-9][0-9]{0,5}$'),
  md as (
    select m.mdl, m.court, m.g[1] as office,
           case when length(m.g[2]) = 4 then m.g[2]::integer when m.g[2]::integer >= 68 then 1900 + m.g[2]::integer
                else 2000 + m.g[2]::integer end as yr,
           lower(m.g[3]) as typ, m.g[4] as num
      from mdl m where m.g is not null and m.mdl not in (select reg.mdl from reg)),
  k as (
    select reg.case_id, reg.mdl, 'registry_pdf_case_id'::text as basis, 1 as prio from reg
    union all select 'MDL ' || mdl.mdl, mdl.mdl, 'court_mdl_label', 2 from mdl
    union all select 'MDL No. ' || mdl.mdl, mdl.mdl, 'court_mdl_label', 2 from mdl
    union all select md.court || '-' || md.office || ':' || md.yr || '-' || md.typ || '-' || lpad(md.num, 5, '0'), md.mdl,
                     'derived_master_docket', 3 from md where md.court ~ '^[a-z0-9]{2,12}$'
    union all select md.office || ':' || right(md.yr::text, 2) || md.typ || md.num, md.mdl, 'derived_master_docket', 3 from md)
  select k.case_id, (array_agg(k.mdl order by k.prio, k.mdl))[1] as mdl, (array_agg(k.basis order by k.prio, k.mdl))[1] as basis,
         count(distinct k.mdl) as n_mdl
    from k where k.case_id is not null group by k.case_id;

  -- open associations, one per document. An association whose case id a published page lists for exactly one MDL
  -- keeps that listing (preferred when a document has several associations); every other open association with a
  -- recorded case id enters on its own docket ('native_case_id', dataset 'docket', record_id = the case id) with no MDL:
  -- a docket type 'md', a caption or a case id listed for two MDLs is never MDL membership (AGENTS MDL rule).
  create temp table _doc_cand on commit drop as
  select distinct on (a.source_system, a.native_document_id)
         a.source_system, a.native_document_id, a.native_case_id, a.sha256, a.durable_url, a.origins,
         k.mdl, coalesce(k.basis, 'native_case_id') as basis
    from corpus_ingest.pdf_document_assets a
    left join _doc_keys k on k.case_id = a.native_case_id and k.n_mdl = 1
   where a.source_system in ('docketbird', 'courtlistener', 'official-court', 'govinfo')
     and a.native_case_id is not null and btrim(a.native_case_id) <> ''
     and public.corpus_pdf_availability_v1(a.source_system, a.provider_flags) = 'open'
   order by a.source_system, a.native_document_id, (k.case_id is null), a.verified_at desc;

  -- bytes carrying an explicit seal, restriction or policy flag anywhere are left out entirely
  create temp table _doc_out on commit drop as
  select c.source_system, c.native_document_id, c.sha256,
         case when exists (select 1 from corpus_ingest.local_pdf_asset_occurrences o
                            where o.sha256 = c.sha256 and o.source_seal_status = 'locally_flagged_sealed') then 'local_seal_flag'
              else 'association_flag' end as reason
    from _doc_cand c
   where exists (select 1 from corpus_ingest.local_pdf_asset_occurrences o
                  where o.sha256 = c.sha256 and o.source_seal_status = 'locally_flagged_sealed')
      or exists (select 1 from corpus_ingest.pdf_document_assets a
                  where a.sha256 = c.sha256
                    and (a.provider_flags -> 'withheld_by_policy' = 'true'::jsonb or a.provider_flags -> 'is_sealed' = 'true'::jsonb
                         or a.provider_flags -> 'restricted' = 'true'::jsonb
                         or a.provider_flags -> 'sealing_related_locator_held' = 'true'::jsonb));
  with gone as (
    delete from _doc_cand c using _doc_out o where o.source_system = c.source_system and o.native_document_id = c.native_document_id
    returning 1)
  select count(*) into v_n from gone;
  select coalesce(jsonb_object_agg(reason, n), '{}'::jsonb) into v_excluded
    from (select reason, count(*) as n from _doc_out group by reason) s;

  -- published rows that describe a document
  create temp table _doc_db on commit drop as
  select r.filters ->> 'native_id' as native_id, r.id, r.item -> 'cells' as cells
    from public.corpus_records r where r.dataset = 'sw_docket_documents_v1' and r.filters ? 'native_id';
  create temp table _doc_cl on commit drop as
  select x.doc_id, r.id, r.item -> 'cells' as cells
    from public.corpus_records r
   cross join lateral jsonb_array_elements_text(case when jsonb_typeof(r.item -> 'cells' -> 'document_ids') = 'array'
                                                   then r.item -> 'cells' -> 'document_ids' else '[]'::jsonb end) x(doc_id)
   where r.dataset = 'sw_docket_entries_v1';
  create temp table _doc_dk on commit drop as
  select x.case_id, min(r.filters ->> 'court_id') as court_id, min(r.item -> 'cells' ->> 'docket_number') as docket_number,
         count(distinct (r.filters ->> 'court_id', r.item -> 'cells' ->> 'docket_number')) as n
    from public.corpus_records r
   cross join lateral jsonb_array_elements_text(case jsonb_typeof(r.filters -> 'native_case_id')
                                                   when 'array' then r.filters -> 'native_case_id'
                                                   when 'string' then jsonb_build_array(r.filters -> 'native_case_id')
                                                   else '[]'::jsonb end) x(case_id)
   where r.dataset = 'sw_matter_dockets_v1' and x.case_id in (select c.native_case_id from _doc_cand c)
   group by x.case_id;

  create temp table _doc_new on commit drop as
  with base as (
    select c.*, o.bytes, documents.doc_id(c.source_system, c.native_document_id) as id,
           (select x -> 'listing' from jsonb_array_elements(c.origins) x where x ? 'listing' and jsonb_typeof(x -> 'listing') = 'object'
             order by x ->> 'retrieved_at' desc limit 1) as listing,
           db.id as db_id, db.cells as db_cells, cl.id as cl_id, cl.cells as cl_cells,
           case when dk.n = 1 then dk.court_id end as reg_court, case when dk.n = 1 then dk.docket_number end as reg_docket,
           (select jsonb_build_object('court', lower(btrim(r.detail ->> 'cl_court_id')), 'docket', btrim(r.detail ->> 'master_docket'))
              from public.corpus_records r where r.dataset = 'mdls' and r.id = c.mdl) as mdl_rec,
           regexp_match(c.native_document_id, '^(([a-z0-9]{2,12})-(\d{1,2}):(\d{4})-([a-z]{2})-(\d{5}))-(\d{5})(?:-(\d{3}))?$') as dbid,
           case when c.source_system = 'docketbird' then regexp_match(c.native_case_id, '^([a-z][a-z0-9]{1,11})-[0-9]') end as dbcase,
           t.status as t_status, t.page_count, t.pages_with_text, t.ocr_pending_pages,
           case when t.sha256 is null then null else documents.text_fingerprint(t) end as fp,
           ps.fingerprint as ps_fp, ps.status as ps_status, ps.ecf
      from _doc_cand c
      left join corpus_ingest.pdf_objects o on o.sha256 = c.sha256
      left join lateral (select d.id, d.cells from _doc_db d where c.source_system = 'docketbird' and d.native_id = c.native_document_id
                          order by d.id limit 1) db on true
      left join lateral (select d.id, d.cells from _doc_cl d where c.source_system = 'courtlistener' and d.doc_id = c.native_document_id
                          order by d.id limit 1) cl on true
      left join _doc_dk dk on dk.case_id = c.native_case_id
      left join corpus_ingest.pdf_texts t on t.sha256 = c.sha256
      left join documents.page_sets ps on ps.sha256 = c.sha256),
  meta as (
    select b.*,
      -- the published description (or printed title) and where it comes from
      case when b.db_cells is not null then 'sw_docket_documents_v1'
           when b.cl_cells is not null then 'sw_docket_entries_v1'
           when b.listing is not null then 'listing' end as meta_src,
      coalesce(b.db_cells ->> 'description', b.cl_cells ->> 'description', b.listing ->> 'printed_title') as raw_title,
      case when b.cl_cells is not null and (coalesce((b.cl_cells ->> 'held')::boolean, false)
                                            or coalesce((b.cl_cells ->> 'documents_sealed')::integer, 0) > 0
                                            or b.cl_cells ->> 'description_withheld' is not null) then 'entry_withheld'
           when b.db_cells is not null and b.db_cells ->> 'description_withheld' is not null then 'entry_withheld' end as entry_flag,
      coalesce(
        case when b.db_cells ->> 'date_filed' ~ '^\d{4}-\d{2}-\d{2}$' then b.db_cells ->> 'date_filed' end,
        case when b.cl_cells ->> 'date_filed' ~ '^\d{4}-\d{2}-\d{2}$' then b.cl_cells ->> 'date_filed' end,
        case when b.listing ->> 'date_iso' ~ '^\d{4}-\d{2}-\d{2}$' then b.listing ->> 'date_iso' end) as pub_date,
      case when b.db_cells ->> 'date_filed' ~ '^\d{4}-\d{2}-\d{2}$' then 'Docket sheet (published row ' || b.db_id || ')'
           when b.cl_cells ->> 'date_filed' ~ '^\d{4}-\d{2}-\d{2}$' then 'Docket entry (published row ' || b.cl_id || ')'
           when b.listing ->> 'date_iso' ~ '^\d{4}-\d{2}-\d{2}$' then
             case when b.source_system = 'govinfo' then 'GovInfo date issued' else 'Date printed on the court''s MDL page' end
      end as pub_date_basis
    from base b)
  select m.id, m.source_system, m.native_document_id, m.native_case_id, m.sha256, m.bytes,
    case m.source_system when 'official-court' then 'court_mdl_pages' when 'govinfo' then 'govinfo_court_opinions' else 'docket_filings' end as collection,
    case m.basis when 'registry_pdf_case_id' then 'sw_matters_v1' when 'native_case_id' then 'docket' else 'mdls' end as dataset,
    case m.basis when 'registry_pdf_case_id' then 'sw-matter:' || m.mdl when 'native_case_id' then m.native_case_id
                 else m.mdl end as record_id,
    m.basis as listed_by, m.mdl,
    -- court: the registry docket row of this case id, else the MDL's transferee court (JPML) for MDL-page and derived
    -- documents, else the court the official listing names, else the court prefix of the DocketBird document or case id;
    -- kept only when the court directory has that exact id
    (select cc.id from public.corpus_records cc where cc.dataset = 'court_spine'
        and cc.id = coalesce(m.reg_court, case when m.basis <> 'registry_pdf_case_id' then m.mdl_rec ->> 'court' end,
                             m.listing ->> 'court_id', m.dbid[2], m.dbcase[1])) as court_id,
    case when m.reg_court is not null then 'Matter registry docket'
         when m.basis <> 'registry_pdf_case_id' and m.mdl_rec ->> 'court' is not null then 'MDL transferee court (JPML)'
         when m.listing ->> 'court_id' is not null then 'Court named by the listing'
         when m.dbid is not null or m.dbcase is not null then 'Court prefix of the DocketBird case id' end as court_basis,
    coalesce(documents.docket_key(m.reg_docket),
             case when m.basis = 'derived_master_docket' then documents.docket_key(m.mdl_rec ->> 'docket') end,
             documents.docket_key(m.listing ->> 'docket_number_published'),
             case when m.dbid is not null then m.dbid[3] || ':' || right(m.dbid[4], 2) || '-' || m.dbid[5] || '-' || m.dbid[6] end,
             m.ecf ->> 'docket',
             case when m.basis = 'native_case_id' and m.source_system in ('official-court', 'govinfo')
                  then documents.docket_key(m.native_case_id) end) as docket_number,
    case when m.reg_docket is not null and documents.docket_key(m.reg_docket) is not null then 'Matter registry docket'
         when m.basis = 'derived_master_docket' and documents.docket_key(m.mdl_rec ->> 'docket') is not null then 'JPML master docket'
         when documents.docket_key(m.listing ->> 'docket_number_published') is not null then 'GovInfo docket number'
         when m.dbid is not null then 'DocketBird case id'
         when m.ecf ->> 'docket' is not null then 'ECF header printed on the document'
         when m.basis = 'native_case_id' and m.source_system in ('official-court', 'govinfo')
              and documents.docket_key(m.native_case_id) is not null then 'Case number on the court''s page' end as docket_basis,
    coalesce(case when m.db_cells ->> 'entry_number' ~ '^\d{1,6}$' then (m.db_cells ->> 'entry_number')::integer end,
             case when m.cl_cells ->> 'entry_number' ~ '^\d{1,6}$' then (m.cl_cells ->> 'entry_number')::integer end,
             case when m.dbid is not null then m.dbid[7]::integer end) as entry_number,
    case when m.dbid is not null and m.dbid[8] is not null then m.dbid[8]::integer end as attachment,
    coalesce(nullif(left(m.listing ->> 'doc_number', 40), ''), m.ecf ->> 'document') as document_number,
    coalesce(m.pub_date::date, (m.ecf ->> 'filed')::date) as filed_date,
    case when m.pub_date is not null then m.pub_date_basis
         when m.ecf ->> 'filed' is not null then 'ECF header printed on page ' || (m.ecf ->> 'at_page')
           || case when m.ecf ->> 'date_kind' = 'entered' then ' (date entered on the docket)' else '' end end as date_basis,
    case when m.raw_title is null then null else left(btrim(m.raw_title), 500) end as title,
    case when m.raw_title is null then null
         when m.meta_src = 'listing' then case when m.source_system = 'govinfo' then 'GovInfo title' else 'Title printed on the court''s MDL page' end
         else 'Docket description as published' end as title_basis,
    documents.doc_type(m.listing ->> 'doc_kind', m.raw_title) as doc_type,
    case when m.listing ->> 'doc_kind' is not null then 'Listing document kind'
         when documents.doc_type(null, m.raw_title) is not null then 'First words of the docket description' end as type_basis,
    coalesce(m.durable_url, m.db_cells ->> 'court_url', m.listing ->> 'url') as source_url,
    case when m.db_id is not null then 'sw_docket_documents_v1/' || m.db_id when m.cl_id is not null then 'sw_docket_entries_v1/' || m.cl_id end as published_record,
    m.page_count, m.pages_with_text, m.ocr_pending_pages,
    case when m.entry_flag is not null then 'withheld_policy'
         when m.t_status is null then 'not_extracted'
         when coalesce(m.pages_with_text, 0) = 0 then 'no_text_layer'
         when m.ps_fp is distinct from m.fp then 'pending_index'
         -- a byte set the retired keyword rule withheld is indexed again on the next pages pass
         when m.ps_status = 'withheld_policy' then 'pending_index'
         when m.t_status = 'complete' then 'text_layer'
         else 'partial_text' end as text_status,
    m.entry_flag as withheld_reason
  from meta m;

  -- the same bytes listed twice: one withheld listing withholds the text of every listing of those bytes
  update _doc_new n set text_status = 'withheld_policy', withheld_reason = coalesce(n.withheld_reason, 'same_bytes_withheld')
   where n.text_status <> 'withheld_policy'
     and exists (select 1 from _doc_new w where w.sha256 = n.sha256 and w.text_status = 'withheld_policy');

  insert into documents.documents as d (id, source_system, native_document_id, native_case_id, sha256, bytes, collection, dataset,
    record_id, listed_by, mdl, court_id, court_basis, docket_number, docket_basis, entry_number, attachment, document_number,
    filed_date, date_basis, title, title_basis, doc_type, type_basis, source_url, published_record, page_count, pages_with_text,
    ocr_pending_pages, text_status, withheld_reason, build)
  select n.id, n.source_system, n.native_document_id, n.native_case_id, n.sha256, n.bytes, n.collection, n.dataset, n.record_id,
    n.listed_by, n.mdl, n.court_id, case when n.court_id is null then null else n.court_basis end, n.docket_number,
    case when n.docket_number is null then null else n.docket_basis end, n.entry_number, n.attachment, n.document_number,
    n.filed_date, case when n.filed_date is null then null else n.date_basis end, n.title, n.title_basis, n.doc_type,
    case when n.doc_type is null then null else n.type_basis end, n.source_url, n.published_record, n.page_count,
    n.pages_with_text, n.ocr_pending_pages, n.text_status, n.withheld_reason, p_build
  from _doc_new n
  on conflict (id) do update set source_system = excluded.source_system, native_document_id = excluded.native_document_id,
    native_case_id = excluded.native_case_id, sha256 = excluded.sha256, bytes = excluded.bytes, collection = excluded.collection,
    dataset = excluded.dataset, record_id = excluded.record_id, listed_by = excluded.listed_by, mdl = excluded.mdl,
    court_id = excluded.court_id, court_basis = excluded.court_basis, docket_number = excluded.docket_number,
    docket_basis = excluded.docket_basis, entry_number = excluded.entry_number, attachment = excluded.attachment,
    document_number = excluded.document_number, filed_date = excluded.filed_date, date_basis = excluded.date_basis,
    title = excluded.title, title_basis = excluded.title_basis, doc_type = excluded.doc_type, type_basis = excluded.type_basis,
    source_url = excluded.source_url, published_record = excluded.published_record, page_count = excluded.page_count,
    pages_with_text = excluded.pages_with_text, ocr_pending_pages = excluded.ocr_pending_pages, text_status = excluded.text_status,
    withheld_reason = excluded.withheld_reason, build = excluded.build
  where (d.source_system, d.native_document_id, d.native_case_id, d.sha256, d.bytes, d.collection, d.dataset, d.record_id,
         d.listed_by, d.mdl, d.court_id, d.court_basis, d.docket_number, d.docket_basis, d.entry_number, d.attachment,
         d.document_number, d.filed_date, d.date_basis, d.title, d.title_basis, d.doc_type, d.type_basis, d.source_url,
         d.published_record, d.page_count, d.pages_with_text, d.ocr_pending_pages, d.text_status, d.withheld_reason)
    is distinct from
        (excluded.source_system, excluded.native_document_id, excluded.native_case_id, excluded.sha256, excluded.bytes,
         excluded.collection, excluded.dataset, excluded.record_id, excluded.listed_by, excluded.mdl, excluded.court_id,
         excluded.court_basis, excluded.docket_number, excluded.docket_basis, excluded.entry_number, excluded.attachment,
         excluded.document_number, excluded.filed_date, excluded.date_basis, excluded.title, excluded.title_basis,
         excluded.doc_type, excluded.type_basis, excluded.source_url, excluded.published_record, excluded.page_count,
         excluded.pages_with_text, excluded.ocr_pending_pages, excluded.text_status, excluded.withheld_reason);
  get diagnostics v_changed = row_count;

  -- documents no longer eligible leave the layer with their links; text of bytes no document serves is dropped
  with gone as (delete from documents.links l where not exists (select 1 from _doc_new n where n.id = l.document_id) returning 1)
  select count(*) into v_n from gone;
  with gone as (delete from documents.documents d where not exists (select 1 from _doc_new n where n.id = d.id) returning 1)
  select count(*) into v_removed from gone;
  with gone as (
    delete from documents.links l using documents.documents d
     where d.id = l.document_id and d.text_status not in ('text_layer', 'partial_text')
    returning 1)
  select count(*) into v_n from gone;
  with gone as (
    delete from documents.pages p where not exists (select 1 from documents.documents d where d.sha256 = p.sha256
                                                      and d.text_status in ('text_layer', 'partial_text', 'pending_index'))
    returning 1)
  select count(*) into v_n from gone;
  with gone as (
    delete from documents.page_sets s where not exists (select 1 from documents.documents d where d.sha256 = s.sha256) returning 1)
  select count(*) into v_n from gone;
  with gone as (
    delete from documents.extractions e where not exists (select 1 from documents.documents d where d.sha256 = e.sha256
                                                            and d.text_status in ('text_layer', 'partial_text'))
    returning 1)
  select count(*) into v_n from gone;

  select jsonb_build_object(
    'documents', (select count(*) from documents.documents),
    'changed', v_changed, 'removed', v_removed, 'excluded_bytes_flags', v_excluded,
    'by_text_status', (select jsonb_object_agg(text_status, n) from (select text_status, count(*) n from documents.documents group by 1) s),
    'by_collection', (select jsonb_object_agg(collection, n) from (select collection, count(*) n from documents.documents group by 1) s),
    'by_listed_by', (select jsonb_object_agg(listed_by, n) from (select listed_by, count(*) n from documents.documents group by 1) s),
    'without_mdl', (select count(*) from documents.documents where mdl is null),
    'withheld_reasons', (select coalesce(jsonb_object_agg(withheld_reason, n), '{}'::jsonb)
                           from (select withheld_reason, count(*) n from documents.documents where withheld_reason is not null group by 1) s),
    'with_filed_date', (select count(*) from documents.documents where filed_date is not null),
    'with_court', (select count(*) from documents.documents where court_id is not null))
  into v_counts;
  update documents.builds set steps = steps || jsonb_build_object('refresh', v_counts || jsonb_build_object('at', now())) where build = p_build;
  return v_counts;
end $$;

create or replace function public.documents_search_v1(p_q text default null, p_court text default null, p_mdl text default null,
  p_from date default null, p_to date default null, p_type text default null, p_sort text default null,
  p_limit integer default 20, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_q tsquery; v_sort text; v_rows jsonb; v_n integer; v_total integer; v_capped boolean := false; v_facets jsonb;
  v_dropped integer := 0; c_cap constant integer := 20000;
begin
  if p_limit is null or p_limit not between 1 and 50 or p_offset is null or p_offset not between 0 and 1000 then
    raise exception 'Invalid page' using errcode = '22023'; end if;
  if p_court is not null and p_court !~ '^[a-z0-9_-]{1,40}$' then raise exception 'Invalid court' using errcode = '22023'; end if;
  if p_mdl is not null and p_mdl !~ '^[1-9][0-9]{0,5}$' then raise exception 'Invalid MDL' using errcode = '22023'; end if;
  if p_type is not null and p_type !~ '^[a-z_]{2,30}$' then raise exception 'Invalid type' using errcode = '22023'; end if;
  if p_q is not null and length(p_q) > 300 then raise exception 'Query too long' using errcode = '22023'; end if;
  if p_from is not null and p_to is not null and p_from > p_to then raise exception 'Invalid date range' using errcode = '22023'; end if;
  v_q := documents.text_query(p_q);
  v_sort := coalesce(p_sort, case when v_q is null then 'newest' else 'relevance' end);
  if v_sort not in ('relevance', 'newest', 'oldest') or (v_sort = 'relevance' and v_q is null) then
    raise exception 'Invalid sort' using errcode = '22023'; end if;
  if p_q is not null and btrim(p_q) <> '' and v_q is null then
    return jsonb_build_object('mode', 'text', 'rows', '[]'::jsonb, 'total', 0, 'has_more', false, 'capped', false,
                              'facets', '{}'::jsonb, 'query', null, 'offset', p_offset, 'limit', p_limit);
  end if;

  -- matching documents (text mode: pages whose tsvector matches, capped at c_cap pages; browse mode: every document),
  -- filters applied before the cap so a narrow filter never loses its hits to the cap
  with hits as materialized (
    select d.id, p.page, ts_rank_cd(p.tsv, v_q, 32) as rk
      from documents.pages p
      join documents.documents d on d.sha256 = p.sha256 and d.text_status in ('text_layer', 'partial_text')
     where v_q is not null and p.tsv @@ v_q
       and (p_court is null or d.court_id = p_court) and (p_mdl is null or d.mdl = p_mdl)
       and (p_type is null or d.doc_type = p_type)
       and (p_from is null or d.filed_date >= p_from) and (p_to is null or d.filed_date <= p_to)
     limit c_cap + 1),
  docs as materialized (
    select h.id, max(h.rk) as rk, count(*)::integer as pages, (array_agg(h.page order by h.rk desc, h.page))[1:3] as top
      from hits h group by h.id
    union all
    select d.id, null::real, null::integer, null::integer[] from documents.documents d
     where v_q is null
       and (p_court is null or d.court_id = p_court) and (p_mdl is null or d.mdl = p_mdl)
       and (p_type is null or d.doc_type = p_type)
       and (p_from is null or d.filed_date >= p_from) and (p_to is null or d.filed_date <= p_to)),
  joined as materialized (select s.*, d as r from docs s join documents.documents d on d.id = s.id),
  facets as (
    select jsonb_build_object(
      'court', (select coalesce(jsonb_agg(jsonb_build_array(f.k, f.n) order by f.n desc, f.k), '[]'::jsonb) from
                 (select (j.r).court_id k, count(*) n from joined j where (j.r).court_id is not null group by 1 order by 2 desc, 1 limit 40) f),
      'mdl', (select coalesce(jsonb_agg(jsonb_build_array(f.k, f.n) order by f.n desc, f.k), '[]'::jsonb) from
                 (select (j.r).mdl k, count(*) n from joined j where (j.r).mdl is not null group by 1 order by 2 desc, 1 limit 60) f),
      'type', (select coalesce(jsonb_agg(jsonb_build_array(f.k, f.n) order by f.n desc, f.k), '[]'::jsonb) from
                 (select coalesce((j.r).doc_type, 'not_recorded') k, count(*) n from joined j group by 1) f),
      'year', (select coalesce(jsonb_agg(jsonb_build_array(f.k, f.n) order by f.k), '[]'::jsonb) from
                 (select coalesce(extract(year from (j.r).filed_date)::integer::text, 'not_recorded') k, count(*) n from joined j group by 1) f)) as v),
  page as (
    select j.* from joined j
     order by case when v_sort = 'relevance' then j.rk end desc nulls last,
              case when v_sort = 'newest' then (j.r).filed_date end desc nulls last,
              case when v_sort = 'oldest' then (j.r).filed_date end asc nulls last, j.id
     limit p_limit + 1 offset p_offset),
  checked as (select pg.*, documents.is_open((pg.r).source_system, (pg.r).native_document_id) as open from page pg)
  select (select count(*) from joined), (select count(*) from hits) > c_cap, (select f.v from facets f),
         coalesce(jsonb_agg(documents.summary(c.r) || jsonb_build_object(
           'rank', case when c.rk is null then null else round(c.rk::numeric, 5) end, 'matched_pages', c.pages,
           'snippets', case when v_q is null or c.top is null then '[]'::jsonb else
             (select coalesce(jsonb_agg(jsonb_build_object('page', tp.page,
                        'text', ts_headline('english', tp.text, v_q,
                                            'StartSel=[[, StopSel=]], MaxFragments=2, MaxWords=26, MinWords=10, ShortWord=2, FragmentDelimiter=" … "'))
                        order by array_position(c.top, tp.page)), '[]'::jsonb)
                from corpus_ingest.pdf_text_pages tp where tp.sha256 = (c.r).sha256 and tp.page = any(c.top)) end)
           order by case when v_sort = 'relevance' then c.rk end desc nulls last,
                    case when v_sort = 'newest' then (c.r).filed_date end desc nulls last,
                    case when v_sort = 'oldest' then (c.r).filed_date end asc nulls last, c.id)
           filter (where c.open), '[]'::jsonb),
         count(*), count(*) filter (where not c.open)
    into v_total, v_capped, v_facets, v_rows, v_n, v_dropped
    from checked c;
  if jsonb_array_length(v_rows) > p_limit then v_rows := v_rows - p_limit; end if;
  return jsonb_build_object('mode', case when v_q is null then 'browse' else 'text' end, 'rows', v_rows, 'total', v_total,
    'has_more', v_n > p_limit, 'capped', v_capped, 'facets', v_facets, 'query', v_q::text, 'sort', v_sort,
    'dropped_unavailable', v_dropped, 'offset', p_offset, 'limit', p_limit);
end $$;

create or replace function public.documents_for_entity_v1(p_type text, p_id text, p_limit integer default 10) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if p_limit is null or p_limit not between 0 and 50 then raise exception 'Invalid limit' using errcode = '22023'; end if;
  if p_type is null or p_type not in ('court', 'judge', 'mdl', 'law_unit', 'case') then raise exception 'Invalid type' using errcode = '22023'; end if;
  if p_id is null or not (case p_type
      when 'court' then p_id ~ '^[a-z0-9_-]{1,40}$'
      when 'judge' then p_id ~ '^[0-9a-f]{32}$'
      when 'mdl' then p_id ~ '^[1-9][0-9]{0,5}$'
      when 'law_unit' then p_id ~ '^(usc:[0-9]{1,2}a?:[0-9][0-9A-Za-z.-]{0,40}|cfr:[0-9]{1,2}:[0-9]{1,5})$'
      else p_id ~ '^[1-9][0-9]{0,9}$' end) then
    raise exception 'Invalid id' using errcode = '22023'; end if;
  with ids as (
    select d.id, null::integer as mentions, null::integer as first_page from documents.documents d
     where (p_type = 'court' and d.court_id = p_id) or (p_type = 'mdl' and d.mdl = p_id)
        or (p_type = 'judge' and d.mdl in (select r.id from public.corpus_records r
                                            where r.dataset = 'mdls'
                                              and jsonb_path_exists(r.detail, '$.judge_links[*].links[*].url ? (@ == $u)',
                                                                    jsonb_build_object('u', '#judge/' || p_id))))
    union all
    select l.document_id, sum(l.mentions)::integer, min(l.first_page) from documents.links l
     where p_type in ('law_unit', 'case') and l.relation = 'cites'
       and l.to_type = case p_type when 'law_unit' then 'law_unit' else 'record' end
       and l.to_id = case p_type when 'case' then 'caselaw/' || p_id else p_id end
     group by l.document_id),
  s as materialized (select ids.id, ids.mentions, ids.first_page, d from ids join documents.documents d on d.id = ids.id)
  select jsonb_build_object('type', p_type, 'id', p_id,
    'basis', case p_type
      when 'court' then 'Documents whose docket is in this court (matter registry docket, MDL transferee court, listing court or the court prefix of the case id).'
      when 'judge' then 'Documents filed in MDLs whose published MDL record links this judge as transferee judge (JPML report). The judge did not necessarily write them.'
      when 'mdl' then 'Documents listed for this MDL: matter registry case ids, the court''s MDL page, or the JPML master docket. Filings on dockets with no such listing carry no MDL.'
      when 'law_unit' then 'Documents whose text cites this provision; each citation was matched exactly to the provision''s number.'
      else 'Documents whose text cites this decision by an exact reporter citation that only this decision carries.' end,
    'total', (select count(*) from s),
    'with_text', (select count(*) from s where (s.d).text_status in ('text_layer', 'partial_text')),
    'undated', (select count(*) from s where (s.d).filed_date is null),
    'by_year', (select coalesce(jsonb_agg(jsonb_build_array(t.y, t.n) order by t.y), '[]'::jsonb) from
                 (select extract(year from (s.d).filed_date)::integer y, count(*) n from s where (s.d).filed_date is not null group by 1) t),
    'by_type', (select coalesce(jsonb_agg(jsonb_build_array(t.k, t.n) order by t.n desc, t.k), '[]'::jsonb) from
                 (select coalesce((s.d).doc_type, 'not_recorded') k, count(*) n from s group by 1) t),
    'mentions', (select sum(s.mentions) from s),
    'recent', (select coalesce(jsonb_agg(documents.summary(x.d) || jsonb_build_object('mentions', x.mentions, 'first_page', x.first_page)
                                         order by (x.d).filed_date desc nulls last, (x.d).id), '[]'::jsonb)
                 from (select s.d, s.mentions, s.first_page from s order by (s.d).filed_date desc nulls last, s.id limit p_limit) x),
    'refreshed', (select max(b.started_at) from documents.builds b))
  into v;
  return v;
end $$;

create or replace function public.documents_links_v1(p_type text, p_id text, p_relation text default null, p_limit integer default 100) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_doc text; v jsonb;
begin
  if p_limit is null or p_limit not between 1 and 500 then raise exception 'Invalid limit' using errcode = '22023'; end if;
  if p_type is null or p_type not in ('record', 'mdl', 'law_unit', 'court') or p_id is null or length(p_id) > 120 then
    raise exception 'Invalid entity' using errcode = '22023'; end if;
  if p_relation is not null and p_relation not in ('cites', 'mentions', 'listed_in', 'filed_in') then
    raise exception 'Invalid relation' using errcode = '22023'; end if;
  v_doc := case when p_type = 'record' and p_id ~ '^documents/d_[0-9a-f]{24}$' then substr(p_id, 11) end;
  with l as (
    select l.document_id, l.to_type, l.to_id, l.relation, l.evidence from documents.links l
     where (v_doc is not null and l.document_id = v_doc) or (v_doc is null and l.to_type = p_type and l.to_id = p_id)
    union all
    select d.id, 'mdl', d.mdl, 'listed_in', case d.listed_by when 'court_mdl_label' then 'publisher_stated' else 'exact_id' end
      from documents.documents d where d.mdl is not null
       and ((v_doc is not null and d.id = v_doc) or (v_doc is null and p_type = 'mdl' and d.mdl = p_id))
    union all
    select d.id, 'court', d.court_id, 'filed_in', 'exact_id'
      from documents.documents d where d.court_id is not null
       and ((v_doc is not null and d.id = v_doc) or (v_doc is null and p_type = 'court' and d.court_id = p_id)))
  select coalesce(jsonb_agg(jsonb_build_object(
      'from', jsonb_build_object('type', 'record', 'id', 'documents/' || x.document_id),
      'to', jsonb_build_object('type', x.to_type, 'id', x.to_id),
      'relation', x.relation, 'evidence', x.evidence, 'sourceDataset', 'documents', 'sourceRecordId', x.document_id)
      order by x.document_id, x.relation, x.to_type, x.to_id), '[]'::jsonb)
    into v
    from (select * from l where p_relation is null or l.relation = p_relation order by l.document_id, l.relation, l.to_type, l.to_id limit p_limit) x;
  return v;
end $$;

do $grants$
declare f text;
begin
  foreach f in array array[
    'public.documents_refresh_v1(text)',
    'public.documents_search_v1(text,text,text,date,date,text,text,integer,integer)',
    'public.documents_for_entity_v1(text,text,integer)', 'public.documents_links_v1(text,text,text,integer)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $grants$;

comment on schema documents is 'documents/2: searchable, linked layer over the stored court-filing PDFs (open associations only): filings the published matter and MDL pages list, with their MDL, and filings of every other docket on their own case id, without an MDL. Page text stays in corpus_ingest.pdf_text_pages.';

commit;
