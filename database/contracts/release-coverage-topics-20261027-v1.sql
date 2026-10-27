-- release-dataset-coverage-topics/2026-10-27.v1  (release workstream dataset-coverage-topics)
-- Releases public.corpus_datasets 'coverage_topics' (ready=false since the 2026-10-03 import) under the owner decision of 2026-10-27
-- ("dont withhold any data. If its accurate and valuable, USE IT"). No row carries source evidence of a seal or restriction, and no owner/admin
-- policy hold names this dataset: the hold was caution only (stale expected_records 17,942 after the 17,808 open_us_law-derived rows were removed
-- on 2026-10-06, and unproven provenance). What this contract does, row by row (134 rows before):
--
--   * 1 row DELETED, commercial host: record:4a132d1b0456db74a52b59d4599666d6, https://trellis.law/state-rules/az/constitution/18-labor/section-5-...
--     Trellis is a commercial host (never a data source) and the row was mislabelled source_tier 'official_capture'.
--   * 117 New Jersey statute rows RE-SOURCED to the official in-force edition state_law.sections_nj (edition nj-20261024, New Jersey Legislature,
--     Office of Legislative Services, https://pub.njleg.gov/statutes/STATUTES-TEXT.zip). Every row's citation matches exactly one in-force
--     section (117/117). Each topic tag is re-checked against the official heading/text with the published rules below; a tag is kept only
--     where its rule matches. 7 tags fail (4 'sol': 2A:16-64, 2A:42A-6, 2A:44-143, 34:15-87 are not time limits; 3 'udap': 56:6-19,
--     56:8-61, 56:8-98 are a motor-fuel policy declaration and two short titles) so 6 rows are DELETED (no confirmed topic left) and 1 row
--     loses one tag. The 111 kept rows get the official title (number — heading), source_url, source_tier 'official_edition',
--     source_dataset 'state_law.sections_nj', publisher_status (in_force) and item.official_edition (edition, section id, citation,
--     publisher, currency statement, source member, text sha256). Provenance note: these rows were derived from dataset 'seeger'
--     (ready, record ids in item.record_id, 117/117 live), not from open_us_law (its derived rows carried item.row_id 'oul:*' and were all removed).
--   * 13 court-rule rows (CA 7, PA 1, TX 5) KEPT: hosts are the courts' own publishers (courts.ca.gov Judicial Council of California;
--     sf.courts.ca.gov Superior Court of San Francisco; lascpubstorage.blob.core.windows.net, the Los Angeles Superior Court's document store
--     linked from lacourt.ca.gov; txcourts.gov Texas Judicial Branch; courts.phila.gov First Judicial District of Pennsylvania). Tags re-checked
--     against the court document text held in dataset 'seeger' (item.record_id); 5 'damages_cap' tags are not supported (court rules mention
--     jurisdictional limits, not damages caps) and are dropped. No row loses all tags.
--   * 3 Nevada rows KEPT (official_capture, leg.state.nv.us, Nevada Legislature); tags confirmed on the chapter titles.
-- After: 127 rows (statutes 114, guidance 13; states CA, NJ, NV, PA, TX), ready=true, expected_records = imported_records = 127.
--
-- Topic rules (coverage-topics-verify/2026-10-27.1, PostgreSQL ARE, case-insensitive, matched against heading/title first, then text):
--   sol                     (statute of limitations|limitations? (of|on|upon) actions?|limitations? periods?|limitation of time|periods? of limitation|shall be (commenced|brought|instituted|filed) within|(commenced|brought|instituted|filed) within [^.;]{0,60}(years?|months?|days?)|(action|claim|cause of action|right of action)[^.;]{0,60}accru(al|es|ed|e)\M|accru(al|es|ed|e)\M[^.;]{0,20}(of|on) (the |an |any )?(action|claim|cause))
--   repose                  (statutes? of repose|\mrepose\M|substantial completion)
--   punitive                (punitive damages|exemplary damages|treble damages|threefold damages|three times the (amount|damages))
--   class_action            (class actions?|on behalf of [^.;]{0,30}class|members of the class|class members?)
--   comparative_fault       (comparative (negligence|fault)|contributory negligence|percentage of (negligence|fault|responsibility)|assumption of (the )?risk)
--   damages_cap             (damages[^.;]{0,80}(shall not exceed|may not exceed|not to exceed|(?<!not )limited to)|(shall not exceed|may not exceed|not to exceed)[^.;]{0,80}damages|damages in an amount (up to|not to exceed|not exceeding)|limitation on (the amount of )?damages|cap on damages)
--   expert_evidence         (expert (witness|witnesses|testimony|opinion|opinions|report|reports)|affidavit of merit|appropriate licensed person|qualified expert)
--   joint_several           (joint(ly)? and several(ly)?|joint tortfeasors?|several liability)
--   product_liability       (products? liability|product seller|defective product|design defect|manufacturing defect|failure to warn|harm caused by a product)
--   udap                    (consumer fraud|unconscionable (commercial )?practice|deceptive (act|practice|trade)|unfair (or deceptive|trade practice)|ascertainable loss)
--   wrongful_death_survival (wrongful death|death action|death of (a|the) (person|decedent)|caused by (a )?wrongful act|survival (action|statute)|surviv(e|es|al) [^.;]{0,40}(death|decedent)|executors? (and|or) administrators?)
--   complex_coordination    (complex (case|cases|litigation)|coordinat(ion|ed) proceedings?|coordination of actions|multi-?district|mass torts?|consolidat(ed|ion) (of )?(actions|cases|proceedings))
-- Tags are only ever removed, never added: the kept set is (original tags) intersected with (rule matches on the official document).
-- The per-row outcome below was computed by the read-only dry run of 2026-10-27 (packet private/acq/release-dataset-coverage-topics/release-packet.json).
--
-- Guards: every target row's md5(to_jsonb(row)) must equal the dry-run value; every NJ section's text_sha256 must equal the dry-run value.
-- The whole file runs in one transaction and raises (rolling everything back) unless exactly 7 rows are deleted, 127 updated and 127 remain.
-- Ledger: corpus_ingest.cleanup_decisions, issue 'release20261027_coverage_topics_verify', run 5792288a-88c5-9f65-f391-6da80fbd194b
--   (deleted rows: disposition 'quarantine'; updated rows and the dataset entry: 'label_override'; original_record = the full before-image).
-- ROLLBACK: database/contracts/release-coverage-topics-20261027-v1.rollback.sql

begin;

-- ===== statement 0: register the run =====
insert into corpus_ingest.runs (id, contract_version, status, scope, counts, finished_at)
values ('5792288a-88c5-9f65-f391-6da80fbd194b'::uuid, 'release-dataset-coverage-topics/2026-10-27.v1', 'completed',
  '{"dataset": "coverage_topics", "issue": "release20261027_coverage_topics_verify", "owner_decision": "2026-10-27: dont withhold any data. If its accurate and valuable, USE IT", "rule_version": "coverage-topics-verify/2026-10-27.1", "official_edition": "nj-20261024", "method": "topic tags kept only where the published rule matches the official document (NJ: state_law.sections_nj heading/text; court rules: court-published document text in dataset seeger; NV: chapter title); trellis.law row removed (commercial host); NJ rows re-sourced to the official in-force edition"}'::jsonb,
  '{"before": {"records": 134, "ready": false, "expected_records": 17942}, "after": {"records": 127, "ready": true, "expected_records": 127, "by_category": {"statutes": 114, "guidance": 13}}, "deleted": {"commercial_host": 1, "no_confirmed_topic": 6}, "updated": 127, "tags": {"before": 182, "after": 169, "dropped_unsupported": 12, "removed_with_trellis_row": 1}}'::jsonb,
  now())
on conflict (id) do nothing;

create temporary table _ct_targets (id text primary key, row_md5 text not null, action text not null, kept jsonb, section_id text, section_sha256 text) on commit drop;
insert into _ct_targets (id, row_md5, action, kept, section_id, section_sha256) values
  ('record:4a132d1b0456db74a52b59d4599666d6', 'e021b2e08a2f376a89c86463abf7d2a6', 'delete_commercial_host', '[{"match": "title", "topic": "comparative_fault", "query_id": "comparative_fault", "query_ids": ["comparative_fault"]}]'::jsonb, NULL, NULL),
  ('record:31865cddfe5d019f39f62340ef04a5fb', '64fdd0eb8ab88e4d5c776dbfd7a8210d', 'update', '[{"match": "text", "topic": "product_liability", "query_id": "product_liability", "query_ids": ["product_liability"]}]'::jsonb, NULL, NULL),
  ('record:33dc92b0c0eb8ebe2521a64072574cc2', '234cf1c3576c803f7dd90c433e5f3223', 'update', '[{"match": "text", "topic": "sol", "query_id": "sol_personal_injury", "query_ids": ["sol_personal_injury"]}, {"match": "text", "topic": "punitive", "query_id": "punitive_derived", "query_ids": ["punitive_derived"]}, {"match": "text", "topic": "wrongful_death_survival", "query_id": "wrongful_death_survival", "query_ids": ["wrongful_death_survival"]}, {"match": "text", "topic": "complex_coordination", "query_id": "complex_coordination", "query_ids": ["complex_coordination"]}, {"match": "text", "topic": "expert_evidence", "query_id": "expert_evidence", "query_ids": ["expert_evidence"]}]'::jsonb, NULL, NULL),
  ('record:36f90f359ee316e937d583bc8a748f85', '9fee2abbfc8d61aae5f5d1d0699b825e', 'update', '[{"match": "text", "topic": "sol", "query_id": "sol_any", "query_ids": ["sol_any", "sol_personal_injury"]}, {"match": "text", "topic": "comparative_fault", "query_id": "comparative_fault", "query_ids": ["comparative_fault"]}, {"match": "text", "topic": "punitive", "query_id": "punitive_derived", "query_ids": ["punitive_derived"]}, {"match": "text", "topic": "class_action", "query_id": "class_action", "query_ids": ["class_action"]}, {"match": "text", "topic": "complex_coordination", "query_id": "complex_coordination", "query_ids": ["complex_coordination"]}]'::jsonb, NULL, NULL),
  ('record:6d48d90967b711dd4d708ad5e1532295', '213fe96b54500da0a137922a4e551ad6', 'update', '[{"match": "text", "topic": "sol", "query_id": "sol_personal_injury", "query_ids": ["sol_personal_injury"]}, {"match": "text", "topic": "punitive", "query_id": "punitive_derived", "query_ids": ["punitive_derived"]}, {"match": "text", "topic": "wrongful_death_survival", "query_id": "wrongful_death_survival", "query_ids": ["wrongful_death_survival"]}, {"match": "text", "topic": "complex_coordination", "query_id": "complex_coordination", "query_ids": ["complex_coordination"]}, {"match": "text", "topic": "expert_evidence", "query_id": "expert_evidence", "query_ids": ["expert_evidence"]}]'::jsonb, NULL, NULL),
  ('record:7aa47d77392db40c0eeb70de7f82923c', '0ec8f4b5e530cdc45135d4729e11e5a4', 'update', '[{"match": "text", "topic": "wrongful_death_survival", "query_id": "wrongful_death_survival", "query_ids": ["wrongful_death_survival"]}]'::jsonb, NULL, NULL),
  ('record:7ac09dc1819cbd02c72dcdfb0373c4af', '5923ed58a47e674923359af2849a9d6d', 'update', '[{"match": "text", "topic": "class_action", "query_id": "class_action", "query_ids": ["class_action"]}, {"match": "text", "topic": "expert_evidence", "query_id": "expert_evidence", "query_ids": ["expert_evidence"]}]'::jsonb, NULL, NULL),
  ('record:ae453b07c0d4400308a22a7b2f2e7e16', 'a5ad0c341bf5415e92ec211903e058cc', 'update', '[{"match": "text", "topic": "sol", "query_id": "sol_personal_injury", "query_ids": ["sol_personal_injury"]}, {"match": "text", "topic": "repose", "query_id": "repose", "query_ids": ["repose"]}, {"match": "text", "topic": "class_action", "query_id": "class_action", "query_ids": ["class_action"]}, {"match": "text", "topic": "complex_coordination", "query_id": "complex_coordination", "query_ids": ["complex_coordination"]}]'::jsonb, NULL, NULL),
  ('record:01916ffbda24138125857d7b2281d42b', '07d2ea4832d2c420d8caa6d961e322c2', 'update', '[{"match": "title", "topic": "sol", "query_id": "sol_any", "query_ids": ["sol_any"]}, {"match": "text", "topic": "punitive", "query_id": "punitive_derived", "query_ids": ["punitive_derived"]}]'::jsonb, 'NJ:NJSA:2A:61B-1', '7855780426301f1e4b539c1747979f385d6446bb1f8802291b94f7a0445b1da5'),
  ('record:0abca1e6ceced9dc50de25ccfccc97e0', '5325936708db77f618bf99ad99f4b06b', 'update', '[{"match": "title", "topic": "sol", "query_id": "sol_any", "query_ids": ["sol_any"]}]'::jsonb, 'NJ:NJSA:2A:14-22', 'a74ffdcc749fffa70c66d098391b7cdb84c17353d8ea4a05d4554a44267a24a9'),
  ('record:0cec2454cbd2bd1562e2316b36d9bf73', '7d4b020adbcde3e4a54e1165498e267f', 'update', '[{"match": "title", "topic": "sol", "query_id": "sol_any", "query_ids": ["sol_any"]}]'::jsonb, 'NJ:NJSA:2A:82-4.3', 'a76bc5e080fcb47d1380ddd6753653e1b34bde36f0293964d897f24fc6a343b4'),
  ('record:0d1ac07d21825ed464d5313721b38a2f', 'acb1cdb948207431da9c8ae473fd6902', 'update', '[{"match": "title", "topic": "punitive", "query_id": "punitive_derived", "query_ids": ["punitive_derived"]}]'::jsonb, 'NJ:NJSA:2A:38A-3', '99d5b7a716048ece89c2ea375a857dbd3b1fd47487add2c19c8da6077168cbcd'),
  ('record:0eb9fa9cc2aa4c600b2fd31d680cd730', '4286d4b3789bf79bc1b6fabdc4134c95', 'update', '[{"match": "text", "topic": "class_action", "query_id": "class_action", "query_ids": ["class_action"]}]'::jsonb, 'NJ:NJSA:56:9-12', '02cf6e63a3631bbdaad47b5c1270587d04828ec92275fcd25b851c92ba67796e'),
  ('record:0edb6c765080220e0864158b6c5fe6b5', '7a5c0eadefa2d953d85093ff1ac02fc0', 'update', '[{"match": "text", "topic": "punitive", "query_id": "punitive_derived", "query_ids": ["punitive_derived"]}]'::jsonb, 'NJ:NJSA:2A:15-5.15', '9760d3243d8cc63cd530e3e999e2f577c9ef8e97ab30d11f111c8d1f4c3298e6'),
  ('record:1448528c69134120dc999170a0befad6', '335c32b031ad057f8cf27f686ea68bb0', 'update', '[{"match": "text", "topic": "punitive", "query_id": "punitive_derived", "query_ids": ["punitive_derived"]}]'::jsonb, 'NJ:NJSA:56:15-4', 'fd04e5732e4bfd20259c7e1efc657760066403b9319b9f6cb0d606d422e90f00'),
  ('record:1491f9d4b23fd653e4794d630fd2cacd', '9442a66ddc35f4a1e9eeca93feef3ec4', 'update', '[{"match": "title", "topic": "sol", "query_id": "sol_any", "query_ids": ["sol_any", "sol_personal_injury"]}, {"match": "text", "topic": "wrongful_death_survival", "query_id": "wrongful_death_survival", "query_ids": ["wrongful_death_survival"]}]'::jsonb, 'NJ:NJSA:2A:14-26.1', '1d84a95c8d2d1ee0bd43d87d1dcc94116de9b2701361f652eabdafa90d035221'),
  ('record:1549e97902f1adaef3acd8d57db0028e', '6c833c63b577533cac38978d543637c7', 'update', '[{"match": "text", "topic": "punitive", "query_id": "punitive_derived", "query_ids": ["punitive_derived"]}]'::jsonb, 'NJ:NJSA:2B:21-10', '77ad96ecc3e5ed443438e3b70a61a867113d6e571686343aef9da095ef128b54'),
  ('record:186957b8e637fb7ed60cdc55e334c37a', 'dc92e0c13ca789df5056a265dbd3e014', 'update', '[{"match": "text", "topic": "punitive", "query_id": "punitive_derived", "query_ids": ["punitive_derived"]}]'::jsonb, 'NJ:NJSA:2A:15-5.14', 'eb611065d427501900b9002ffa854824d298d82ff0ea57a3f0aaf3647a38c48d'),
  ('record:19fdc8b68b4ec7dcc2a20eb2fa83cd62', 'a6b936784ea9baa65d2ea6e41a6a0baf', 'update', '[{"match": "title", "topic": "udap", "query_id": "udap", "query_ids": ["udap"]}]'::jsonb, 'NJ:NJSA:56:8-14.6', '93cd77db9d34d36ed48c7b5db46c6e0d90b567f7778d53ea53c04dc362b68c9e'),
  ('record:1a9ed3eab0c90ac77e6061994c1bc371', '2f1e0a78408527f86a72c99c36f4ccb2', 'update', '[{"match": "text", "topic": "sol", "query_id": "sol_any", "query_ids": ["sol_any"]}]'::jsonb, 'NJ:NJSA:2A:30B-6', '5c96ee9229a8edf76072df139ad8764864f2e2add3339f0ddaa88e7390910fc6'),
  ('record:1e5ca2985ffc68e4e3859bcd938f1e26', 'd0bf2653e84b6785ce0ffdbd1be720ed', 'update', '[{"match": "title", "topic": "sol", "query_id": "sol_any", "query_ids": ["sol_any"]}]'::jsonb, 'NJ:NJSA:2A:50-56.1', '78eac7196aa892d722dfe0a1e9a5216f2bdf9ad64bc669ac98856cf33fbe6692'),
  ('record:200d894a4bb11d061a4c15831f369fbf', 'a7b3786a9b2b974d88f5e9d80bfb6e9c', 'update', '[{"match": "text", "topic": "wrongful_death_survival", "query_id": "wrongful_death_survival", "query_ids": ["wrongful_death_survival"]}]'::jsonb, 'NJ:NJSA:59:3-15', '27eb3914555964f426195ed60434bf730c5cfd9bbcc694ecef9e61797b448445'),
  ('record:206aed31ec43f377ebb937a26d3b7da6', '3c2d913a91ffd2585e5c86a169134eb6', 'update', '[{"match": "text", "topic": "punitive", "query_id": "punitive_derived", "query_ids": ["punitive_derived"]}]'::jsonb, 'NJ:NJSA:2A:84A-21.11', 'c64dc3168bf8493265487979c2ff4a0fc1dfb19da3c4289c6043b66b14f7235b'),
  ('record:207bc50938274d15a524ead7f0ac3f6e', 'd5caa231adc9fd5b869b588e37c50d71', 'update', '[{"match": "title", "topic": "product_liability", "query_id": "product_liability", "query_ids": ["product_liability"]}]'::jsonb, 'NJ:NJSA:2A:58C-2', 'c405f24705d9815761228ffad213158140451c0cdf4e60f76dbee47284f03050'),
  ('record:226283e5b2939a78838e9abd2c5d7b6e', '3d39bbf681b2ccc0b0efae4e912d397a', 'update', '[{"match": "title", "topic": "comparative_fault", "query_id": "comparative_fault", "query_ids": ["comparative_fault"]}]'::jsonb, 'NJ:NJSA:59:9-4', '57ff25cd9cc86eea77384892f7903dc9c2018395f40125f15c7a12b5ec0b497b'),
  ('record:2323d72091b94b09a49682293e248c54', '3d0de3840a35c50f43d756f7ccb46a41', 'update', '[{"match": "text", "topic": "joint_several", "query_id": "joint_several", "query_ids": ["joint_several"]}]'::jsonb, 'NJ:NJSA:56:12-46', '17d855da142149164b4f5f8138ac4199fc6d4894a86087c035e7f8fc0482b2d2'),
  ('record:254ae901af6c4c9c63ed6ec32d2236e5', 'f17458fc9117268b97807136f3adf1b8', 'update', '[{"match": "title", "topic": "joint_several", "query_id": "joint_several", "query_ids": ["joint_several"]}]'::jsonb, 'NJ:NJSA:34:11-58.2', 'e5830e92eabb4bbed2f1911647b6eea96a6ec8253bf4035054eb2c1615679329'),
  ('record:259ad2a1eb8288a56feb0aecade64163', '69a52525a68276c37d89a3fd49b6ef31', 'delete_no_confirmed_topic', null, 'NJ:NJSA:56:8-98', 'd119c5789422dede64743b0b6b8f0e87efbd658dfc909f81a8a4881bdf7c52d5'),
  ('record:27207f7f9101879779da195525cfcfbd', '14cd44120ebb463c91b4e8a7a884b617', 'update', '[{"match": "text", "topic": "sol", "query_id": "sol_any", "query_ids": ["sol_any"]}]'::jsonb, 'NJ:NJSA:2A:14-26.2', '242c994655da986afe306eb366b2cc6afdc8a3c8edccb47aa38cc448aa1dcb42'),
  ('record:2ad4636beeb870bb571eb38e8790939b', '97e97c349deed5392838c81bb08d1ec6', 'update', '[{"match": "text", "topic": "product_liability", "query_id": "product_liability", "query_ids": ["product_liability"]}, {"match": "text", "topic": "punitive", "query_id": "punitive_derived", "query_ids": ["punitive_derived"]}]'::jsonb, 'NJ:NJSA:59:9-2', '1de01d2783ff4c680736d7a6928eca9835c453ba4ebcbafef400c9ff5e3cdbdb'),
  ('record:308b477e8a97c42884ec0bab30d0176c', '1c4be90c0ca4b68c0b816d91f98b69cd', 'update', '[{"match": "text", "topic": "sol", "query_id": "sol_any", "query_ids": ["sol_any"]}, {"match": "title", "topic": "product_liability", "query_id": "product_liability", "query_ids": ["product_liability"]}]'::jsonb, 'NJ:NJSA:2A:58C-9', '64ac3efb0e0d48527c948de8d5caf05b637c6d16c71406e104b86ec286960e14'),
  ('record:33e29f105e97036d2ab97e57c5af8160', 'e5cf5d987337dbf1b2f9b896b130c2f7', 'update', '[{"match": "title", "topic": "joint_several", "query_id": "joint_several", "query_ids": ["joint_several"]}]'::jsonb, 'NJ:NJSA:34:11-79', 'b2f5aaa37f3a77b8fa806f62daf4a0915cb5171c7aafdaad96a7032743d07be4'),
  ('record:3700fa575778de2f652fab5c62db9189', '79e7fd566b6bb20d07dc4a20fb80458d', 'update', '[{"match": "text", "topic": "punitive", "query_id": "punitive_derived", "query_ids": ["punitive_derived"]}]'::jsonb, 'NJ:NJSA:2A:32C-10', '4237834c464ddb96c9d867ab651f577b89a0c3416872067326118efb8aa06564'),
  ('record:3820fc6c4709ab1abb0674af6c21b94f', '0e61290affb5a2ecbbc645661e63b436', 'update', '[{"match": "text", "topic": "product_liability", "query_id": "product_liability", "query_ids": ["product_liability"]}]'::jsonb, 'NJ:NJSA:2A:58C-3', '1fcb7ae5a0fe641c1b192754c939d82e5ec0589fcb29f86b8ead6a552f561489'),
  ('record:3aca77ca85e2aba6bbed55b0f3e993c5', 'a943f25247642ab300af786b538d5d13', 'update', '[{"match": "text", "topic": "joint_several", "query_id": "joint_several", "query_ids": ["joint_several"]}]'::jsonb, 'NJ:NJSA:34:8D-5', '60983f467073fec2fa0dbe83ba34fa962f908d5bbe43df62c38b5f62cd2f5670'),
  ('record:3e1fe1272ba61b2f8e437fe2c0268436', '1054f54f6786675daa8e85b3fa36eebb', 'update', '[{"match": "text", "topic": "joint_several", "query_id": "joint_several", "query_ids": ["joint_several"]}]'::jsonb, 'NJ:NJSA:34:11-56.51', '932bbe4ff68e25a547aec7d3f413ca8b31c19c06fbe53549de74a105bf01460c'),
  ('record:3e639c2c46bde87b2c4b3e2069324806', '4d2dedaadebe33f63214e1cb664feb4c', 'update', '[{"match": "title", "topic": "udap", "query_id": "udap", "query_ids": ["udap"]}]'::jsonb, 'NJ:NJSA:2A:18-61.65', 'dce36c70f95ebfa497770d8e1a3f2fa08e110c102603d36fd5786588d5733fdc'),
  ('record:3e8cda18c05758daec45f60482bf7182', 'b652e686883420e4ccd16ca59a6b5ace', 'update', '[{"match": "text", "topic": "damages_cap", "query_id": "damages_caps", "query_ids": ["damages_caps"]}, {"match": "title", "topic": "punitive", "query_id": "punitive_derived", "query_ids": ["punitive_derived"]}, {"match": "title", "topic": "class_action", "query_id": "class_action", "query_ids": ["class_action"]}]'::jsonb, 'NJ:NJSA:56:12-4', '0186ec4ebfe9327797a4a9a8903269929f8b643c30840ad1c51614e1b7ae1f2c'),
  ('record:40c8a4f7b4355be3cf31a2ccd7e7e37e', '06b09e0a3a357393aa1b5af45565e632', 'update', '[{"match": "title", "topic": "udap", "query_id": "udap", "query_ids": ["udap"]}]'::jsonb, 'NJ:NJSA:56:8-19.1', 'cf07b33bb963982938f083ef9c10d43e72557dc9cd636e56905dc5c8d5e46754'),
  ('record:43a4af8be35d20ba8be73d5c19898309', '9e6d8ec93dc1c34028f6564b8ab65de5', 'update', '[{"match": "title", "topic": "sol", "query_id": "sol_any", "query_ids": ["sol_any"]}]'::jsonb, 'NJ:NJSA:56:9-15', '1fa4a0b5c8a132e7ffcf0db84269b8ff4abe7ba88eb1a661e56d79c7b912a395'),
  ('record:440998b1182eb0f666d798e46e40e8d8', '7cb021b259e1617b39710e28e252ae85', 'update', '[{"match": "text", "topic": "punitive", "query_id": "punitive_derived", "query_ids": ["punitive_derived"]}]'::jsonb, 'NJ:NJSA:34:1A-1.14', 'daeaa241b1a18d3e461c6311750ebc938929149489fe0f40d16d22d787b1c6f7'),
  ('record:45894a99fc931db3d6359b27a221fa0e', 'bf0407ddf6a973497d01a2bd5fbfccd2', 'update', '[{"match": "title", "topic": "sol", "query_id": "sol_any", "query_ids": ["sol_any"]}]'::jsonb, 'NJ:NJSA:2A:32C-11', '8fcb1721064fa4845dd591167e85f93fabc52f26278a40537184997284e51f0a'),
  ('record:4611487ace47f4d1c6d8227f3a786a34', '4bd41186851cd353e01d353d73bde622', 'update', '[{"match": "title", "topic": "punitive", "query_id": "punitive_derived", "query_ids": ["punitive_derived"]}]'::jsonb, 'NJ:NJSA:2A:15-5.12', '82e64029f6ad3d377d335f33b1ede1f789af8a87b8aefbb6d85f2d1b0434346d'),
  ('record:461f1c2e5ada6d9bd5cfe19ea04a57a9', '034716ee6b685dec00d2c32c022a2d60', 'update', '[{"match": "text", "topic": "damages_cap", "query_id": "damages_caps", "query_ids": ["damages_caps"]}, {"match": "text", "topic": "punitive", "query_id": "punitive_derived", "query_ids": ["punitive_derived"]}]'::jsonb, 'NJ:NJSA:56:12-3', '4129efdac21b064b823dc689841ddbe9ca78c535f3120ab83f08717a7656d2d0'),
  ('record:48250aab6dfef1ada463f031e6a5a4af', '844e310bf0d1805b9e1d14f5d9ab9135', 'update', '[{"match": "text", "topic": "punitive", "query_id": "punitive_derived", "query_ids": ["punitive_derived"]}]'::jsonb, 'NJ:NJSA:34:2-21.66', '97e02628abcbffed68e4850bc536e5b3a3ececcc56e5611af11b2d12d2ef1678'),
  ('record:49f9023e71d7edf1c23a612cd9fe19b7', '76a5ae7a238afba6d9c6ea1e933e083b', 'update', '[{"match": "text", "topic": "wrongful_death_survival", "query_id": "wrongful_death_survival", "query_ids": ["wrongful_death_survival"]}]'::jsonb, 'NJ:NJSA:2A:53A-5.1', '5d49e47ffd901552881f93246d458cd253dcef27bccbe4fa004b9e015061cba0'),
  ('record:4abe218673fc122dec0021d36e22c9b5', 'b914184a6803d8714270da1f06307f04', 'update', '[{"match": "text", "topic": "expert_evidence", "query_id": "expert_evidence", "query_ids": ["expert_evidence"]}]'::jsonb, 'NJ:NJSA:34:1B-366', '6f67da4fc48792392e96dd4a6cccbfb4f8f69bce93368c404b12a97188aac06f'),
  ('record:4ee2eeb8ec87c37b68717ffc9eee5e30', 'a298f67dd2693ec52f9ee059f5059939', 'update', '[{"match": "title", "topic": "sol", "query_id": "sol_any", "query_ids": ["sol_any"]}, {"match": "text", "topic": "class_action", "query_id": "class_action", "query_ids": ["class_action"]}]'::jsonb, 'NJ:NJSA:2A:14-2a', '72f86b7f732dcb0bd35e02ef5326d08a72858d348aab04637652ed35c6adc1d5'),
  ('record:4f1002727b690e2bcb7f1ced13c27d53', '7b4be0a81992f2f62c28433ec01b8af8', 'update', '[{"match": "title", "topic": "sol", "query_id": "sol_any", "query_ids": ["sol_any"]}]'::jsonb, 'NJ:NJSA:2A:19-20', 'd965f9635ec67614d9ca7bb87465b2e0359f17eb08ad4db808eefc56149fe5a1'),
  ('record:4f28c03708753ffcbb15cfbf90132b67', '5c6a2bcafba6f8fb9d7974a342f83522', 'update', '[{"match": "text", "topic": "punitive", "query_id": "punitive_derived", "query_ids": ["punitive_derived"]}]'::jsonb, 'NJ:NJSA:2A:58D-4', 'daea209e6e741ae4daa05a96eedc2e02cbfbefe9e0f21bb374f309d190f61ab6'),
  ('record:4f423230d27e8e0ac5e35ac7603eb8ad', '16489fc935eca5aee66814de7d3b4220', 'update', '[{"match": "title", "topic": "punitive", "query_id": "punitive_derived", "query_ids": ["punitive_derived"]}]'::jsonb, 'NJ:NJSA:2A:15-5.11', '8073e9d1b0d8acb7ca5d7c568cf94c5edbf2da820d20df3a623ad0d1deb6ed93'),
  ('record:5132c6eaffd5ffa71955226a2b822c9a', '7a7c128bf3f310f4db6f7b5f406cc617', 'update', '[{"match": "text", "topic": "udap", "query_id": "udap", "query_ids": ["udap"]}]'::jsonb, 'NJ:NJSA:2A:18-61.64', 'a2eb01238a4693746f3477e114c8ff6c6f201b6503e12550c5f9bf65141d5d91'),
  ('record:54901c9c0be2872f646ad0e5be42fa9e', '314e232ea8e90d48079b377992476a7c', 'update', '[{"match": "text", "topic": "sol", "query_id": "sol_any", "query_ids": ["sol_any"]}]'::jsonb, 'NJ:NJSA:2A:53A-40', '3f7b2833723691116aa7d45cd42bc556cc9630c07ab9788a24b14d8ba3db08ea'),
  ('record:56d85659e0cb609001f98274c7bc6ef5', 'a248365519754b70f710290f00f146bc', 'update', '[{"match": "title", "topic": "comparative_fault", "query_id": "comparative_fault", "query_ids": ["comparative_fault"]}]'::jsonb, 'NJ:NJSA:2A:15-5.1', 'bfa6ec528c9c49c5d683e1a3ff890acd11d95cc12467df571a4709604a4c7ec3'),
  ('record:5ab55189db434f33e67388f0a5ce48f2', '88e9b2cf01bd820e7242c4dc7cc53400', 'update', '[{"match": "text", "topic": "joint_several", "query_id": "joint_several", "query_ids": ["joint_several"]}]'::jsonb, 'NJ:NJSA:2A:32C-3', 'cc16f3a38caa7d69fc02a00589035e584a95f7add3b9aead68832ad53fa582c6'),
  ('record:5be9fc17df21ad58e58dd03b8bfa38c3', 'f1dc3b8a7ac79c580010c675695fcc44', 'update', '[{"match": "text", "topic": "class_action", "query_id": "class_action", "query_ids": ["class_action"]}]'::jsonb, 'NJ:NJSA:34:20-8', 'e3c859dc5751ad9207b3a4ae534561713aa22c786ee72bc71ff29d183f3e0b81'),
  ('record:5bef4095962add67c96b04bea3af8431', 'a55e29c0e8eb3978d23cd981f4c081e7', 'delete_no_confirmed_topic', null, 'NJ:NJSA:56:6-19', '1bf1e9d9e7ffb76081e31b0f4e3653384acecbfc037a85d812f804c3ffdf80ab'),
  ('record:5e04e794d75843a5222eb484072a429f', 'b245084f915a1bdfed014a6206846fb2', 'update', '[{"match": "text", "topic": "punitive", "query_id": "punitive_derived", "query_ids": ["punitive_derived"]}]'::jsonb, 'NJ:NJSA:56:11-38', '14138fbf7c80b6bfa1c8fca8c524a27e255ef240ee638a91987c81b886b62035'),
  ('record:5f32199aad302ac3e6747f2ce8b18094', '135dd29d66262aed8a95c076b6a83a65', 'update', '[{"match": "title", "topic": "comparative_fault", "query_id": "comparative_fault", "query_ids": ["comparative_fault"]}]'::jsonb, 'NJ:NJSA:2A:53A-6', 'f54349c8a98dfa2580d59612b4fdb9ccfaa51ca959753a880299b33b3f8ed1a2'),
  ('record:601e099d55fff0dc4c783e3f7a872a49', '240da54ed8ce4818c5906df4a98025ca', 'update', '[{"match": "text", "topic": "sol", "query_id": "sol_any", "query_ids": ["sol_any"]}]'::jsonb, 'NJ:NJSA:2A:4-30.171', '4e6b2a047bf2170f8b62c092355907a791c945f1af46029f43ab27b05116db69'),
  ('record:61d2942fdab2a2ba7820033e0e7f99b7', '0d1bcbd03b87a02e52628f612503acf7', 'update', '[{"match": "text", "topic": "wrongful_death_survival", "query_id": "wrongful_death_survival", "query_ids": ["wrongful_death_survival"]}, {"match": "text", "topic": "expert_evidence", "query_id": "expert_evidence", "query_ids": ["expert_evidence"]}]'::jsonb, 'NJ:NJSA:2A:53A-27', '6ab656cc87987aa890ddae7c29607753b43159b450bc455f9780066364c33f89'),
  ('record:640fe704e909d539e59b86d382568622', '5556012633384d22591a11860edc3ffe', 'update', '[{"match": "text", "topic": "class_action", "query_id": "class_action", "query_ids": ["class_action"]}]'::jsonb, 'NJ:NJSA:56:8-203', 'b244f3e9d883313f24000ae72b34e4d174bb2814bd7afdc62fe79a24fac11950'),
  ('record:6a4302c9dc5fba1040574912a22469ff', 'c14ac3b2f7c5c0066ba9aa622ac568d5', 'update', '[{"match": "text", "topic": "punitive", "query_id": "punitive_derived", "query_ids": ["punitive_derived"]}]'::jsonb, 'NJ:NJSA:59:10-2', '9c4fdf4635803e048b88def3bbf9a6fbfad4154f75ecddda89c167468a9fa4e0'),
  ('record:6ad4136845c75d8b80d150fb2f17f4cc', '236d200346294c8ea6c3a05e22414de5', 'update', '[{"match": "text", "topic": "punitive", "query_id": "punitive_derived", "query_ids": ["punitive_derived"]}]'::jsonb, 'NJ:NJSA:2A:58D-2', '8e2f5313fc3afe8977c36dfc0a93c462b73729c6ae23c4fe0aa586810599f292'),
  ('record:6d86addf97016698f5eabe12c2114e4e', '0b48783cd31007ddf2161eba01ad0810', 'update', '[{"match": "text", "topic": "sol", "query_id": "sol_personal_injury", "query_ids": ["sol_personal_injury"]}]'::jsonb, 'NJ:NJSA:2A:14-2', 'b632b0e8be9ecaaaa591ab324fbc6474782ccde0d0a3eadcd1b7c06b0d66af95'),
  ('record:6de7b5bc126053f617280588d80a8587', 'b338129bca7421d11d621d3d1e80fd8f', 'update', '[{"match": "text", "topic": "punitive", "query_id": "punitive_derived", "query_ids": ["punitive_derived"]}]'::jsonb, 'NJ:NJSA:10:5-12.12', '9646699d86b9ace36439ce35d9603807c94c13e2f2f4f5172cc31ed097fa809d'),
  ('record:738925b42ae2b26e2ccc57cfb4164643', 'e148a578984096717d74389b8dc54444', 'delete_no_confirmed_topic', null, 'NJ:NJSA:2A:16-64', '601de8f38f9afd4ccb3bd6e8b2e53591601a404a71e0776687a6e0f9c176fb65'),
  ('record:753107ca9c344bdeda54158533b51550', 'e75383647b5a4cf4833e0ba913beaf76', 'update', '[{"match": "text", "topic": "class_action", "query_id": "class_action", "query_ids": ["class_action"]}]'::jsonb, 'NJ:NJSA:34:15C-10.2a', 'c2ee96f30fb7617721321938cc6978f6ffc57ced683c3610c22fd6cbff82ea9c'),
  ('record:7584663eea0edc9e2caf4f8ccef91485', '5cfcdc990920573a48de5481d2ca9118', 'update', '[{"match": "text", "topic": "damages_cap", "query_id": "damages_caps", "query_ids": ["damages_caps"]}, {"match": "title", "topic": "punitive", "query_id": "punitive_derived", "query_ids": ["punitive_derived"]}, {"match": "text", "topic": "class_action", "query_id": "class_action", "query_ids": ["class_action"]}]'::jsonb, 'NJ:NJSA:34:11B-11', '9aab822d06cb2bb3b387f563484dbabf2c6b31b0ea18ddf883df900c7ed061e2'),
  ('record:784700e25062532e947aa20f42ec3a84', '52870cebfbd756ad77f88cb912456423', 'update', '[{"match": "title", "topic": "expert_evidence", "query_id": "expert_evidence", "query_ids": ["expert_evidence"]}]'::jsonb, 'NJ:NJSA:2A:53A-41', 'fabab8f1f96e493e0fea58da1e99f92ae38d977b2345196c8584522de6863e3f'),
  ('record:7b222879b8fcb19863e6ea6fb8de940a', '0e97b1ce6569fc702c0ccc86a149b692', 'delete_no_confirmed_topic', null, 'NJ:NJSA:2A:42A-6', '05805103429ce90ec2cd9f1198bae0ff413bcebb0cab50ab6ca15434f3fd18c9'),
  ('record:7c2ec29981ade1fbf8145d0fd9f3b3a9', '35e1c396d8fdb79a52b571e7877ac615', 'update', '[{"match": "text", "topic": "sol", "query_id": "sol_any", "query_ids": ["sol_any"]}]'::jsonb, 'NJ:NJSA:2A:14-2c', '38ab1656b435133ab14c2b8092da94e0500303e72fb0ddf78ccebf69ea222c42'),
  ('record:7c6ea887eba4ce46c2f7479ba2e98a58', '9d821b5f64ddba62f74f9264395f4d68', 'update', '[{"match": "text", "topic": "product_liability", "query_id": "product_liability", "query_ids": ["product_liability"]}]'::jsonb, 'NJ:NJSA:2A:58C-11', '25495a162d461202d57d9bcc0200b48cceefcdfc9475bf14bb70e8aa12cfd656'),
  ('record:7d4c85b6bfcca45bb40623a85cb06d0b', 'bfc8afd88fd058dd0bcd3ef20086fb09', 'update', '[{"match": "text", "topic": "punitive", "query_id": "punitive_derived", "query_ids": ["punitive_derived"]}]'::jsonb, 'NJ:NJSA:59:10-1', '66c28f29a95cb7fb60a16d02c5f6c80f02786b650d0bf0108e17bfcb07552609'),
  ('record:7f94633e2950099be06269b5ba47472a', '173429e2e28984404df53591ca67896d', 'update', '[{"match": "text", "topic": "punitive", "query_id": "punitive_derived", "query_ids": ["punitive_derived"]}]'::jsonb, 'NJ:NJSA:2A:53A-21', '85f723139040bfe2bfef449a851cb67ecb1393573609632a13a4844b654fa17a'),
  ('record:7ff619c0b00a4a558cf5da28eea32d7b', '9d3db4efc37217f43030cfd68084ef64', 'update', '[{"match": "text", "topic": "punitive", "query_id": "punitive_derived", "query_ids": ["punitive_derived"]}]'::jsonb, 'NJ:NJSA:2A:156A-24', '6e030c7162093f4fd8b563c3b13c81a442609725b483d074dce776f4c735eb7b'),
  ('record:8341886390a5fdc25303c2f45393cef4', 'df360e51cce5ea4015065307640620e0', 'update', '[{"match": "text", "topic": "punitive", "query_id": "punitive_derived", "query_ids": ["punitive_derived"]}]'::jsonb, 'NJ:NJSA:56:8-166.1', 'd4d3596925ff4b96be6e049cee7142ab5c6957b321733db7c179c6f93c6ce0f0'),
  ('record:83b28a8cbad5cbf6531b2e7714227462', 'd10326305e555a14bc260dc482e0df8d', 'update', '[{"match": "text", "topic": "punitive", "query_id": "punitive_derived", "query_ids": ["punitive_derived"]}]'::jsonb, 'NJ:NJSA:10:5-3', 'e409c3adc850cbf4694f07c331122c2cbbdbc2deb60f49011b795a8cd793dc4a'),
  ('record:8952bcfaf43f9535c520925ede9405e0', 'eed5bcd13ab51ce3313e56cc89680e8b', 'update', '[{"match": "text", "topic": "sol", "query_id": "sol_any", "query_ids": ["sol_any"]}]'::jsonb, 'NJ:NJSA:2A:84A-18', '2bfbe7776bcd82547e7ffc97bdf050db0a1352aeede8857b7bd5b47edad58020'),
  ('record:897118563f0cd93dfb7e3f00920e0766', '20bc325fb6a14f31cc7e1feaf68fcc23', 'update', '[{"match": "title", "topic": "product_liability", "query_id": "product_liability", "query_ids": ["product_liability"]}, {"match": "title", "topic": "punitive", "query_id": "punitive_derived", "query_ids": ["punitive_derived"]}]'::jsonb, 'NJ:NJSA:2A:58C-5', '3a4c8496fb35098475400f3362aa68929d6dc510aa0e6c64f6414b4afa3b7ffd'),
  ('record:8987267076311db386bd1448c0bb6dcd', 'c40e8ac4112fb7f2423fa4da1da1b0f5', 'update', '[{"match": "text", "topic": "joint_several", "query_id": "joint_several", "query_ids": ["joint_several"]}]'::jsonb, 'NJ:NJSA:56:8-1.1', '396b25c15005d3b5237775d4dc4b813975d0808b38cab71cc59ee00b9cdeaef6'),
  ('record:8cb295bdeaf8107e5fee483ab701fa9d', 'deb532955618a24ad8d4728e3598abf6', 'update', '[{"match": "text", "topic": "punitive", "query_id": "punitive_derived", "query_ids": ["punitive_derived"]}]'::jsonb, 'NJ:NJSA:34:19-5', 'bbd355b35ab273e79b755897294404762a1fec7ee3b83bac282b8eacdc9b4dda'),
  ('record:8e2066a7fe72af39c31390cab167f75a', 'adbcac138f8e72bf99b44f2cee6035f5', 'update', '[{"match": "title", "topic": "sol", "query_id": "sol_any", "query_ids": ["sol_any"]}]'::jsonb, 'NJ:NJSA:2A:15-3', '388a1d63e815a5d7ba871c5eb2e3d4e980abdc58436614b817a4682bdb561e5d'),
  ('record:8f2e860c5734c71939d626782b3efce2', 'bac73a43451b40c66e2491645b6e1513', 'update', '[{"match": "title", "topic": "sol", "query_id": "sol_any", "query_ids": ["sol_any"]}, {"match": "text", "topic": "class_action", "query_id": "class_action", "query_ids": ["class_action"]}]'::jsonb, 'NJ:NJSA:2A:14-2b', 'dbc5cbbfd4c270bc526a600f8b9373eb0488912c443754ca7fa5110e00f05263'),
  ('record:8f8c672a65511e2bc21dc35c2470061f', '4e3437467976287601065aade1147de0', 'update', '[{"match": "text", "topic": "joint_several", "query_id": "joint_several", "query_ids": ["joint_several"]}]'::jsonb, 'NJ:NJSA:34:11-56.101', '7ab762f81fde192cfe6907374c96661935763d06c54b9e7a1d8e3ceed756a014'),
  ('record:95d9e41911ccce006aa6a92042f9da8b', 'e846ff04e5cfe68b73e28ac95b89ae42', 'update', '[{"match": "text", "topic": "punitive", "query_id": "punitive_derived", "query_ids": ["punitive_derived"]}]'::jsonb, 'NJ:NJSA:2A:15-5.9', 'dd95c38ee7793c443365aa098ff65488399f7ec6852f57b4ca0f865429c4513f'),
  ('record:997f85b0fecf95d661a4bbe368fc968f', 'fd67ae787a3c7e64d4f68745faeeb8f8', 'update', '[{"match": "text", "topic": "product_liability", "query_id": "product_liability", "query_ids": ["product_liability"]}]'::jsonb, 'NJ:NJSA:2A:58C-4', 'bd41cfb3856776dc7cb9afeab72ffed01eca8053ee9dc2931f130bcdb2e0b1c5'),
  ('record:99f484adf5a1215e9d74546f31238a57', '78a246c81ae1f4f02d5ee1575bfc833a', 'update', '[{"match": "text", "topic": "udap", "query_id": "udap", "query_ids": ["udap"]}]'::jsonb, 'NJ:NJSA:56:8-96', '6049728dcbbcbba5b512ec1fdf9286ab6694de3dbd5d67a5e40eed89591defa6'),
  ('record:9bfcb309a42ddbdda80c60c6978dbeda', 'c06908912d4fbf2239562d834dfc6884', 'update', '[{"match": "text", "topic": "punitive", "query_id": "punitive_derived", "query_ids": ["punitive_derived"]}]'::jsonb, 'NJ:NJSA:59:10-4', 'a1c9b99e14c1aa291cadbf264ca6bb41eeb92df1769d46af23316dec0b2f238d'),
  ('record:9d11357078fc29b9a88b7eb9249cec6f', 'db00231459b7984af19b80bdfd064717', 'update', '[{"match": "text", "topic": "sol", "query_id": "sol_any", "query_ids": ["sol_any"]}]'::jsonb, 'NJ:NJSA:2A:53A-7.5', 'f019b9dbe56d59137913f3035ff3c3e0249e8467e962390ffb1f0255d635f7af'),
  ('record:9d6755d3a1323016a4b3d43ef93a8df9', 'c7ddfc4fd59ee93c510329f9df11efb2', 'update', '[{"match": "title", "topic": "sol", "query_id": "sol_any", "query_ids": ["sol_any", "sol_personal_injury"]}]'::jsonb, 'NJ:NJSA:2A:47A-2', '44c78ed6a5947acdb76060198b8f3a488dde456943960a1532630e8b92ff3048'),
  ('record:9df33796b9156b082efcc1cf69e09e06', 'ebce8b6129aa609ccf6050e740c1d02f', 'update', '[{"match": "text", "topic": "sol", "query_id": "sol_any", "query_ids": ["sol_any"]}]'::jsonb, 'NJ:NJSA:34:15-41.1', 'f437a9de33518adbc3f1562a157a2fc0f0e976cf5ba02595652d51b17070c4a5'),
  ('record:9f9ed5ad2e39d4d7a5c69528203a9ac3', '98664c816c29ba5d4e72929022a7d0cd', 'update', '[{"match": "text", "topic": "sol", "query_id": "sol_any", "query_ids": ["sol_any"]}]'::jsonb, 'NJ:NJSA:59:2-1.3', 'd2c16c1064be1a83726e3a9d8ccbc169e876be2707dd7c4f735122c56b88de21'),
  ('record:a055add7b807c1c65e5dc464648e4c7d', '1d646871292145715a325a89fcb22015', 'update', '[{"match": "text", "topic": "sol", "query_id": "sol_any", "query_ids": ["sol_any"]}]'::jsonb, 'NJ:NJSA:2A:32C-5', '44a79c2ffc55bc93729d439c3a8f53ab5af3879c4782a1644999eaa37c9f7963'),
  ('record:a3c591ddedb20b08e983dcb737e812d3', '0e8d3b41ff5b2b46aadadeb2391e6ab5', 'update', '[{"match": "text", "topic": "punitive", "query_id": "punitive_derived", "query_ids": ["punitive_derived"]}]'::jsonb, 'NJ:NJSA:10:5-12.6', '4cc49e841d8dfaaf8d9aa571d2cca1fa919456c867afbf8faea95fac309cd514'),
  ('record:a60fdc33a4ec851ff75136d4d1f405b4', '42da54df5e55842eb5e2b747079d0cfb', 'update', '[{"match": "text", "topic": "punitive", "query_id": "punitive_derived", "query_ids": ["punitive_derived"]}]'::jsonb, 'NJ:NJSA:34:1A-1.19', '88166e22f3e2207364b10b7ff012bdebf732a1915c6b30f73afc36d49a3bf93e'),
  ('record:a753fa42327a87f233634bc08decc10f', '61f8c5bda41e097a6ac788d1af2aad99', 'update', '[{"match": "text", "topic": "punitive", "query_id": "punitive_derived", "query_ids": ["punitive_derived"]}]'::jsonb, 'NJ:NJSA:34:19-13', '9a2c334be53f634546c3876b13eb6c4c184b139b0e525406d5dd4e5c4bb1240f'),
  ('record:aa1ae17ac7872f9814f91e7cc027c2ad', '443c27fc516bb2926130732f3183b11a', 'update', '[{"match": "title", "topic": "punitive", "query_id": "punitive_derived", "query_ids": ["punitive_derived"]}]'::jsonb, 'NJ:NJSA:2A:15-5.10', '9a7b0fbf5f15fb6b5838778a25a841d952c32d69abcc38eb3dbe07c5d554669b'),
  ('record:ac0e118d1a73fcb4ea991c895eb326e2', 'b302854f077ccf60dc8b83e64bf01acd', 'update', '[{"match": "text", "topic": "product_liability", "query_id": "product_liability", "query_ids": ["product_liability"]}, {"match": "text", "topic": "punitive", "query_id": "punitive_derived", "query_ids": ["punitive_derived"]}]'::jsonb, 'NJ:NJSA:2A:58C-1', 'dec967c27f543380893b1e46b651a4b3b1fafcaf92de6fd5f727dc6e49a8ab0e'),
  ('record:b1ab20b4da657e77adab1210f7e3e394', '583a4662813c3fcb1f706ed2c13e825b', 'update', '[{"match": "text", "topic": "product_liability", "query_id": "product_liability", "query_ids": ["product_liability"]}]'::jsonb, 'NJ:NJSA:2A:15-5.2', 'cd00d10dbfb9c69230db7e5f32698cb5136333fd47086303f02a17aa6a2a0412'),
  ('record:b64ae72622fc1bbca534083bdcd7c077', '8b7c9c5d212f3049a2bd82094fbecddd', 'update', '[{"match": "title", "topic": "sol", "query_id": "sol_any", "query_ids": ["sol_any", "sol_personal_injury"]}, {"match": "text", "topic": "wrongful_death_survival", "query_id": "wrongful_death_survival", "query_ids": ["wrongful_death_survival"]}]'::jsonb, 'NJ:NJSA:2A:14-1.1', 'daba289d67d47464e23c5ba83d1cadc0b5fc1af2e1dbafd719609aefd9e0164b'),
  ('record:b850f6f740973aa1313db682906beaf3', '937ee7dfbd0421861fdb5a94a008cce4', 'update', '[{"match": "text", "topic": "punitive", "query_id": "punitive_derived", "query_ids": ["punitive_derived"]}]'::jsonb, 'NJ:NJSA:34:8A-10.1', 'f857286e2a54e2716375823729ec330ba3f1054a6ca3cc011ecad8de725515ee'),
  ('record:bb88ff616057af18fa28192ec7f3e240', 'eebca6c33585cff3106512531692c324', 'update', '[{"match": "title", "topic": "udap", "query_id": "udap", "query_ids": ["udap"]}]'::jsonb, 'NJ:NJSA:56:8-54', '6d05ea969e0ccf5118b1354a692e7535fe9f7dfe650b43e300f9f9ba0c9dbde1'),
  ('record:c2d3c2084c18f6c1c5f48cdcee494144', '17abbe3e7a21ca1ccb44659bfb7efca1', 'update', '[{"match": "text", "topic": "sol", "query_id": "sol_any", "query_ids": ["sol_any"]}]'::jsonb, 'NJ:NJSA:2A:50-2.1', '8cc978a1da6595551e08caaa6de0369f9994f2bd8bcaee67e941276334a364b8'),
  ('record:c3e02a7df0bb40d4acac202c787ce749', '1393f796dbe9c68824805e2ab00d199a', 'update', '[{"match": "text", "topic": "punitive", "query_id": "punitive_derived", "query_ids": ["punitive_derived"]}]'::jsonb, 'NJ:NJSA:2A:23B-21', 'bf92926b2d768d9b15b80d916597a064abc6ec5aaa936cb4b2364179f0a733d4'),
  ('record:d022f258419403238c6986ce0bdc78a9', 'd04d87e82f5560f227bc42c278dc007b', 'update', '[{"match": "text", "topic": "sol", "query_id": "sol_any", "query_ids": ["sol_any"]}]'::jsonb, 'NJ:NJSA:2A:23A-21', 'a3460e1fc27f669cf917896a194b5b06e23ab0abc149435bc892b724f43449cf'),
  ('record:d5fd0f4463b21551c0cf2c726a10e378', '0681810fce25245e56b06d0ecd3a6f79', 'update', '[{"match": "text", "topic": "udap", "query_id": "udap", "query_ids": ["udap"]}]'::jsonb, 'NJ:NJSA:56:8-14.2', '77e05da1f06b69e05fff523b48aa01c4821b7d06447de51d9a4dc7a637dd9555'),
  ('record:d717db5ca004fc9aa3e7cfefc1af9811', '61b4c5bfb5ca361edf757413cbc6d20e', 'update', '[{"match": "text", "topic": "joint_several", "query_id": "joint_several", "query_ids": ["joint_several"]}]'::jsonb, 'NJ:NJSA:56:12-90', '02cb615c9d713c0e0109aa8e3ba3a883ed083fa9b4108f4fb5919c51078766bf'),
  ('record:d9819b83c796e70b8be7db4825358ba9', 'cd6683875cb8511a4c54ebb341635b08', 'update', '[{"match": "text", "topic": "punitive", "query_id": "punitive_derived", "query_ids": ["punitive_derived"]}]'::jsonb, 'NJ:NJSA:2A:15-5.13', '817552ce5218205881393403107bd995bbc0ea582fc589311ff095c780dab9be'),
  ('record:dd1f55c5cdf8bc3c61cfac1a91ac774d', 'b10f93807e897ad418544ea10e84cef3', 'update', '[{"match": "text", "topic": "punitive", "query_id": "punitive_derived", "query_ids": ["punitive_derived"]}]'::jsonb, 'NJ:NJSA:2A:58D-1', '0022dbba3119de2802bfe9413e3d9cf1691160fe8e1715e1eb470249244fd303'),
  ('record:dfe9c6cad470dbcb4bd7ee63e4f91196', '7e778b7a0afcaaec3b77432a34cc76c2', 'update', '[{"match": "text", "topic": "punitive", "query_id": "punitive_derived", "query_ids": ["punitive_derived"]}]'::jsonb, 'NJ:NJSA:2A:47A-1', '8d14055ca542e52c147ca80cf349c7b1043d7476098cb11607f935dfada39a01'),
  ('record:e0c1b777c1e6d7654bb1c8c6ce150792', '135d25576e190fff4e850c8ec7eef028', 'delete_no_confirmed_topic', null, 'NJ:NJSA:34:15-87', '9bc2a4d7b4b149188462fd7525905bbb7c627efe79a84ae39251e31b64d99cb0'),
  ('record:e1464b6f7966b8e02fa4d1fef4e5bf97', 'a2221ecd1be23f3f83a842792dd978d5', 'update', '[{"match": "text", "topic": "wrongful_death_survival", "query_id": "wrongful_death_survival", "query_ids": ["wrongful_death_survival"]}]'::jsonb, 'NJ:NJSA:2A:44-143', '468a7b9d595700d3815f4b885133643c12a6c2198b1152dafd58874a0112c1a8'),
  ('record:e1779405be110b6942bcf7cc1d017783', '3c9e4b4aa9c1fea8c3db86942fc63537', 'update', '[{"match": "text", "topic": "punitive", "query_id": "punitive_derived", "query_ids": ["punitive_derived"]}]'::jsonb, 'NJ:NJSA:2A:15-5.17', 'e3f19c65542b461f0b8034659ddefc632b072e731786aaa66633cdeae43e6702'),
  ('record:e3a957b2a7e50d38680c4ffafb2d0d9f', 'dedddd933f5904671d61009d95fcda7a', 'update', '[{"match": "text", "topic": "sol", "query_id": "sol_any", "query_ids": ["sol_any"]}]'::jsonb, 'NJ:NJSA:2A:14-1.2', '3abe07533d9d022d74984d49c071e8a298eed677f1a3feb4835ae3b9c6ea32f9'),
  ('record:e4e5b43480fe284caed63180632a3004', 'a77201af5115158cca9f6cb4da8ad231', 'update', '[{"match": "text", "topic": "punitive", "query_id": "punitive_derived", "query_ids": ["punitive_derived"]}]'::jsonb, 'NJ:NJSA:10:5-13', '15f71136384606fe93f0ae123a5d56624f41876bf508dc45e3f3c8b900c757c1'),
  ('record:e5c2fa744241c3b2508bb2c72b8adc4b', '8606ce1b0f409191ff3fb03b4b16665c', 'update', '[{"match": "text", "topic": "sol", "query_id": "sol_any", "query_ids": ["sol_any"]}]'::jsonb, 'NJ:NJSA:10:5-12', '8c47a148462811fb7e20fde8cc76186c9b30f797e81a035cfd8d5d63950162b5'),
  ('record:eff8f80bc8a0ca79fb5dd523ed8eaeb7', '4e7129e3e1f4f28aeddac896e175f2d7', 'delete_no_confirmed_topic', null, 'NJ:NJSA:56:8-61', 'f87684d3c187d2921d5e3f20e03131580a2b4be695be148854933f5c05fa8f36'),
  ('record:f424249375a8f180e0e5855603a0c8fa', 'b73515e64a2e8c13050f9962b6eb262b', 'update', '[{"match": "text", "topic": "punitive", "query_id": "punitive_derived", "query_ids": ["punitive_derived"]}]'::jsonb, 'NJ:NJSA:2A:15-5.16', 'c7ce0c50bd4e08e0783004df2e1e656d1cfa83fb2cb36fb41459cd6a09fa76dd'),
  ('record:f654796585ee35cc943c7fc299919bba', '2435c30f6760ac43375dce2725a951c0', 'update', '[{"match": "title", "topic": "sol", "query_id": "sol_any", "query_ids": ["sol_any"]}]'::jsonb, 'NJ:NJSA:2A:31-3', 'd78a1017d549ff899d6d401116be153d09a4c81e8a070f77ebfd448d42f8d614'),
  ('record:f717cd41bb3f06e55861c8252ca1ef04', '88d59a108dd48bdfb80e1b7ff0828dd5', 'update', '[{"match": "text", "topic": "repose", "query_id": "repose", "query_ids": ["repose"]}]'::jsonb, 'NJ:NJSA:2A:14-1.4', '60bb59aa9025239f6cc3ec084772ed2f7cbf352144980315a25ccd194400e3e6'),
  ('record:fa313b5b4368e21ecae342bc14215705', 'efe1f8928152938b66400f30e0f330ae', 'update', '[{"match": "title", "topic": "product_liability", "query_id": "product_liability", "query_ids": ["product_liability"]}]'::jsonb, 'NJ:NJSA:2A:58C-8', 'adedab3edc0b3c5565a188998d0a78f3bb874c28aa6ff9072659f004f383117f'),
  ('record:fa936a1d29a4811cd31e87fe9b051dbc', '4510119f855b7a92782c36de4f0a17f4', 'update', '[{"match": "text", "topic": "punitive", "query_id": "punitive_derived", "query_ids": ["punitive_derived"]}]'::jsonb, 'NJ:NJSA:2A:61A-3', '478dd91d4945930117719e3915cdcb94cc448ad0ba7a9fac5993f93eaea2502a'),
  ('record:fc87e87faaca939590fca7414e5c85ed', '5b403f389cfe7eca11ccd46dc644c83a', 'update', '[{"match": "text", "topic": "udap", "query_id": "udap", "query_ids": ["udap"]}]'::jsonb, 'NJ:NJSA:56:8-14.3', '39dee9cfa188aeaffe3d0e9bb5e5db699a6ade31959498a566ecc92ccb12505b'),
  ('record:fd30d4d416235b064f309a19c832f1d7', '4b60708fa68d5e99541ce0ff96e88164', 'update', '[{"match": "text", "topic": "product_liability", "query_id": "product_liability", "query_ids": ["product_liability"]}]'::jsonb, 'NJ:NJSA:2A:58C-7', '829c38bf10921ff21447a9d78b14a9b8845dfdd9275fb320c4e377dc4bd4be54'),
  ('record:237c94f0bb9be3cb7732dd07f48c1cd8', '23dc1d4d9c01fd224a99616a2b394b3f', 'update', '[{"match": "title", "topic": "udap", "query_id": "udap", "query_ids": ["udap"]}]'::jsonb, NULL, NULL),
  ('record:66f593188f5d52dd7699a4668de829f2', '4c22132c57edbea4871c003b84963823', 'update', '[{"match": "title", "topic": "sol", "query_id": "sol_any", "query_ids": ["sol_any"]}]'::jsonb, NULL, NULL),
  ('record:e2dcf6bf26c00b9dfb9fa845de8a70e7', '9b578ca45e6d55a25d2fa67ddd4d26e9', 'update', '[{"match": "title", "topic": "udap", "query_id": "udap", "query_ids": ["udap"]}]'::jsonb, NULL, NULL),
  ('record:dad2ff16dc52a70cd32322b7ad58399e', '98259bbec9b7e84e180109fcb52756ee', 'update', '[{"match": "text", "topic": "sol", "query_id": "sol_personal_injury", "query_ids": ["sol_personal_injury"]}, {"match": "text", "topic": "product_liability", "query_id": "product_liability", "query_ids": ["product_liability"]}, {"match": "text", "topic": "comparative_fault", "query_id": "comparative_fault", "query_ids": ["comparative_fault"]}, {"match": "text", "topic": "joint_several", "query_id": "joint_several", "query_ids": ["joint_several"]}, {"match": "text", "topic": "wrongful_death_survival", "query_id": "wrongful_death_survival", "query_ids": ["wrongful_death_survival"]}, {"match": "text", "topic": "complex_coordination", "query_id": "complex_coordination", "query_ids": ["complex_coordination"]}]'::jsonb, NULL, NULL),
  ('record:0805b5f05e1c354a4e7d56a37c753f20', '3bf11a472f2a36e9a585aa8759798c12', 'update', '[{"match": "text", "topic": "expert_evidence", "query_id": "expert_evidence", "query_ids": ["expert_evidence"]}]'::jsonb, NULL, NULL),
  ('record:360b104afcb5cdf16955e2de53fdf14f', 'a3160318766bdc01480f084061e5c202', 'update', '[{"match": "text", "topic": "sol", "query_id": "sol_any", "query_ids": ["sol_any", "sol_personal_injury"]}, {"match": "text", "topic": "comparative_fault", "query_id": "comparative_fault", "query_ids": ["comparative_fault"]}, {"match": "text", "topic": "punitive", "query_id": "punitive_derived", "query_ids": ["punitive_derived"]}, {"match": "text", "topic": "class_action", "query_id": "class_action", "query_ids": ["class_action"]}, {"match": "text", "topic": "complex_coordination", "query_id": "complex_coordination", "query_ids": ["complex_coordination"]}, {"match": "text", "topic": "expert_evidence", "query_id": "expert_evidence", "query_ids": ["expert_evidence"]}]'::jsonb, NULL, NULL),
  ('record:36aec380ff1d0c0a735779908586a3b5', 'ebfb4b588113fcd48da26192ddfaf9ef', 'update', '[{"match": "text", "topic": "complex_coordination", "query_id": "complex_coordination", "query_ids": ["complex_coordination"]}]'::jsonb, NULL, NULL),
  ('record:54143a84ddbc562edc0e8c33afbb72cc', '42149a9095931ba282edf2b9942eb13f', 'update', '[{"match": "text", "topic": "expert_evidence", "query_id": "expert_evidence", "query_ids": ["expert_evidence"]}]'::jsonb, NULL, NULL),
  ('record:6c0699f4e475157a98fdce869f88ad9e', '5514aa22ce4c1d97ed767f3d3d61d0a6', 'update', '[{"match": "text", "topic": "punitive", "query_id": "punitive_derived", "query_ids": ["punitive_derived"]}, {"match": "text", "topic": "expert_evidence", "query_id": "expert_evidence", "query_ids": ["expert_evidence"]}]'::jsonb, NULL, NULL)
;

-- ===== statement 1: audit (full before-images) =====
insert into corpus_ingest.cleanup_decisions (dataset, record_id, issue, disposition, reason, evidence, original_record, replacement, run_id)
select r.dataset, r.id, 'release20261027_coverage_topics_verify',
       case when t.action like 'delete%' then 'quarantine' else 'label_override' end,
       case t.action
         when 'delete_commercial_host' then 'Removed: trellis.law is a commercial host (not a permitted source) and the row was mislabelled source_tier official_capture'
         when 'delete_no_confirmed_topic' then 'Removed: none of the row''s topic tags is supported by the official New Jersey section text (state_law.sections_nj, edition nj-20261024) under coverage-topics-verify/2026-10-27.1'
         else 'Topic tags re-checked against the official document under coverage-topics-verify/2026-10-27.1 (unsupported tags dropped); New Jersey rows re-sourced to the official in-force edition nj-20261024'
       end,
       jsonb_build_object('version', 'release-dataset-coverage-topics/2026-10-27.v1', 'action', t.action, 'kept_evidence', t.kept, 'section_id', t.section_id, 'section_text_sha256', t.section_sha256),
       to_jsonb(r) || jsonb_build_object('row_md5', t.row_md5),
       case when t.action = 'update' then jsonb_build_object('kept_evidence', t.kept) end,
       '5792288a-88c5-9f65-f391-6da80fbd194b'::uuid
from _ct_targets t join public.corpus_records r on r.dataset = 'coverage_topics' and r.id = t.id and md5(to_jsonb(r)::text) = t.row_md5
on conflict (dataset, record_id, issue) do nothing;

insert into corpus_ingest.cleanup_decisions (dataset, record_id, issue, disposition, reason, evidence, original_record, replacement, run_id)
select 'corpus_datasets', d.id, 'release20261027_coverage_topics_verify', 'label_override',
       'Dataset released (ready=true) and its counts corrected to the rows that remain after the verification',
       jsonb_build_object('version', 'release-dataset-coverage-topics/2026-10-27.v1'), to_jsonb(d), null, '5792288a-88c5-9f65-f391-6da80fbd194b'::uuid
from public.corpus_datasets d where d.id = 'coverage_topics'
on conflict (dataset, record_id, issue) do nothing;

-- ===== statement 2: delete the 7 rows (only rows unchanged since the dry run and ledgered above) =====
create temporary table _ct_deleted (id text primary key) on commit drop;
with del as (
  delete from public.corpus_records r using _ct_targets t
   where r.dataset = 'coverage_topics' and r.id = t.id and t.action like 'delete%' and md5(to_jsonb(r)::text) = t.row_md5
     and exists (select 1 from corpus_ingest.cleanup_decisions c where c.dataset = 'coverage_topics' and c.record_id = t.id
                  and c.issue = 'release20261027_coverage_topics_verify' and c.original_record->>'row_md5' = t.row_md5)
  returning r.id)
insert into _ct_deleted select id from del;

-- ===== statement 3: update the 127 kept rows =====
create temporary table _ct_updated (id text primary key) on commit drop;
with base as (
  select r.dataset, r.id, r.item, r.filters, t.kept, t.row_md5, s.section_id, s.number, s.heading, s.citation, s.status, s.source_url as s_url,
         s.source_member, s.text_sha256, s.retrieved_at, s.edition_id, e.publisher, e.currency_statement,
         (select jsonb_agg(x.e->'topic' order by x.o) from jsonb_array_elements(t.kept) with ordinality x(e, o)) as topics,
         (select jsonb_agg(distinct q) from jsonb_array_elements(t.kept) k, jsonb_array_elements_text(k->'query_ids') q) as query_ids,
         case when exists (select 1 from jsonb_array_elements(t.kept) k where k->>'match' = 'title') then 'title' else 'text' end as match
  from _ct_targets t
  join public.corpus_records r on r.dataset = 'coverage_topics' and r.id = t.id and md5(to_jsonb(r)::text) = t.row_md5 and r.item = r.detail
  left join state_law.sections_nj s on t.section_id is not null and s.edition_id = 'nj-20261024' and s.section_id = t.section_id and s.text_sha256 = t.section_sha256 and s.status = 'in_force'
  left join state_law.editions e on e.edition_id = 'nj-20261024' and e.lifecycle = 'active'
  where t.action = 'update' and (t.section_id is null or s.section_id is not null)
    and exists (select 1 from corpus_ingest.cleanup_decisions c where c.dataset = 'coverage_topics' and c.record_id = t.id
                 and c.issue = 'release20261027_coverage_topics_verify' and c.original_record->>'row_md5' = t.row_md5)
),
built as (
  select b.*,
    (b.item - '_topic_evidence')
    || jsonb_build_object('match', b.match, 'topics', b.topics, 'query_ids', b.query_ids, '_topic_evidence', b.kept,
         'topic_verification', jsonb_build_object('version', 'coverage-topics-verify/2026-10-27.1',
           'checked_against', case when b.section_id is not null then 'official section heading and text (state_law.sections_nj ' || b.section_id || ')'
                                   when b.item->>'source_tier' = 'official_capture' then 'title as published by the source'
                                   else 'court-published document text (dataset seeger, record ' || (b.item->>'record_id') || ')' end))
    || case when b.section_id is null then '{}'::jsonb else jsonb_build_object(
         'title', b.number || ' — ' || b.heading,
         'citation', b.number,
         'source_url', b.s_url,
         'source_tier', 'official_edition',
         'source_dataset', 'state_law.sections_nj',
         'publisher_status', b.status,
         'temporal', coalesce(b.item->'temporal', '{}'::jsonb) || jsonb_build_object('captured_at', b.retrieved_at,
            'captured_at_basis', 'official edition retrieved_at (state_law.editions ' || b.edition_id || ')'),
         'official_edition', jsonb_build_object('edition_id', b.edition_id, 'section_id', b.section_id, 'citation', b.citation,
            'publisher', b.publisher, 'currency_statement', b.currency_statement, 'source_member', b.source_member, 'text_sha256', b.text_sha256)) end
    as new_item
  from base b
),
upd as (
  update public.corpus_records r
     set item = n.new_item,
         detail = n.new_item,
         filters = r.filters || jsonb_build_object('topic', n.topics),
         title = coalesce(n.new_item->>'title', r.title),
         source_url = coalesce(n.new_item->>'source_url', r.source_url)
    from built n
   where r.dataset = n.dataset and r.id = n.id and md5(to_jsonb(r)::text) = n.row_md5
  returning r.id)
insert into _ct_updated select id from upd;

-- ===== statement 4: release the dataset with corrected counts =====
update public.corpus_datasets d
   set ready = true,
       expected_records = c.n,
       imported_records = c.n,
       metadata = d.metadata || jsonb_build_object(
         'rows', c.n,
         'categories', c.by_category,
         'states', c.states,
         'release_2026_10_27', jsonb_build_object(
           'version', 'release-dataset-coverage-topics/2026-10-27.v1',
           'run_id', '5792288a-88c5-9f65-f391-6da80fbd194b',
           'owner_decision', '2026-10-27: dont withhold any data. If its accurate and valuable, USE IT',
           'previous', jsonb_build_object('ready', d.ready, 'expected_records', d.expected_records, 'imported_records', d.imported_records),
           'bundle_note', 'path, bytes and sha256 describe the 2026-10-03 import bundle (17,942 rows); 17,808 open_us_law-derived rows were removed on 2026-10-06 and 7 rows on 2026-10-27',
           'topic_rule_version', 'coverage-topics-verify/2026-10-27.1')),
       updated_at = now()
  from (select count(*)::int as n,
               (select jsonb_object_agg(category, k) from (select category, count(*) k from public.corpus_records where dataset = 'coverage_topics' group by 1) q) as by_category,
               (select jsonb_agg(state order by state) from (select distinct state from public.corpus_records where dataset = 'coverage_topics') q) as states
          from public.corpus_records where dataset = 'coverage_topics') c
 where d.id = 'coverage_topics';

-- ===== statement 5: assert, or roll everything back =====
do $$
declare n_del int; n_upd int; n_left int; n_trellis int; n_ready int;
begin
  select count(*) into n_del from _ct_deleted;
  select count(*) into n_upd from _ct_updated;
  select count(*) into n_left from public.corpus_records where dataset = 'coverage_topics';
  select count(*) into n_trellis from public.corpus_records where dataset = 'coverage_topics' and source_url ilike '%trellis%';
  select count(*) into n_ready from public.corpus_datasets where id = 'coverage_topics' and ready and expected_records = 127 and imported_records = 127;
  if n_del <> 7 or n_upd <> 127 or n_left <> 127 or n_trellis <> 0 or n_ready <> 1 then
    raise exception 'coverage_topics release check failed: deleted %, updated %, remaining %, trellis %, dataset ok % (expected 7, 127, 127, 0, 1)', n_del, n_upd, n_left, n_trellis, n_ready;
  end if;
end $$;

commit;

-- ===== verification (read-only; run after commit) =====
-- select source_url from public.corpus_records where dataset = 'coverage_topics' and source_url ilike '%trellis%';                       -- expect 0 rows
-- select ready, expected_records, imported_records, metadata->'categories', metadata->'states' from public.corpus_datasets where id = 'coverage_topics';
--   -- expect true, 127, 127, {"guidance": 13, "statutes": 114}, ["CA","NJ","NV","PA","TX"]
-- select state, item->>'source_tier' tier, split_part(split_part(source_url,'://',2),'/',1) host, count(*) from public.corpus_records where dataset = 'coverage_topics' group by 1,2,3 order by 1;
--   -- expect CA imported_collection 7 (3 hosts), NJ official_edition pub.njleg.gov 111, NV official_capture 3, PA imported_collection 1, TX imported_collection 5
-- select count(*) from public.corpus_records r where r.dataset = 'coverage_topics' and r.state = 'NJ'
--    and not exists (select 1 from state_law.sections_nj s where s.edition_id = 'nj-20261024' and s.section_id = r.item->'official_edition'->>'section_id' and s.status = 'in_force');  -- expect 0
-- select sum(jsonb_array_length(item->'topics')) from public.corpus_records where dataset = 'coverage_topics';                            -- expect 169
-- select count(*) from public.corpus_records where dataset = 'coverage_topics' and (item->'topics' is distinct from filters->'topic' or item <> detail); -- expect 0
-- select disposition, count(*) from corpus_ingest.cleanup_decisions where issue = 'release20261027_coverage_topics_verify' group by 1;   -- expect label_override 128, quarantine 7
