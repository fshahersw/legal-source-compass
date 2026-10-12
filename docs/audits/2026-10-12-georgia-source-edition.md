# Georgia retained source edition, 12 October 2026

Georgia is privately landed and fully read back as a **qualified third-party 2025 edition**, not current-law certification. Publication remains pending. The independent Georgia Commons CC0 release `ocga-2025-supplement-v3` supplies 29,682 source occurrences with 29,490 distinct printed citations across 53 titles. This is separate from the deleted `open_us_law` collection. All 190 duplicate citation groups remain distinct; no version is selected as operative. The literal effective-date qualifiers on 653 records and upstream extraction warnings on 2,468 records remain visible.

The pinned JSONL gzip SHA-256 is `5cc3304062371359a814c144b68105e0fa56a74992561e418b44bef6980ee3a5`. Each source identity binds this release hash and the exact JSONL record ordinal; each record also retains the raw line hash. The 97 referenced PDFs were fetched independently and matched their upstream SHA-256 values: 96 official Legislature URLs and one Internet Archive copy covering Title 9 chapters 12–16. The latter supplies 232 records and is explicitly marked as an archive copy. Availability of official PDFs does not convert the third-party extraction into official-source text.

## Complete source comparison

Every body was compared against text extracted from its cited PDF pages. All originals were rehashed, page bounds checked, and resumed comparison rows rebound to the exact release body, status, citation and page range. The final comparison ledger is `0146a316e6055cd0410592e6e0ce2979473462f5f6640e3908d2aec1ccd2f112`.

| Result | Source records | Display treatment |
| --- | ---: | --- |
| Whole body matched after Unicode NFKC, whitespace and soft-hyphen normalization | 11,002 | Exact method disclosed; no currency or legal-effect claim |
| Whole body matched only after additionally joining line-end hyphens | 5,784 | Extra transformation disclosed |
| PDF text order or content unresolved | 11,754 | Visible unresolved-comparison warning; release text preserved |
| No body text in release | 1,142 | Empty text retained; upstream status explicitly unverified |

Some status-only records link to an older bound printing containing a prior body. A claimed repeal, reservation or redesignation therefore remains a literal upstream status, not a verified conclusion about current law. Missing text is never reconstructed from the heading or status. Matching text does not prove official TOC completeness, present applicability or a correct choice among different printings.

The title derivatives concatenate exact release body strings; they are not fetched statutory pages. The acquisition proof accounts for every release record, not a claimed complete official Georgia Code inventory. The archive edition date remains null because no exact publication day is established. All current-law and calculator gates remain false.

## Reproducible packet and checks

The immutable candidate is `private/coverage-completion-2026-10-12/ga-staged-2025-v2`; v1 is retained as an unlanded preliminary packet. Source system: `ga-georgiacommons-2025`. Manifest SHA-256: `ae151a497faa1d2921c912648a9948be9305b84e04b762de7bf5161c8b267386`. Deterministic run: `a5dea540-ffa5-599e-b7bc-ac88e0bafde5`. It contains 151 objects, 269,510,799 bytes, 53 source units and 29,682 source records. Sections JSONL SHA-256: `41a111b4f5f15d128a2684bbee00d35f9d28471be1967b2b3030044b5057ddf6`.

The stager refuses missing or incomplete PDF comparison evidence, mismatched original checksums, incorrect comparison body/page bindings and overwrite of an existing packet. Five focused tests cover duplicates, date qualifiers, empty statuses, changed originals, hidden warnings, comparison mismatches and exact source URL pattern matches. The full independent verifier replays all records, original objects, source spans, headings, hierarchy, warnings, comparison metadata and display qualifications. The generic lander's dry-run passed.

An isolated PostgreSQL instance accepted the actual manifest, all 151 object descriptors, 53 source units and 65 selected sections covering every title, all comparison and source-status types, archived PDF provenance, duplicate citations, largest text/status fields and deepest hierarchy. The full readback query was also executed against those samples. This validates the intake contract; it does not substitute for all-record cloud verification or claim that the samples were uploaded.

## Administrative intake and publication boundary

Apply `corpus-publisher-code-source-occurrence-v1.sql` followed by `corpus-third-party-edition-v1.sql`; the coordinator confirmed both installed. Through the existing secure administrative environment, run:

```text
python scripts/legal/state-codes/common/land_publisher_code_v2.py private/coverage-completion-2026-10-12/ga-staged-2025-v2 --execute --workers 2 --checkpoint private/coverage-completion-2026-10-12/ga-staged-2025-v2/land-checkpoint.json
```

This command registers private evidence and retains all original bytes. It does not publish. Resume an interrupted run with this same packet and checkpoint; do not open a competing import or alter source timestamps. The coordinator's preflight found no prior Georgia source state, entities or runs.

After intake, execute the packet's `cloud-readback.sql` read-only. Require 29,682 source records, 53 units, completed run, no open runs and all error counts zero. The full actual-payload ledger must equal `c95e1b0e616fa27bdd5b40aa83aeb4b699bc859585b26a62af7e76bcd2776aeb`. This hashes every active unit and section, including text, source occurrence, PDF comparison, display warnings and edition metadata; it recomputes the hashes instead of trusting the stored payload hash. The expected comparison counts and 1,142 empty-body bindings must also match.

Private intake completed at **2026-10-12 20:35:02 UTC**. The completed run reports 151 objects, 269,510,799 bytes and all 29,735 rows verified (53 source units and 29,682 sections), under the exact manifest and run above. The state remained `landed` with `public_projection_allowed:false`.

The complete cloud readback at **2026-10-12 20:35:50 UTC**, retained in the packet's `cloud-readback.json`, matched the independently replayed full payload ledger `c95e1b0e616fa27bdd5b40aa83aeb4b699bc859585b26a62af7e76bcd2776aeb`. Every payload and text hash check passed. No unexpected manifests, wrong identities or provenance classes, missing qualifications, hidden unresolved comparisons, incorrect empty-body bindings, quarantined rows or enabled current-law/calculation flags were found. There were no open runs. All four PDF comparison counts, 29,490 distinct citations, 190 duplicate citation groups and 1,142 status-only records matched the independent packet proof.

The prepared `publish-reviewed.sql` takes the Georgia state lock, recomputes the complete payload ledger, requires the exact completed run and manifest with publication still disabled, and rejects any integrity error before recording a qualified browsing review. It has not been executed as of this audit update. Frontend deployment and the publication decision remain separate from this successful private intake and whole-record verification.

Publication is a separate explicit review of this qualified browsing edition. The UI must display the source-edition qualification, unresolved comparison warnings, multiple printings and status-only records without presenting missing text as an error or an inferred law. Automatic citation-token lookup excludes third-party source occurrences. Keep `current_law_verified` and `calculation_activation_allowed` false. Cloud intake/readback and the eventual publication decision must be recorded separately.
