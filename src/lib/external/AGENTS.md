# external corpus rules

- UI is metadata-driven: `catalog.functions.ts` reads each dataset's listing metadata and corpus RPCs; sections map in `groups.ts`. Why: every dataset reachable without per-dataset code.
- Stored files are served only via `/api/files?route=` (corpus_artifacts lookup). Why: storage keys stay server-side.
- Entity pages (courts/judges/MDLs/records) render `corpus_detail` via pure `entityView.ts`.
- Folder drill-downs use pure `directoryTree.ts` and `lawTree.ts`; unmapped ids fall into "Other".
- Provisions show `corpus_records` text + http(s) source_url only; `formatLawText.ts` never drops text.
- Agency profiles use the Federal Register listing's agency filter ids/counts (`agency.functions.ts`).
