# Hawaii publisher-source completion

The source is the Hawaii Legislature's exact `data.capitol.hawaii.gov/hrscurrent/`
directory. The retained directory traversal identifies 14 volumes, 1,108 chapter
directories, and 24,081 HRS HTML pages, including 1,108 chapter indexes. The
expected remaining 22,973 identities are section-page filenames, subject to the
complete source audit. These counts describe source files, not present legal
force or distinct enacted provisions.

## Source boundaries

`capture_hrs.mjs` retains exact publisher bytes and HTTP receipts, with TLS
verification, bounded concurrency, no implicit redirects, and resumable SHA-256
checks. `stage_hrs.py` reparses every retained directory anchor and rejects any
inventory URL absent from its source directory. Missing pages block a packet.

The crawler defaults to 250 ms between request starts. The owner-authorized
`--rate-ms=125` option permits at most eight starts per second with the same four
workers; values below 125 ms are rejected. The source host's retrieved robots
file allows the HRS paths and specifies no crawl delay. The access-guidance
receipts are retained in `private/coverage-completion-2026-10-12/hi-rate-guidance/`.
Shared `Retry-After` cooldowns and bounded transport retries cover all workers.
Access restrictions, repeated 429/server failures, and requested waits over one
minute pause acquisition. Restart only one crawler, and honor a reported future
retry time. Exact resumes preserve the original directory inventory byte hash;
changed discovery requires a new reviewed capture rather than silent replacement.

The parser reads the publisher's `WordSection` content, preserves statutory
characters in source order, and retains `XNotes` editorial annotations separately.
Leading title/part paragraphs remain in the source unit; exact Unicode spans
locate the section text. A native page containing several printed citation
markers stays one complete source-page record with an explicit disclosure. It
does not silently select a legal version. Chapter headings that print OLD and
NEW versions retain both headings and labels.

Two observed chapter 291C pages style their entire statutory paragraph as
`XNotes`. A narrow source-bound exception retains such a paragraph only when it
is the sole nonempty paragraph in the sole content container and its leading
bold citation matches the exact publisher filename. Different citations,
multiple paragraphs, and mixed statute/notes remain unresolved rather than
being guessed. The observed §342H-11 page has a leading statutory paragraph in
`XNotes`, followed by actual editorial notes. Its explicit exception requires
the reviewed original response hash and exact native citation; changed bytes
require another review. Every exception is recorded with its source URL and hash
in the private `source-style-exceptions.jsonl` evidence.

The native `[OLD]` filename is retained literally for a repealed article range.
One native page prints only `ARTICLE 18` and `[RESERVED]`. Its displayed citation
is that literal article label, with an explicit reserved-page disclosure; no
section citation or operative text is invented from the filename. Native page
counts therefore include reserved and repealed source records.

Exact publisher filenames form native IDs. Printed citations are separate
fields, including the publisher's punctuation. Unknown text or an inconsistent
chapter identity creates a review hold. The retrieval date and the directory
name do not establish compilation currency: each record uses the contract's
unknown-currency form, with no through date or invented publisher statement.
Current-law and calculator flags remain false.

Linked images are not converted into invented statute text. `capture_assets.py`
first proves each reference against its retained source HTML, then captures only
the exact official HTTPS image URL. Staging requires these original image bytes
and discloses their absence from the plain-text derivative. All raw HTML, linked
images, annotations, receipts, and candidate rows remain private.

## Review and execution

The output paths below are examples under the ignored private directory; choose
fresh audit and packet directories so earlier evidence is preserved.

1. Run `stage_hrs.py --capture <capture> --out <audit>` to obtain a complete or
   partial audit and exact `attachments.jsonl` references.
2. Run `capture_assets.py --capture <capture> --references <audit>/attachments.jsonl
   --out <assets>`. Its requests are limited to image references reverified in
   the source HTML. An expanded inventory uses a fresh asset output directory.
3. Once the crawler completes, run `stage_hrs.py --capture <capture> --assets
   <assets> --out <packet> --emit-packet`. Every directory, index, section page,
   and linked image must be retained, and all interpretation holds must be zero.
4. Run `verify_packet.py --capture <capture> --packet <packet> --out <report>`.
   This independently compares complete statutory and annotation character
   sequences against original HTML without calling the statute parser. It also
   checks the full native inventory, object hashes, retrieval identities, Unicode
   spans, and visual-content disclosures. Run the common v2 lander's dry preflight.
   `source_review.py --capture <capture> --out <fresh-sample>` retains a separate
   bounded 20-page sample spanning all 14 volumes, with each sample's chapter
   index. It is supporting evidence alongside the complete source audit.
5. An owner executes `scripts/legal/state-codes/hi/preflight.sql` before intake.
   Existing runs and retained versions require explicit review. Two unchanged
   activity observations plus worker inspection can support a stale-run
   decision; age or a zero section count alone cannot. No helper auto-closes a
   run, deletes old units, or overwrites source history.
6. After authorized private intake through the versioned contract, retain
   object hash readbacks, exact batch verification, immutable-version group
   comparisons, and whole-inventory source/hash/span proofs. Independently review
   fresh source samples alongside those whole-source proofs. Only a separate
   explicit review may open protected publisher browsing. No staging script
   calls the publication RPC or changes calculator rules.

`source_review.py --capture <capture> --packet <packet> --sample <fresh-sample>
--out <comparison.json>` checks the separately fetched sample against the final
packet. Changed response bytes require a source-version review even if rendered
text matches. No sample result substitutes for the whole-source verification.

`review_export.py generate --packet <packet> --baseline <preflight.json>
--out <review-directory>` creates the bounded read-only `readback.sql` and exact
expected chapter-level data/provenance digests. If intake uses a retry run,
provide its exact `--run-id`; never silently substitute a different run. After
the owner saves the SQL result, run `review_export.py check --expected
<review-directory>/expected.json --readback <readback.json> --out <comparison.json>`.
This requires the complete candidate, registered private originals and text
derivatives, source/Unicode-span bindings, a completed private run, no open runs,
and unchanged current/history digests for the legacy units. The state total must
include both new units and retained legacy units. This report does not approve
publication or establish current-law or calculator authority.

Raw originals may be privately retained before source interpretation finishes.
`prepare_original_upload.py --capture <capture> --out <raw-plan>` snapshots and
hash-verifies only existing directory-listed originals. The owner may run
`preupload_originals.py --capture <capture> --plan <raw-plan> --checkpoint
<private-checkpoint> --workers 8 --execute`; omission of `--execute` performs only
offline validation. This wrapper checks that `corpus-originals` is private,
uses the existing content-addressed non-upsert uploader, and prohibits corpus
RPCs. Each storage creation is journaled before whole-object readback, and each
verified receipt is flushed in the final lander's checkpoint format. Per-worker
sessions share retry cooldowns; requested waits over 60 seconds stop acquisition
and record the wait for a later resume. Never restart before that recorded wait
expires. These raw uploads do not register a manifest or approve any source row.

The initial live preflight found 1,500 retained parser-1 source units, zero
sections, and a separate open parser-2 run with no batches, source references,
or original-object registrations. The old units include administrative and
constitutional pages and use a filename-plus-hash-suffix identity scheme. Keep
their current and historical digests unchanged; they are not new HRS section
candidates. Existing projected section readers select only `code-section`
records. The eventual state unit count includes retained legacy units, while
the published section count must reconcile exactly to the new HRS page inventory.
No old source-unit content is approved by the new section review.

The owner closed only the empty parser-2 run as failed at 2026-10-12 20:14:45 UTC,
after three preflights and worker inspection found no ongoing acquisition or
registered run activity. The closure receipt is
`private/coverage-completion-2026-10-12/hi-empty-run-closure.json`. The 1,500 legacy
units and 3,059 private objects were retained. Their original digests remain the
post-intake preservation baseline.

The current partial evidence is under
`private/coverage-completion-2026-10-12/hi-audit-retained-images/`: 6,405 captured
pages, 6,077 section pages, 328 chapter indexes, zero interpretation holds, and
three retained image assets. Acquisition was still incomplete when this note was
written; this note does not claim full intake, publication, or deployment.
The separate fresh sample subsequently captured 20 section pages across all 14
volumes and their 18 distinct chapter indexes, with zero parser holds. Its bytes
and review are under `private/coverage-completion-2026-10-12/hi-source-sample-20261012/`.
