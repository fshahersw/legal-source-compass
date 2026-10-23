# State administrative codes and state registers (wave 1025, REGS) — 2026-10-25

Scope: the current official text of every state's administrative code (plus the District of Columbia), a complete
table-of-contents index, and a self-updating index of state register (rulemaking bulletin) issues. Everything comes from
each state's official government publisher; commercial hosts are never fetched; where the official code is published only
by a commercial vendor, or on a state domain operated by one that claims copyright in the text, the state is blocked or
index-only and the reason is recorded.

## 1. Coverage matrix (51 jurisdictions)

Measured on 2026-10-23 by `scripts/state_regs/probe.py` (robots.txt verdict and HTTP result of the official code page and
of the register page; raw responses hashed in `private/acq/w1025_regs/manifest.jsonl`). "Access" is how the publisher
serves the text; for states without a parser yet it is the publisher's published form, not yet exercised by a parser.
The machine-readable matrix is `private/build/w1025_regs/coverage.json`; the rows loaded into `state_regs.codes` are
`codes.json` (same folder), built by `scripts/state_regs/coverage.py`.

| State | Code (official publisher) | Access | Robots / HTTP (2026-10-23) | Text here | Index here | Register |
|---|---|---|---|---|---|---|
| AL | [Alabama Administrative Code](https://admincode.legislature.state.al.us/administrative-code) — Alabama Legislative Services Agency, Legal Division | api; official free | allowed; ok | no parser yet | — | Alabama Administrative Monthly (monthly) |
| AK | [Alaska Administrative Code](https://www.akleg.gov/basis/aac.asp) — Alaska State Legislature (Legislative Affairs Agency) | html; official free | allowed; ok | no parser yet | — | Alaska Administrative Register (quarterly) |
| AZ | [Arizona Administrative Code](https://apps.azsos.gov/public_services/CodeTOC.htm) — Arizona Secretary of State, Administrative Rules Division | pdf; official free | allowed; http_403 | blocked | — | Arizona Administrative Register (weekly) |
| AR | [Code of Arkansas Rules](https://codeofarrules.arkansas.gov/) — Arkansas Legislative Council, Bureau of Legislative Research | html; official free | allowed; ok | no parser yet | — | Arkansas Register (monthly) |
| CA | [California Code of Regulations](https://oal.ca.gov/publications/ccr/) — California Office of Administrative Law | none; commercial only | allowed, crawl-delay 10 s; ok | blocked | — | California Regulatory Notice Register (weekly) |
| CO | [Code of Colorado Regulations](https://www.sos.state.co.us/CCR/NumericalDeptList.do) — Colorado Secretary of State | pdf; official free | allowed; ok | sample built + checked (2 rules) | 1,276 headings | Colorado Register (semi-monthly) |
| CT | [Regulations of Connecticut State Agencies](https://eregulations.ct.gov/eRegsPortal/Browse/RCSA) — Connecticut Secretary of the State (eRegulations System) | html; official free | allowed; ok | no parser yet | — | eRegulations System notices (Connecticut Law Journal publishes legal notices) (continuous) |
| DE | [Delaware Administrative Code](https://regulations.delaware.gov/AdminCode/) — Delaware Registrar of Regulations (Division of Research, Legislative Council) | html; official free | allowed; ok | no parser yet | — | Delaware Register of Regulations (monthly) |
| DC | [District of Columbia Municipal Regulations](https://www.dcregs.dc.gov/Common/DCMR/TitleList.aspx) — D.C. Office of Documents and Administrative Issuances | html; official free | allowed; ok | no parser yet | — | District of Columbia Register (weekly) |
| FL | [Florida Administrative Code](https://www.flrules.org/gateway/organization.asp) — Florida Department of State, Administrative Code and Register | html; official free | allowed; ok | sample built + checked (24 rules) | 3,312 headings | Florida Administrative Register (daily) |
| GA | [Rules and Regulations of the State of Georgia](https://rules.sos.ga.gov/gac) — Georgia Secretary of State, Administrative Procedure Division | html; vendor operated | allowed, crawl-delay 2 s; ok | index only | 2,736 headings | none published (—) |
| HI | [Hawaii Administrative Rules](https://ltgov.hawaii.gov/the-office/administrative-rules/) — Office of the Lieutenant Governor (rules posted by each department) | pdf; official partial | allowed; ok | no parser yet | — | none published (—) |
| ID | [Idaho Administrative Code (IDAPA)](https://adminrules.idaho.gov/rules/current/) — Idaho Office of the Administrative Rules Coordinator (Division of Financial Management) | pdf; official free | allowed; ok | no parser yet | — | Idaho Administrative Bulletin (monthly) |
| IL | [Illinois Administrative Code](https://www.ilga.gov/commission/jcar/admincode/titles.html) — Illinois General Assembly, Joint Committee on Administrative Rules | html; official free | allowed, crawl-delay 10 s; ok | sample built + checked (12 rules) | 2,604 headings | Illinois Register (weekly) |
| IN | [Indiana Administrative Code](https://iar.iga.in.gov/code/current) — Indiana Legislative Services Agency (Indiana Register) | api; official free | allowed; ok | no parser yet | — | Indiana Register (weekly) |
| IA | [Iowa Administrative Code](https://www.legis.iowa.gov/law/administrativeRules/agencies) — Iowa Legislative Services Agency | pdf; official free | allowed; ok | no parser yet | — | Iowa Administrative Bulletin (biweekly) |
| KS | [Kansas Administrative Regulations](https://sos.ks.gov/publications/kansas-administrative-regulations.html) — Kansas Secretary of State | pdf; official free | allowed; ok | no parser yet | — | Kansas Register (weekly) |
| KY | [Kentucky Administrative Regulations](https://apps.legislature.ky.gov/law/kar/titles.htm) — Kentucky Legislative Research Commission | html; official free | allowed; ok | no parser yet | — | Administrative Register of Kentucky (monthly) |
| LA | [Louisiana Administrative Code](https://www.doa.la.gov/doa/osr/louisiana-administrative-code/) — Louisiana Office of the State Register (Division of Administration) | pdf; official free | allowed; ok | no parser yet | — | Louisiana Register (monthly) |
| ME | [Code of Maine Rules](https://www.maine.gov/sos/rulemaking/agency-rules) — Maine Secretary of State, Administrative Procedures Act Office | html; official free | allowed; http_403 | blocked | — | Weekly Notices of Rule-Making (weekly) |
| MD | [Code of Maryland Regulations (COMAR)](https://regs.maryland.gov/us/md/exec/comar/index.json) — Maryland Division of State Documents | api; official free | allowed; ok | no parser yet | — | Maryland Register (biweekly) |
| MA | [Code of Massachusetts Regulations](https://www.sec.state.ma.us/divisions/regs/) — Secretary of the Commonwealth, Regulations Division (official text sold by the State Bookstore) | none; paid official | allowed; ok | blocked | — | Massachusetts Register (biweekly) |
| MI | [Michigan Administrative Code](https://ars.apps.lara.state.mi.us/AdminCode/AdminCode) — Michigan Office of Administrative Hearings and Rules (ARS) | html; official free | allowed; ok | sample built + checked (27 rules) | 884 headings | Michigan Register (semi-monthly) |
| MN | [Minnesota Rules](https://www.revisor.mn.gov/rules/) — Minnesota Office of the Revisor of Statutes | html; official free | allowed; ok | sample built + checked (505 rules) | 832 headings | Minnesota State Register (weekly) |
| MS | [Mississippi Administrative Code](https://www.sos.ms.gov/adminsearch/default.aspx) — Mississippi Secretary of State, Administrative Procedures Division | pdf; official free | allowed; ok | no parser yet | — | Mississippi Administrative Bulletin (continuous) |
| MO | [Missouri Code of State Regulations](https://www.sos.mo.gov/adrules/csr/csr) — Missouri Secretary of State, Administrative Rules Division | pdf; official free | allowed; ok | no parser yet | — | Missouri Register (semi-monthly) |
| MT | [Administrative Rules of Montana](https://rules.mt.gov/) — Montana Secretary of State | api; official free | allowed; ok | no parser yet | — | Montana Administrative Register (biweekly) |
| NE | [Nebraska Administrative Code](https://www.nebraska.gov/rules-and-regs/regsearch/) — Nebraska Secretary of State, Rules and Regulations Division | pdf; official free | allowed; ok | no parser yet | — | none published (—) |
| NV | [Nevada Administrative Code](https://www.leg.state.nv.us/nac/) — Nevada Legislative Counsel Bureau | html; official free | allowed; ok | no parser yet | — | Nevada Register of Administrative Regulations (continuous) |
| NH | [New Hampshire Code of Administrative Rules](https://gc.nh.gov/rules/about_rules/listagencies.aspx) — New Hampshire Office of Legislative Services, Administrative Rules | html; official free | allowed; error | deferred | — | New Hampshire Rulemaking Register (weekly) |
| NJ | [New Jersey Administrative Code](https://www.nj.gov/oal/rules/accessp) — New Jersey Office of Administrative Law | none; commercial only | allowed; ok | blocked | — | New Jersey Register (semi-monthly) |
| NM | [New Mexico Administrative Code](https://www.srca.nm.gov/nmac-home/) — New Mexico State Records Center and Archives | pdf; official free | allowed; ok | no parser yet | — | New Mexico Register (semi-monthly) |
| NY | [Official Compilation of Codes, Rules and Regulations of the State of New York](https://dos.ny.gov/state-register) — New York Department of State, Division of Administrative Rules | none; commercial only | allowed; ok | blocked | — | New York State Register (weekly) |
| NC | [North Carolina Administrative Code](http://reports.oah.state.nc.us/ncac.asp) — North Carolina Office of Administrative Hearings, Rules Division | pdf; official free | allowed; ok | sample built + checked (156 rules) | 1,589 headings | North Carolina Register (semi-monthly) |
| ND | [North Dakota Administrative Code](https://www.ndlegis.gov/agency-rules/north-dakota-administrative-code) — North Dakota Legislative Council | pdf; official free | allowed; ok | no parser yet | — | none published (—) |
| OH | [Ohio Administrative Code](https://codes.ohio.gov/ohio-administrative-code) — Ohio Legislative Service Commission (codes.ohio.gov) | html; official free | allowed; ok | sample built + checked (42 rules) | 2,844 headings | Register of Ohio (continuous) |
| OK | [Oklahoma Administrative Code](https://rules.ok.gov/code) — Oklahoma Secretary of State, Office of Administrative Rules | api; official free | allowed; http_403 | blocked | — | Oklahoma Register (semi-monthly) |
| OR | [Oregon Administrative Rules](https://secure.sos.state.or.us/oard/ruleSearch.action) — Oregon Secretary of State, Archives Division | html; official free | allowed; ok | sample built + checked (24 rules) | 3,334 headings | Oregon Bulletin (monthly) |
| PA | [Pennsylvania Code](https://www.pacodeandbulletin.gov/Display/pacode) — Pennsylvania Legislative Reference Bureau | html; official free | disallowed; robots_disallowed | blocked | — | Pennsylvania Bulletin (weekly) |
| RI | [Rhode Island Code of Regulations](https://rules.sos.ri.gov/Organizations) — Rhode Island Department of State, Administrative Records | html; official free | allowed; ok | no parser yet | — | Rulemaking notices (Rhode Island Department of State) (continuous) |
| SC | [South Carolina Code of Regulations](https://www.scstatehouse.gov/coderegs/statmast.php) — South Carolina Legislative Council | html; official free | allowed; ok | no parser yet | — | South Carolina State Register (monthly) |
| SD | [Administrative Rules of South Dakota](https://sdlegislature.gov/Rules/Administrative) — South Dakota Legislative Research Council | api; official free | allowed; ok | no parser yet | — | South Dakota Register (weekly) |
| TN | [Official Compilation Rules and Regulations of the State of Tennessee](https://publications.tnsosfiles.com/rules/0800/0800.htm) — Tennessee Secretary of State, Publications Division | pdf; official free | allowed; http_403 | blocked | — | Tennessee Administrative Register (monthly) |
| TX | [Texas Administrative Code](https://texas-sos.appianportalsgov.com/rules-and-meetings?interface=VIEW_TAC) — Texas Secretary of State, Texas Register Section | portal; official free | allowed; ok | deferred | — | Texas Register (weekly) |
| UT | [Utah Administrative Code](https://adminrules.utah.gov/public/search/Current%20Rules) — Utah Office of Administrative Rules | api; official free | allowed; http_404 | deferred | — | Utah State Bulletin (semi-monthly) |
| VT | [Code of Vermont Rules](https://sos.vermont.gov/secretary-of-state-services/apa-rules) — Vermont Secretary of State | none; commercial only | allowed; ok | blocked | — | Rulemaking notices (Vermont Secretary of State) (weekly) |
| VA | [Virginia Administrative Code](https://law.lis.virginia.gov/admincode/) — Virginia Division of Legislative Automated Systems (law.lis.virginia.gov) | api; official free | allowed; ok | no parser yet | — | Virginia Register of Regulations (biweekly) |
| WA | [Washington Administrative Code](https://app.leg.wa.gov/wac/) — Washington Office of the Code Reviser | html; official free | allowed; ok | sample built + checked (335 rules) | 2,646 headings | Washington State Register (semi-monthly) |
| WV | [West Virginia Code of State Rules](https://apps.sos.wv.gov/adlaw/csr/) — West Virginia Secretary of State, Administrative Law Division | pdf; official free | allowed; ok | no parser yet | — | West Virginia State Register (weekly) |
| WI | [Wisconsin Administrative Code](https://docs.legis.wisconsin.gov/code/admin_code) — Wisconsin Legislative Reference Bureau | html; official free | allowed; error | deferred | — | Wisconsin Administrative Register (weekly) |
| WY | [Wyoming Administrative Rules](https://rules.wyo.gov/) — Wyoming Secretary of State, Administrative Rules | html; official free | allowed; ok | no parser yet | — | none published (—) |

Blocked or deferred, with the reason recorded in `state_regs.codes.blocked_reason` / `acquisition.reason`:

- **Commercial vendor only (not fetched):** California (CCR on Westlaw), New York (NYCRR on Westlaw), New Jersey
  (N.J.A.C. and N.J.R. by LexisNexis), Vermont (compiled code by LexisNexis). Index metadata only from the states' own pages.
- **Vendor-operated state site:** Georgia — rules.sos.ga.gov carries "Copyright (c) 2026 Fastcase, Inc - All rights
  reserved" on every page; department / chapter / subject captions only, no rule text.
- **Paid official text:** Massachusetts (CMR sold by the Secretary of the Commonwealth; site also behind a browser check).
- **robots.txt disallows:** Pennsylvania (pacodeandbulletin.gov: `User-agent: *` / `Disallow: /`).
- **Browser checks / 403 to automated requests (never bypassed):** Arizona, Oklahoma (Cloudflare), Tennessee, Maine
  (CloudFront 403).
- **Deferred:** Texas (the TAC moved in 2025 to the Secretary of State's Appian "Rules and Meetings" portal; pages are
  built by a stateful UI protocol with no bulk file or documented API — the Texas Register issue index is acquired);
  Wisconsin and New Hampshire (connections reset/closed from the acquisition network on 2026-10-23; the earlier wave
  reached Wisconsin); Utah (single-page application with an undocumented data interface).
- **Illinois** publishes with the statement that its database "is NOT the official text" (the certified copy filed with
  the Secretary of State is); the statement is kept as the edition note on every Illinois rule.

## 2. Normalized model (state-regs/1)

Field names follow the state-statutes model (`src/lib/law/stateCodeContract.ts`, `scripts/enrichment/state_statutes/codebuild.py`:
citation, heading, text, history, edition, currency, source_url, status). The shared state-law library
(`/home/user/wt/stat-a/scripts/state_law/lib.py`, MODEL.md) did not exist during this wave; `scripts/state_regs/lib.py`
imports it by path when it appears (`lib.shared_lib()`), nothing depends on it. Definitions: `scripts/state_regs/model.py`.

- **Node** (one heading of the official table of contents): `id` (`<st>:<key from the official numbering>`), `state`,
  `parent_id`, `level` (the publisher's word: title, agency, department, bureau, chapter, subchapter, division, part,
  rule set, subject), `num`, `heading`, `agency`, `citation`, `source_url`, `ordinal`, `rule_count` (as listed by the
  publisher, else null).
- **Rule**: `id` (`<st>:<cite_key>`), `state`, `node_id`, `number`, `citation` (official form), `cite_key`, `heading`,
  `agency`, `text` (published body, one line per block), `history` (source note as printed, one line per entry),
  `authority`, `status` (active / repealed / expired / reserved / transferred / recodified / rescinded / renumbered, as
  printed), `emergency` (true only when the publisher marks the current version emergency/temporary; null otherwise),
  `effective_date` / `adopted_date` (only when printed as a date for the current version), `register_citation` (the
  latest register entry the publisher prints, e.g. `WSR 25-05-042`, `43 Ill. Reg. 9674`, `46 SR 1209`), `source_url`,
  `edition`, `currency` (statements as printed), `retrieved_at`, `raw_sha256` (the unchanged response the rule was cut
  from), `text_sha256`, `text_check`.
- **Register issue** (corpus dataset `state_register_issues`): `state`, `publication`, `date` or `period` (YYYY-MM for a
  bulletin listed by month), `volume`, `issue`, `pages`, `label` (link text as printed), `url`.
- **Citation keys** (`scripts/state_regs/cite_patterns.json`, mirrored in `state_regs.cite_patterns`): one pattern per
  state form (OH `3745-31-03`, WA `173-400-010`, MN `7011.0010`, OR `581-001-0005`, NC `15A NCAC 02D .0101`, MI
  `R 336.1101`, IL `35 Ill. Adm. Code 101.100`, FL `62-296.320`, TX `16 TAC § 3.1`, VA `9VAC5-40-10`, MD COMAR,
  GA, CO, KY); key = template, lowercased, leading zeros dropped. A citation resolves only to the rule with exactly that
  key; no key or no rule is "unresolved" — never a nearby rule.

## 3. Acquisition and parsers (bounded samples, exact-text checks)

Stream design (`scripts/state_regs/build.py`): fetch one unit (chapter / division / subchapter / rule set / part) →
parse → check every rule against an independent rendering of the same bytes → write a gzip JSONL shard → delete the
raw bytes (manifest keeps URL, sha256, size). Polite fetching (`lib.py`): robots.txt honoured with Crawl-delay, ≥1 s per
host, bounded retries, descriptive User-Agent, commercial hosts refused, missing TLS intermediates loaded from the
certificate's own AIA URL (verification never disabled).

Exact-text check: each line of the stored text, heading and history must occur verbatim (whitespace aside) in the
independent rendering, in order (`lib.contained`). HTML is rendered with the standard-library HTMLParser (parsers use
lxml); Florida's Word files are read by a standard-library OLE/piece-table reader and checked against LibreOffice's
conversion of the same bytes.

| State | Source unit | Sample (units) | Rules | Text / heading / history check |
|---|---|---|---|---|
| OH | chapter page (all rules in full) | 3745-4, 4901:1-10 | 42 | 42 / 42 / 42 confirmed |
| WA | `default.aspx?cite=<chapter>&full=true` | 173-400, 296-24 | 335 | 315 confirmed (20 headings-only sections print no text) / 335 / 335 |
| MN | `/rules/<chapter>/full` | 1400, 7011 | 505 | 503 confirmed (2 print no text) / 424 (81 repealed parts print no heading) / 423 |
| OR | OARD division page | 581-001, 581-002 | 24 | 24 / 24 / 24 |
| NC | subchapter HTML file | 15A NCAC 02A, 02B | 156 | 90 confirmed (66 expired/repealed/reserved print no text) / 156 / 129 |
| MI | rule-set HTML rendering | R 336.1101–1128, R 336.201–205 | 27 | 26 (1 rescinded) / 27 / 27 |
| IL | JCAR section file (Crawl-delay 10 s) | 35 Ill. Adm. Code 101 (first 12 sections) | 12 | 12 / 12 / 10 |
| FL | chapter page + Word rule file | 62-296, 64B8-9 (12 rules each) | 24 | 18 (6 repealed) / 24 / 24 (LibreOffice) |
| CO | rule-set page + official PDF (unit = rule set, the unit the CCR cites) | 5 CCR 1001-1, 1001-2 | 2 | 1 confirmed, 1 mostly (99.9%: a table header the two PDF engines lay out differently); lines compared without order |

No HTML or Word check failed in any sample (no `mostly_confirmed` / `partly_confirmed`); Colorado's PDF check is reported as
measured. Colorado text is extracted with `pdftotext -layout` (the default mode re-joins hyphenated words across lines and
so changes citations such as "25-7-101"); the rotated side banner ("Code of Colorado Regulations", "Secretary of State")
is page furniture and is dropped by an explicit rule. Reports with every request URL and sha256:
`private/build/w1025_regs/<ST>/report-sample.json`; shards: `rules-sample.jsonl.gz`.

Index v2 (full table of contents, crawled 2026-10-23): OH 2,844 nodes (328 agencies, 2,516 chapters); WA 2,646
(197 titles, 2,449 chapters); MN 832 chapters; OR 3,334 (181 chapters, 3,153 divisions; 40,824 rules listed); MI 884
(19 departments, 97 bureaus, 768 rule sets); IL 2,604 (33 titles, 2,571 parts; 54,670 section files listed); FL 3,312
(54 departments, 390 divisions, 2,868 chapters); NC 1,589 (30 titles, 533 chapters, 1,026 subchapters; 35,002 rules
listed); CO 1,276 (25 departments, 213 agencies, 1,038 rule sets); GA 2,736 (154 departments, 1,222 chapters, 1,360
subjects; captions only).

## 4. State register issue index (self-updating)

`src/lib/ingest/sources/stateRegisters.ts` (adapter `state_registers`), edge function
`supabase/functions/ingest-state-registers/` (weekly, Tuesday 06:17 UTC, disabled until the lead enables it). One
listing page per state per run (≤20 requests, ≥2 s apart per host): Texas Register, Colorado Register, Maryland
Register, Missouri Register, New Mexico Register, New York State Register, Minnesota State Register, Oregon Bulletin,
Administrative Register of Kentucky. Rows go to corpus dataset `state_register_issues` through `ingest_upsert_v1`
(upsert, newest first); only what the listing prints is recorded (847 issue rows from the 2026-10-23 listings). A
listing that yields nothing marks the run partial (layout change). Fixture: `src/lib/ingest/fixtures/state-registers.json`.

## 5. SQL contract and app

`database/contracts/state-regs-v1.sql` — schema `state_regs` (codes, nodes, rules with a weighted tsvector, cite
patterns); RPCs `state_reg_codes_v1`, `state_reg_tree_v1(p_state, p_parent, p_limit, p_offset)`, `state_reg_rule_v1(p_id)`,
`state_reg_search_v1(p_state, p_q, p_limit, p_offset)`, **`state_reg_resolve_v1(p_state, p_citation)`** (worker CITE:
`resolved` with `rule_id` | `ambiguous` | `unresolved` | `not_covered` | `invalid`), `state_reg_status_v1`, loaders
`state_reg_load_codes_v1`, `state_reg_load_nodes_v1`, `state_reg_load_rules_v1` (unchanged rows not rewritten),
`state_reg_finish_v1`, `state_reg_prune_v1`; the `state_register_issues` dataset row and the `state_registers` ingest
source. All SECURITY DEFINER, `search_path = ''`, service_role only. Offline test:
`node --test scripts/state_regs/state-regs-contract.test.mjs` (pglite).

App: `/law/regulations` shows the 51-row coverage matrix (publisher, text held, contents, robots, register) and keeps the
v1 index search; `/law/regulations/$state` has tabs Contents (tree from the official table of contents, rules under a
heading), Search (rule text, with exact citation match first), Register (issues per year and the newest issues, each
linking to the official issue), Source and coverage; `?rule=<id>` opens the rule reader (citation, status, effective
date, register citation, agency, official link, currency, retrieval date, text check, text, authority, history,
previous/next). Until the contract is applied every v2 call returns null and the pages show the v1 index as before.
Server functions: `src/lib/external/stateRegs.functions.ts`.

## 6. Size estimates

Average stored rule row in the samples: OH 7.0 KB, WA 5.8 KB, MN 2.2 KB, OR 3.6 KB, NC 8.9 KB, MI 4.6 KB, IL 5.2 KB,
FL 8.6 KB (Colorado stores one row per rule set: ≈1,100 rows of up to several MB each). Rule counts listed by the
publishers: OR 40,824; NC 35,002; IL 54,670 section files. The other five are not listed in their tables of contents; at the samples' rules per unit they are in the order of 20,000–60,000 each. For the eight
states (≈250,000–350,000 rules) expect ≈1.5–2.5 GB of row JSON, stored in Postgres as ≈0.6–0.9 GB of TOAST-compressed
text plus ≈0.4–0.7 GB for the GIN index and ≈0.1 GB of btree indexes. Build shards (gzip) ≈ 25–30% of the row JSON:
load and delete shard by shard (`--delete-after-load`) to stay inside the disk budget.

## 7. RUNBOOK (lead)

All commands from the repository root. Python needs only the standard library plus lxml (present); Florida's checks use
LibreOffice (`soffice`, present). Credentials are sourced only inside the commands that load.

1. **Apply the contract** (after `database/contracts/ingest-v1.sql`, which it extends):
   `database/contracts/state-regs-v1.sql` (idempotent; safe to re-apply). Check: `select public.state_reg_status_v1();`
2. **Coverage rows** (51): `python3 -I -B scripts/state_regs/coverage.py` then
   `. private/scratch/env.sh && python3 -I -B scripts/state_regs/load.py codes` → `{"codes": 51, ...}`.
3. **Indexes** (already built under `private/build/w1025_regs/<ST>/nodes.jsonl.gz`; to refresh:
   `python3 -I -B scripts/state_regs/build.py index OH WA MN OR NC MI IL FL CO GA`, ≈ 5–40 min per state, raw pages deleted
   after each state).
4. **Validation samples** (already built): `. private/scratch/env.sh && for s in OH WA MN OR NC MI IL FL CO; do
   python3 -I -B scripts/state_regs/load.py state $s --run sample; done` (nodes then rules, then `state_reg_finish_v1`).
   GA: `load.py state GA --run sample` loads its index only (no rule text by design).
5. **Full acquisition, streamed, one state at a time** (resumable; each shard = 25 units; raw bytes of a shard are
   deleted once its rules are written; `report-full.json` records every shard's file, row count and sha256):
   `python3 -I -B scripts/state_regs/build.py full OH` (likewise WA, MN, OR, NC, MI, CO, FL; IL in chunks:
   `build.py full IL --limit 200` repeated — Crawl-delay 10 s).
   Then load and free the disk: `. private/scratch/env.sh && python3 -I -B scripts/state_regs/load.py state OH --run full
   --build oh-full-2026-10-26 --delete-after-load`. After a complete run only: `load.py prune OH --build oh-full-2026-10-26`
   (removes rows of older builds of that state; the nodes must have been loaded with the same build id).
   Expected requests / time at the publishers' pace: OH ≈2,500 chapter pages (≈1 h), WA ≈2,450 (≈1 h), MN 832 (≈15 min),
   OR 3,153 divisions (≈1 h), NC 1,026 subchapter files (≈20 min), MI 768 rule sets (≈15 min), CO ≈1,100 rule sets
   (page + official PDF each, ≈40 min; PDFs up to tens of MB: use `--shard 5`), FL 2,868 chapter
   pages + one Word file per rule (≈25,000–35,000 requests, ≈9–10 h; LibreOffice check on 1 rule in 20, set
   `STATE_REGS_DOC_CHECK_EVERY=1` to check all), IL 54,670 section files at 10 s (≈6.3 days; run `--limit` chunks).
   Disk: ≤ 30 MB transient raw per shard; gzip shards ≈ 25–30% of row JSON — delete after load.
6. **Register ingest**: deploy `supabase functions deploy ingest-state-registers --project-ref xosqzzsnhxcyehcnirpa
   --no-verify-jwt`; first run manually as in `ingest-v1.sql` step 5 with `'source', 'state_registers'`; check
   `ingest.runs`; then `update ingest.sources set enabled = true where id = 'state_registers';` and re-apply section 9 of
   `ingest-v1.sql` (the cron block reads every row of `ingest.sources`). To use `scripts/ingest/dry_run.py` for this
   source, add `stateRegisters` to `SOURCES` in `src/lib/ingest/registry.ts` and move its `ingest.sources` row into
   `ingest-v1.sql` (the registry test reads that file).
7. **Verification SQL**
   ```sql
   select public.state_reg_status_v1();
   select state, status, access, text_rules, index_nodes, acquisition->>'text' as acquisition from state_regs.codes order by state;
   select state, count(*) as rules,
          count(*) filter (where text_check->>'text' = 'confirmed') as text_confirmed,
          count(*) filter (where text_check->>'text' in ('mostly_confirmed', 'partly_confirmed')) as text_partial,
          count(*) filter (where text is null) as no_text
   from state_regs.rules group by state order by state;
   select state, count(*) from state_regs.rules r
   where node_id is not null and not exists (select 1 from state_regs.nodes n where n.id = r.node_id) group by state;  -- 0 after full index loads
   select public.state_reg_resolve_v1('OH', 'Ohio Adm.Code 3745-4-01');   -- resolved, rule_id oh:3745-4-1
   select public.state_reg_resolve_v1('OH', 'Ohio Adm.Code 3745-4-99');   -- unresolved
   select public.state_reg_resolve_v1('CA', '17 CCR 1234');               -- unresolved (no rule text held)
   select public.state_reg_search_v1('MN', 'opacity', 5, 0) -> 'total';
   select source, status, fetched, inserted, updated, unchanged, error, notes from ingest.runs
   where source = 'state_registers' order by started_at desc limit 5;
   select state, count(*) from public.corpus_records where dataset = 'state_register_issues' group by state order by 1;
   ```
8. **Refresh cadence**: registers weekly (scheduled function). Codes: re-run `build.py full <ST>` monthly per state
   (unchanged rules are not rewritten; changed text replaces the row and keeps a new `retrieved_at`), then `prune`
   after a complete run; refresh the coverage probe (`probe.py`) quarterly.
