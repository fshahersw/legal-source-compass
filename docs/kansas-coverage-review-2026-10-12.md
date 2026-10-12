# Kansas coverage review and additive correction

This review concerns the protected `ks-statutes` publisher edition. It does not
certify present legal effect or activate calculator rules. The official root
still says its text includes the 2025 legislative session. The separately linked
2026 composite PDF, dated August 13, 2026, includes later and delayed amendments;
its contents must remain qualifications, not silent edits to the older text.

## Evidence collected

- Completed baseline run: `5c91a63f-95ae-5bfa-953b-15a88add63eb`, parser
  `ks-revisor-html/6`, manifest
  `b1bf94bf787ae6c37de818c1732729d6052466324be1cdb545c18b41d8ec85f8`.
- Read-only database checks: 47,488 distinct sections and source pages; every
  section passed text checksum, retained version, source-unit, original-source,
  native-identity, and run/manifest checks. The storage catalog is private and
  the publisher RPCs have service-role-only execution and empty search paths.
- Fresh official root plus 91 chapter pages: 92 HTTP 200 receipts, rehashed and
  independently reparsed, containing 47,489 distinct section-page URLs.
- The final 88 nonempty chapter URL/native-key digest groups match all 91
  chapter indexes, including the added `032_001_0004l.html`. Before the addition,
  chapter 32 matched after excluding that one URL. The old TOC regex skipped its italicized
  native citation. DOM parsing now recognizes every captured URL. Six repeated
  exact URLs in chapter 73 keep the prior last-label behavior and have an
  explicit duplicate-label evidence record; they do not create extra identities.
- Twenty deterministic source samples pass against retained and freshly fetched
  original bytes: complete print-box character order, source markers, exact
  section text, citation, heading, history, derivative hash, and Unicode spans.
  This sample is used with the whole-inventory proofs, never as their substitute.

All raw HTML, PDF, source text, receipts, SQL outputs, candidate data, and source
notes remain under ignored `private/coverage-completion-2026-10-12/ks-review/`.
They are not public assets or committed source rows.

## One-page candidate

`build_additive_packet.py` accepts only an exact single-page discrepancy proved
by the baseline chapter digest. Its version 7 packet contains one source unit,
one section, and two content-addressed objects. No baseline row is in the packet.

The page's native identity is `KS:032_001_0004l`; its combined printed citation is
preserved. The official TOC says “Transferred.” The separate Revisor's note is
retained in original HTML and candidate evidence, outside the statute text.
Retained and fresh original bytes have the same SHA-256
`e88f6f205167b6cd839c020191a20858e8222207db29bc2c360c0fb9456c581b`.

Candidate manifest:
`6325709f40d0870594465cb7d27413b8249e55b13cbfc4ec5bdcfe709ee6038d`.
Deterministic run: `0dc6fb25-c88b-52aa-b65f-96f531789876`.
The additive run completed and retained its originals and derivative with
hash-verified readback. All 101,000 earlier current section/source-unit rows
retained their exact data and provenance hashes. The final whole-source proof
passed for 47,489 unique section identities and official source pages.

On October 12, 2026, the owner-authorized guarded review transaction opened
protected publisher browsing for that combined source inventory. The saved
`published-readback.json` records `review_status: reviewed` and
`public_projection_allowed: true`; `protected-api-readback.json` records a
successful service-mediated read of the exact added native identity. The pinned
review is `combined-publication-review.json`. The later-change comparison
reconciles all 490 flagged sections against 732 citation keys from the publisher's
2026 composite. This publication concerns the dated publisher edition only;
current-law certification and calculator activation remain false. It does not
assert a new application deployment or release any other held source.

## Contract and execution boundary

The v2 manifest describes a parser and source schema; it is not a one-section
inventory declaration. `corpus_publisher_code_register_manifest_v2` preserves
older manifest records and updates the state's current parser pointer.
`corpus_publisher_code_open_run_v2` pins the new run to that manifest.
`corpus_publisher_code_finish_run_v2` calls
`corpus_ingest.publisher_code_summarize_state_v2`, which counts **all** retained,
nonquarantined rows for the source system. An additive run therefore results in
47,489 sections, not a state count of one.

The v2/v3 projected gates check state/code review and projection flags. Section
reads then select the source system, schema version, and nonquarantined rows;
they do not require each row's manifest to equal the latest parser pointer.
The v3 primary-code row mirrors v2 through its existing trigger. No projection
contract change or rewrite of the v6 baseline is needed. A combined review must
name the 47,488-row v6 cohort and the one-row v7 cohort honestly.

Before authorized intake, run and retain `additive-preservation.sql`. It must
show neither proposed target identity already exists, no open Kansas run, the
expected private baseline state, and preservation digests for every existing
section and source unit. If either target already exists, stop and review that
record; the candidate is not authorized to replace it by implication.

Use the existing `land_publisher_code_v2.py` contract for object hash readback,
registration, the two-row intake, batch verification, and completed run closure.
Keep state projection false throughout. Do not use a review RPC as an intake
shortcut. After intake:

1. Re-run preservation SQL. Every baseline group count and digest must match;
   only the two new target identities may appear.
2. Verify the new rows against the exact candidate and its run/manifest, including
   retained versions, source object registration, and all three false row gates.
3. Re-run the compact whole-source chapter digests, record proofs, unit-marker /
   Unicode-span proof, and currency comparison. Expected section/page count is
   47,489, with all chapter URL and base-key digests matching the captured TOC.
   Review the two pinned parser cohorts explicitly; do not change old provenance
   to make a single-manifest check pass.
4. Pin a combined evidence report and record the explicit publication decision.
   Only then use `corpus_publisher_code_review_v2('KS', 'reviewed', true, notes)`
   (or the v3 primary-code delegate). The note should identify both cohorts and
   the dated edition. A fresh gated read must show the added native identity,
   unchanged baseline samples, and correct coverage counts.

## Reversible rollback

Closing publication is the first rollback action:
`corpus_publisher_code_review_v2('KS', 'landed', false, reason)`. This leaves all
evidence private and does not erase source versions or objects.

If the additive records themselves must be withdrawn, use the existing
`corpus_publisher_code_quarantine_apply_v1` with a new rollback run/issue and only
the exact added section and source-unit IDs, after verifying their current
payload hashes, provenance manifest, and last run still match this candidate.
The contract writes cleanup before-images and recomputes counts. Do not delete
the raw original (already retained by the baseline inventory), derivative,
manifest, intake receipts, or historical entity versions.

For an exact metadata rollback, an owner transaction must retain the current
state row as a cleanup before-image, lock the Kansas state row, verify the
additive run is the most recent run and both added rows are quarantined, then
restore the private baseline state fields from the saved pre-intake packet.
There is no public RPC that resets the current manifest pointer: re-registering
an old manifest is idempotent and does not restore that pointer. Never reopen a
historical run or fabricate a replacement baseline to simulate rollback. The
normal safer state is private/landed with both immutable parser cohorts retained.

## Reproducible local commands

`revalidate.py sql preflight|summary|unit-proof|sample` creates owner-executed,
read-only SQL. The compact summary avoids a large browser JSON export.
`capture-toc` and `capture-currency` retain exact HTTPS publisher bytes with
certificate verification enabled. `source_review.py capture|check` handles the
bounded source sample. Every report keeps publication and calculation activation
false; no report-only tool imports administrative credentials or calls an intake,
review, or projection mutation.
