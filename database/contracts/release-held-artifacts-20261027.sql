-- held-artifact-release/2026-10-27.1  (workstream release/held-artifact-downloads)
-- Owner decision 2026-10-27: "dont withhold any data. If its accurate and valuable, USE IT".
--
-- What is held (read-only survey 2026-10-27; packet private/acq/release-held-artifact-downloads/):
--   /api/files serves a stored file only when public.corpus_artifacts.ready = true (fetchArtifact,
--   src/lib/external/rest.server.ts). 71,174 artifact rows are ready = false. No row records a seal, restriction or
--   policy hold of its own; the flag came with the bundle imports ("availability not established",
--   docs/supabase-data-audit-2026-10-05.md), i.e. caution.
--   Every one of the 36,812 ready = true rows has its object in storage bucket corpus-originals. Of the 71,174 held rows only
--   27,730 do (size equal to the catalogued bytes; 8 of them are /api/* routes out of scope below, so 27,722 are evaluated);
--   the other 43,444 point at bytes that were never uploaded, so a ready flag would only turn "not available in the corpus"
--   into "not available in storage". Those are not touched here (restore = upload the bytes, then re-run this rule).
--
-- Dry run 2026-10-27 (scripts/admin/held-artifact-release-dryrun.mjs summary): 27,722 evaluated; 27,652 released
--   (11,935,908,095 bytes): /supplement-files/court_documents 19,993, /files 7,074, source_documents 497, mdl-pdf 24,
--   agency_science_documents 23, court_statistics 18, /mdl-files 7, source-assets 6, settlement-pdf 4, court_spine 2,
--   settlements 2. Kept: 48 /files from olls.info, 22 source_documents from content.naic.org.
--
-- Selection rule (statement 1), applied to held rows whose stored object exists with the catalogued size:
--   * provenance = the source host of every published record that links the route:
--       court_documents / agency_science_documents / source_documents / court_statistics  item.links[].url -> source_url
--         (court_documents rows without a source_url use their recorded cells.host)
--       focused / seeger  item.original_url / item.extracted_url -> source_url
--     plus an explicit list (statement 1, "explicit") for routes that only record details or a builder manifest link:
--       /mdl-files/*  (JPML CM/ECF reports, linked from 176 mdls records), /source-assets/*  (sources records),
--       /supplement-files/court_spine/* and /supplement-files/settlements/*  (detail links), /library-assets/mdl-pdf-*
--       (24 filings of D.N.J. docket 2:23-md-03080, SCRAPE local_library_presentation_20260918 mdl-3080.jsonl);
--     plus, for a route no record links, the provenance of routes holding byte-identical content (same sha256).
--   * released when every provenance host is a government/court host (.gov, .mil, .us) or on the vetted list of official
--     non-.gov publishers (state and local courts and clerks, county governments, state bars, a state agency, and
--     court-appointed settlement administrators), and none is denied.
--   * kept held, with the reason recorded in the ledger:
--       olls.info                 statute source rule: publisher of the Colorado code not confirmed (same rule and wording
--                                 as large-text-assets-release/2026-10-27.1); owner/lead confirmation releases it.
--       content.naic.org          NAIC is a private standards body that holds copyright in its manuals; owner rule 2026-10-22
--                                 (no paid/restricted licences) and the 2026-10-24 practice for private publishers' reports
--                                 (link, do not rehost). The records keep their link to naic.org.
--       trellis.law / commercial  commercial legal publishers are never a data source (none of the stored routes today).
-- Not in scope (other workstreams): /api/text/* (large-text-assets-release), /supplement-files/court_reference/*
--   (dataset-court-reference), /api/trellis-coverage/* (commercial, Trellis), /agency-files/* (no stored bytes).
--
-- Ledger: corpus_ingest.held_artifact_release_20261027, one row per evaluated route (released and kept), with hosts,
-- classes, provenance path and decision. The rollback flips exactly the ledger's released routes back.
-- ROLLBACK: database/contracts/release-held-artifacts-20261027.rollback.sql
-- VERIFY:   database/contracts/verify-release-held-artifacts-20261027.sql
--
-- Run as one transaction (psql -v ON_ERROR_STOP=1 -1 -f, or paste whole into the SQL editor).

begin;
set local statement_timeout = '900s';

-- ===== statement 0: not applied yet =====
do $$
begin
  if to_regclass('corpus_ingest.held_artifact_release_20261027') is not null then
    raise exception 'held_artifact_release_20261027 ledger exists: this release was applied' using errcode = '55000';
  end if;
end $$;

-- ===== statement 1: evaluate every held route that has its stored bytes =====
create temporary table har_eval on commit drop as
with held as (
  select a.route, a.sha256, a.bytes,
         case split_part(a.route, '/', 2)
           when 'supplement-files' then 'supplement-files/' || split_part(a.route, '/', 3)
           when 'source-assets' then 'source-assets/' || split_part(split_part(a.route, '/', 3), ':', 1)
           when 'library-assets' then 'library-assets/' || regexp_replace(split_part(a.route, '/', 3), '-[0-9a-f]+$', '')
           else split_part(a.route, '/', 2) end as family
  from public.corpus_artifacts a
  join storage.objects o on o.bucket_id = 'corpus-originals' and o.name = a.object_key
                         and (o.metadata->>'size') = a.bytes::text
  where a.ready = false
    and a.route not like '/api/%'
    and a.route not like '/agency-files/%'
    and a.route not like '/supplement-files/court_reference/%'),
explicit(route, host, via) as (values
  ('/mdl-files/jpmldoc-1113fa70c31288db', 'www.jpml.uscourts.gov', 'mdls.detail (JPML CM/ECF report)'),
  ('/mdl-files/jpmldoc-2479fadc72afd111', 'www.jpml.uscourts.gov', 'mdls.detail (JPML CM/ECF report)'),
  ('/mdl-files/jpmldoc-379b3c83a44ed33f', 'www.jpml.uscourts.gov', 'mdls.detail (JPML CM/ECF report)'),
  ('/mdl-files/jpmldoc-59249052276410b1', 'www.jpml.uscourts.gov', 'mdls.detail (JPML CM/ECF report)'),
  ('/mdl-files/jpmldoc-71b8bb13611d508d', 'www.jpml.uscourts.gov', 'mdls.detail (JPML CM/ECF report)'),
  ('/mdl-files/jpmldoc-7dd1f40b28e8433b', 'www.jpml.uscourts.gov', 'mdls.detail (JPML CM/ECF report)'),
  ('/mdl-files/jpmldoc-b1c7556abd50179a', 'www.jpml.uscourts.gov', 'mdls.detail (JPML CM/ECF report)'),
  ('/source-assets/archive:75f9ea3f6ec0989c35f008e873bb8a9b421496cd108ace851ac2bad20771c12d/original', 'courts.ca.gov', 'sources.detail pld-6f290c940224'),
  ('/source-assets/archive:9b0b48cceee2462b320ebbe07b37b4ee24945688f87e5a077ad8faefd26a5d4e/original', 'courts.ms.gov', 'sources.detail pld-74a80589ff7e'),
  ('/source-assets/archive:eb2e10206d64f98f1d948f1f0f2b54dfac7fd430a7b74b818b4d79e856e3965e/original', 'courts.delaware.gov', 'sources.detail pld-ea2884463998'),
  ('/source-assets/gapfill:5b616968f1e3089759035bb6/original', 'www.courts.phila.gov', 'sources.detail pld-346a82441b38'),
  ('/source-assets/gapfill:6b314a776dcf9db0beed52cc/original', 'www.jud11.flcourts.org', 'sources.detail pld-6fe939ada1c6'),
  ('/source-assets/gapfill:7b8c479bc40b343732d768bb/original', 'ars.apps.lara.state.mi.us', 'sources.detail pld-7335babd117b'),
  ('/source-assets/gapfill:7eea963ab30823d636814c49/original', 'courts.ca.gov', 'sources.detail pld-1a28a5dddc0f'),
  ('/source-assets/gapfill:cf4101e11354e5f6cb00a168/original', 'www.jud11.flcourts.org', 'sources.detail pld-1be89a3ee26b'),
  ('/supplement-files/court_spine/logo_21bef4871fc4b187', 'www.courts.phila.gov', 'court_spine.detail pactcomplphilad (identity mark)'),
  ('/supplement-files/court_spine/logo_bb2379ebcdade3c3', 'www.lacourt.ca.gov', 'court_spine.detail calsuppctla (identity mark)'),
  ('/supplement-files/settlements/stlfile-02d9cb427a9fa3f0a3cc', 'www.jpml.uscourts.gov', 'settlements.detail settlement-page-02d9cb427a9fa3f0a3cc'),
  ('/supplement-files/settlements/stlfile-26db8da4399b9a11116e', 'www.jpml.uscourts.gov', 'settlements.detail settlement-page-26db8da4399b9a11116e'),
  ('/library-assets/mdl-pdf-087e6d989c8aa8a0f21da959', 'njd.uscourts.gov', 'mdl-3080.jsonl docket 2:23-md-03080 (D.N.J.)'),
  ('/library-assets/mdl-pdf-11a0c317617783649232d167', 'njd.uscourts.gov', 'mdl-3080.jsonl docket 2:23-md-03080 (D.N.J.)'),
  ('/library-assets/mdl-pdf-1d6a0bbac56081b5c1f2ab84', 'njd.uscourts.gov', 'mdl-3080.jsonl docket 2:23-md-03080 (D.N.J.)'),
  ('/library-assets/mdl-pdf-2a062603e9ef4b5056581a88', 'njd.uscourts.gov', 'mdl-3080.jsonl docket 2:23-md-03080 (D.N.J.)'),
  ('/library-assets/mdl-pdf-2b0d6b9719b930a0314529b0', 'njd.uscourts.gov', 'mdl-3080.jsonl docket 2:23-md-03080 (D.N.J.)'),
  ('/library-assets/mdl-pdf-3abf2a3ff444e20147c0d2c6', 'njd.uscourts.gov', 'mdl-3080.jsonl docket 2:23-md-03080 (D.N.J.)'),
  ('/library-assets/mdl-pdf-3ec163dbaf271d0c3350b744', 'njd.uscourts.gov', 'mdl-3080.jsonl docket 2:23-md-03080 (D.N.J.)'),
  ('/library-assets/mdl-pdf-47704f1d76e729806abf0347', 'njd.uscourts.gov', 'mdl-3080.jsonl docket 2:23-md-03080 (D.N.J.)'),
  ('/library-assets/mdl-pdf-4f687a5a09a3ea65a3c12d21', 'njd.uscourts.gov', 'mdl-3080.jsonl docket 2:23-md-03080 (D.N.J.)'),
  ('/library-assets/mdl-pdf-7da8914be81b5b9a0c51a2eb', 'njd.uscourts.gov', 'mdl-3080.jsonl docket 2:23-md-03080 (D.N.J.)'),
  ('/library-assets/mdl-pdf-811179eca558a7773070b948', 'njd.uscourts.gov', 'mdl-3080.jsonl docket 2:23-md-03080 (D.N.J.)'),
  ('/library-assets/mdl-pdf-85e31c3c0603a4910207789c', 'njd.uscourts.gov', 'mdl-3080.jsonl docket 2:23-md-03080 (D.N.J.)'),
  ('/library-assets/mdl-pdf-8af01cc3d07ffe58caa61c0f', 'njd.uscourts.gov', 'mdl-3080.jsonl docket 2:23-md-03080 (D.N.J.)'),
  ('/library-assets/mdl-pdf-9666d408c2c3d26d4003334c', 'njd.uscourts.gov', 'mdl-3080.jsonl docket 2:23-md-03080 (D.N.J.)'),
  ('/library-assets/mdl-pdf-9edb07792b589da9b57e20e2', 'njd.uscourts.gov', 'mdl-3080.jsonl docket 2:23-md-03080 (D.N.J.)'),
  ('/library-assets/mdl-pdf-c08e1de8065b53ac7aa8a05c', 'njd.uscourts.gov', 'mdl-3080.jsonl docket 2:23-md-03080 (D.N.J.)'),
  ('/library-assets/mdl-pdf-d07c466c49784bbdd3ee2718', 'njd.uscourts.gov', 'mdl-3080.jsonl docket 2:23-md-03080 (D.N.J.)'),
  ('/library-assets/mdl-pdf-d6515a5c3be7d98ff562e32d', 'njd.uscourts.gov', 'mdl-3080.jsonl docket 2:23-md-03080 (D.N.J.)'),
  ('/library-assets/mdl-pdf-d9784b5d045b5301a9bdd278', 'njd.uscourts.gov', 'mdl-3080.jsonl docket 2:23-md-03080 (D.N.J.)'),
  ('/library-assets/mdl-pdf-f0509d0a4ff92defa4c55769', 'njd.uscourts.gov', 'mdl-3080.jsonl docket 2:23-md-03080 (D.N.J.)'),
  ('/library-assets/mdl-pdf-f656da536544166f66678679', 'njd.uscourts.gov', 'mdl-3080.jsonl docket 2:23-md-03080 (D.N.J.)'),
  ('/library-assets/mdl-pdf-fa3155b94c1095141f0bceb8', 'njd.uscourts.gov', 'mdl-3080.jsonl docket 2:23-md-03080 (D.N.J.)'),
  ('/library-assets/mdl-pdf-fb83afc124c107219b7ab45e', 'njd.uscourts.gov', 'mdl-3080.jsonl docket 2:23-md-03080 (D.N.J.)'),
  ('/library-assets/mdl-pdf-fbed6ef4c3b1964ae9d6433a', 'njd.uscourts.gov', 'mdl-3080.jsonl docket 2:23-md-03080 (D.N.J.)')),
direct as (
  select l->>'url' as route,
         lower(coalesce(substring(nullif(r.source_url, '') from '^https?://([^/:?#]+)'), nullif(r.item->'cells'->>'host', ''))) as host,
         r.dataset || '.item.links' as via
  from public.corpus_records r
  cross join lateral jsonb_array_elements(case when jsonb_typeof(r.item->'links') = 'array' then r.item->'links' else '[]'::jsonb end) l
  where r.dataset in ('court_documents', 'agency_science_documents', 'source_documents', 'court_statistics')
    and l->>'url' like '/supplement-files/%'
  union all
  select u.route,
         lower(substring(coalesce(nullif(r.source_url, ''), r.item->>'source_url') from '^https?://([^/:?#]+)')),
         r.dataset || '.item.' || u.k
  from public.corpus_records r
  cross join lateral (values ('original_url', r.item->>'original_url'), ('extracted_url', r.item->>'extracted_url')) u(k, route)
  where r.dataset in ('focused', 'seeger') and u.route like '/files/%'
  union all
  select route, host, via from explicit),
own as (  -- provenance of the held routes themselves
  select h.route, d.host, d.via from held h join direct d on d.route = h.route),
inherited as (  -- routes no record links: provenance of byte-identical linked routes (held or ready)
  select h.route, d.host, 'same sha256 as ' || b.route || ' <- ' || d.via as via
  from held h
  join public.corpus_artifacts b on b.sha256 = h.sha256 and b.route <> h.route
  join direct d on d.route = b.route
  where not exists (select 1 from own o where o.route = h.route)),
prov as (select route, host, via, false as inherited from own union all select route, host, via, true from inherited),
vetted(host, class) as (values
  -- state and local courts, judicial circuits and clerks of court on non-.gov domains
  ('www.lasc.org', 'official_court'), ('www.sccourts.org', 'official_court'), ('www.oscn.net', 'official_court'),
  ('flcourts18.org', 'official_court'), ('jud10.flcourts.org', 'official_court'), ('jud14.flcourts.org', 'official_court'),
  ('www.17th.flcourts.org', 'official_court'), ('www.jud10.flcourts.org', 'official_court'), ('www.jud12.flcourts.org', 'official_court'),
  ('www.jud11.flcourts.org', 'official_court'),
  ('circuit7.org', 'official_court'), ('circuit8.org', 'official_court'), ('www.circuit5.org', 'official_court'),
  ('www.circuit19.org', 'official_court'), ('thirdcircuitfl.org', 'official_court'), ('ninthcircuit.org', 'official_court'),
  ('www.15thcircuit.com', 'official_court'), ('www.fljud13.org', 'official_court'), ('www.jud4.org', 'official_court'),
  ('www.jud6.org', 'official_court'), ('www.ca.cjis20.org', 'official_court'), ('keyscourts.net', 'official_court'),
  ('www.lonokecircuitclerk.com', 'official_court'), ('www.chattahoocheeclerkofcourt.com', 'official_court'),
  -- state bars (integrated bars under their state supreme courts)
  ('www.azbar.org', 'official_state_bar'), ('www.montanabar.org', 'official_state_bar'),
  -- state agency
  ('www.oha.org', 'official_state_agency'),
  -- court-appointed settlement administrators (court-approved notices and forms)
  ('cw.simpluris.com', 'settlement_administrator'), ('www.genericdrugsendpayersettlement.com', 'settlement_administrator'),
  ('www.seniorcarecopaysettlement.com', 'settlement_administrator'),
  -- county and municipal governments' own sites (recorded as such by the published focused records)
  ('abbevillecountysc.com', 'official_local_government'), ('adaircountymissouri.com', 'official_local_government'),
  ('alfalfa.okcounties.org', 'official_local_government'), ('allencountyohio.com', 'official_local_government'),
  ('alpenacounty.org', 'official_local_government'), ('andrewcounty.org', 'official_local_government'),
  ('atkinsoncounty.org', 'official_local_government'), ('baconcounty.org', 'official_local_government'),
  ('batescounty.net', 'official_local_government'), ('beaver.okcounties.org', 'official_local_government'),
  ('beckham.okcounties.org', 'official_local_government'), ('berriencountygeorgia.com', 'official_local_government'),
  ('blaine.okcounties.org', 'official_local_government'), ('bleckley.org', 'official_local_government'),
  ('boundarycountyid.org', 'official_local_government'), ('bullochcounty.net', 'official_local_government'),
  ('butlercountymo.com', 'official_local_government'), ('callawaycounty.org', 'official_local_government'),
  ('clarkcountymo.org', 'official_local_government'), ('clevelandcountyok.com', 'official_local_government'),
  ('clintoncomo.org', 'official_local_government'), ('coal.okcounties.org', 'official_local_government'),
  ('conwaycountyar.com', 'official_local_government'), ('crawfordcountyil.org', 'official_local_government'),
  ('crispcounty.com', 'official_local_government'), ('custer.okcounties.org', 'official_local_government'),
  ('custercountyidaho.org', 'official_local_government'), ('dekalbcounty.org', 'official_local_government'),
  ('delaware.okcounties.org', 'official_local_government'), ('dickeynd.com', 'official_local_government'),
  ('dodgecountyga.com', 'official_local_government'), ('dpcountyks.com', 'official_local_government'),
  ('edgarcountyillinois.com', 'official_local_government'), ('elmorecounty.org', 'official_local_government'),
  ('evanscounty.org', 'official_local_government'), ('fostercounty.com', 'official_local_government'),
  ('grant.okcounties.org', 'official_local_government'), ('grantcountyoregon.net', 'official_local_government'),
  ('greeleycounty.org', 'official_local_government'), ('greer.okcounties.org', 'official_local_government'),
  ('hempsteadcountyar.com', 'official_local_government'), ('hickorycomo.net', 'official_local_government'),
  ('hidalgocounty.org', 'official_local_government'), ('hotspringcounty.org', 'official_local_government'),
  ('jacksoncountyar.com', 'official_local_government'), ('jaycounty.net', 'official_local_government'),
  ('labettecounty.com', 'official_local_government'), ('perrycoarkansas.org', 'official_local_government'),
  ('pitkincounty.com', 'official_local_government'), ('presqueislecounty.org', 'official_local_government'),
  ('scottcountyar.com', 'official_local_government'), ('www.andersoncountysc.org', 'official_local_government'),
  ('www.ashleycountyar.com', 'official_local_government'), ('www.atokaok.org', 'official_local_government'),
  ('www.audraincounty.org', 'official_local_government'), ('www.bankscountyga.org', 'official_local_government'),
  ('www.barrowga.org', 'official_local_government'), ('www.bearlakecounty.info', 'official_local_government'),
  ('www.boonecountyar.com', 'official_local_government'), ('www.bourboncountyks.org', 'official_local_government'),
  ('www.camdencounty.com', 'official_local_government'), ('www.chautauquacountyks.com', 'official_local_government'),
  ('www.cheboygancounty.net', 'official_local_government'), ('www.chesco.org', 'official_local_government'),
  ('www.co.athensoh.org', 'official_local_government'), ('www.colletoncounty.org', 'official_local_government'),
  ('www.columbiapa.org', 'official_local_government'), ('www.columbusdeeds.com', 'official_local_government'),
  ('www.comanchecoks.org', 'official_local_government'), ('www.coshoctoncounty.net', 'official_local_government'),
  ('www.crawfordcountyga.org', 'official_local_government'), ('www.crawfordcountykansas.org', 'official_local_government'),
  ('www.creekcountyonline.com', 'official_local_government'), ('www.crosscountyar.org', 'official_local_government'),
  ('www.darcosc.com', 'official_local_government'), ('www.dccoks.org', 'official_local_government'),
  ('www.dearborncounty.org', 'official_local_government'), ('www.defiance-county.com', 'official_local_government'),
  ('www.dilloncountysc.org', 'official_local_government'), ('www.dividecountynd.org', 'official_local_government'),
  ('www.forsythco.com', 'official_local_government'), ('www.fountaincounty.net', 'official_local_government'),
  ('www.fultoncountyoh.com', 'official_local_government'), ('www.goldenvalleycounty.org', 'official_local_government'),
  ('www.greenwoodcounty.org', 'official_local_government'), ('www.guadalupecountynm.org', 'official_local_government'),
  ('www.habershamga.com', 'official_local_government'), ('www.hardingcounty.org', 'official_local_government'),
  ('www.harnett.org', 'official_local_government'), ('www.hokecounty.net', 'official_local_government'),
  ('www.independencecounty.com', 'official_local_government'), ('www.jocogov.org', 'official_local_government'),
  ('www.loganso.com', 'official_local_government'), ('www.macombgov.org', 'official_local_government'),
  ('www.mississippicountyar.org', 'official_local_government'), ('www.penobscot-county.net', 'official_local_government'),
  ('www.stancounty.com', 'official_local_government'), ('www2.auglaizecounty.org', 'official_local_government')),
classified as (
  select p.route, p.host, p.via, p.inherited,
         case
           when p.host is null then 'unknown_host'
           when p.host ~ '(^|\.)trellis\.law$' then 'deny:commercial_legal_publisher'
           when p.host ~ '(^|\.)(westlaw|lexis|lexisnexis|justia|findlaw|casetext|casemine|vlex|leagle|municode|ecode360|amlegal|codepublishing|generalcode)\.[a-z]+$'
             then 'deny:commercial_legal_publisher'
           when p.host = 'olls.info' then 'deny:statute_publisher_unconfirmed'
           when p.host = 'content.naic.org' then 'deny:private_publisher_copyright'
           when p.host ~ '\.(gov|mil|us)$' then 'official_government'
           when v.class is not null then v.class
           else 'unvetted'
         end as class
  from prov p left join vetted v on v.host = p.host)
select h.route, h.family, h.sha256, h.bytes,
       coalesce(array_agg(distinct c.host) filter (where c.host is not null), '{}') as hosts,
       coalesce(array_agg(distinct c.class) filter (where c.class is not null), '{}') as classes,
       coalesce(array_agg(distinct c.via) filter (where c.via is not null), '{}') as via,
       coalesce(bool_or(c.inherited), false) as inherited,
       case
         when count(c.route) = 0 then 'held:no_provenance'
         when bool_or(c.class like 'deny:%') then 'held:' || substr(min(c.class) filter (where c.class like 'deny:%'), 6)
         when bool_or(c.class in ('unvetted', 'unknown_host')) then 'held:unvetted_host'
         else 'released'
       end as decision
from held h left join classified c on c.route = h.route
group by h.route, h.family, h.sha256, h.bytes;

-- ===== statement 2: preflight (the evaluation must reproduce the surveyed split exactly) =====
do $$
declare v_total bigint; v_rel bigint; v_rel_bytes numeric; v_olls bigint; v_naic bigint; v_other bigint; v_trellis bigint;
begin
  select count(*), count(*) filter (where decision = 'released'), coalesce(sum(bytes) filter (where decision = 'released'), 0),
         count(*) filter (where decision = 'held:statute_publisher_unconfirmed'),
         count(*) filter (where decision = 'held:private_publisher_copyright'),
         count(*) filter (where decision not in ('released', 'held:statute_publisher_unconfirmed', 'held:private_publisher_copyright')),
         count(*) filter (where decision = 'released' and exists (select 1 from unnest(hosts) x where x like '%trellis%'))
    into v_total, v_rel, v_rel_bytes, v_olls, v_naic, v_other, v_trellis
  from har_eval;
  if v_total <> 27722 or v_rel <> 27652 or v_rel_bytes <> 11935908095 or v_olls <> 48
     or v_naic <> 22 or v_other <> 0 or v_trellis <> 0 then
    raise exception 'Evaluation differs from the survey: total % released % (% bytes) olls % naic % other % trellis %',
      v_total, v_rel, v_rel_bytes, v_olls, v_naic, v_other, v_trellis using errcode = '55000';
  end if;
end $$;

-- ===== statement 3: the ledger (private schema, not readable by anon/authenticated) =====
create table corpus_ingest.held_artifact_release_20261027 (
  route text primary key,
  family text not null,
  sha256 text not null,
  bytes bigint not null,
  provenance_hosts text[] not null,
  provenance_classes text[] not null,
  provenance_via text[] not null,
  inherited boolean not null,
  decision text not null,
  ready_before boolean not null,
  release text not null default 'held-artifact-release/2026-10-27.1',
  evaluated_at timestamptz not null default now());
comment on table corpus_ingest.held_artifact_release_20261027 is
  'held-artifact-release/2026-10-27.1: every held corpus_artifacts route with stored bytes, its provenance and decision. Rollback flips decision=released back to ready=false.';
revoke all on table corpus_ingest.held_artifact_release_20261027 from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on table corpus_ingest.held_artifact_release_20261027 from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on table corpus_ingest.held_artifact_release_20261027 from authenticated'; end if;
end $$;

insert into corpus_ingest.held_artifact_release_20261027
  (route, family, sha256, bytes, provenance_hosts, provenance_classes, provenance_via, inherited, decision, ready_before)
select route, family, sha256, bytes, hosts, classes, via, inherited, decision, false from har_eval;

-- ===== statement 4: release =====
update public.corpus_artifacts a set ready = true
from corpus_ingest.held_artifact_release_20261027 l
where l.route = a.route and l.decision = 'released' and a.ready = false;

-- ===== statement 5: postcheck =====
do $$
declare v_flipped bigint; v_missing bigint; v_trellis bigint;
begin
  select count(*) into v_flipped from public.corpus_artifacts a
    join corpus_ingest.held_artifact_release_20261027 l on l.route = a.route and l.decision = 'released' where a.ready;
  if v_flipped <> 27652 then raise exception 'Released % routes, expected 27652', v_flipped using errcode = '55000'; end if;
  select count(*) into v_missing from public.corpus_artifacts a
    left join storage.objects o on o.bucket_id = 'corpus-originals' and o.name = a.object_key
    where a.ready and o.name is null;
  if v_missing <> 0 then raise exception '% ready routes have no stored object', v_missing using errcode = '55000'; end if;
  select count(*) into v_trellis from public.corpus_artifacts where ready and route like '/api/trellis-coverage/%';
  if v_trellis <> 0 then raise exception 'Trellis receipts became ready' using errcode = '55000'; end if;
end $$;

commit;

select decision, count(*) as routes, sum(bytes) as bytes
from corpus_ingest.held_artifact_release_20261027 group by decision order by decision;
