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

- No fabricated data: every row comes from the protected snapshot bundles (`/api/bundles`, private storage; `public/data/` must stay absent) or the read-only external corpus.
- Website access to the external corpus stays read-only via `src/lib/external/*` and `src/lib/matters/*` server functions (EXTERNAL_SUPABASE_* secrets never reach the client). The corpus PostgREST exposes only `public`: new app-readable objects are `public` RPCs/views, `SECURITY DEFINER` with `search_path = ''`, revoked from `public`/`anon`/`authenticated`, granted to `service_role`.
- The user explicitly authorized administrative Supabase enrichment on October 2, 2026. Use the private, versioned `corpus_ingest` contract for acquisitions and native-ID relationships; retain raw source versions, retrieval provenance, checksums and reversible cleanup evidence. Administrative credentials never enter the client or repository. Do not overwrite or release held collections by implication.
- October 5, 2026 owner deletion decision: remove `open_us_law`, `cpsc_injury_data`, and the reviewed storage objects documented in `docs/owner-data-removal-2026-10-05.md`. Preserve matter PDFs and working app dependencies. Do not reacquire these collections or recreate removed files without a new owner instruction.
- October 6, 2026 owner decisions: (1) corpus development and its continuation automation resume for gap-filling and cleanup, using CourtListener, DocketBird and authoritative public legal sources (official legislature/code sites, court websites, US Code/CFR); (2) the October 5 removals (`open_us_law`, `cpsc_injury_data`, the reviewed storage objects) stay removed and are not reacquired; (3) API credentials live only in environment variables, never in the repository, client bundle, logs or docs; (4) cleanup rule: if it is not mapped, accurate and useful, it is removed. (5) The owner granted the coordinator authority to merge PRs without review and to remove collections, rows and code judged not mapped, accurate or useful, provided every data removal is ledgered and reversible and every removal is recorded in the audit reports.
- October 3, 2026 owner decisions: (1) PDF downloads of docket documents are authorized (private `corpus-originals` bucket, content-addressed, hash-verified readback); (2) docket text is shown as published — entry descriptions, member-case captions and party names exactly as the court record shows them, excluding anything sealed, restricted, in camera, ex parte or redacted; counsel without contact fields; (3) authentication is not enforced for now — the server-side access gate stays behind `CORPUS_REQUIRE_AUTH` (default off).
- MDL membership needs explicit evidence (DocketBird native relationship, JPML Schedule A/CTO, exact docket transfer entry, native crosswalk, or exact FJC IDB association labelled historical). Never infer it from caption, product, judge, firm or court similarity; `parent_docket_id` is not MDL membership.
- Large snapshot files live in private storage behind the bundle manifest, not in git.
- Sidebar has exactly 4 sections in `AppShell`; everything else is contextual sub-navigation. Home `/` is the map; the library is `/sources/library`.
- Names link to a profile only on a unique exact match; never fuzzy-merge people.
- Unknown or uncountable values show as "Not recorded"/"too large to count", never a guessed number.
