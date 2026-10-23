# State law in force — STAT-B jurisdictions (wave 1025)

Worker STAT-B, branch `wave1025/stat-b`. Scope: current, in-force official statutory text for 29 jurisdictions —
MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY — from the official
government publisher only (AGENTS.md owner instruction 2026-10-19). Model: `scripts/state_law/MODEL.md`
(state-law/1, owned by STAT-A); shared code `scripts/state_law/{lib,run,verify,load}.py` is STAT-A's, copied
unchanged (byte-identical, checked with `cmp` against STAT-A's commit `c6ea31f`).

Everything below was observed on 2026-10-23. Unknown values are written "Not recorded".

## 1. Outcome by jurisdiction

| Outcome | Jurisdictions |
|---|---|
| Live official source, parser proven on a bounded live sample | TX NJ PA NC MO MN SC OR NV VA WA SD ND MT WY NE WV RI UT VT (20) |
| Live source unavailable today; parser proven on the project's retained publisher originals | MI (robots.txt answers 5xx), NM (HTTP 403), WI (TLS reset), NH (connection closed) (4) |
| Owner decision needed before anything is loaded | OH (robots.txt is one ambiguous line; retained originals parse), OK (robots.txt disallows all agents, and the retained capture was taken under that rule) (2) |
| Blocked, no module output | NY (browser check; API key not provisioned; LRS robots `Disallow: /`), TN and MS (code text only on a commercial host) (3) |

## 2. Coverage matrix — what we hold vs. the official current source

"Held" = `corpus_ingest.publisher_code_states_v2` (production, read-only query 2026-10-23), plus the official
datasets `state_code_wa` (52,518), `state_code_sd` (47,734), `state_code_nd` (29,116) built 2026-10-19.

| St | Held today (source system · sections) | Held official? | Official publisher and current source | Access | robots.txt / rate | Live 2026-10-23 | Module (parser) |
|---|---|---|---|---|---|---|---|
| MI | mi-compiled-laws · 43,891 | yes | Michigan Legislative Council — per-chapter MCL XML, `legislature.mi.gov/documents/mcl/` | bulk XML | robots.txt answers HTTP 502 → treated as disallow-all (RFC 9309) | refused (Blocked) | `mi.py` (mi-mcl-xml/1), retained mode |
| MN | mn-statutes · 55,445 | yes | Office of the Revisor — `revisor.mn.gov/statutes/cite/<ch>/full` | html | disallows only /alpha/, /beta/, search | ok | `mn.py` (mn-chapter-full/1) |
| MS | ms-historical-rtf-20200708 · 28,913 | **no** (third-party 2020 edition) | code text only on LexisNexis (pointed to by sos.ms.gov) | blocked | legislature.ms.gov TLS chain error | blocked | `ms.py` (blocked) |
| MO | mo-revised-statutes · 30,472 | yes | Revisor of Statutes — `revisor.mo.gov/main/ViewChapter.aspx?chapter=<n>` | html | no robots.txt | ok | `mo.py` (mo-viewchapter-html/1) |
| MT | mt-mca · 44,917 | yes | Legislative Services — one page per section, `mca.legmt.gov/bills/mca/…` | html | no robots.txt (404) | ok | `mt.py` (mt-section-page/1) |
| NE | ne-revised-statutes · 56,371 | yes | Revisor of Statutes — `nebraskalegislature.gov/laws/display-chapters.php?chapter=<n>` | html | `Crawl-delay: 3` (honored) | ok | `ne.py` (ne-display-chapter/1) |
| NV | nv-nrs-lcb · 50,084 | yes | Legislative Counsel Bureau — `leg.state.nv.us/NRS/NRS-<ccc>.html` | html | disallows report/exhibit/opinion paths | ok | `nv.py` (nv-chapter-html/1) |
| NH | nh-rsa-html · 27,737 | yes | General Court — merged chapter pages `gencourt.state.nh.us/rsa/html/<T>/<ch>/<ch>-mrg.htm` | html | Not recorded (host now redirects to gc.nh.gov) | connection closed (no HTTP answer) | `nh.py` (nh-merged-chapter/1), retained only |
| NJ | nj-pub-statutes-bulk · 56,333 | yes | Office of Legislative Services — `pub.njleg.gov/statutes/STATUTES-TEXT.zip` (TXT + RTF) | bulk | `Allow: /` | ok | `nj.py` (nj-txt-rtf/1) |
| NM | nm-nmsa-1978 · 62,972 | yes | Compilation Commission — NMOneSource chapter PDFs | pdf | disallows two named items | HTTP 403 (not retried) | `nm.py` (nm-chapter-pdf/1), retained mode |
| NY | ny-consolidated-laws · 37,530 | captured through a third-party fetch proxy, not publisher-direct | Senate Open Legislation API `legislation.nysenate.gov/api/3/laws` | api | nysenate.gov browser check (403); API 401 without key; LRS `Disallow: /` | blocked | `ny.py` (blocked) |
| NC | nc-general-statutes · 39,612 | yes | General Assembly — `ncleg.gov/EnactedLegislation/Statutes/HTML/ByChapter/Chapter_<n>.html` | html | `Crawl-delay: 2` (behind a BOM; module enforces 2 s) | ok | `nc.py` (nc-chapter-html/1) |
| ND | nd-cencode-chapter-pdf-html · 17,612 (+ dataset 29,116) | yes | Legislative Branch — chapter PDFs `ndlegis.gov/cencode/t<tt>c<cc>.pdf` | pdf | allows /cencode/ | ok | `nd.py` (nd-chapter-pdf/1) |
| OH | oh-codes-ohio-gov · 33,343 | yes | Legislative Service Commission — `codes.ohio.gov/ohio-revised-code/section-<n>` | html | single line `User-agent: * Disallow: /` (parsers read no rule; intent reads disallow-all) | not crawled (owner decision) | `oh.py` (oh-section-page/1), retained by default |
| OK | ok-statutes · 48,019 | yes, but captured 2026-10-06 while robots.txt disallowed all agents | Legislature — complete-title RTF `oklegislature.gov/OK_Statutes/CompleteTitles/os<N>.rtf` | bulk RTF | `User-agent: *` … `Disallow: /` (named search bots allowed); OSCN browser check | refused (Blocked) | `ok.py` (ok-title-rtf/1), retained only |
| OR | or-ors · 65,750 | yes | Legislative Counsel — `oregonlegislature.gov/bills_laws/ors/ors<ccc>.html` (2025 Edition) | html | no restriction on these paths | ok | `or.py` (or-chapter-html/1) |
| PA | pa-consolidated-statutes · 14,741 | yes | General Assembly — title documents `palegis.us/statutes/consolidated/view-statute?…ttl=<n>` | html | restricts only one scanner and /cfdocs/ | ok | `pa.py` (pa-title-html/1) |
| RI | ri-statutes-web · 32,852 | yes | General Assembly — one page per section `webserver.rilegislature.gov/Statutes/…` | html | no robots.txt (404) | ok | `ri.py` (ri-section-page/1) |
| SC | sc-code-of-laws · 30,867 | yes | Legislative Council — `scstatehouse.gov/code/t<tt>c<ccc>.php` | html | disallows image/dashboard paths, two named bots | ok | `sc.py` (sc-chapter-html/1) |
| SD | sd-sdcl-api · 27,876 (+ dataset 47,734) | yes | Legislature — `sdlegislature.gov/api/Statutes/<title>.html?all=true` | api | lists sitemaps; disallows viewer/logo paths | ok | `sd.py` (sd-whole-title/1) |
| TN | tn-historical-rtf-20210521 · 34,356 | **no** (third-party 2021 edition) | code text only on LexisNexis (linked from capitol.tn.gov) | blocked | capitol.tn.gov `Disallow: /` | blocked | `tn.py` (blocked) |
| TX | tx-texas-legislature-code · 121,902 | yes | Texas Legislative Council — per-code HTML zips listed in `statutes.capitol.texas.gov/assets/StatuteCodeDownloads.json` | bulk | none (SPA shell / 404) | ok | `tx.py` (tx-html/1) |
| UT | ut-code · 22,977 | yes | Office of Legislative Research and General Counsel — per-title XML `le.utah.gov/xcode/Title<N>/<version>.xml` | bulk XML | `Crawl-delay: 10` (honored) | ok | `ut.py` (ut-title-xml/1) |
| VT | vt-statutes-online · 26,463 | yes | General Assembly — `legislature.vermont.gov/statutes/fullchapter/<t>/<ccc>` | html | `Crawl-delay: 30` (honored) | ok | `vt.py` (vt-fullchapter/1) |
| VA | va-code · 34,442 | yes | Division of Legislative Services — per-title CSV `law.lis.virginia.gov/CSV/CoVTitle_<n>.csv` | bulk CSV | no robots.txt (404) | ok | `va.py` (va-title-csv/1) |
| WA | wa-rcw-archive-2026-pdf · 44,096 (+ dataset 52,518) | yes | Code Reviser — `app.leg.wa.gov/RCW/default.aspx?cite=<ch>&full=true` | html | no robots.txt (404) | ok | `wa.py` (wa-rcw-full-chapter/1) |
| WV | wv-code · 31,246 | yes | Legislature — `code.wvlegislature.gov` (admin-ajax `get_all_sections` per article) | api | explicitly allows admin-ajax.php | ok | `wv.py` (wv-article-ajax/1) |
| WI | wi-statutes · 18,153 | yes | Legislative Reference Bureau — `docs.legis.wisconsin.gov/statutes/statutes/<ch>.txt` (+ .pdf) | bulk text | disallows only search/feed/frame | TLS reset from this network | `wi.py` (wi-chapter-txt/1), retained mode |
| WY | wy-statutes · 21,412 | yes | Legislative Service Office — title PDFs from `wyoleg.gov/stateStatutes/StatutesDownload` | pdf | no robots.txt (404) | ok | `wy.py` (wy-title-pdf/1) |

**WA / SD / ND — current vs held.** Bounded comparison of section numbers between the held official datasets
(2026-10-19) and today's publisher text: WA chapter 4.16 38/38 identical numbers; ND chapter 28-01 53/53; SD title 2
chapter 1: 39 today vs 40 held — the held set has `2-1-6.3` ("Repealed by SL 2009, ch 64, § 6, eff. July 1, 2010."),
which today's whole-title document does not print. Text-level comparison was not possible from `corpus_records.text`
(it holds the catchline, not the statute text). The held datasets are current as of their build; the new modules
produce state-law/1 editions from the same publishers.

### Currency statements (verbatim, from the samples)

| St | Currency statement | Source |
|---|---|---|
| MI | "Michigan Compiled Laws Complete Through PA 103 of 2026" (retained index, 2026-10-06; the live index read "PA 114 of 2026" on 2026-10-23) | `www.legislature.mi.gov/Laws/ChapterIndex` |
| MN | "2025 Minnesota Statutes" | revisor.mn.gov |
| MO | "In accordance with Section 3.090, the language of statutory sections enacted during a legislative session are updated and available on this website on the effective date of such enacted statutory section. CERTIFICATION STATUS: Currently the statutes posted on this website are uncertified and unofficial (see FAQ for more information)." | revisor.mo.gov home |
| MT | "Montana Code Annotated 2025 / Updated August 2026" | mca.legmt.gov |
| NC | "The General Statutes include changes through S.L. 2026-30." | ncleg.gov TOC |
| NJ | "NEW JERSEY GENERAL AND PERMANENT STATUTES (UPDATED THROUGH P.L.2026, c.50, and J.R.1)" | STATUTES.TXT |
| OH | "The Legislative Service Commission staff updates the Revised Code on an ongoing basis, as it completes its act review of enacted legislation. Updates may be slower during some times of the year, depending on the volume of enacted legislation." | section pages |
| OK | "Note: The Oklahoma Constitution and Oklahoma Statutes were last updated on November 18th, 2025." | osStatuesTitle.html (retained 2026-10-06) |
| OR | "The 2025 Edition does not include changes to the law enacted during the 2025 special session or the 2026 regular session of the Eighty-third Legislative Assembly. …" (full text in the edition) | ORS page |
| SC | "The South Carolina Code on the General Assembly's website is now current through the 2026 Session of the General Assembly." | statmast.php |
| TX | "The statutes available on this website are current through the 89th 2nd Called Legislative Session, 2025. The constitutional provisions found on this website are current through the amendments approved by voters in November 2025." | tcss API StatutesCurrentMsg |
| UT | "The Office of Legislative Research and General Counsel is the official publisher of the Utah Code. The code provisions available above constitute the current and official electronic record of the Utah Code." | xcode/js/code.js |
| VT | "The Statutes below now include the actions of the 2026 session of the General Assembly. NOTE: The Vermont Statutes Online is an unofficial copy of the Vermont Statutes Annotated that is provided as a convenience." | statutes index |
| WA | "Last update: July 15, 2026" | RCW index |
| WI | "The Legislative Reference Bureau certifies that each section of the updated 2023-24 Wisconsin Statutes for publication under s. 35.18 (1) (b) on October 1, 2026, has been compared … and that all sections appear to be correctly printed." | prefaces/certificate.txt (retained 2026-10-06) |
| WV | "These West Virginia Code sections are updated regularly as new legislation takes effect." | code.wvlegislature.gov |
| WY | "This version of the Wyoming Statutes contains changes from the 2026 Budget Session and reflects the contents of the statutes as they exist as of July 1, 2026." | download page template |
| ND NE NH NM NV PA RI SD VA | Not recorded (the publisher prints no code-wide currency line on the pages read) | — |

## 3. Bounded samples (exact-text proof)

Built end to end with `run.py` and checked with the local verify adapter
(`python3 scripts/state_law/states/_statb.py verify <edition> --raw private/acq/w1025_stat-b/state_law`): every line of
`text`, the heading, the history and the status marker occurs verbatim in the rendering of the kept source bytes, and
the number occurs in the source. All 26 samples: `ok: true`. Manifest with every file hash, count and source URL:
`private/build/w1025_stat-b/MANIFEST.json`.

| State | Edition dir (private/build/w1025_stat-b/state_law/…) | Mode | Bound | Sections | Exact-text checked | Quotes | Status counts | sections.jsonl.gz sha256 (first 16) |
|---|---|---|---|---:|---:|---:|---|---|
| MI | mi/mi-20261023 | retained | chapters 2, 691 | 341 | 341 | 965 | in_force 312, repealed 29 | `d87bdfb09fb4a1d7` |
| MN | mn/mn-20261023 | live | chapters 540, 541 | 62 | 62 | 166 | in_force 52, not_recorded 1, repealed 9 | `c7d11e7fd8321a13` |
| MO | mo/mo-20261023 | live | chapters 1, 516 | 104 | 104 | 310 | in_force 104 | `aa1fd190e016c3e7` |
| MT | mt/mt-20261023 | live | part 27-2-2 | 22 | 22 | 63 | in_force 20, renumbered 1, repealed 1 | `fc72bf058254b1ac` |
| NC | nc/nc-20261023 | live | chapters 1C, 1D | 67 | 67 | 171 | in_force 52, reserved 15 | `d9512f438f6b5373` |
| ND | nd/nd-20261023 | live | chapter 28-01 | 53 | 53 | 109 | in_force 50, repealed 3 | `603eacb249a2865f` |
| NE | ne/ne-20261023 | live | chapter 1 | 85 | 85 | 217 | in_force 66, repealed 18, transferred 1 | `6784ca2ae1478125` |
| NH | nh/nh-20261023 | retained | chapters 507, 508 | 76 | 76 | 214 | in_force 69, repealed 7 | `9c22ef647eaac628` |
| NJ | nj/nj-20261023 | live | first 80 sections | 80 | 80 | 211 | in_force 80 | `a4c4647c1a36a84f` |
| NM | nm/nm-20261023 | retained | chapters 46B, 22A, 71 (PDFs) | 139 | 139 | 329 | in_force 56, renumbered 50, repealed 33 | `43d13c3a4048f1c1` |
| NV | nv/nv-20261023 | live | chapter 11 | 56 | 56 | 168 | in_force 56 | `7354b7917957c5b2` |
| OH | oh/oh-20261023 | retained | R.C. 2305.10, 2305.11 | 2 | 2 | 6 | in_force 2 | `29813c3559067381` |
| OK | ok/ok-20261023 | retained | title 12 | 1536 | 1536 | 3374 | in_force 919, renumbered 106, repealed 510, transferred 1 | `beeb395fb9e85931` |
| OR | or/or-20261023 | live | chapter 12 | 52 | 52 | 141 | in_force 49, repealed 3 | `89d4e3d1fc145b2f` |
| PA | pa/pa-20261023 | live | title 1 | 85 | 85 | 182 | in_force 85 | `c82768d066e3d293` |
| RI | ri/ri-20261023 | live | chapter 9-1 (25) | 25 | 25 | 75 | in_force 25 | `ca0f9442cef99b01` |
| SC | sc/sc-20261023 | live | title 15 ch. 3 | 50 | 50 | 150 | in_force 50 | `d9bfaeb27a3f4d80` |
| SD | sd/sd-20261023 | live | title 2 (first 60) | 60 | 60 | 155 | in_force 43, not_recorded 1, repealed 15, transferred 1 | `ba5bc1ae1a8b58e4` |
| TX | tx/tx-20261023 | live | CP code (first 40) | 40 | 40 | 120 | in_force 40 | `d4bf0ea38a4b6099` |
| UT | ut/ut-20261023 | live | title 78B (first 120) | 120 | 120 | 360 | in_force 120 | `53d1ee6dae581f7b` |
| VA | va/va-20261023 | live | title 1 | 129 | 129 | 384 | in_force 127, repealed 2 | `1bf389613e3169bb` |
| VT | vt/vt-20261023 | live | chapter 12/023 | 47 | 47 | 113 | in_force 46, repealed 1 | `b36104a328e83b33` |
| WA | wa/wa-20261023 | live | chapter 4.16 | 38 | 38 | 114 | in_force 38 | `e65ff700ca54d57c` |
| WI | wi/wi-20261023 | retained | chapters 1, 893, 895 | 234 | 234 | 692 | in_force 234 | `863e37474a1df203` |
| WV | wv/wv-20261023 | live | articles 55-2, 55-2A | 31 | 31 | 62 | in_force 31 | `35c65f9151b20c4e` |
| WY | wy/wy-20261023 | live | title 1 | 1033 | 1033 | 1905 | in_force 872, renumbered 1, repealed 160 | `26751f56dc1ae8df` |

Earlier proofs on larger bounds (same parsers): NJ full run 56,294 sections in 17 s (25.2 MB gz, deleted after the
check); UT title 78B 975 sections (7 future_effective, 3 reserved); SD title 1 1,699 sections; TX code CP 1,477
section markers = 1,477 parsed. These bounded editions are proofs only — several carry `sample: null` because they
were bounded with `--option chapters=…`; never load them.

Status values come only from publisher markers (`_statb.status_kwargs`): a catchline counts as a marker only when no
statute text is printed under it; the marker word must be followed by end of text, punctuation or a citation word
("Repealed by L.2005, c.83", "[Reserved.]", "Recompiled." → renumbered). `in_force` means printed as operative text
in the current compilation (`status_basis = current_compilation`). MN `[Obsolete]` and SD "Superseded by § …" are
kept as `not_recorded` with the marker verbatim (the enum has no value for them).

## 4. Size estimates

Rows: the held count (or the official dataset / measured full run where noted). Bytes: the sample's average
`sections.jsonl` row (2.0 KB default where the sample has fewer than 50 rows). Database: 1.0–1.6 × the JSON size
(text, tsvector and indexes; the 2026-10-19 SD/WA datasets measured 1.6–1.9 KB per row in the database).

| State | Rows (est.) | Row basis | Avg JSON row (sample) | sections.jsonl (MB) | .gz (MB) | DB est. (MB, 1.0–1.6× JSON) |
|---|---:|---|---:|---:|---:|---:|
| MI | 43,891 | held count | 2.1 KB | 92 | 22 | 92–147 |
| MN | 55,445 | held count | 1.9 KB | 103 | 25 | 103–165 |
| MO | 30,472 | held count | 2.0 KB | 60 | 14 | 60–95 |
| MT | 44,917 | held count | 2.0 KB (default) | 90 | 22 | 90–144 |
| NC | 39,612 | held count | 2.0 KB | 81 | 19 | 81–129 |
| ND | 29,116 | official dataset state_code_nd | 1.7 KB | 50 | 12 | 50–80 |
| NE | 56,371 | held count | 1.7 KB | 99 | 24 | 99–158 |
| NH | 27,737 | held count | 1.9 KB | 53 | 13 | 53–86 |
| NJ | 56,294 | measured full run (2026-10-23) | 1.9 KB | 106 | 25 | 106–169 |
| NM | 62,972 | held count | 1.6 KB | 101 | 24 | 101–162 |
| NV | 50,084 | held count | 1.9 KB | 93 | 22 | 93–149 |
| OH | 33,343 | held count | 2.0 KB (default) | 67 | 16 | 67–107 |
| OK | 48,019 | held count | 1.7 KB | 81 | 19 | 81–130 |
| OR | 65,750 | held count | 1.8 KB | 117 | 28 | 117–188 |
| PA | 14,741 | held count | 2.1 KB | 31 | 8 | 31–50 |
| RI | 32,852 | held count | 2.0 KB (default) | 66 | 16 | 66–105 |
| SC | 30,867 | held count | 1.9 KB | 58 | 14 | 58–93 |
| SD | 47,734 | official dataset state_code_sd | 3.6 KB (title-2 sample; likely high) | 172 | 41 | 172–275 |
| TX | 121,902 | held count | 2.0 KB (default) | 244 | 59 | 244–390 |
| UT | 22,977 | held count | 2.0 KB | 45 | 11 | 45–72 |
| VA | 34,442 | held count | 1.9 KB | 66 | 16 | 66–106 |
| VT | 26,463 | held count | 2.0 KB (default) | 53 | 13 | 53–85 |
| WA | 52,518 | official dataset state_code_wa | 2.0 KB (default) | 105 | 25 | 105–168 |
| WI | 18,153 | held count | 2.9 KB | 52 | 13 | 52–83 |
| WV | 31,246 | held count | 2.0 KB (default) | 62 | 15 | 62–99 |
| WY | 21,412 | held count | 1.7 KB | 36 | 9 | 36–58 |
| **All 26** | **1,099,330** | | | **2,182** | **524** | **2,182–3,491** |

## 5. RUNBOOK (lead)

Preconditions: STAT-A's contract `database/contracts/state-law-inforce-v1.sql` applied (it creates
`state_law.*`, the loader RPCs and `public.state_law_retained_sources_v1`; the RPC did not exist in production on
2026-10-23). STAT-B's branch merged so `scripts/state_law/states/<xx>.py` and `_statb.py` are present. Disk: one
state at a time — a full run writes only the compact edition (largest: TX ≈ 60 MB gz) and streams/discards raw bytes;
delete the edition directory after a successful load. Run from the repository root.

```bash
OUT=private/build/state_law; RAW=private/acq/state_law
# A. live publishers (one state at a time; long crawls in the background)
python3 scripts/state_law/run.py tx --out $OUT --raw $RAW            # writes $OUT/tx/tx-<yyyymmdd>/
python3 scripts/state_law/verify.py $OUT/tx/tx-<yyyymmdd> --no-require-raw   # structural proof of the full edition
zcat $OUT/tx/tx-<yyyymmdd>/rejects.jsonl.gz 2>/dev/null | head      # inspect rejects (records that broke the model)
(set -a; . private/scratch/env.sh; set +a; python3 scripts/state_law/load.py $OUT/tx/tx-<yyyymmdd> --dry-run)
(set -a; . private/scratch/env.sh; set +a; python3 scripts/state_law/load.py $OUT/tx/tx-<yyyymmdd> --activate)
rm -rf $OUT/tx/tx-<yyyymmdd>                                          # after the load succeeds
# B. retained originals (MI, NM, WI, NH; OH/OK only after the owner decision)
(set -a; . private/scratch/env.sh; set +a; python3 scripts/state_law/run.py wi --out $OUT --raw $RAW --option source=retained)
```

Exit code 3 = Blocked (recorded in `blocked.json` in the edition dir; never retried around). For a bounded re-proof
of any state, add `--sample 40 --keep-raw` and run the adapter verify with `--raw $RAW`.

| State | Full-run command (after `run.py`) | Requests / bytes | Time (est.) | Peak disk |
|---|---|---|---|---|
| TX | `tx` | 31 code zips | 2 min | ≤ 30 MB transient + 60 MB out |
| NJ | `nj` | 1 zip, 41 MB (streamed) | 20 s | 41 MB transient + 25 MB out |
| PA | `pa` | ~75 title documents | 5 min | < 20 MB |
| NC | `nc` | ~400 chapters at 2 s | 15 min | < 20 MB |
| MO | `mo` | ~470 chapters at 1 s | 10 min | < 20 MB |
| MN | `mn` | ~95 part pages + ~1,130 chapters | 25 min | < 30 MB |
| SC | `sc` | 63 titles + ~1,300 chapters | 25 min | < 20 MB |
| OR | `or` | index + ~830 chapters | 15 min | < 30 MB |
| NV | `nv` | ~830 chapters | 15 min | < 30 MB |
| VA | `va` | ~70 title CSVs | 3 min | < 30 MB |
| WA | `wa` | ~2,900 pages | 50 min | < 30 MB |
| SD | `sd` | sitemap (~24 MB) + 71 whole-title documents at 1.5 s (up to 15 MB each) | 5–10 min | ≤ 60 MB |
| ND | `nd` | index (9.5 MB) + ~1,740 chapter PDFs | 35 min | < 30 MB |
| WY | `wy` | ~43 title PDFs (pdftotext CPU) | 5 min | < 40 MB |
| NE | `ne` | ~90 chapters at 3 s | 5 min | < 20 MB |
| WV | `wv` | 137 chapters + ~2,370 article POSTs | 45 min | < 20 MB |
| UT | `ut` | ~96 title XML at 10 s | 20 min | < 40 MB |
| RI | `ri` (background) | ~33,000 section pages + ~1,300 index pages | ~10 h | < 20 MB |
| MT | `mt` (background) | ~51,000 section pages | ~15 h | < 20 MB |
| VT | `vt` (background) | ~2,225 pages at Crawl-delay 30 | ~19 h | < 20 MB |
| MI | `mi --option source=retained` | 205 chapter XML from Storage (480 MB total, ≤ 24 MB each) | 15 min | ≤ 30 MB |
| NM | `nm --option source=retained` | up to 165 PDFs from Storage (264 MB total) | 15 min | ≤ 30 MB |
| WI | `wi --option source=retained` | 470 chapter .txt (+ chapter PDF only where a section prints no History line) | 15 min | ≤ 30 MB |
| NH | `nh --option source=retained` | 1,314 chapter pages (39 MB) | 10 min | < 10 MB |
| OH | `oh --option source=retained` (**owner decision first**) | 33,343 section pages from Storage | 2–4 h | < 10 MB |
| OK | `ok --option source=retained` (**owner decision first**) | 89 title RTFs (217 MB) | 10 min | ≤ 20 MB |
| NY TN MS | — (exit 3, blocked) | — | — | — |

If the retained RPC is not deployed, export an index and pass `--retained-index FILE` instead of
`--option source=retained` (read-only SQL; `XX` = state):

```sql
select jsonb_build_object('url', os.source_url, 'sha256', o.sha256, 'bytes', o.bytes, 'object_key', o.object_key,
       'retrieved_at', to_char(os.retrieved_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
from corpus_ingest.publisher_code_object_sources_v2 os
join corpus_ingest.publisher_code_objects_v2 o on o.sha256 = os.sha256 and o.kind = 'publisher_original'
where os.jurisdiction = 'XX' and os.http_status = 200;
```

Verification SQL after loading (resolver examples use each code's canonical citation, which always parses):

```sql
select state, edition_id, lifecycle, expected->>'sections' sections, currency_statement
  from state_law.editions where state in ('MI','MN','MO','MT','NC','ND','NE','NH','NJ','NM','NV','OH','OK','OR','PA',
  'RI','SC','SD','TX','UT','VA','VT','WA','WI','WV','WY') order by state, created_at;
select e.state, s.status, count(*) from state_law.sections s join state_law.editions e using (edition_id)
  where e.lifecycle = 'active' group by 1, 2 order by 1, 2;
select public.state_law_resolve_v1('TX', 'Tex. Civ. Prac. & Rem. Code § 16.003');   -- resolved
select public.state_law_resolve_v1('NJ', 'N.J. Stat. Ann. § 2A:14-2');              -- resolved
select public.state_law_resolve_v1('PA', '42 Pa. Cons. Stat. § 5524');              -- resolved
select public.state_law_resolve_v1('VT', 'Vt. Stat. Ann. tit. 12, § 512');          -- resolved (number 12:512)
select public.state_law_resolve_v1('WI', 'Wis. Stat. § 893.54');                   -- resolved
select public.state_law_resolve_v1('NH', 'RSA 508:4');                              -- resolved
select public.state_law_resolve_v1('TX', 'Tex. Civ. Prac. & Rem. Code § 999.999'); -- unresolved, never a neighbour
select public.state_law_search_v1('NC', 'statute of limitations personal injury', 5, 0, null);
```

Refresh cadence (from each module's `update_cadence`): NJ weekly (rebuilt every weekday); TX, PA, NC, MO, MI monthly
(MO also right after August 28); VA and SD each July + quarterly; WA, NE, WV, UT, RI, SC, NV, MN after the
effective-date wave + quarterly; WY and ND each July/August; MT, OR, VT when the edition/update line changes; WI after
each LRB certificate date; NH, NM, OH, OK when the live source is reachable/decided.

## 6. Display notes for /law/codes (STAT-A's UI)

- Container-prefixed numbers: VT `12:512`, OK `12:2001`, PA `42:5524` — show the `citation` ("Vt. Stat. Ann. tit. 12,
  § 512"), not the raw number. NH `508:4` and NJ `2A:14-1` are the real printed numbers.
- Versions: TX and UT print more than one text for a number (`@1`/`@2`; TX "Text of section effective …", UT
  `effdate`); show the version label and `effective.start`; UT/OH/MO future texts are `future_effective`.
- `source.display_url` (UT title page, MI section page, SD section page): link it as the official page; `source.url`
  is the file actually read (bulk XML/zip/API).
- Retained editions (MI, NM, WI, NH, OH, OK): `source.method = retained_original`, `retrieved_at` is the original
  capture time (2026-10-06/07/08) — show "Captured <date>", not today's date.
- `not_recorded` with `status_basis = publisher_marker` (MN `[Obsolete]`, SD "Superseded by …"): show the marker.
- Currency statements that say "unofficial" (VT, MO) or that the edition lags session laws (OR) must be shown verbatim
  next to the text.
- Annotations, notes and cross references are not kept (MO, NE, NM, OK `NOTE:`, WI annotations/committee notes):
  "Annotations not included". WI: tables and graphics are absent from the text rendition for the sections the LRB
  certificate lists (11.1101, 20.005, 35.84, …, 990.001).
- NJ sources are per-title slices of STATUTES.TXT (`member` names the byte range); WV sources carry the POST body in
  `source.request`.

## 7. Requests to STAT-A (shared design; local adapter used meanwhile)

1. `lib.classify_status` reads catchline words as markers ("Reserved name.", "Transferred employees", "Expired labor
   contracts", a heading "Repealed" over a repealer text). STAT-B modules pass status explicitly
   (`_statb.status_kwargs`); consider the same strict rule in lib.
2. `lib.render_text` / `xml_text`: render the publisher's escaped markup inside XML (MI `BodyText`), CSV fields
   (VA), BOM-less UTF-16 and concatenated `<html>` documents (SD), `pdftotext -layout` (ND/WY/NM keep U+2011), RTF
   (OK), and UT subsection labels. Until then `python3 scripts/state_law/states/_statb.py verify` is the exact-text
   check for those states (writes the same `verify.json`, plus an `adapter` note).
3. robots.txt parsing should strip a UTF-8 BOM (NC's `Crawl-delay: 2` is invisible otherwise).
4. Sources: a field for the POST body (WV uses one URL for every request) and `display_url` / `page_revised` /
   `pdf_created` extras (STAT-B adds them to the source dict).
5. `run.py` refuses `META.blocked` even for retained re-parses, so OH/OK/NH/MI raise `lib.Blocked` inside `acquire()`
   for the live path instead of declaring `blocked`.
6. MODEL status enum: consider `superseded` / `obsolete`.

## 8. Disclosures

- MI: before noticing that robots.txt answered HTTP 502, chapters 2 and 691 were requested once each from
  www.legislature.mi.gov with curl; those bytes were used only for an early replay proof. The sample now staged is
  built from the retained originals.
- NY: the LRS index page (public.leginfo.state.ny.us) was requested once before its robots.txt (`Disallow: /`) was
  read; nothing from it is used.
- NM: nmonesource.com answered 403 after a few requests; not retried.
- OK: the retained capture (2026-10-06) includes that day's robots.txt, which already disallowed `/` for all agents.
- OH: robots.txt is the single line `User-agent: * Disallow: /`; standard parsers read no rule, its intent reads as
  disallow-all; no live crawl was run.
