# New Jersey publisher source occurrences

The October 12, 2026 direct official bulk capture contains 56,331 styled section occurrences and two nonempty anomalous publisher blocks across 70 physical titles. These are 56,333 source occurrences, not a certification of 56,333 operative laws. All original ZIP/TXT/RTF bytes and title text derivatives remain retained.

The `STATUTES.TXT` preamble states `UPDATED THROUGH P.L.2026, c.30, and J.R.1` (original spacing retained in the packet). The separately published counsel table states c.90 and JR 2. The latter does not update the statute bodies. No current-law through-date is inferred; `current_law_verified` and `calculation_activation_allowed` stay false.

## Identity and visible qualifications

`publisher_source_occurrence` is a separate manifest and record identity scheme. Its ID binds the raw `STATUTES.TXT` SHA-256, physical title unit, and exact Unicode span. The paired RTF ordinal/span/hash, raw archive hash, and literal headnote are additional evidence. An occurrence is not labeled an official citation path.

- All 20 repeated citation groups (42 occurrences) remain separate. Every member displays a warning; the first occurrence receives no preference.
- Two printed citations conflict with their physical title: `48:3-89` in Title 49 and `52:12A-44` in Title 58. The captured enactments reproduce the erroneous identifiers. They remain literal with visible conflict warnings.
- The malformed `9-3A-7` headnote and the `54A:2-1b` reallocation notice remain distinct source blocks, not text silently merged into the preceding section.
- Partial/malformed identifiers, including the four `52:9H 34`–`37` headnotes, remain literal. No missing separator is invented.
- Only publisher title and section/headnote structure is represented. Chapter/article structure is not inferred from the counsel table.

Each displayed occurrence states that current legal effect is unverified. The public source title also identifies publisher source occurrences. Exact-ID browsing and search preserve multiple results; automatic citation-token resolution excludes the occurrence scheme. Existing canonical-citation records retain their prior lookup behavior.

## Separate primary crosswalk evidence

Fresh direct official enactments support three explicit crosswalks: `9-3A-7` to `9:3A-7` (P.L.2016 c.72 amendment clause), `52:24.4.1` to `52:24-4.1` (P.L.2007 c.39 amendment clause), and the second `45:15-16.52` occurrence to enacted `45:15-16.53` (P.L.2006 c.63 section 4). These links are evidence metadata in the independent verification report. They do not replace the printed text, enable canonical lookup, or choose operative law. Range-only TOC matches and source errors reproduced in enactments remain unresolved.

## Reproducible packet and checks

Private packet: `private/coverage-completion-2026-10-12/nj-occurrences-20261012-v2-final`.

- Canonical manifest SHA-256: `64e19c1a4c2ea1e52cdbf3412aff23934742b2a6bb161eae95d3a985a09ec50d`.
- Deterministic intake run: `b6f540fe-c2f2-56b3-a081-df795c494835`.
- 79 original/derivative objects, 314,915,376 bytes; 70 units; 56,333 occurrences.
- Original statutes archive SHA-256: `86fb2a806c88d64077fe013c38439569b390050e23356a09b27bc14c37f2f820`.
- Full identity/text/hierarchy/occurrence/display ledger SHA-256: `7663b91dec321f4c168eeaa4b9622afa1c08853e8514b5fb935b95b40171d582`.

`nj-verify-occurrence-packet.py` replayed every source heading and exact text span, every original/derivative object hash, both sides of duplicate/conflict qualifications, the source edition marker, and literal primary crosswalk quotes. The final result is `independent-verification-v2.json`, whose full ledger also covers display citation, heading, warning and currency. No database mutation was performed by this verification. Earlier staged candidates and verification reports remain retained, including the version that quarantined two cross-title records.

## Administrative sequence

1. Review and apply `database/contracts/corpus-publisher-code-source-occurrence-v1.sql` after intake-v2 and projection-v2. It adds scheme validation and evidence bindings, preserves all existing authority gates, and retains service-role-only access. Do not overwrite later amendments to these functions when applying other migrations.
2. Confirm New Jersey's existing public gate is false, no previous source rows would remain unaccounted for, and no conflicting open run exists.
3. Run the existing generic lander with this packet, `--execute --workers 2 --checkpoint private/coverage-completion-2026-10-12/nj-occurrences-20261012-v2-final/land-checkpoint.json`, using credentials only through the authorized private environment. No `--multicode` is required for this single NJ source.
4. Execute the packet's read-only `cloud-readback.sql`. Require 56,333 occurrences, 70 units, the exact full ledger hash above, completed deterministic run, zero open runs, matching current manifest, and zero integrity/identity/qualification/authority errors. Publication must still be false at this checkpoint.
5. Only after source review, explicitly publish the qualified source edition using the existing review RPC. This permits browsing only; it does not certify current law or activate calculator rules. Retain the gate state and review note for reversible withdrawal.

Local checks: 11 NJ staging/replay tests, 12 generic lander tests, and 7 isolated PostgreSQL intake/projection tests passed. The SQL tests cover forged source bindings, missing warnings, false legal-effect flags, unchanged valid canonical lookup, and withholding occurrence token lookup.

## Published readback

The coordinator completed this sequence on October 12. Two read-only preflights and local worker inspection established that the October 8 interrupted run was empty and inactive; it was closed as failed without deleting retained objects or prior runs. The new deterministic run completed 113 verified batches: 56,333 occurrences and 70 units. The complete cloud ledger matched the independent digest above, with all integrity and authority checks passing and the gate still closed.

The guarded review transaction opened source-edition browsing at `2026-10-12T20:10:29Z`. The protected API returned 69 nonempty title groups; the seventieth retained physical title unit has no section entries. Exact search for `45:15-16.52` returned both occurrences, while automatic token resolution returned null. The live browser displayed the literal text and duplicate/current-effect warning. Readback, exact publication SQL, API evidence and a live screenshot remain beside the private packet. Closing the state review gate withdraws browsing without altering any retained source or version.
