# California retained-source completion — 12 October 2026

## Active-version correction after private import

The completed parser-4 intake retained all 162,556 target versions and observations, but the first whole-cloud comparison failed: all active rows still used parser 3. The live `ingest_entities` ordering prefers `(source_as_of or retrieval day, retrieved_at)`. Parser 3 recorded retrieval on October 9 at 02:19:34 UTC; parser 4 correctly preserves the pinned archive receipt of October 5 at 22:24:52.030 UTC. The archive SHA-256 is identical. This is a parser-selection issue, not a reason to invent a newer source retrieval.

`database/contracts/corpus-ca-parser4-promotion-v1.sql` prepares two service-only, bounded RPCs for this exact source, old and new manifests, import run, archive hash and retrieval timestamps. Installation does not select any rows. Promotion requires both publication gates closed, the exact completed import and no competing open run. Each supplied target payload hash must resolve to the retained parser-4 observation/version and pass canonical hashing and false authority gates. The active row must still match the diagnosed parser-3 version. A full original row is retained in `cleanup_decisions`; immutable versions and observations remain intact. Replay and rollback reject intervening changes. UTC serialization makes the ledger stable across session timezones.

The owner may run `python scripts/legal/state-codes/ca-promote-parser4.py private/coverage-completion-2026-10-12/ca/packet-v4 --execute --batch-size 500 --checkpoint private/coverage-completion-2026-10-12/ca/promote-v4-checkpoint.json` after reviewing/applying the contract. The driver pins the exact manifest, units and sections file hashes; default invocation is an offline dry-run. It never publishes. Require the full independent `cloud-readback-v4.sql` comparison to pass afterward, plus `promotion-ledger-readback.sql` showing 162,556 before-images and zero mismatches. All current-law/calculation flags must stay false.

Rollback uses the same driver with `--rollback`, a fresh checkpoint, and publication gates closed. It restores the exact original row only if the active row still matches the recorded replacement. The current manifest remains parser 4, so rollback is a private recovery state and cannot be followed by publication without another successful source comparison. Never reuse a completed promotion checkpoint after rollback.

The six isolated PostgreSQL tests cover older truthful retrieval timestamps, retained versions, full before-images, repeat calls, restoration/reapplication, changed or quarantined current rows, incorrect target hashes, tampered retained data, public gates, competing runs, unauthorized roles and actual source identities containing spaces, brackets and fractions.

California parser 4 preserves the full retained `pubinfo_2025.zip` section inventory: **162,526 section occurrences across 30 codes**. This is a dated publisher export, not a certification of present legal effect. The original archive was captured from the Legislature on 5 October 2026; its compilation-through date is not established. Twenty-five sections contain 26 explicit publisher form/graphic placeholders, which remain visibly disclosed.

## Source and correction evidence

The original archive is 1,288,351,194 bytes, SHA-256 `2b443092fc6ad7fbee78d694dd885ec9a44337ebc2b9557980c8846d27978f2c`. Its exact successful HTTP receipt is preserved with the original capture. The original checkout and capture were read, not edited.

The whole-source comparison found 937 lost fraction separators across 419 sections in parser 3, and 65,013 sections whose text differed when publisher semantic spacing was retained. Parser 4 preserves every source text node, semantic space, fraction separator and table boundary, rejects unclassified elements, disables XML entity/network resolution, and records the transformations. No new statutory words are inferred.

Every `LAW_SECTION_TBL` occurrence is joined to its exact `LAW_TOC_SECTIONS_TBL` version and original XML member. Native occurrence identities, including repeated citations, are preserved. All 24,394 publisher hierarchy nodes are resolved. The source graph includes 25 ambiguous scope groups resolved by 413 exact-version overrides, and 31 printed-path collisions that require native node identity. California's code-specific structural order is retained rather than forced into one title/division/part sequence. The prior cloud readback had 568,397 missing ancestor headings; the corrected packet has zero.

The independent verifier checks all section identities, every original member's actual checksum, all rendered text hashes, headings, history, native hierarchy nodes, Unicode spans, complete derivative contents and counts. Its reference ledger was produced separately from the pinned retained archive. Source ledger SHA-256: `77efa1a532e9713611c23a17974e2dded48de8defc3ff35254a7ca9b3a042897`.

Private evidence lives under `private/coverage-completion-2026-10-12/ca/`:

- `source-audit-v1/`, including the source ledger and runtime-pin correction receipt.
- `cloud-readback.json` and `cloud-source-comparison.json`, proving all 30 old cloud code inventories match the retained source.
- `packet-v4/`, the unchanged candidate packet, with `source-attachment-gaps.json` and `packet-report.json`.
- `packet-v4-independent-verification-crosslinked.json`, the full successful independent verification.
- `attachments-probe/report.json`, hashes and retrieval qualifications for the follow-up attachment investigation.

## Missing publisher graphics and forms

All 205,033 archive members are `.dat` or `.lob`; it contains no separate graphic/PDF assets. Fresh ordinary Firecrawl basic-proxy extractions of all 25 official section pages returned the publisher's own incomplete-text notices and historical chapter references, with no linked form/graphic assets. An exact chaptered-bill PDF link was found for AB 2747 (2014, chapter 913). A direct request returned HTTP 403; proxy-extracted PDF text was retained separately and explicitly is **not original PDF bytes or a verified complete rendering**. No proxy content was spliced into the 2025 XML text. The 25 omissions remain in the section status notes.

## Projection and release sequence

Manifest SHA-256: `4dd46270ad4da9362d75ef7f8202eec296e2768a4e794c271c041943b2ea9a03`. Section JSONL SHA-256: `8c2391a9464445e7ff82384f6b639582b5a0886bc243aff1352432f9dba30a64`. Deterministic run: `48f97671-5852-5965-8b45-1adbe689b8ce`. The packet has 31 objects totaling 1,482,165,378 bytes; the original archive is reusable by content hash.

1. Apply the additive `database/contracts/corpus-publisher-code-projection-v4-outline.sql` contract before publishing California. It preserves exact native `node_id` in grouping and path matching. Existing legacy paths without node IDs remain supported; an executable v3/v4 comparison covers omitted declared levels. The function retains the reviewed/public gate, `SECURITY DEFINER`, empty search path and service-role-only grant. It changes no corpus rows or gates.
2. Confirm the prior manifest (`8c4d8025e4f8a5055a2f420a77bbc22f9b9e376886496d795e8aacbcdba90599`) has no open run and California is private. The coordinator confirmed both immediately before starting the private parser-4 intake.
3. Through the authorized secure administrative environment, run `python scripts/legal/state-codes/common/land_publisher_code_v2.py private/coverage-completion-2026-10-12/ca/packet-v4 --execute --workers 2 --checkpoint private/coverage-completion-2026-10-12/ca/land-v4-checkpoint.json`. Credentials stay outside files/repository; the Python environment must include `requests` and its trusted CA configuration. No `--multicode` is needed. A failed interrupted run must resume using its same exact packet/checkpoint; never open a competing run by implication.
4. After completed intake, execute `ca/cloud-readback-v4.sql` read-only and save `ca/cloud-readback-v4.json`. The query fingerprints every cloud section, including native node IDs. Run `python private/coverage-completion-2026-10-12/ca/compare-cloud-v4.py --expected private/coverage-completion-2026-10-12/ca/packet-v4-independent-verification-crosslinked.json --cloud private/coverage-completion-2026-10-12/ca/cloud-readback-v4.json --out private/coverage-completion-2026-10-12/ca/cloud-comparison-v4.json`. Require exact 30-code identity/text/hierarchy hashes, 162,526 sections, 30 units, zero hash errors/missing headings, completed run and closed public gate.
5. Only the coordinator's explicit reviewed-source decision may open the state projection. Retain the dated export qualification and the attachment omissions. Test live root/code/section navigation, duplicate printed nodes, source-order branches, direct links and section warnings. Keep `current_law_verified` and `calculation_activation_allowed` false. This acquisition does not enable deadline calculations.

The intake contract appends immutable versions and observations, preserving parser-3 evidence, then selects current entities under the existing source-date rule. Parser 4 correctly retains the original October 5 retrieval timestamp, while parser 3 carried an October 9 timestamp. The ordinary intake therefore retained the new evidence without replacing the active rows; the narrowly bound, reversible promotion described above was required. Registration alone does not reset a previously opened state gate; California was verified private before intake. If readback fails, keep the public gate closed and investigate or resume the exact run. Do not delete prior evidence or invent newer retrieval timestamps to force a match.

## Verification

CAML tests (6), hierarchy tests (6), packet/source-link tests (4), projection SQL tests (4), focused TypeScript contract/server tests (18), and private cloud-digest SQL tests (4) passed. Full retained-source verification passed again after strengthening the archive/member cross-links. The lander's read-only preflight passed. These are parser, provenance and navigation checks; they do not prove current statutory applicability. Cloud publication and live browser verification must be recorded separately by the coordinator after the private ingest finishes.

The coordinator completed the explicit parser-4 selection on October 12. The private CA cloud-readback-v4-selected.json and cloud-comparison-v4-selected.json match all 162,526 source identities, texts and native-node hierarchies across 30 codes, with zero hash errors or missing ancestor headings. The promotion-ledger-readback.json confirms 162,556 before-images and zero ledger mismatches. Publication remains a separate decision after the compatible frontend is deployed; this readback does not establish current legal effect.
