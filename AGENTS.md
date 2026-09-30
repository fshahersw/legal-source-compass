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

## Legal Source Atlas architecture rules

- All directory data comes from a user-imported V2.2A JSON bundle validated by
  `src/lib/atlas/types.ts`; the repo ships no seeded, sample or fabricated records
  so no count in the UI can be mistaken for verified live data.
- Pure data logic lives in `src/lib/atlas/{bundle,filters,review,exports}.ts` and is
  unit-tested; React code only renders it, which keeps filter/export behaviour testable
  without a DOM.
- Imported bundle fields are immutable; review decisions and bookmarks are a separate
  browser-local overlay in `src/lib/atlas/store.tsx` (localStorage) so curation history
  is never overwritten by local triage.
- No backend, database, API key or network call is used by this app; everything runs in
  the browser.
