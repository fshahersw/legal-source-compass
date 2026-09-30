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

- Directory data is the real supplied V2.2A file shipped byte-identical at
  `public/data/atlas-import-bundle.json` (sha256 recorded in `persistence.ts`), optionally
  replaced by a user import; no sample or fabricated rows so every count is computed from real rows.
- Startup order is saved IndexedDB import → legacy localStorage (migrated only after a verified
  IndexedDB write) → bundled default, in `src/lib/atlas/persistence.ts`, because multi-MB bundles
  exceed localStorage quota; stale async loads are discarded via a generation counter.
- User imports are stored as exact raw bytes in IndexedDB and view models are derived in memory,
  so round-trip exports and original-file text are never lost.
- Pure data logic lives in `src/lib/atlas/{bundle,filters,review,exports}.ts` and is
  unit-tested; React code only renders it, which keeps filter/export behaviour testable
  without a DOM.
- Imported bundle fields are immutable (raw object deep-frozen, each source keeps
  `imported_raw_record`); review decisions and bookmarks are a separate localStorage overlay
  (`localState.ts`) written only by user actions, so startup can never overwrite them.
- External corpus data (user-requested) is read-only via PostgREST in `src/lib/external/*` server functions using EXTERNAL_SUPABASE_URL/KEY secrets; secrets never reach the client and nothing is written.
- Apart from that connection, no other backend or external call is used; the only browser fetch is the
  app's own bundled data file.
