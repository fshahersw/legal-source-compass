# Seeger Weiss local docket crosswalk — October 2, 2026

The local review identifies **17 exact CourtListener docket IDs** with firm-related source evidence and cached headers. It does not certify current appearances or a complete firm portfolio. No PDF was read or downloaded, downloaded pipeline code was not executed, no API/database call was made, and contacts and party captions were omitted from the prepared evidence.

| Evidence slice | Verified counting unit | Result |
|---|---|---:|
| Local matter pipeline | Nonfixture attorney/firm rows joined through explicit bundle metadata docket ID | 66 rows / 7 native docket IDs |
| Cached CourtListener attorney metadata | Native attorneys containing explicit firm text | 6 native attorney IDs |
| Cached nested representation evidence | Attorney `parties_represented` plus reverse party `attorneys` source observations | 1,455 + 289 observations |
| Representation deduplication | Exact attorney, docket, party, role and action-date tuples | 1,455 tuples / 5 dockets / 972 native party IDs |
| Latest local AWS release | Producer-declared firm appearances, August 24 snapshot | 478 appearances / 38 local matter IDs |
| Cached docket header matching | Exact provider ID, preserving observed versions | 17 docket IDs / 23 source versions |
| Native judge assignments | Explicit cached docket `assigned_to` identifier | 16 docket observations / 12 native person IDs |

The two named enriched source-registry exports are byte-identical (245,708,410 bytes each, SHA256 `23f68d93019bba7f6283312658bd0454f4aa4b5b86b6b20bd7c9c3d4f2835fb5`). One streamed snapshot contains 317,579 registry records and 434,190 observations; the only firm mention has no docket locator. A registry folder name therefore supplies no firm participation evidence. Three template/golden-sample attorney rows are held separately.

## Exact local pipeline seeds

| Court | Source docket number | CourtListener ID | Firm-linked local rows | Local MDL label |
|---|---|---:|---:|---|
| njd | 2:24-md-03113 | 68869775 | 25 | 3113, explicitly in Apple metadata |
| njd | 2:23-md-03080 | 67665081 | 23 | Insulin 3080 folder label; retained as local label |
| njd | 2:26-cv-02334 | 72371373 | 3 | None inferred |
| txed | 4:25-cv-01277 | 71949121 | 1 | None inferred |
| njd | 1:23-cv-08564 | 67721420 | 2 | None inferred |
| njd | 2:18-cv-00674 | 6261208 | 1 | None inferred |
| njd | 2:19-cv-03973 | 14533063 | 11 | None inferred |

The last two cached headers contain termination dates. They remain historical firm-evidence records, not current-matter claims. A null termination date is not proof of activity. Local manifests' judge strings and MDL/master labels remain distinct from provider-native identities, assignments and member relationships. Apple's cached header has a judge string but no assigned-person identifier; no judge ID was invented.

AWS firm appearances require additional source review: **219** lack an exact native docket locator and **195** have multiple conflicting native locators. CourtListener IDs **4261857** and **18704765** both carry `ilnd / 1:14-cv-01748`; the provider identities remain separate. Producer `candidate_firms`, `node_role`, normalized firm IDs and relationship claims do not become verified court participation or master/member edges.

## Research and verification handoff

The private packet is under the task's Seeger Weiss cache, `2026-10-02/local`. `next-quota-exact-docket-seeds.json` contains the seven exact source IDs, court/docket keys and dated evidence for root-owned live backfills. Evidence JSONLs preserve original file SHA256, row ordinal, original-record digest, exact source-native identifiers and original cached provenance. The independently reconstructed receipt verifies **6,117 prepared evidence rows against 4,628 original source rows**, with zero mismatches and unchanged source hashes.

The parallel official-firm research establishes separately dated leadership claims: [Class Action Settlement Administration, MDL 3162, Bates/D.D.C. and Seeger lead counsel](https://www.seegerweiss.com/news/christopher-a-seeger-appointed-plaintiffs-lead-counsel-in-in-re-class-action-settlement-administration-litigation); [September 2026 Depo and Talc leadership report](https://www.seegerweiss.com/news/finalist-for-litigation-department-of-the-year-products-liability-mass-torts-category-2026-new-jersey-legal-awards); and [June 2026 GLP-1, NAION, Apple, MultiPlan and Insulin leadership report](https://www.seegerweiss.com/news/seeger-weiss-named-finalist-for-seven-categories-in-the-national-law-journals-2026-elite-trial-lawyers-awards). Firm-reported leadership is distinct from court-native ID, current member-case census or order verification. Investigation labels alone do not establish filed cases.

Searches should pair each explicit court/docket identity with native metadata and appearances, then confirm leadership from the appointing court source. Professional names and observed spellings can generate search leads; they cannot merge people. Local `SEEGAR`, `DAROCI` and `Doroci` variants remain unresolved source spellings. The separately captured fully paginated CourtListener firm index has its own source grain and capture proof; it is not silently combined into this dated local-source count.
