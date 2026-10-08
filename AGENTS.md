<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Legal Source Atlas rules

- No fabricated data: every row comes from the protected snapshot bundles (`/api/bundles`, private storage; `public/data/` stays absent) or the read-only external corpus. Large snapshots live in private storage behind the bundle manifest, not in git.
- Corpus access from the site is read-only via `src/lib/external/*` and `src/lib/matters/*` server functions (EXTERNAL_SUPABASE_* never reach the client). New app-readable corpus objects: `public` RPCs/views, `SECURITY DEFINER`, `search_path = ''`, revoked from `public`/`anon`/`authenticated`, granted to `service_role`.
- Owner authorized administrative corpus enrichment (2026-10-02): private versioned `corpus_ingest` contract; retain raw versions, provenance, checksums, reversible cleanup evidence; admin credentials never in client, repo, logs or docs; never release held collections by implication.
- Owner decisions 2026-10-03: docket PDF downloads allowed (private `corpus-originals`, content-addressed, hash-verified); docket text shown as published, minus sealed/restricted/in camera/ex parte/redacted material; counsel without contact fields; auth not enforced (`CORPUS_REQUIRE_AUTH`, default off).
- Owner decisions 2026-10-05/06: `open_us_law`, `cpsc_injury_data` and the objects in `docs/owner-data-removal-2026-10-05.md` stay removed, never reacquired without a new instruction; matter PDFs and app dependencies preserved. Gap-filling resumes from CourtListener, DocketBird and official public sources; if not mapped, accurate and useful it is removed; the coordinator may merge PRs and remove data/code unreviewed if every removal is ledgered, reversible and in the audit reports.
- MDL membership needs explicit evidence (DocketBird relationship, JPML Schedule A/CTO, exact transfer entry, native crosswalk, FJC IDB association labelled historical); never inferred from caption, product, judge, firm or court; `parent_docket_id` is not membership.
- Time Limits releases ship only via `scripts/admin/stage-limitations-release.mjs` (content-addressed, hash readback, inactive staged manifest) then `activate-limitations-release.mjs --verify` (one-file change to `src/lib/private-data/manifest.server.json`); never hand-edit the manifest or load rules elsewhere. Why: every served rule is reversible and traceable.
- Tolling/repose note links come only from `link-cross-references.ts`: exact section via the shared citation parser, same state, operative text (stubs and >50 KB sections withheld), term check recorded beside the untouched note. Why: a link points at the provision described, never rewrites the note.
- Captures keep response bytes unchanged (`.raw`) plus a plain-text rendering (`.txt`, `capture.py`) every quote is checked against; extraction markup never enters stored text or excerpts — a quote carrying it is superseded, not edited. Why: users see the statute's own words, transformation reviewable.
- Source currency routes, in order, in `currency.route`: `direct` (same URL from here; `recheck-direct-browser.py` waits out browser checks, never bypasses a block or leaves the host), `official_code_capture` (corpus code text), `proxied`. Proxied yields only `confirmed_evidence_intact` or `not_rechecked`; a passage missing from a browser/proxy copy is a review item, never `evidence_lost`; text >15 MiB stays raw-only; a direct text differing from a retained *extraction* is not a page change. Why: a verdict claims no more than the compared bytes show.
- A builder-made concatenation is never fetched: its verdict derives from its components' text-identical direct re-reads (`currency.componentSourceIds`: direct, intact, existing ids, no self), withdrawn when one stops matching. Proxy-confirmed passages beside another page verdict go in `currency.passageRecheck`, never a route change. Why: every retained copy a note cites is addressable from the bundle.
- Missing provenance on a released rule is added only via the evidence-attachment ledger (`attachments.ts`): literal quotes of the cited stored text whose period words match the rule; provenance, period, dates, conditions, calculation untouched; shown as `evidenceAttachment` in "Change history". Literal match first; `passageMatch.ts` may accept spacing-only differences labelled `spacing_normalized`. Why: gaps close with the statute's words, reversibly.
- Every coverage row has `timeComputation` or `timeComputationNotRecorded` (reason). Only a *verified* rule moves a weekend last day (`weekendTreatment`, `engine.ts`); flagged/absent rules yield a `weekendNotice` in result and steps, never a silent date. Why: a weekend anniversary says what the rule did or why none applied.
- Sidebar has exactly 4 sections in `AppShell`; all else is contextual sub-navigation. Home `/` is the map; the library is `/sources/library`.
- Names link to a profile only on a unique exact match; never fuzzy-merge people.
- Unknown/uncountable values show as "Not recorded"/"too large to count", never a guessed number.
- Court artwork uses exact court IDs and recorded court types; generic emblems are labeled court types, never official seals.
