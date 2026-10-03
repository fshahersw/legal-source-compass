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
- October 3, 2026 owner decisions: (1) PDF downloads of docket documents are authorized (private `corpus-originals` bucket, content-addressed, hash-verified readback); (2) docket text is shown as published — entry descriptions, member-case captions and party names exactly as the court record shows them, excluding anything sealed, restricted, in camera, ex parte or redacted; counsel without contact fields; (3) authentication is not enforced for now — the server-side access gate stays behind `CORPUS_REQUIRE_AUTH` (default off).
- MDL membership needs explicit evidence (DocketBird native relationship, JPML Schedule A/CTO, exact docket transfer entry, native crosswalk, or exact FJC IDB association labelled historical). Never infer it from caption, product, judge, firm or court similarity; `parent_docket_id` is not MDL membership.
- Large snapshot files live in private storage behind the bundle manifest, not in git.
- Sidebar has exactly 4 sections in `AppShell`; everything else is contextual sub-navigation. Home `/` is the map; the library is `/sources/library`.
- Names link to a profile only on a unique exact match; never fuzzy-merge people.
- Unknown or uncountable values show as "Not recorded"/"too large to count", never a guessed number.
