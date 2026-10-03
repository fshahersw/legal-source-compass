# Official JPML and court HTML references — October 2, 2026

The [source-backed inventory](../public/data/quality/jpml-html-metadata-20261002.json) records seven successful official HTML captures and one retained HTTP 404. The private corpus contains all 96 original records and 102 explicit relationships; the independently verified public dataset contains 93 qualified rows. No database calls or PDF requests were made by this acquisition task; root executed and verified the database publication.

| Record grain | Count | Scope |
|---|---:|---|
| Official source captures | 7 | Four JPML pages, two district-court case pages, one official judge profile |
| July-session MDL observations | 17 | Five new-centralization motion rows and twelve previously-centralized motion rows |
| July-session order locators | 19 | PDF URL/anchor metadata only; order bodies unread |
| Current dated report locators | 5 | HTML reports dated October 1, 2026; four pending reports and one recently-terminated report |
| Statistical-report locators | 25 | First statistics-directory page only |
| Panel memberships | 7 | Reported panel role/service court; not MDL transferee assignments |
| Court-label references | 9 | Exact source labels/site references; no invented CourtListener IDs |
| District-court master references | 2 | Exact MDL 3108 and 3047 case identifiers from court HTML |
| Official judge-profile references | 3 | Explicit judge/profile links attached to those case pages |
| Caption-conflict observations | 1 | Preserve conflicting primary-source captions; prohibit automatic overwrite |
| Rejected HTML captures | 1 | Former California court case-page URL returned 404 |

## Current report limit

[JPML’s pending page](https://www.jpml.uscourts.gov/pending-mdls-0) publishes October 1, 2026 report dates and PDF locators. Its captured HTML does not contain individual current pending/terminated directory rows, transferee assignments or numeric counts. Those values remain unknown. The five URLs and the recently-terminated report’s January 1–October 1, 2026 coverage are retained as metadata. The [statistics page](https://www.jpml.uscourts.gov/statistics-info) likewise exposes report locators rather than counts; this packet covers its first page only.

[The orders page](https://www.jpml.uscourts.gov/panel-orders) identifies a July 2026 hearing session and seventeen numbered/captioned motion rows. This is a session index, not proof of current pending status or a complete MDL directory. Order filenames and anchor labels do not establish a decision date, transferee assignment or outcome. None was inferred from a PDF locator.

## Confirmed caption conflict and exact court references

The orders index labels MDL **3108** with the social-media caption also used for **3047**. The [District of Minnesota’s official HTML page](https://www.mnd.uscourts.gov/content/change-healthcare-inc-data-breach) independently identifies **3108** as **Change Healthcare, Inc. Customer Data Security Breach Litigation**, district case **24-MD-03108**, and lists **Donovan W. Frank** and **Dulce J. Foster** with explicit profile links. Its narrative reports centralization on June 7, 2024. The JPML 3108 caption remains a conflicting source observation; it is withheld from automatic identity/category mapping and cannot overwrite an existing correct master profile.

The [Northern District of California’s replacement case page](https://cand.uscourts.gov/cases-e-filing/cases/422-md-03047-ygr/re-social-media-adolscent-addictionpersonal-injury-products), discovered through [Judge Gonzalez Rogers’s official profile](https://cand.uscourts.gov/judges/ygr/gonzalez-rogers-yvonne), identifies **4:22-md-03047-YGR**, social-media litigation, **Gonzalez Rogers, Yvonne**, and a filing date of **October 6, 2022**. The source title typo, “Adolscent,” is retained. Its displayed last-filing date is **January 29, 2026**; this is not proof that later docket activity is absent. Neither court page certifies a complete current docket, disposition or outcome probability.

[About the Panel](https://www.jpml.uscourts.gov/about-panel) supplies seven panel judges and service courts. These memberships remain separate from the three court-page judge references. Names are not fuzzy-merged with corpus people, and a panel role is not converted into an MDL assignment.

## Prepared delivery and validation

Private directory: `../private/jpml-html-metadata-20261002-v1`. `metadata.jsonl` contains 96 `jpml-html` native-schema `1.0.0` envelopes. SHA256: `9048f8c8fbff7ac8b44adc9649db5cb01ed34f2c202edde7c9c0ce6de0f9856d`. The assigned administrative run is `9618c42d-d746-40f1-af56-2d5e4a0fa46f`. `native-evidence-edges.json` names all 102 endpoints, and each relationship is independently proven by a field in its source record. No relationship infers a person merge, outcome or current MDL assignment. `preparation-receipt.json` and `source-captures.manifest.json` retain exact checksums, retrieval qualifications and status codes. Root executes database operations through the existing metadata-batch contract; this task prepares and validates files offline.

The public dataset, `jpml_html_reference`, was confirmed **ready with 93 rows** at **12:09:15 UTC on October 2, 2026**. Its independent full-field rowset SHA256 is `420535679a8ba66760fcf3896aca381e62fd19d2f957b78204cc6aabd68a5b7c`. Source/provenance, public-field, facet, relationship, role and privacy mismatches were all zero. Three original observations stay private and quarantined with reversible cleanup decisions: the HTTP 404 capture, the conflicting July-session MDL 3108 caption, and its caption-bearing order locator. Their original source versions remain intact. The separate caption-conflict audit and independently captured court master references for 3108 and 3047 are published. Existing MDL profiles are not changed. The downloadable acquisition inventory describes held and rejected observations too; its 96 metadata descriptions should not be mistaken for the 93-row public database projection.

The [tracked publication contract](../database/contracts/project-jpml-html-reference-v1-20261002.sql) has five sections executed in separate queries after the 96-record private import: write native relationships; independently verify those relationships; stage the held public projection; independently verify the complete public projection; repeat verification and set the ready flag. Private `handoff-index.json` and `public-projection-plan.json` identify the exact SQL file hashes and order. The ready gate reconstructs all twelve public fields from pinned private source versions, proves source URL/raw/text checksums and observations, reconciles all 102 relationships and all three quarantine decisions, and checks exact listing metadata and option counts. All three filters use the client contract `name` and `type: "select"`: evidence kind totals 93, MDL-number options cover 40 applicable rows, and captured-source options total 93. Numeric pending counts stay null.

Raw HTML, visible text and private locators remain private. Public inventory excludes full captured text, contact information, raw locators and provider access-session identifiers. It exposes selected case/reference fields, source URLs, checksums and qualifications. All eight saved captures have independently recomputed raw/text SHA256 values. The failed page is rejected, not a case authority.

Provider origin-fetch timestamps were unavailable. The actual capture-recording observation times and verified acquisition day are retained with that qualification. Report dates, session labels, centralization dates and displayed filing dates remain separate fields. No FJC historical pending marker was used to infer current JPML status.
