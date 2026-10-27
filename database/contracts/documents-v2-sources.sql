-- documents/1, source change v2 (2026-10-27): the court-filings layer takes RECAP filings found through the CourtListener
-- public locator (source_system 'courtlistener-public-locator').
--
-- Owner decision 2026-10-27 (AGENTS.md): "dont withhold any data. If its accurate and valuable, USE IT". The availability
-- rule (database/contracts/corpus-pdf-availability-v2.sql) opened these PDFs; documents/1 still left the source out in two
-- places: the documents.documents CHECK constraint on source_system and the source list in documents_refresh_v1's
-- _doc_cand. On 2026-10-27 that left out 101,424 locator associations (99,289 PDFs, 46 CourtListener dockets), none
-- carrying a seal, restriction or policy flag. 91,133 of them (89,145 documents) belong to the 32 dockets the matter registry lists
-- (sw_matters_v1 pdf_case_ids, 30 MDLs); the other 14 dockets are not listed by any matter page and stay out of this
-- layer by its listing rule (not a hold).
--
-- What changes (everything else in documents-v1.sql is unchanged and still applies):
--   1. documents_documents_source_system_check also allows 'courtlistener-public-locator'.
--   2. documents_refresh_v1 takes open locator associations like any other source (collection 'docket_filings').
--      The _doc_out seal / restriction / policy check and the same-bytes rule are unchanged.
--   3. Locator bytes that another source already lists in this layer stay with that listing (same filing, richer
--      metadata); counted in the result as locator_bytes_listed_by_other_source. They are served, not held.
--   4. Locator metadata, exact only: the RECAP file name (gov.uscourts.<court>.<pacer case>.<document>.<attachment>.pdf)
--      gives the entry number and attachment; the CourtListener docket entry with that docket id and entry number
--      (sw_docket_entries_v1, unique pairs only; two rows with one number = not matched) gives the filing date and, for
--      the main document (attachment 0), its published description. On 2026-10-27, 457 of 457 (locator file, CourtListener
--      document id) pairs over 296 files whose bytes also carry a CourtListener document id had that id's entry number
--      equal to the file-name number, and each of the 46 locator dockets holds files of exactly one PACER case.
--   5. Text of a locator filing is withheld only on explicit source evidence about that file: its own provider flags
--      (is_sealed / restricted / withheld_by_policy / sealing_related_locator_held, via _doc_out) or a local seal on its
--      bytes. Entry-level counts are not evidence about one file: on 2026-10-27 the 4 locator files whose docket entry
--      reports a sealed document (cand 3:25-md-3166 entries 379 and 435) were each is_sealed=false / is_available=true in
--      CourtListener's own recap-documents record; the sealed documents of those entries are other attachments that have
--      no file. The builder's keyword flag ('sealed_or_restricted_text', 'held') and contact-data redaction
--      ('contact_or_access_data') of a description are not source seals either. So no locator row gets entry_withheld.
--   6. _doc_out reads locally flagged bytes from a small work table (same predicate, one scan instead of one per row),
--      and the work tables are analyzed so the ~3x larger candidate set keeps hash joins.
-- Size (dry run 2026-10-27): +88,748 locator documents (88,726 distinct bytes, 32 dockets, 30 MDLs; 397 more locator
-- files are the same bytes another source lists), 0 with text withheld, 12,047 matched to a unique docket entry (dated),
-- 5,064 titled; none has extracted text yet, so they arrive as 'not_extracted' and become searchable when the PDF text
-- pipeline extracts them. The same refresh also lists 17,193 courtlistener and 3,058 docketbird documents that
-- corpus-pdf-availability-v2.sql opened (any refresh after that file does this; not part of this change).
-- Built on documents-v2-scope.sql (scripts/documents/build_documents_v2_sources.py): the refresh body is the scope
-- body with the locator hunks above, so locator files of dockets no matter page lists also enter, as 'docket_case' with
-- no MDL, or with the MDL an exact master-docket key names. Apply after documents-v1.sql and documents-v2-scope.sql,
-- then documents-v2-entry-flag.sql (it patches this body). Re-applying an earlier file restores its own body; re-apply
-- the later files after it.
-- Rollback: documents-v2-sources.rollback.sql (four-source constraint and the documents-v2-scope.sql refresh function).

begin;

alter table documents.documents drop constraint if exists documents_source_system_check;
alter table documents.documents add constraint documents_source_system_check
  check (source_system in ('docketbird', 'courtlistener', 'official-court', 'govinfo', 'courtlistener-public-locator'));

create or replace function public.documents_refresh_v1(p_build text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_counts jsonb; v_changed integer; v_removed integer; v_excluded jsonb; v_n integer; v_dup integer;
begin
  if p_build is null or p_build !~ '^[a-z0-9_.-]{1,40}$' then raise exception 'Invalid build' using errcode = '22023'; end if;
  insert into documents.builds(build) values (p_build) on conflict (build) do nothing;
  -- the work tables are dropped at commit; a second call in the same transaction starts from fresh ones
  if to_regclass('pg_temp._doc_keys') is not null then
    drop table if exists pg_temp._doc_keys, pg_temp._doc_cand, pg_temp._doc_out, pg_temp._doc_db, pg_temp._doc_cl,
      pg_temp._doc_dk, pg_temp._doc_new, pg_temp._doc_mx, pg_temp._doc_lseal, pg_temp._doc_ce;
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

  -- every open association with a case id, one per document (documents/2 scope, owner decision 2026-10-27). A case id
  -- the matter pages request for exactly one MDL carries that MDL and its listing basis; every other case id (not
  -- requested, or requested for two MDLs) enters as 'docket_case' with no MDL. MDL membership is never inferred.
  -- When one document has several associations, the one with an MDL listing wins, then the latest verified.
  create temp table _doc_cand on commit drop as
  select distinct on (a.source_system, a.native_document_id)
         a.source_system, a.native_document_id, a.native_case_id, a.sha256, a.durable_url, a.origins,
         k.mdl, coalesce(k.basis, 'docket_case') as basis
    from corpus_ingest.pdf_document_assets a
    left join _doc_keys k on k.case_id = a.native_case_id and k.n_mdl = 1
   where a.source_system in ('docketbird', 'courtlistener', 'official-court', 'govinfo', 'courtlistener-public-locator')
     and a.native_case_id is not null
     and public.corpus_pdf_availability_v1(a.source_system, a.provider_flags) = 'open'
   order by a.source_system, a.native_document_id, (k.case_id is null), a.verified_at desc;

  -- exact master-docket evidence the `mdls` dataset itself records: a 'docket_case' filing whose case id is an MDL's
  -- master docket by an exact key carries that MDL (listed_by 'derived_master_docket'). Keys: the DocketBird form of the
  -- JPML master docket (court-office:yyyy-type-nnnnn), also for MDLs the matter registry covers; a CourtListener docket id
  -- the record names as its supporting master docket (cases.sample id 'cl_docket:<id>', status 'supporting_master'); for a
  -- court-website or GovInfo filing, the docket key of its printed case number equal to that of the master docket, in the
  -- record's own court (cl_court_id = the listing's court). A key that names two MDLs is not used; nothing is inferred
  -- from captions, products, judges or firms.
  create temp table _doc_mx on commit drop as
  with m as (
    select r.id as mdl, lower(btrim(r.detail ->> 'cl_court_id')) as court, r.detail,
           regexp_match(btrim(r.detail ->> 'master_docket'), '^(\d{1,2}):(\d{2}|\d{4})-([A-Za-z]{2})-0*(\d{1,6})$') as g
      from public.corpus_records r where r.dataset = 'mdls' and r.id ~ '^[1-9][0-9]{0,5}$'),
  x as (
    select 'docketbird'::text as src, null::text as court,
           m.court || '-' || m.g[1] || ':' ||
             (case when length(m.g[2]) = 4 then m.g[2]::integer when m.g[2]::integer >= 68 then 1900 + m.g[2]::integer
                   else 2000 + m.g[2]::integer end) || '-' || lower(m.g[3]) || '-' || lpad(m.g[4], 5, '0') as case_id, m.mdl
      from m where m.g is not null and m.court ~ '^[a-z0-9]{2,12}$'
    union all
    select 'courtlistener', null, substring(s ->> 'id' from '^cl_docket:([0-9]{1,12})$'), m.mdl
      from m cross join lateral jsonb_array_elements(case when jsonb_typeof(m.detail -> 'cases' -> 'sample') = 'array'
                                                         then m.detail -> 'cases' -> 'sample' else '[]'::jsonb end) s
     where s ->> 'status' = 'supporting_master' and s ->> 'id' ~ '^cl_docket:[0-9]{1,12}$'
       and coalesce(s ->> 'mdl_number', m.mdl) = m.mdl
    union all
    select 'court', m.court, documents.docket_key(m.detail ->> 'master_docket'), m.mdl
      from m where m.court ~ '^[a-z0-9]{2,12}$' and documents.docket_key(m.detail ->> 'master_docket') is not null)
  select x.src, x.court, x.case_id, min(x.mdl) as mdl from x where x.case_id is not null
   group by 1, 2, 3 having count(distinct x.mdl) = 1;
  update _doc_cand c set mdl = x.mdl, basis = 'derived_master_docket'
    from (select c2.source_system, c2.native_document_id,
                 case when c2.source_system = 'docketbird' then 'docketbird'
                      when c2.source_system in ('courtlistener', 'courtlistener-public-locator') then 'courtlistener'
                      else 'court' end as src,
                 case when c2.source_system in ('official-court', 'govinfo') then documents.docket_key(c2.native_case_id)
                      else c2.native_case_id end as case_id,
                 case when c2.source_system in ('official-court', 'govinfo') then
                   (select lower(btrim(o -> 'listing' ->> 'court_id')) from jsonb_array_elements(c2.origins) o
                     where o ? 'listing' and jsonb_typeof(o -> 'listing') = 'object'
                     order by o ->> 'retrieved_at' desc limit 1) end as court
            from _doc_cand c2 where c2.basis = 'docket_case') y
    join _doc_mx x on x.src = y.src and x.case_id = y.case_id and coalesce(x.court, '') = coalesce(y.court, '')
   where c.source_system = y.source_system and c.native_document_id = y.native_document_id and c.basis = 'docket_case';
  -- work tables have no statistics until analyzed; with ~130k candidates a misestimate would pick a nested loop
  analyze pg_temp._doc_cand;

  -- bytes carrying an explicit seal, restriction or policy flag anywhere are left out entirely
  create temp table _doc_lseal on commit drop as
  select distinct o.sha256 from corpus_ingest.local_pdf_asset_occurrences o
   where o.source_seal_status = 'locally_flagged_sealed' and o.sha256 is not null;
  create temp table _doc_out on commit drop as
  select c.source_system, c.native_document_id, c.sha256,
         case when exists (select 1 from _doc_lseal o where o.sha256 = c.sha256) then 'local_seal_flag'
              else 'association_flag' end as reason
    from _doc_cand c
   where exists (select 1 from _doc_lseal o where o.sha256 = c.sha256)
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

  -- a RECAP file found through the public locator whose bytes another source lists stays with that listing (served there)
  with gone as (
    delete from _doc_cand c
     where c.source_system = 'courtlistener-public-locator'
       and exists (select 1 from _doc_cand o where o.sha256 = c.sha256 and o.source_system <> 'courtlistener-public-locator')
    returning 1)
  select count(*) into v_dup from gone;

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
  -- CourtListener docket entries a RECAP file name points to: docket id + entry number, used only when the pair is unique
  create temp table _doc_ce on commit drop as
  select e.docket_id, e.entry_number, (array_agg(e.id order by e.id))[1] as id, (array_agg(e.cells order by e.id))[1] as cells,
         count(*) as n
    from (select coalesce(r.filters ->> 'native_docket_id', r.item -> 'cells' ->> 'native_docket_id') as docket_id,
                 (r.item -> 'cells' ->> 'entry_number')::integer as entry_number, r.id, r.item -> 'cells' as cells
            from public.corpus_records r
           where r.dataset = 'sw_docket_entries_v1' and r.item -> 'cells' ->> 'entry_number' ~ '^\d{1,6}$') e
   where e.docket_id in (select c.native_case_id from _doc_cand c where c.source_system = 'courtlistener-public-locator')
   group by e.docket_id, e.entry_number;
  analyze pg_temp._doc_ce;
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
           db.id as db_id, db.cells as db_cells, cl.id as cl_id, cl.cells as cl_cells, ce.id as ce_id, ce.cells as ce_cells,
           case when dk.n = 1 then dk.court_id end as reg_court, case when dk.n = 1 then dk.docket_number end as reg_docket,
           (select jsonb_build_object('court', lower(btrim(r.detail ->> 'cl_court_id')), 'docket', btrim(r.detail ->> 'master_docket'))
              from public.corpus_records r where r.dataset = 'mdls' and r.id = c.mdl) as mdl_rec,
           regexp_match(c.native_document_id, '^(([a-z0-9]{2,12})-(\d{1,2}):(\d{4})-([a-z]{2})-(\d{5}))-(\d{5})(?:-(\d{3}))?$') as dbid,
           t.status as t_status, t.page_count, t.pages_with_text, t.ocr_pending_pages,
           case when t.sha256 is null then null else documents.text_fingerprint(t) end as fp,
           ps.fingerprint as ps_fp, ps.status as ps_status, ps.ecf
      from (select c0.*,
                   -- RECAP file name: court, PACER case number, document (entry) number, attachment number (0 = main document)
                   case when c0.source_system = 'courtlistener-public-locator' then
                     regexp_match(c0.native_document_id,
                       '^https://storage\.courtlistener\.com/recap/(?:gov\.uscourts\.[a-z0-9]+\.[0-9]+/)?gov\.uscourts\.([a-z0-9]+)\.([0-9]+)\.([0-9]{1,6})\.([0-9]{1,4})(?:_[0-9]+)*\.pdf$')
                   end as rcp
              from _doc_cand c0) c
      left join corpus_ingest.pdf_objects o on o.sha256 = c.sha256
      left join lateral (select d.id, d.cells from _doc_db d where c.source_system = 'docketbird' and d.native_id = c.native_document_id
                          order by d.id limit 1) db on true
      left join lateral (select d.id, d.cells from _doc_cl d where c.source_system = 'courtlistener' and d.doc_id = c.native_document_id
                          order by d.id limit 1) cl on true
      left join _doc_ce ce on c.rcp is not null and ce.docket_id = c.native_case_id and ce.entry_number = c.rcp[3]::integer
                          and ce.n = 1
      left join _doc_dk dk on dk.case_id = c.native_case_id
      left join corpus_ingest.pdf_texts t on t.sha256 = c.sha256
      left join documents.page_sets ps on ps.sha256 = c.sha256),
  meta as (
    select b.*,
      -- the published description (or printed title) and where it comes from
      case when b.db_cells is not null then 'sw_docket_documents_v1'
           when b.cl_cells is not null then 'sw_docket_entries_v1'
           when b.ce_cells is not null then 'sw_docket_entries_v1'
           when b.listing is not null then 'listing' end as meta_src,
      -- a docket entry's description describes its main document; an attachment of a locator file gets no title from it
      coalesce(b.db_cells ->> 'description', b.cl_cells ->> 'description',
               case when b.rcp is not null and b.rcp[4]::integer = 0 then b.ce_cells ->> 'description' end,
               b.listing ->> 'printed_title') as raw_title,
      case when b.cl_cells is not null and (coalesce((b.cl_cells ->> 'held')::boolean, false)
                                            or coalesce((b.cl_cells ->> 'documents_sealed')::integer, 0) > 0
                                            or b.cl_cells ->> 'description_withheld' is not null) then 'entry_withheld'
           when b.db_cells is not null and b.db_cells ->> 'description_withheld' is not null then 'entry_withheld' end as entry_flag,
           -- locator files: no entry-level flag; a seal on the file itself is a provider flag and _doc_out already left it out
      coalesce(
        case when b.db_cells ->> 'date_filed' ~ '^\d{4}-\d{2}-\d{2}$' then b.db_cells ->> 'date_filed' end,
        case when b.cl_cells ->> 'date_filed' ~ '^\d{4}-\d{2}-\d{2}$' then b.cl_cells ->> 'date_filed' end,
        case when b.ce_cells ->> 'date_filed' ~ '^\d{4}-\d{2}-\d{2}$' then b.ce_cells ->> 'date_filed' end,
        case when b.listing ->> 'date_iso' ~ '^\d{4}-\d{2}-\d{2}$' then b.listing ->> 'date_iso' end) as pub_date,
      case when b.db_cells ->> 'date_filed' ~ '^\d{4}-\d{2}-\d{2}$' then 'Docket sheet (published row ' || b.db_id || ')'
           when b.cl_cells ->> 'date_filed' ~ '^\d{4}-\d{2}-\d{2}$' then 'Docket entry (published row ' || b.cl_id || ')'
           when b.ce_cells ->> 'date_filed' ~ '^\d{4}-\d{2}-\d{2}$' then 'Docket entry (published row ' || b.ce_id || ')'
           when b.listing ->> 'date_iso' ~ '^\d{4}-\d{2}-\d{2}$' then
             case when b.source_system = 'govinfo' then 'GovInfo date issued' else 'Date printed on the court''s MDL page' end
      end as pub_date_basis
    from base b)
  select m.id, m.source_system, m.native_document_id, m.native_case_id, m.sha256, m.bytes,
    case m.source_system when 'official-court' then 'court_mdl_pages' when 'govinfo' then 'govinfo_court_opinions' else 'docket_filings' end as collection,
    case m.basis when 'registry_pdf_case_id' then 'sw_matters_v1' when 'docket_case' then 'pdf_document_assets'
                 else 'mdls' end as dataset,
    case m.basis when 'registry_pdf_case_id' then 'sw-matter:' || m.mdl when 'docket_case' then left(m.native_case_id, 200)
                 else m.mdl end as record_id,
    m.basis as listed_by, m.mdl,
    -- court: the registry docket row of this case id, else the MDL's transferee court (JPML) for MDL-page and derived
    -- documents, else the court the official listing names (or the RECAP file name); kept only when the court directory
    -- has that exact id
    (select cc.id from public.corpus_records cc where cc.dataset = 'court_spine'
        and cc.id = coalesce(m.reg_court, case when m.basis <> 'registry_pdf_case_id' then m.mdl_rec ->> 'court' end,
                             m.listing ->> 'court_id', m.dbid[2], m.rcp[1])) as court_id,
    case when m.reg_court is not null then 'Matter registry docket'
         when m.basis <> 'registry_pdf_case_id' and m.mdl_rec ->> 'court' is not null then 'MDL transferee court (JPML)'
         when m.listing ->> 'court_id' is not null then 'Court named by the listing'
         when m.dbid is not null then 'Court prefix of the DocketBird case id'
         when m.rcp is not null then 'Court in the RECAP file name' end as court_basis,
    coalesce(documents.docket_key(m.reg_docket),
             case when m.basis = 'derived_master_docket' then documents.docket_key(m.mdl_rec ->> 'docket') end,
             documents.docket_key(m.listing ->> 'docket_number_published'),
             case when m.dbid is not null then m.dbid[3] || ':' || right(m.dbid[4], 2) || '-' || m.dbid[5] || '-' || m.dbid[6] end,
             m.ecf ->> 'docket') as docket_number,
    case when m.reg_docket is not null and documents.docket_key(m.reg_docket) is not null then 'Matter registry docket'
         when m.basis = 'derived_master_docket' and documents.docket_key(m.mdl_rec ->> 'docket') is not null then 'JPML master docket'
         when documents.docket_key(m.listing ->> 'docket_number_published') is not null then 'GovInfo docket number'
         when m.dbid is not null then 'DocketBird case id'
         when m.ecf ->> 'docket' is not null then 'ECF header printed on the document' end as docket_basis,
    coalesce(case when m.db_cells ->> 'entry_number' ~ '^\d{1,6}$' then (m.db_cells ->> 'entry_number')::integer end,
             case when m.cl_cells ->> 'entry_number' ~ '^\d{1,6}$' then (m.cl_cells ->> 'entry_number')::integer end,
             case when m.dbid is not null then m.dbid[7]::integer end,
             case when m.rcp is not null then m.rcp[3]::integer end) as entry_number,
    case when m.dbid is not null and m.dbid[8] is not null then m.dbid[8]::integer
         when m.rcp is not null and m.rcp[4]::integer > 0 then m.rcp[4]::integer end as attachment,
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
    case when m.db_id is not null then 'sw_docket_documents_v1/' || m.db_id when m.cl_id is not null then 'sw_docket_entries_v1/' || m.cl_id
         when m.ce_id is not null then 'sw_docket_entries_v1/' || m.ce_id end as published_record,
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
  analyze pg_temp._doc_new;

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
    'locator_bytes_listed_by_other_source', v_dup,
    'by_source', (select jsonb_object_agg(source_system, n) from (select source_system, count(*) n from documents.documents group by 1) s),
    'by_text_status', (select jsonb_object_agg(text_status, n) from (select text_status, count(*) n from documents.documents group by 1) s),
    'by_collection', (select jsonb_object_agg(collection, n) from (select collection, count(*) n from documents.documents group by 1) s),
    'by_listed_by', (select jsonb_object_agg(listed_by, n) from (select listed_by, count(*) n from documents.documents group by 1) s),
    'withheld_reasons', (select coalesce(jsonb_object_agg(withheld_reason, n), '{}'::jsonb)
                           from (select withheld_reason, count(*) n from documents.documents where withheld_reason is not null group by 1) s),
    'without_mdl', (select count(*) from documents.documents where mdl is null),
    'with_filed_date', (select count(*) from documents.documents where filed_date is not null),
    'with_court', (select count(*) from documents.documents where court_id is not null))
  into v_counts;
  update documents.builds set steps = steps || jsonb_build_object('refresh', v_counts || jsonb_build_object('at', now())) where build = p_build;
  return v_counts;
end $$;

revoke all on function public.documents_refresh_v1(text) from public, anon, authenticated;
grant execute on function public.documents_refresh_v1(text) to service_role;

commit;
