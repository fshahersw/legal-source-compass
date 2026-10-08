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

- No fabricated data: every row comes from the protected snapshot bundles (`/api/bundles`, private storage; `public/data/` stays absent) or the read-only external corpus. Large snapshot files live in private storage behind the bundle manifest, not in git.
- Corpus access from the site is read-only via `src/lib/external/*` and `src/lib/matters/*` server functions (EXTERNAL_SUPABASE_* never reach the client). New app-readable corpus objects are `public` RPCs/views, `SECURITY DEFINER`, `search_path = ''`, revoked from `public`/`anon`/`authenticated`, granted to `service_role`.
- Owner authorized administrative corpus enrichment (2026-10-02): use the private versioned `corpus_ingest` contract; retain raw versions, provenance, checksums, reversible cleanup evidence; admin credentials never in client, repo, logs or docs; never overwrite or release held collections by implication.
- Owner decisions 2026-10-03: docket PDF downloads allowed (private `corpus-originals`, content-addressed, hash-verified); docket text shown as published, excluding sealed/restricted/in camera/ex parte/redacted material, counsel without contact fields; auth not enforced (`CORPUS_REQUIRE_AUTH`, default off).
- Owner decisions 2026-10-05/06: `open_us_law`, `cpsc_injury_data` and the objects in `docs/owner-data-removal-2026-10-05.md` stay removed, never reacquired without a new instruction; matter PDFs and app dependencies preserved. Corpus gap-filling resumes from CourtListener, DocketBird and official public sources; if it is not mapped, accurate and useful it is removed; the coordinator may merge PRs and remove data/code unreviewed provided every removal is ledgered, reversible and in the audit reports.
- MDL membership needs explicit evidence (DocketBird relationship, JPML Schedule A/CTO, exact transfer entry, native crosswalk, or FJC IDB association labelled historical); never inferred from caption, product, judge, firm or court; `parent_docket_id` is not membership.
- Time Limits releases ship only via `scripts/admin/stage-limitations-release.mjs` (content-addressed, hash readback, inactive staged manifest) then `activate-limitations-release.mjs --verify` (one-file change to `src/lib/private-data/manifest.server.json`); never hand-edit the manifest or load rules elsewhere. Why: every served rule must be reversible and traceable.
- Tolling/repose note links come only from `link-cross-references.ts`: exact section via the shared citation parser, same state, operative text (stubs and >50 KB sections withheld), term check recorded beside the untouched note. Why: a link must point at the provision described and never rewrite the note.
- Time Limits captures keep the response bytes unchanged (`.raw`) and a plain-text rendering (`.txt`, `capture.py`) that every quote is checked against; extraction markup never enters stored text or excerpts — a quote carrying it is superseded, not edited. Why: users must see the statute's own words with the transformation reviewable.
- Source currency routes, in order, in `currency.route`: `direct` (same URL from here; `recheck-direct-browser.py` waits out browser checks, never bypasses a block or leaves the official host), `official_code_capture` (corpus code text, character references decoded), `proxied`. Proxied yields only `confirmed_evidence_intact` or `not_rechecked`; a passage missing from a browser/proxy copy is a review item, never `evidence_lost`; text >15 MiB stays raw-only; a direct text differing from a retained *extraction* is not a page change. Why: a verdict never claims more than the compared bytes show.
- A builder-made concatenation is never fetched: its verdict derives from its components' text-identical direct re-reads (`currency.componentSourceIds`: direct, intact, existing ids, no self), withdrawn when one stops matching. Proxy-confirmed passages beside another page-level verdict go in `currency.passageRecheck` (hash, storage key, count), never a route change. Why: every retained copy a note cites must be addressable from the bundle.
- Missing provenance on a released rule is added only via the evidence-attachment ledger (`attachments.ts`): literal quotes of the cited stored text whose period words match the rule; existing provenance, period, dates, conditions and calculation untouched; shown as `evidenceAttachment` in "Change history". Matching is literal first; `passageMatch.ts` may accept spacing-only differences labelled `spacing_normalized`. Why: gaps close with the statute's words, reviewably and reversibly.
- Sidebar has exactly 4 sections in `AppShell`; the rest is contextual sub-navigation. Home `/` is the map; the library is `/sources/library`.
- Names link to a profile only on a unique exact match; never fuzzy-merge people.
- Unknown or uncountable values show as "Not recorded"/"too large to count", never a guessed number.
- Court artwork uses exact court IDs and recorded court types; generic emblems are labeled as court types, never official seals.
