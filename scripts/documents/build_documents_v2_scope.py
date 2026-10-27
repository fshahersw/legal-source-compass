"""Builds database/contracts/documents-v2-scope.sql and its rollback from documents-v1.sql.

Every changed function is the v1 text with exact, asserted replacements, so the diff against v1 is only the scope rule
and the exact master-docket evidence step. Run from the repository root:
  python scripts/documents/build_documents_v2_scope.py .
release/documents-locator-source-excluded builds documents-v2-sources.sql on top of this file's refresh body
(scripts/documents/build_documents_v2_sources.py).
"""
import re
import sys
from pathlib import Path

ROOT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(".")
V1 = (ROOT / "database/contracts/documents-v1.sql").read_text(encoding="utf-8")


def block(name: str) -> str:
    m = re.search(r"create or replace function public\." + name + r"\(.*?\n(end )?\$\$;\n", V1, re.S)
    assert m, name
    return m.group(0)


def sub(text: str, old: str, new: str, count: int = 1) -> str:
    n = text.count(old)
    assert n == count, (old[:80], n)
    return text.replace(old, new)


refresh = block("documents_refresh_v1")
search = block("documents_search_v1")
links = block("documents_links_v1")
status = block("documents_status_v1")

# ------------------------------------------------------------------ refresh: the scope rule
r2 = sub(
    refresh,
    """  -- open associations of those case ids, one per document
  create temp table _doc_cand on commit drop as
  select distinct on (a.source_system, a.native_document_id)
         a.source_system, a.native_document_id, a.native_case_id, a.sha256, a.durable_url, a.origins, k.mdl, k.basis
    from corpus_ingest.pdf_document_assets a
    join _doc_keys k on k.case_id = a.native_case_id and k.n_mdl = 1
   where a.source_system in ('docketbird', 'courtlistener', 'official-court', 'govinfo')
     and public.corpus_pdf_availability_v1(a.source_system, a.provider_flags) = 'open'
   order by a.source_system, a.native_document_id, a.verified_at desc;
""",
    """  -- every open association with a case id, one per document (documents/2 scope, owner decision 2026-10-27). A case id
  -- the matter pages request for exactly one MDL carries that MDL and its listing basis; every other case id (not
  -- requested, or requested for two MDLs) enters as 'docket_case' with no MDL. MDL membership is never inferred.
  -- When one document has several associations, the one with an MDL listing wins, then the latest verified.
  create temp table _doc_cand on commit drop as
  select distinct on (a.source_system, a.native_document_id)
         a.source_system, a.native_document_id, a.native_case_id, a.sha256, a.durable_url, a.origins,
         k.mdl, coalesce(k.basis, 'docket_case') as basis
    from corpus_ingest.pdf_document_assets a
    left join _doc_keys k on k.case_id = a.native_case_id and k.n_mdl = 1
   where a.source_system in ('docketbird', 'courtlistener', 'official-court', 'govinfo')
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
           regexp_match(btrim(r.detail ->> 'master_docket'), '^(\\d{1,2}):(\\d{2}|\\d{4})-([A-Za-z]{2})-0*(\\d{1,6})$') as g
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
""",
)
r2 = sub(
    r2,
    """      pg_temp._doc_dk, pg_temp._doc_new;""",
    """      pg_temp._doc_dk, pg_temp._doc_new, pg_temp._doc_mx;""",
)
r2 = sub(
    r2,
    """    case m.basis when 'registry_pdf_case_id' then 'sw_matters_v1' else 'mdls' end as dataset,
    case m.basis when 'registry_pdf_case_id' then 'sw-matter:' || m.mdl else m.mdl end as record_id,""",
    """    case m.basis when 'registry_pdf_case_id' then 'sw_matters_v1' when 'docket_case' then 'pdf_document_assets'
                 else 'mdls' end as dataset,
    case m.basis when 'registry_pdf_case_id' then 'sw-matter:' || m.mdl when 'docket_case' then left(m.native_case_id, 200)
                 else m.mdl end as record_id,""",
)
r2 = sub(
    r2,
    """    'with_filed_date', (select count(*) from documents.documents where filed_date is not null),""",
    """    'without_mdl', (select count(*) from documents.documents where mdl is null),
    'with_filed_date', (select count(*) from documents.documents where filed_date is not null),""",
)

# ------------------------------------------------------------------ search: 'none' filter, MDL facet without nulls
s2 = sub(
    search,
    """  if p_mdl is not null and p_mdl !~ '^[1-9][0-9]{0,5}$' then raise exception 'Invalid MDL' using errcode = '22023'; end if;""",
    """  if p_mdl is not null and p_mdl !~ '^([1-9][0-9]{0,5}|none)$' then raise exception 'Invalid MDL' using errcode = '22023'; end if;""",
)
s2 = sub(
    s2,
    "(p_mdl is null or d.mdl = p_mdl)",
    "(p_mdl is null or d.mdl = p_mdl or (p_mdl = 'none' and d.mdl is null))",
    count=2,
)
s2 = sub(
    s2,
    """                 (select (j.r).mdl k, count(*) n from joined j group by 1 order by 2 desc, 1 limit 60) f),""",
    """                 (select (j.r).mdl k, count(*) n from joined j where (j.r).mdl is not null group by 1 order by 2 desc, 1 limit 60) f),
      'no_mdl', (select count(*) from joined j where (j.r).mdl is null),""",
)

# ------------------------------------------------------------------ links: a filing with no MDL listing has no listed_in link
l2 = sub(
    links,
    """      from documents.documents d where (v_doc is not null and d.id = v_doc) or (v_doc is null and p_type = 'mdl' and d.mdl = p_id)""",
    """      from documents.documents d
     where d.mdl is not null and ((v_doc is not null and d.id = v_doc) or (v_doc is null and p_type = 'mdl' and d.mdl = p_id))""",
)

# ------------------------------------------------------------------ status: count filings without an MDL listing
st2 = sub(
    status,
    """    'mdls', (select count(distinct mdl) from documents.documents),""",
    """    'mdls', (select count(distinct mdl) from documents.documents),
    'without_mdl', (select count(*) from documents.documents where mdl is null),""",
)

GRANTS = """do $grants$
declare f text;
begin
  foreach f in array array[
    'public.documents_refresh_v1(text)', 'public.documents_search_v1(text,text,text,date,date,text,text,integer,integer)',
    'public.documents_links_v1(text,text,text,integer)', 'public.documents_status_v1()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $grants$;
"""

HEADER = """-- documents/2 scope — every open, unflagged court filing with a case id enters the documents layer (owner decision
-- 2026-10-27: "dont withhold any data. If its accurate and valuable, USE IT"). Apply after documents-v1.sql.
--
-- Before: a filing entered only when its native case id was one the published matter pages request for exactly one MDL
-- (sw_matters_v1 pdf_case_ids, the court MDL-page labels, or the JPML master-docket keys). Open filings of every other
-- tracked docket stayed out of search, citations and links although nothing in their source holds them back.
-- Now (documents_refresh_v1, rule 2 replaced):
--   * a case id requested for exactly one MDL keeps that MDL and its listing basis, exactly as before;
--   * every other open association with a case id (not requested, or requested for two MDLs) enters with
--     listed_by = 'docket_case', mdl = null, dataset = 'pdf_document_assets', record_id = the native case id.
--     The UI shows "MDL not linked". MDL membership is never inferred from text, caption, court or case number;
--     a check constraint keeps mdl null exactly for 'docket_case' rows;
--   * exact master-docket evidence the `mdls` dataset records links such a filing to its MDL instead (listed_by
--     'derived_master_docket'): the DocketBird form of the JPML master docket (also for MDLs the registry covers), a
--     CourtListener docket the record names as its supporting master docket, or a court-website / GovInfo case number
--     whose docket key equals the master docket's in the record's own court. A key naming two MDLs is not used.
-- Unchanged: rule 1 (open under public.corpus_pdf_availability_v1; courtlistener-public-locator is not a source of this
-- layer), rule 3 (bytes with an explicit seal / restriction / policy flag on any association, or a local
-- 'locally_flagged_sealed' occurrence, are left out), the source-flag text rule (entry_withheld / same_bytes_withheld),
-- exact links only, "Not recorded" for missing metadata.
-- Reads: documents_search_v1 accepts p_mdl = 'none' (filings with no MDL listing) and returns facets.no_mdl; its MDL
-- facet holds MDL numbers only. documents_links_v1 emits listed_in only for a filing with an MDL listing.
-- documents_status_v1 and the refresh counts add without_mdl.
-- Downstream: litviz-v1.sql (litviz_refresh_v1) skips filings without an MDL when it fills litviz.citations (mdl not
-- null); apply that file in the same release. insights.facts_citations and citations v2 already join or filter on mdl.
-- Rollback: documents-v2-scope.rollback.sql. Tests: src/lib/documents/contract.test.mjs (offline PGlite).
-- Generated from documents-v1.sql by private/acq/release-documents-matter-case-scope/build_contract.py (exact
-- replacements; every other line of the replaced functions is v1 verbatim).

begin;

alter table documents.documents alter column mdl drop not null;
alter table documents.documents drop constraint if exists documents_dataset_check;
alter table documents.documents add constraint documents_dataset_check
  check (dataset in ('sw_matters_v1', 'mdls', 'pdf_document_assets'));
alter table documents.documents drop constraint if exists documents_listed_by_check;
alter table documents.documents add constraint documents_listed_by_check
  check (listed_by in ('registry_pdf_case_id', 'court_mdl_label', 'derived_master_docket', 'docket_case'));
alter table documents.documents drop constraint if exists documents_mdl_listing_check;
alter table documents.documents add constraint documents_mdl_listing_check
  check ((listed_by = 'docket_case') = (mdl is null));

"""

FOOTER = """
comment on schema documents is 'documents/2: searchable, linked layer over every open stored court-filing PDF with a case id (open associations only; explicit seal, restriction and policy flags excluded; MDL only from explicit listings, else none). Page text stays in corpus_ingest.pdf_text_pages.';

commit;
"""

out = HEADER + "\n".join([r2, s2, l2, st2]) + "\n" + GRANTS + FOOTER
(ROOT / "database/contracts/documents-v2-scope.sql").write_text(out, encoding="utf-8", newline="\n")

RB_HEADER = """-- Rollback of documents-v2-scope.sql: back to the documents/1 scope (matter-page MDL listings only).
-- Removes the 'docket_case' filings with their links, then the page index, page sets and extractions no remaining
-- filing serves (the same clean-up documents_refresh_v1 does), restores the v1 constraints and the v1 function bodies
-- (verbatim from documents-v1.sql). The litviz_refresh_v1 filter (litviz-v1.sql) is harmless under v1 and is kept.
-- citations v2 rows of the removed filings are deleted here too (the citations run prunes edges only for byte sets it
-- processes, never for a document row that is gone); then run select insights.refresh_citations('manual') and
-- select public.litviz_refresh_v1(). Check: select count(*) from citations.edges e where e.citing_type = 'document'
--   and not exists (select 1 from documents.documents d where d.id = e.citing_id);  -- 0

begin;

delete from documents.links l using documents.documents d where d.id = l.document_id and d.listed_by = 'docket_case';
delete from documents.documents where listed_by = 'docket_case';
do $orphans$
begin
  if to_regclass('citations.edges') is not null then
    delete from citations.edges e where e.citing_type = 'document'
       and not exists (select 1 from documents.documents d where d.id = e.citing_id);
  end if;
  if to_regclass('citations.document_links') is not null then
    delete from citations.document_links l where not exists (select 1 from documents.documents d where d.id = l.document_id);
  end if;
end $orphans$;
delete from documents.pages p where not exists (select 1 from documents.documents d where d.sha256 = p.sha256
                                                  and d.text_status in ('text_layer', 'partial_text', 'pending_index'));
delete from documents.page_sets s where not exists (select 1 from documents.documents d where d.sha256 = s.sha256);
delete from documents.extractions e where not exists (select 1 from documents.documents d where d.sha256 = e.sha256
                                                        and d.text_status in ('text_layer', 'partial_text'));

alter table documents.documents drop constraint if exists documents_mdl_listing_check;
alter table documents.documents drop constraint if exists documents_listed_by_check;
alter table documents.documents add constraint documents_listed_by_check
  check (listed_by in ('registry_pdf_case_id', 'court_mdl_label', 'derived_master_docket'));
alter table documents.documents drop constraint if exists documents_dataset_check;
alter table documents.documents add constraint documents_dataset_check check (dataset in ('sw_matters_v1', 'mdls'));
alter table documents.documents alter column mdl set not null;

"""
RB_FOOTER = """
comment on schema documents is 'documents/1: searchable, linked layer over the stored court-filing PDFs the published matter pages list (open associations only; display rule applied to page text and descriptions). Page text stays in corpus_ingest.pdf_text_pages.';

commit;
"""
rb = RB_HEADER + "\n".join([refresh, search, links, status]) + "\n" + GRANTS + RB_FOOTER
(ROOT / "database/contracts/documents-v2-scope.rollback.sql").write_text(rb, encoding="utf-8", newline="\n")
print("ok", len(out), len(rb))
