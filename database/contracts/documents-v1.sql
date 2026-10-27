-- documents/1 — searchable, linked document layer over the stored court-filing PDFs that the published matter pages list.
--
-- Superseded in part (owner decision 2026-10-27): database/contracts/documents-v2-docket-scope.sql widens scope rule 2 to
-- every open filing with a recorded case id (listed_by 'native_case_id', no MDL) and replaces documents_refresh_v1,
-- documents_search_v1, documents_for_entity_v1 and documents_links_v1. Re-applying this file restores the v1 scope;
-- apply documents-v2-docket-scope.sql again afterwards.
--
-- Scope (owner decisions 2026-10-03 and 2026-10-23 evening; AGENTS.md): a document enters this layer only when ALL hold
--   1. one of its registry associations is 'open' under the live rule public.corpus_pdf_availability_v1 (DocketBird
--      restricted=false and downloaded; CourtListener is_available and is_sealed=false; official court / GovInfo
--      sealing_related_locator_held=false; never withheld_by_policy). courtlistener-public-locator is never open;
--   2. its native case id is one the published matter pages request: the matter registry's explicit pdf_case_ids
--      (sw_matters_v1, the matter's MDL), the court MDL-page labels 'MDL <n>' / 'MDL No. <n>' of an MDL in the published
--      `mdls` dataset, or, for an MDL the registry does not cover, the master-docket keys derived from the JPML master
--      docket number exactly (court id + docket number). A case id that maps to two MDLs is not used;
--   3. no association or local occurrence of the same bytes carries an explicit seal / restriction / policy flag.
-- Text: page text never leaves corpus_ingest.pdf_text_pages. This schema holds a tsvector per page, char counts and
-- pointers; snippets are cut from the stored text at query time and only for documents this layer serves. Display rule
-- (owner 2026-10-23 night: "dont withhold filings", superseding the 2026-10-03 keyword rule): every eligible filing's
-- text is indexed, snippeted, exported and extracted, and its published description is shown as published, whatever words
-- it contains. Text is withheld only where the docket source itself flags the entry (CourtListener entry held, sealed
-- documents on the entry, or a withheld description; a DocketBird withheld description) — status 'withheld_policy',
-- reason 'entry_withheld' — and then for every listing of the same bytes ('same_bytes_withheld'). documents.withheld_text
-- and documents.withheld_label are kept for callers outside this layer; this layer no longer applies them.
-- MDL: the listing rule above is the only MDL basis (registry relationship, the court's own MDL page, or the JPML master
-- docket). A citation of "MDL No. 2738" inside a document's text is a mention, never membership.
-- Links (contract src/lib/insights/contract.ts Link): resolved only to ids that exist, by exact key —
-- us_code_sections id, federal_regulations_parts id (CFR part), one caselaw cluster whose cite_keys hold the exact
-- citation (two or more = ambiguous, not linked), an `mdls` record id. Everything else stays unresolved.
-- Every function: SECURITY DEFINER, search_path = '', revoked from public/anon/authenticated, granted to service_role.
-- Idempotent (create if not exists / create or replace). Derived rows of this schema are rebuilt from corpus_ingest;
-- nothing outside this schema is written.
-- Pipeline (the lead runs it; scripts/documents/run_pipeline.py wraps every step):
--   select public.documents_refresh_v1('<build>');                  -- documents (metadata, eligibility)
--   select public.documents_build_pages_v1('<build>', 100);         -- repeat until remaining = 0 (policy check, tsvector)
--   select public.documents_refresh_v1('<build>');                  -- folds ECF-header dates into the documents
--   python3 scripts/documents/run_pipeline.py extract|load          -- documents_export_pages_v1 -> extraction -> load
--   select public.documents_resolve_v1(50000);                      -- repeat until pending = 0
--   select public.documents_link_v1();
-- Builders/tests: scripts/documents/*, src/lib/documents/contract.test.mjs (offline PGlite).

begin;

create schema if not exists documents;
revoke all on schema documents from public, anon, authenticated;

-- ------------------------------------------------------------------------------------------------ tables
create table if not exists documents.builds (
  build text primary key check (build ~ '^[a-z0-9_.-]{1,40}$'),
  started_at timestamptz not null default now(),
  steps jsonb not null default '{}'::jsonb
);

create table if not exists documents.documents (
  id text primary key check (id ~ '^d_[0-9a-f]{24}$'),
  source_system text not null check (source_system in ('docketbird', 'courtlistener', 'official-court', 'govinfo')),
  native_document_id text not null,
  native_case_id text not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  bytes bigint,
  collection text not null check (collection in ('docket_filings', 'court_mdl_pages', 'govinfo_court_opinions')),
  dataset text not null check (dataset in ('sw_matters_v1', 'mdls')),
  record_id text not null,
  listed_by text not null check (listed_by in ('registry_pdf_case_id', 'court_mdl_label', 'derived_master_docket')),
  mdl text not null check (mdl ~ '^[1-9][0-9]{0,5}$'),
  court_id text check (court_id ~ '^[a-z0-9_-]{1,40}$'),
  court_basis text,
  docket_number text,
  docket_basis text,
  entry_number integer,
  attachment integer,
  document_number text,
  filed_date date,
  date_basis text,
  title text,
  title_basis text,
  doc_type text,
  type_basis text,
  source_url text,
  published_record text,
  page_count integer,
  pages_with_text integer,
  ocr_pending_pages integer,
  text_status text not null check (text_status in ('text_layer', 'partial_text', 'pending_index', 'no_text_layer', 'not_extracted', 'withheld_policy')),
  withheld_reason text,
  build text not null,
  unique (source_system, native_document_id)
);
create index if not exists documents_sha on documents.documents (sha256);
create index if not exists documents_mdl_date on documents.documents (mdl, filed_date desc nulls last);
create index if not exists documents_court_date on documents.documents (court_id, filed_date desc nulls last);
create index if not exists documents_date on documents.documents (filed_date desc nulls last, id);

-- one row per stored text of a PDF (bytes): the policy outcome and the ECF header printed on its first headed page
create table if not exists documents.page_sets (
  sha256 text primary key check (sha256 ~ '^[0-9a-f]{64}$'),
  fingerprint text not null,
  status text not null check (status in ('indexed', 'withheld_policy')),
  pages integer not null default 0,
  chars bigint not null default 0,
  ocr_pages integer not null default 0,
  policy_page integer,
  ecf jsonb,
  build text not null,
  built_at timestamptz not null default now()
);

create table if not exists documents.pages (
  sha256 text not null,
  page integer not null check (page between 1 and 20000),
  chars integer not null,
  ocr boolean not null default false,
  tsv tsvector not null,
  primary key (sha256, page)
);
create index if not exists pages_tsv on documents.pages using gin (tsv);

create table if not exists documents.extractions (
  sha256 text not null,
  page integer not null,
  start_offset integer not null check (start_offset >= 0),
  end_offset integer not null,
  kind text not null check (kind in ('case_citation', 'usc', 'cfr', 'state_code', 'mdl_number', 'docket_number', 'date', 'dollar_amount')),
  matched text not null,
  normalized text,
  key text,
  value jsonb,
  resolution text not null default 'pending' check (resolution in ('pending', 'resolved', 'unresolved', 'ambiguous', 'not_applicable')),
  target_type text,
  target_id text,
  resolution_note text,
  build text not null,
  primary key (sha256, page, start_offset, kind),
  check (end_offset > start_offset and end_offset - start_offset <= 400)
);
create index if not exists extractions_pending on documents.extractions (kind) where resolution = 'pending';
create index if not exists extractions_target on documents.extractions (target_type, target_id) where resolution = 'resolved';

create table if not exists documents.links (
  document_id text not null,
  to_type text not null check (to_type in ('law_unit', 'mdl', 'record')),
  to_id text not null,
  relation text not null check (relation in ('cites', 'mentions')),
  evidence text not null check (evidence in ('exact_id', 'exact_name_in_context', 'publisher_stated')),
  mentions integer not null,
  first_page integer not null,
  pages integer[] not null,
  primary key (document_id, to_type, to_id, relation)
);
create index if not exists links_to on documents.links (to_type, to_id);

alter table documents.builds enable row level security;
alter table documents.documents enable row level security;
alter table documents.page_sets enable row level security;
alter table documents.pages enable row level security;
alter table documents.extractions enable row level security;
alter table documents.links enable row level security;
revoke all on all tables in schema documents from public, anon, authenticated;

-- ------------------------------------------------------------------------------------------------ helpers
-- The display rule for page text (scripts/ingest/gap-fill/lib.mjs WITHHELD_TEXT, word bounded).
create or replace function documents.withheld_text(p text) returns boolean
language sql immutable parallel safe set search_path = '' as $$
  select coalesce(p ~* '\m(sealed|under\s+seal|restricted|in\s+camera|ex[\s-]+parte|redact(ed|ion|ions)?)\M', false)
$$;

-- The display rule for a published description or title (docs/sw-matter-registry-contract.md §6.0, deliberately broad).
create or replace function documents.withheld_label(p text) returns boolean
language sql immutable parallel safe set search_path = '' as $$
  select coalesce(p ~* '(seal|restricted|in[\s-]*camera|ex[\s-]*parte|redact)', false)
$$;

create or replace function documents.doc_id(p_source text, p_native text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select 'd_' || left(encode(sha256(convert_to(p_source || '|' || p_native, 'UTF8')), 'hex'), 24)
$$;

-- A federal docket number written by a court ("3:16-md-02738", "1:23-cv-818-ABC") in the registry's form
-- (office:yy-type-number, judge suffix dropped, number zero-padded to five digits); null when not of that form.
create or replace function documents.docket_key(p text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select case when g is null then null else
    g[1]::integer::text || ':' || right(g[2], 2) || '-' || lower(g[3]) || '-' ||
    case when length(ltrim(g[4], '0')) >= 5 then ltrim(g[4], '0') else lpad(ltrim(g[4], '0'), 5, '0') end end
  from (select regexp_match(btrim(coalesce(p, '')), '^(\d{1,2}):(\d{2}|\d{4})-([A-Za-z]{2,4})-(\d{1,6})(-[A-Za-z0-9-]{1,20})?$') g) x
$$;

-- The CM/ECF header a court prints on every page ("Case 3:16-md-02738-MAS-RLS Document 33091 Filed 06/26/24 Page 1 of
-- 3 PageID: 123"; also "Doc #: 904 Filed: 07/07/25 Page: 3 of 3", "Doc. 1609 Filed", "Document 7361 Entered on FLSD
-- Docket 10/25/2024"): case, document number, the date (MM/DD/YY or MM/DD/YYYY, a two-digit year read as 20yy and refused
-- when later than p_today) and whether the header calls it filed or entered, page and page count. Null when the page
-- carries no complete header or the date is impossible.
create or replace function documents.ecf_header(p text, p_today date) returns jsonb
language plpgsql immutable parallel safe set search_path = '' as $$
declare m text[]; y integer; d date;
begin
  if p is null then return null; end if;
  m := regexp_match(left(p, 20000),
    'Case:?\s*(MDL\s+No\.\s*[0-9]{1,5}|[0-9]{1,2}:[0-9]{2}-[A-Za-z]{2,4}-[0-9]{1,6}(?:-[A-Za-z0-9]{1,6}){0,4})\s+(?:Document|Doc\.?)\s*#?:?\s*([0-9]{1,6}(?:-[0-9]{1,3})?)\s+(Filed:?|Entered\s+on\s+[A-Za-z]{2,6}\s+Docket:?)\s*([0-9]{1,2})/([0-9]{1,2})/([0-9]{4}|[0-9]{2})\s+Page:?\s*([0-9]{1,5})\s+of\s+([0-9]{1,5})',
    'i');
  if m is null then return null; end if;
  y := case when length(m[6]) = 4 then m[6]::integer else 2000 + m[6]::integer end;
  begin
    d := make_date(y, m[4]::integer, m[5]::integer);
  exception when others then
    return null;
  end;
  if d > p_today or d < date '1990-01-01' then return null; end if;
  return jsonb_build_object('case', m[1], 'document', m[2], 'filed', d,
    'date_kind', case when m[3] ~* '^entered' then 'entered' else 'filed' end, 'page', m[7]::integer, 'of', m[8]::integer,
    'docket', documents.docket_key(m[1]));
end $$;

-- Document type from the court's own wording: the official listing's doc_kind, else the first words of the published
-- docket description. Null (shown as "Not recorded") when neither says.
create or replace function documents.doc_type(p_kind text, p_title text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select case
    when p_kind in ('order', 'case_management_order', 'pretrial_order', 'scheduling_order', 'common_benefit_order',
                    'jpml_conditional_transfer_order', 'jpml_transfer_order', 'jpml_tag_along_transfer_order') then 'order'
    when p_kind = 'opinion_or_memorandum' then 'opinion'
    when p_kind = 'minutes' then 'minutes'
    when p_kind = 'notice' then 'notice'
    when p_kind = 'pleading_or_form_complaint' then 'complaint'
    when p_kind in ('agenda', 'form', 'instructions', 'other') then 'other'
    when t is null or t = '' then null
    when t ~ '^\[?proposed\]?\s+(order|judgment)' then 'proposed_order'
    when t ~ '^(memorandum\s+(opinion|and\s+order|&\s+order)|opinion)\M' then 'opinion'
    when t ~ '^((amended|case\s+management|pretrial|pre-trial|scheduling|protective|transfer|conditional\s+transfer|stipulated|consent|agreed|text|minute|practice\s+and\s+procedure|common\s+benefit)\s+)*order\M' then 'order'
    when t ~ '^(final\s+|amended\s+)?judgment\M' then 'judgment'
    when t ~ '^(report\s+(and|&)\s+recommendations?)\M' then 'report_recommendation'
    when t ~ '^((joint|unopposed|emergency|consent|renewed|amended|cross)\s+)*(motion|application|petition)\M' then 'motion'
    when t ~ '^((joint|supplemental|amended)\s+)*(response|opposition|memorandum\s+in\s+opposition)\M' then 'response'
    when t ~ '^((joint|supplemental)\s+)*reply\M' then 'reply'
    when t ~ '^((joint|supplemental|amended|trial|opening)\s+)*(memorandum|brief)\M' then 'brief'
    when t ~ '^(notice|praecipe)\M' then 'notice'
    when t ~ '^((joint|amended)\s+)?stipulation\M' then 'stipulation'
    when t ~ '^((amended|master|short[\s-]form|first\s+amended|second\s+amended|class\s+action)\s+)*complaint\M' then 'complaint'
    when t ~ '^answer\M' then 'answer'
    when t ~ '^(official\s+)?transcript\M' then 'transcript'
    when t ~ '^(declaration|affidavit)\M' then 'declaration'
    when t ~ '^exhibits?\M' then 'exhibit'
    when t ~ '^letter\M' then 'letter'
    when t ~ '^minute\s+(entry|order)\M' then 'minutes'
    when t ~ '^objections?\M' then 'objection'
    else null end
  from (select lower(btrim(regexp_replace(coalesce(p_title, ''), '^\s*entry\s+[0-9]+\s*[^[:alnum:]]+\s*', '', 'i'))) as t) x
$$;

create or replace function documents.text_query(p text) returns tsquery
language plpgsql immutable parallel safe set search_path = '' as $$
declare q tsquery;
begin
  if p is null or btrim(p) = '' or length(p) > 300 then return null; end if;
  q := websearch_to_tsquery('english', p);
  if numnode(q) = 0 then return null; end if;
  return q;
end $$;

-- What the stored text of these bytes is right now: changes when the text pipeline re-extracts or OCRs pages.
create or replace function documents.text_fingerprint(t corpus_ingest.pdf_texts) returns text
language sql stable set search_path = '' as $$
  select md5(concat_ws('|', t.status, t.page_count, t.pages_with_text, t.ocr_pending_pages, t.chars, t.text_sha256,
                       t.extractor_version, t.extracted_at))
$$;

create or replace function documents.is_open(p_source text, p_native text) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from corpus_ingest.pdf_document_assets a
                 where a.source_system = p_source and a.native_document_id = p_native
                   and public.corpus_pdf_availability_v1(a.source_system, a.provider_flags) = 'open')
$$;

create or replace function documents.summary(d documents.documents) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', d.id, 'collection', d.collection, 'source_system', d.source_system,
    'native_document_id', d.native_document_id, 'native_case_id', d.native_case_id, 'mdl', d.mdl, 'listed_by', d.listed_by,
    'court_id', d.court_id, 'docket_number', d.docket_number, 'entry_number', d.entry_number, 'attachment', d.attachment,
    'document_number', d.document_number, 'filed_date', d.filed_date, 'date_basis', d.date_basis, 'title', d.title,
    'title_basis', d.title_basis, 'doc_type', d.doc_type, 'page_count', d.page_count, 'pages_with_text', d.pages_with_text,
    'text_status', d.text_status, 'source_url', d.source_url, 'bytes', d.bytes)
$$;

-- ------------------------------------------------------------------------------------------------ build: documents
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

  -- open associations of those case ids, one per document
  create temp table _doc_cand on commit drop as
  select distinct on (a.source_system, a.native_document_id)
         a.source_system, a.native_document_id, a.native_case_id, a.sha256, a.durable_url, a.origins, k.mdl, k.basis
    from corpus_ingest.pdf_document_assets a
    join _doc_keys k on k.case_id = a.native_case_id and k.n_mdl = 1
   where a.source_system in ('docketbird', 'courtlistener', 'official-court', 'govinfo')
     and public.corpus_pdf_availability_v1(a.source_system, a.provider_flags) = 'open'
   order by a.source_system, a.native_document_id, a.verified_at desc;

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
    case m.basis when 'registry_pdf_case_id' then 'sw_matters_v1' else 'mdls' end as dataset,
    case m.basis when 'registry_pdf_case_id' then 'sw-matter:' || m.mdl else m.mdl end as record_id,
    m.basis as listed_by, m.mdl,
    -- court: the registry docket row of this case id, else the MDL's transferee court (JPML) for MDL-page and derived
    -- documents, else the court the official listing names; kept only when the court directory has that exact id
    (select cc.id from public.corpus_records cc where cc.dataset = 'court_spine'
        and cc.id = coalesce(m.reg_court, case when m.basis <> 'registry_pdf_case_id' then m.mdl_rec ->> 'court' end,
                             m.listing ->> 'court_id', m.dbid[2])) as court_id,
    case when m.reg_court is not null then 'Matter registry docket'
         when m.basis <> 'registry_pdf_case_id' and m.mdl_rec ->> 'court' is not null then 'MDL transferee court (JPML)'
         when m.listing ->> 'court_id' is not null then 'Court named by the listing'
         when m.dbid is not null then 'Court prefix of the DocketBird case id' end as court_basis,
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
    'withheld_reasons', (select coalesce(jsonb_object_agg(withheld_reason, n), '{}'::jsonb)
                           from (select withheld_reason, count(*) n from documents.documents where withheld_reason is not null group by 1) s),
    'with_filed_date', (select count(*) from documents.documents where filed_date is not null),
    'with_court', (select count(*) from documents.documents where court_id is not null))
  into v_counts;
  update documents.builds set steps = steps || jsonb_build_object('refresh', v_counts || jsonb_build_object('at', now())) where build = p_build;
  return v_counts;
end $$;

-- ------------------------------------------------------------------------------------------------ build: pages
-- Indexes up to p_limit byte sets whose stored text changed since they were last indexed (or that the retired keyword
-- rule withheld): one english tsvector per page and the first ECF header. Bytes of a source-withheld entry are skipped.
create or replace function public.documents_build_pages_v1(p_build text, p_limit integer default 100) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s record; v_ecf jsonb; v_pages integer; v_chars bigint; v_ocr integer; v_n integer;
  n_indexed integer := 0; n_withheld integer := 0; n_pages integer := 0; v_remaining integer;
begin
  if p_build is null or p_build !~ '^[a-z0-9_.-]{1,40}$' then raise exception 'Invalid build' using errcode = '22023'; end if;
  if p_limit is null or p_limit not between 1 and 2000 then raise exception 'Invalid limit' using errcode = '22023'; end if;
  insert into documents.builds(build) values (p_build) on conflict (build) do nothing;
  for s in
    select t.sha256, documents.text_fingerprint(t) as fp
      from corpus_ingest.pdf_texts t
     where t.sha256 in (select d.sha256 from documents.documents d where d.text_status = 'pending_index')
       and not exists (select 1 from documents.documents w where w.sha256 = t.sha256 and w.text_status = 'withheld_policy'
                         and w.withheld_reason in ('entry_withheld', 'description_policy', 'same_bytes_withheld'))
     order by t.sha256
     limit p_limit
  loop
    with gone as (delete from documents.pages p where p.sha256 = s.sha256 returning 1) select count(*) into v_n from gone;
    with gone as (delete from documents.extractions e where e.sha256 = s.sha256 returning 1) select count(*) into v_n from gone;
    insert into documents.pages (sha256, page, chars, ocr, tsv)
    select p.sha256, p.page, p.chars, p.engine = 'surya-ocr', to_tsvector('english', p.text)
      from corpus_ingest.pdf_text_pages p where p.sha256 = s.sha256;
    get diagnostics v_pages = row_count;
    select coalesce(sum(p.chars), 0), count(*) filter (where p.engine = 'surya-ocr') into v_chars, v_ocr
      from corpus_ingest.pdf_text_pages p where p.sha256 = s.sha256;
    select documents.ecf_header(p.text, current_date) || jsonb_build_object('at_page', p.page) into v_ecf
      from corpus_ingest.pdf_text_pages p
     where p.sha256 = s.sha256 and documents.ecf_header(p.text, current_date) is not null
     order by p.page limit 1;
    insert into documents.page_sets as ps (sha256, fingerprint, status, pages, chars, ocr_pages, policy_page, ecf, build, built_at)
    values (s.sha256, s.fp, 'indexed', v_pages, v_chars, v_ocr, null, v_ecf, p_build, now())
    on conflict (sha256) do update set fingerprint = excluded.fingerprint, status = excluded.status, pages = excluded.pages,
      chars = excluded.chars, ocr_pages = excluded.ocr_pages, policy_page = null, ecf = excluded.ecf, build = excluded.build,
      built_at = excluded.built_at;
    update documents.documents d
       set text_status = case when t.status = 'complete' then 'text_layer' else 'partial_text' end, withheld_reason = null
      from corpus_ingest.pdf_texts t
     where d.sha256 = s.sha256 and t.sha256 = s.sha256 and d.text_status = 'pending_index';
    n_indexed := n_indexed + 1; n_pages := n_pages + v_pages;
  end loop;
  select count(distinct d.sha256) into v_remaining from documents.documents d where d.text_status = 'pending_index';
  update documents.builds set steps = steps || jsonb_build_object('pages', coalesce(steps -> 'pages', '{}'::jsonb)
    || jsonb_build_object('indexed', coalesce((steps -> 'pages' ->> 'indexed')::integer, 0) + n_indexed,
                          'withheld', coalesce((steps -> 'pages' ->> 'withheld')::integer, 0) + n_withheld,
                          'pages', coalesce((steps -> 'pages' ->> 'pages')::integer, 0) + n_pages, 'at', now()))
   where build = p_build;
  return jsonb_build_object('indexed', n_indexed, 'withheld', n_withheld, 'pages', n_pages, 'remaining', v_remaining);
end $$;

-- ------------------------------------------------------------------------------------------------ extraction exchange
-- Page text for the deterministic extractor (scripts/documents): only bytes indexed above, after p_after, by sha256.
create or replace function public.documents_export_pages_v1(p_after text default '', p_limit integer default 25) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_shas text[]; v_pages jsonb;
begin
  if p_limit is null or p_limit not between 1 and 200 or length(coalesce(p_after, '')) > 64 then
    raise exception 'Invalid page' using errcode = '22023'; end if;
  select array_agg(s.sha256 order by s.sha256) into v_shas
    from (select ps.sha256 from documents.page_sets ps
           where ps.status = 'indexed' and ps.sha256 > coalesce(p_after, '')
             and exists (select 1 from documents.documents d where d.sha256 = ps.sha256 and d.text_status in ('text_layer', 'partial_text'))
           order by ps.sha256 limit p_limit) s;
  if v_shas is null then return jsonb_build_object('pages', '[]'::jsonb, 'last', null); end if;
  select coalesce(jsonb_agg(jsonb_build_object('sha256', p.sha256, 'page', p.page, 'text', p.text) order by p.sha256, p.page), '[]'::jsonb)
    into v_pages from corpus_ingest.pdf_text_pages p where p.sha256 = any(v_shas);
  return jsonb_build_object('pages', v_pages, 'last', v_shas[cardinality(v_shas)]);
end $$;

-- Extractions from scripts/documents. A row is accepted only when its bytes are indexed, the page exists and the stored
-- page text holds exactly `matched` at [start, end) (code points); everything else is rejected and counted.
create or replace function public.documents_load_extractions_v1(p_build text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r jsonb; v_text text; v_start integer; v_end integer; v_kind text; v_key text; v_why text;
  n_ok integer := 0; v_rejected jsonb := '{}'::jsonb; v_sample jsonb := '[]'::jsonb;
begin
  if p_build is null or p_build !~ '^[a-z0-9_.-]{1,40}$' then raise exception 'Invalid build' using errcode = '22023'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 5000 then
    raise exception 'Invalid extraction batch' using errcode = '22023'; end if;
  insert into documents.builds(build) values (p_build) on conflict (build) do nothing;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_why := null; v_kind := r ->> 'kind'; v_key := r ->> 'key';
    begin
      v_start := (r ->> 'start')::integer; v_end := (r ->> 'end')::integer;
    exception when others then v_why := 'bad_offsets';
    end;
    if v_why is null and (v_kind is null or v_kind not in ('case_citation', 'usc', 'cfr', 'state_code', 'mdl_number', 'docket_number', 'date', 'dollar_amount')) then
      v_why := 'bad_kind'; end if;
    if v_why is null and (v_start is null or v_end is null or v_start < 0 or v_end <= v_start or v_end - v_start > 400) then
      v_why := 'bad_offsets'; end if;
    if v_why is null and not exists (select 1 from documents.page_sets ps where ps.sha256 = r ->> 'sha256' and ps.status = 'indexed') then
      v_why := 'bytes_not_indexed'; end if;
    if v_why is null then
      select p.text into v_text from corpus_ingest.pdf_text_pages p
       where p.sha256 = r ->> 'sha256' and p.page = (r ->> 'page')::integer;
      if v_text is null then v_why := 'no_such_page';
      elsif substr(v_text, v_start + 1, v_end - v_start) is distinct from r ->> 'matched' then v_why := 'text_mismatch';
      end if;
    end if;
    if v_why is null and not (case v_kind
        when 'usc' then coalesce(v_key ~ '^usc:[0-9]{1,2}a?:[0-9][0-9A-Za-z.-]{0,40}(:[0-9][0-9A-Za-z.-]{0,40})?$', false)
        when 'cfr' then coalesce(v_key ~ '^cfr:[0-9]{1,2}:[0-9]{1,5}\.[0-9][0-9A-Za-z()-]{0,40}(:[0-9]{1,5}(\.[0-9][0-9A-Za-z()-]{0,40})?)?$', false)
                        or coalesce(v_key ~ '^cfr-part:[0-9]{1,2}:[0-9]{1,5}(:[0-9]{1,5})?$', false)
        when 'case_citation' then coalesce(v_key ~ '^case:[0-9]{1,4} [^ ].{0,40} [0-9]{1,7}$', false)
        when 'mdl_number' then coalesce(v_key ~ '^mdl:[1-9][0-9]{0,5}$', false)
        else v_key is null or length(v_key) <= 200 end) then
      v_why := 'bad_key'; end if;
    if v_why is not null then
      v_rejected := v_rejected || jsonb_build_object(v_why, coalesce((v_rejected ->> v_why)::integer, 0) + 1);
      if jsonb_array_length(v_sample) < 10 then
        v_sample := v_sample || jsonb_build_array(jsonb_build_object('why', v_why, 'row', r)); end if;
      continue;
    end if;
    insert into documents.extractions as e (sha256, page, start_offset, end_offset, kind, matched, normalized, key, value,
      resolution, target_type, target_id, resolution_note, build)
    values (r ->> 'sha256', (r ->> 'page')::integer, v_start, v_end, v_kind, r ->> 'matched', left(r ->> 'normalized', 400),
      v_key, case when jsonb_typeof(r -> 'value') = 'object' then r -> 'value' end, 'pending', null, null, null, p_build)
    on conflict (sha256, page, start_offset, kind) do update set end_offset = excluded.end_offset, matched = excluded.matched,
      normalized = excluded.normalized, key = excluded.key, value = excluded.value, resolution = 'pending', target_type = null,
      target_id = null, resolution_note = null, build = excluded.build;
    n_ok := n_ok + 1;
  end loop;
  return jsonb_build_object('accepted', n_ok, 'rejected', v_rejected, 'rejected_sample', v_sample);
end $$;

-- Exact resolution of pending extractions (at most p_limit per call).
create or replace function public.documents_resolve_v1(p_limit integer default 50000) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n integer; v_pending integer;
begin
  if p_limit is null or p_limit not between 1 and 200000 then raise exception 'Invalid limit' using errcode = '22023'; end if;
  with batch as (
    select e.sha256, e.page, e.start_offset, e.kind, e.key, string_to_array(e.key, ':') as k
      from documents.extractions e where e.resolution = 'pending'
     order by e.sha256, e.page, e.start_offset, e.kind limit p_limit),
  res as (
    select b.sha256, b.page, b.start_offset, b.kind,
      case
        when b.kind = 'usc' and cardinality(b.k) = 3 then
          case when exists (select 1 from public.corpus_records r where r.dataset = 'us_code_sections' and r.id = b.k[2] || ':' || b.k[3])
               then jsonb_build_array('resolved', 'law_unit', 'usc:' || b.k[2] || ':' || b.k[3], null)
               else jsonb_build_array('unresolved', null, null, 'no current U.S. Code section with this number') end
        when b.kind = 'usc' then jsonb_build_array('unresolved', null, null, 'section range')
        when b.kind = 'cfr' and cardinality(b.k) = 3 then
          case when exists (select 1 from public.corpus_records r where r.dataset = 'federal_regulations_parts'
                              and r.id = 'cfr:' || b.k[2] || ':' || split_part(b.k[3], '.', 1))
               then jsonb_build_array('resolved', 'law_unit', 'cfr:' || b.k[2] || ':' || split_part(b.k[3], '.', 1), null)
               else jsonb_build_array('unresolved', null, null, 'no CFR part with this number') end
        when b.kind = 'cfr' then jsonb_build_array('unresolved', null, null, 'section or part range')
        when b.kind = 'case_citation' then
          (select case count(*) when 1 then jsonb_build_array('resolved', 'record', 'caselaw/' || min(c.cluster_id), null)
                                when 0 then jsonb_build_array('unresolved', null, null, 'no case with this exact citation')
                                else jsonb_build_array('ambiguous', null, null, count(*) || ' cases carry this citation') end
             from (select c.cluster_id from caselaw.cases c
                    where c.cite_keys @> array[caselaw.cite_key(substr(b.key, 6))] limit 3) c)
        when b.kind = 'mdl_number' then
          case when exists (select 1 from public.corpus_records r where r.dataset = 'mdls' and r.id = substr(b.key, 5))
               then jsonb_build_array('resolved', 'mdl', substr(b.key, 5), null)
               else jsonb_build_array('unresolved', null, null, 'no MDL record with this number') end
        when b.kind = 'state_code' then jsonb_build_array('unresolved', null, null, 'state code sections are not resolved in documents/1')
        else jsonb_build_array('not_applicable', null, null, null) end as v
      from batch b)
  update documents.extractions e
     set resolution = res.v ->> 0, target_type = res.v ->> 1, target_id = res.v ->> 2, resolution_note = res.v ->> 3
    from res
   where e.sha256 = res.sha256 and e.page = res.page and e.start_offset = res.start_offset and e.kind = res.kind;
  get diagnostics n = row_count;
  select count(*) into v_pending from documents.extractions where resolution = 'pending';
  return jsonb_build_object('resolved_batch', n, 'pending', v_pending,
    'by_resolution', (select jsonb_object_agg(kind || ':' || resolution, c) from (select kind, resolution, count(*) c from documents.extractions group by 1, 2) s));
end $$;

-- Rebuilds documents.links from resolved extractions of every document that serves its text.
create or replace function public.documents_link_v1() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  -- every link (document_id is never null); the explicit condition is required for requests through the API
  delete from documents.links where document_id is not null;
  insert into documents.links (document_id, to_type, to_id, relation, evidence, mentions, first_page, pages)
  select d.id, e.target_type, e.target_id, case e.kind when 'mdl_number' then 'mentions' else 'cites' end, 'exact_id',
         count(*), min(e.page), (array_agg(distinct e.page order by e.page))[1:20]
    from documents.extractions e
    join documents.documents d on d.sha256 = e.sha256 and d.text_status in ('text_layer', 'partial_text')
   where e.resolution = 'resolved' and e.target_type is not null and e.target_id is not null
   group by d.id, e.target_type, e.target_id, case e.kind when 'mdl_number' then 'mentions' else 'cites' end;
  get diagnostics n = row_count;
  return jsonb_build_object('links', n,
    'by_target', (select jsonb_object_agg(to_type || ':' || relation, c) from (select to_type, relation, count(*) c from documents.links group by 1, 2) s));
end $$;

-- ------------------------------------------------------------------------------------------------ read RPCs
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
                 (select (j.r).mdl k, count(*) n from joined j group by 1 order by 2 desc, 1 limit 60) f),
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

create or replace function public.documents_document_v1(p_id text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare d documents.documents; v jsonb;
begin
  if p_id is null or p_id !~ '^d_[0-9a-f]{24}$' then raise exception 'Invalid document' using errcode = '22023'; end if;
  select * into d from documents.documents x where x.id = p_id;
  if not found or not documents.is_open(d.source_system, d.native_document_id) then return null; end if;
  select documents.summary(d) || jsonb_build_object(
    'dataset', d.dataset, 'record_id', d.record_id, 'court_basis', d.court_basis, 'docket_basis', d.docket_basis,
    'type_basis', d.type_basis, 'published_record', d.published_record, 'withheld_reason', d.withheld_reason,
    'ocr_pending_pages', d.ocr_pending_pages,
    'ocr_pages', (select ps.ocr_pages from documents.page_sets ps where ps.sha256 = d.sha256 and ps.status = 'indexed'),
    'indexed_pages', (select ps.pages from documents.page_sets ps where ps.sha256 = d.sha256 and ps.status = 'indexed'),
    'extractions', case when d.text_status in ('text_layer', 'partial_text') then
       (select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) from (select e.kind, count(*) n from documents.extractions e where e.sha256 = d.sha256 group by 1) s)
       else '{}'::jsonb end,
    'links', (select coalesce(jsonb_agg(jsonb_build_object('to_type', l.to_type, 'to_id', l.to_id, 'relation', l.relation,
                'evidence', l.evidence, 'mentions', l.mentions, 'first_page', l.first_page,
                'cited_as', (select e.normalized from documents.extractions e
                              where e.sha256 = d.sha256 and e.resolution = 'resolved' and e.target_type = l.to_type
                                and e.target_id = l.to_id order by e.page, e.start_offset limit 1))
                order by l.mentions desc, l.to_id), '[]'::jsonb)
                from (select * from documents.links l where l.document_id = d.id order by l.mentions desc, l.to_id limit 100) l),
    'amounts', case when d.text_status in ('text_layer', 'partial_text') then
       (select coalesce(jsonb_agg(jsonb_build_object('page', e.page, 'matched', e.matched, 'value', e.value) order by e.page, e.start_offset), '[]'::jsonb)
          from (select * from documents.extractions e where e.sha256 = d.sha256 and e.kind = 'dollar_amount'
                 order by e.page, e.start_offset limit 50) e)
       else '[]'::jsonb end)
  into v;
  return v;
end $$;

-- Documents for a court, a judge (MDLs whose published record links that judge as transferee judge), an MDL, a law unit
-- (usc:<title>:<section> or cfr:<title>:<part>, by resolved citations) or a case (CourtListener cluster id, by citations).
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
      when 'court' then 'Documents whose docket is in this court (matter registry docket, MDL transferee court or listing court).'
      when 'judge' then 'Documents filed in MDLs whose published MDL record links this judge as transferee judge (JPML report). The judge did not necessarily write them.'
      when 'mdl' then 'Documents listed for this MDL: matter registry case ids, the court''s MDL page, or the JPML master docket.'
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

-- Links in the insights/1 Link shape: outgoing for a document (p_type 'record', p_id 'documents/<id>'), else incoming to
-- an entity (mdl, law_unit, or 'record' 'caselaw/<cluster id>'). Listing links (document -> MDL / court) are included.
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
      from documents.documents d where (v_doc is not null and d.id = v_doc) or (v_doc is null and p_type = 'mdl' and d.mdl = p_id)
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

create or replace function public.documents_status_v1() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'documents', (select count(*) from documents.documents),
    'by_text_status', (select coalesce(jsonb_object_agg(text_status, n), '{}'::jsonb) from (select text_status, count(*) n from documents.documents group by 1) s),
    'by_collection', (select coalesce(jsonb_object_agg(collection, n), '{}'::jsonb) from (select collection, count(*) n from documents.documents group by 1) s),
    'mdls', (select count(distinct mdl) from documents.documents),
    'courts', (select count(distinct court_id) from documents.documents),
    'pages_indexed', (select count(*) from documents.pages),
    'extractions', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (select kind || ':' || resolution k, count(*) n from documents.extractions group by 1) s),
    'links', (select count(*) from documents.links),
    'builds', (select coalesce(jsonb_object_agg(build, steps), '{}'::jsonb) from (select * from documents.builds order by started_at desc limit 5) b),
    'bytes', jsonb_build_object('documents', pg_total_relation_size('documents.documents'), 'pages', pg_total_relation_size('documents.pages'),
                                'extractions', pg_total_relation_size('documents.extractions'), 'links', pg_total_relation_size('documents.links')))
$$;

do $grants$
declare f text;
begin
  foreach f in array array[
    'public.documents_refresh_v1(text)', 'public.documents_build_pages_v1(text,integer)',
    'public.documents_export_pages_v1(text,integer)', 'public.documents_load_extractions_v1(text,jsonb)',
    'public.documents_resolve_v1(integer)', 'public.documents_link_v1()',
    'public.documents_search_v1(text,text,text,date,date,text,text,integer,integer)', 'public.documents_document_v1(text)',
    'public.documents_for_entity_v1(text,text,integer)', 'public.documents_links_v1(text,text,text,integer)',
    'public.documents_status_v1()',
    'documents.withheld_text(text)', 'documents.withheld_label(text)', 'documents.doc_id(text,text)', 'documents.docket_key(text)',
    'documents.ecf_header(text,date)', 'documents.doc_type(text,text)', 'documents.text_query(text)',
    'documents.text_fingerprint(corpus_ingest.pdf_texts)', 'documents.is_open(text,text)', 'documents.summary(documents.documents)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $grants$;

comment on schema documents is 'documents/1: searchable, linked layer over the stored court-filing PDFs the published matter pages list (open associations only; display rule applied to page text and descriptions). Page text stays in corpus_ingest.pdf_text_pages.';

commit;
