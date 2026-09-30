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

- Directory data is the supplied V2.2A file at `public/data/atlas-import-bundle.json`, optionally replaced by a user import; no fabricated rows.
- Startup order is saved IndexedDB import → legacy localStorage (migrated only after a verified
  IndexedDB write) → bundled default, in `src/lib/atlas/persistence.ts`, because multi-MB bundles
  exceed localStorage quota; stale async loads are discarded via a generation counter.
- User imports are stored as exact raw bytes in IndexedDB and view models are derived in memory,
  so round-trip exports and original-file text are never lost.
- Pure data logic lives in `src/lib/atlas/{bundle,filters,review,exports}.ts` and is unit-tested.
- Imported bundle fields are immutable (raw object deep-frozen, each source keeps
  `imported_raw_record`); review decisions and bookmarks are a separate localStorage overlay
  (`localState.ts`) written only by user actions, so startup can never overwrite them.
- External corpus data (user-requested) is read-only via PostgREST in `src/lib/external/*` server functions using EXTERNAL_SUPABASE_URL/KEY secrets; secrets never reach the client and nothing is written.
- Apart from that connection, no other backend or external call is used; the only browser fetch is the
  app's own bundled data file.

- Corpus UI is generic and metadata-driven: `src/lib/external/catalog.functions.ts` reads each dataset's own listing metadata (columns, filters, qualification) and the corpus RPCs (`corpus_query_bounded`, `corpus_query`, `corpus_detail`); sections are a pure mapping in `groups.ts`, so every dataset is reachable without per-dataset code.
- Stored corpus files (seals, portraits, PDFs) are served only via `/api/files?route=` which looks up `corpus_artifacts` by route and streams from the private bucket, so storage keys never reach the client.
- Primary navigation is domain-based; specialist/raw pages remain available through contextual navigation, not competing top-level links.
- Courts, judges and MDLs have full pages (`/courts/$id`, `/judges/$id`, `/matters/$id`, generic `/records/$dataset/$id`) rendered from `corpus_detail` via the pure `entityView.ts` mapper; directory rows navigate there, related collections embed filtered DatasetBrowsers, and provenance sits in a collapsed "Technical details" block.
- The supplied source registry (`public/data/registry_v06_1.jsonl`) is read-only, parsed in `src/lib/atlas/registry.ts`, and browsed jurisdiction → layer → record type; its HTTP statuses are shown as historical registry checks.
- Sidebar has exactly 4 sections (Explore, Litigation, Law & Safety, Sources & Work) in `AppShell`; all other pages are contextual sub-navigation so the top level stays uncluttered.
- Uploaded MDL docket documents are split into `public/data/mdl-documents/{mdl,court}-<key>.json` (each <10 MB commit limit); the full original is a lovable-asset (`src/assets/mdl-documents.json.asset.json`); PACER-only rows are never linked as downloads.
- Case catalog (`public/data/catalog-matters.json`) links to MDLs only via master-docket ids found in the docket documents (`mdl-documents/master-dockets.json`); registry V2.2 is split per jurisdiction in `public/data/registry-v22/` with the full original as a lovable-asset.
- Courts and Judges open as folder drill-downs (system → state → type/court → list) built by the pure `directoryTree.ts` from the full listings loaded once via `directory.functions.ts`; judge names link to a profile only on a unique exact `nameKey` match, since fuzzy matching would misattribute people.
- Law & Safety open as folder drill-downs (jurisdiction → type of law → outline/record set; agency → record kind) via the pure `lawTree.ts` mapping; unmapped dataset IDs fall into "Other" so nothing is hidden.
