# atlas data rules

- Startup: saved IndexedDB import → legacy localStorage (migrated only after a verified IndexedDB write) → bundled default (`persistence.ts`); stale loads dropped via generation counter. Why: bundles exceed localStorage quota.
- Imports stored as exact raw bytes; view models derived in memory; raw records deep-frozen with `imported_raw_record`. Why: lossless round-trip exports.
- Reviews/bookmarks are a separate localStorage overlay (`localState.ts`) written only by user actions. Why: startup can't overwrite them.
- Pure logic (bundle, filters, review, exports, registry, catalogMatters, caseAnalytics, mdlDocuments) is unit-tested against the real files.
- Case catalog links to MDLs only via master-docket ids from the docket documents; PACER-only docs are never download links.
