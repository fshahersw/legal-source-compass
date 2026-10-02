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

- No fabricated data: every row comes from bundled uploads in `public/data/` or the read-only external corpus.
- Website access to the external corpus stays read-only via `src/lib/external/*` server functions (EXTERNAL_SUPABASE_* secrets never reach the client).
- The user explicitly authorized administrative Supabase enrichment on October 2, 2026. Use the private, versioned `corpus_ingest` contract for acquisitions and native-ID relationships; retain raw source versions, retrieval provenance, checksums and reversible cleanup evidence. Administrative credentials never enter the client or repository. Do not overwrite or release held collections by implication.
- The October 2 backfill is metadata-only: collect document locators, not PDF bytes. Document downloads are a separate user-authorized scope.
- Files >10 MB are split under `public/data/` with the original as a lovable-asset (commit limit).
- Sidebar has exactly 4 sections in `AppShell`; everything else is contextual sub-navigation. Home `/` is the map; the library is `/sources/library`.
- Names link to a profile only on a unique exact match; never fuzzy-merge people.
- Unknown or uncountable values show as "Not recorded"/"too large to count", never a guessed number.
