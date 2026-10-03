-- judges-directory-stub-flags/2026-10-03.r4.1  (run c41d48ea-d3fb-4362-bda3-a959b127a4cb; coordinator decision 4 after the round-3 review: "FLAG ONLY, no merge")
-- Problem: 76 normalized-name groups in public.corpus_records dataset 'judges' consist of exactly ONE profile backed by the Federal Judicial Center record (structured.ids.fjc_nid)
--   plus ONE name-only profile taken from a directory listing (publisher "trellis directory", no FJC fields, career_count 0). The UI's exact-name rule (makeJudgeMatcher) links a printed
--   judge only when exactly one profile has the name, so these 76 names never link (9 of them are transferee judges of MDLs).
-- Rule (coordinator): flag a stub ONLY where the stub and the FJC-backed profile share the exact normalized name AND at least one exact court string (item.courts).
--   Result: 72 of the 76 stubs qualify. NOT flagged (4): Edward L. Artau (stub court is a Florida state court of appeal), James Rodney Gilstrap and John Gayle (stub records no court),
--   David Alan Ezra (court spelled Hawai'i vs Hawaii; an orthography variant, listed for a decision).
-- Flag on the stub (item and detail): profile_role = 'directory_stub', primary_profile_id = the FJC-backed profile's record id; detail also gets profile_role_basis (hidden from the
--   page as a "basis" field) and links = [#judge/<primary id>] so the stub's page points to the primary. NOTHING is merged, deleted or re-pointed; the FJC-backed profile and every distinct
--   record stay as they are; no other field of the stub changes. Dataset 'judge_entities' (a generic projection of the same ids without name/courts fields) is not flagged.
-- Intended UI use: in makeJudgeMatcher drop rows with profile_role = 'directory_stub' whose primary_profile_id exists in the same list before counting candidates for a name.
-- Before-image: whole item / detail + whole-row md5 (issue dq20261003r4_judges_directory_stub).
-- Execute statement 1 (audit) then statement 2 (apply).
--
-- ROLLBACK (exact):
--   update public.corpus_records r set item = c.original_record->'item', detail = c.original_record->'detail'
--     from corpus_ingest.cleanup_decisions c
--    where c.dataset = 'judges' and c.issue = 'dq20261003r4_judges_directory_stub' and c.run_id = 'c41d48ea-d3fb-4362-bda3-a959b127a4cb' and r.dataset = 'judges' and r.id = c.record_id;
--
-- ===== statement 1: audit =====
with flag as (select true as apply),
k as materialized (
 select r.id, r.title, r.item, r.detail, md5(to_jsonb(r)::text) as row_md5,
        btrim(regexp_replace(regexp_replace(lower(normalize(coalesce(r.item->>'name', r.title), NFC)), '[.,]', ' ', 'g'), '\s+', ' ', 'g')) as jkey,
        coalesce(r.item->'courts', '[]'::jsonb) as courts, r.detail->'structured'->'ids'->>'fjc_nid' as nid, r.item->>'profile_layer' as layer
 from public.corpus_records r where r.dataset = 'judges'),
g as (select jkey from k group by jkey having count(*) > 1 and count(nid) = 1),
pairs as (
 select s.id as stub_id, s.title as stub_title, s.item as old_item, s.detail as old_detail, s.row_md5, p.id as prim_id,
        (select jsonb_agg(c) from jsonb_array_elements_text(s.courts) c where p.courts ? c) as shared_courts
 from k s join g on g.jkey = s.jkey join k p on p.jkey = s.jkey and p.nid is not null
 where s.nid is null and s.layer = 'consolidated_entity' and p.layer = 'consolidated_entity' and s.id <> p.id
   and exists (select 1 from jsonb_array_elements_text(s.courts) c where p.courts ? c)),
ins as (
 insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
 select 'judges', x.stub_id, 'dq20261003r4_judges_directory_stub', 'label_override',
  'Name-only directory profile of a judge who also has a profile backed by the Federal Judicial Center record (same exact normalized name, same court string). Flagged as a directory stub with a pointer to the primary profile; nothing merged or removed.',
  jsonb_build_object('review_version','judges-directory-stub-flags/2026-10-03.r4.1','rule','exact normalized name AND at least one identical court string; exactly one FJC-backed profile in the name group','primary_profile_id',x.prim_id,'shared_courts',x.shared_courts,'approved_by','coordinator (decision 4, flag only)'),
  jsonb_build_object('id',x.stub_id,'item',x.old_item,'detail',x.old_detail,'row_md5',x.row_md5),
  jsonb_build_object('item', x.old_item || jsonb_build_object('profile_role','directory_stub','primary_profile_id',x.prim_id),
                     'detail', x.old_detail || jsonb_build_object('profile_role','directory_stub','primary_profile_id',x.prim_id,
                        'profile_role_basis','same exact normalized name and the same court string as the profile backed by the Federal Judicial Center record; flagged only, not merged',
                        'links', coalesce(x.old_detail->'links', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('url', '#judge/' || x.prim_id, 'label', 'Profile backed by the Federal Judicial Center record (same name and court)')))),
  'c41d48ea-d3fb-4362-bda3-a959b127a4cb'::uuid
 from pairs x where (select apply from flag)
 on conflict (dataset,record_id,issue) do nothing
 returning record_id)
select (select count(*) from pairs) qualifying_stubs, (select count(*) from ins) audit_rows_written;

-- ===== statement 2: apply =====
with u as (
 update public.corpus_records r
    set item = c.replacement->'item', detail = c.replacement->'detail'
   from corpus_ingest.cleanup_decisions c
  where c.dataset = 'judges' and c.issue = 'dq20261003r4_judges_directory_stub' and c.run_id = 'c41d48ea-d3fb-4362-bda3-a959b127a4cb'
    and r.dataset = 'judges' and r.id = c.record_id and md5(to_jsonb(r)::text) = c.original_record->>'row_md5'
 returning r.id)
select count(*) updated from u;
