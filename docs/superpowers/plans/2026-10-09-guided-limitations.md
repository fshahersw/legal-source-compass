# Guided limitations implementation plan

Goal: a compact case/timeline/review workflow that accounts for every recorded tolling note, repose note, condition and exclusion. Add explicitly reviewed case-specific arithmetic; never infer statutory effects from keywords or call incomplete coverage exhaustive.

Architecture: existing immutable release and baseline engine -> pure legal-factor inventory/context -> reviewed date arithmetic -> assessment/audit export -> guided React calculator. Existing source/research views stay available. The separate Lovable worker owns state-code ingestion; do not overwrite its scripts or restart crawlers.

Invariants: no invented legal durations or majority ages; all answers initially unknown; exact duplicate notes retain every origin; any fact/rule/source/release change invalidates review; overlapping pauses count once; open-ended tolls have no guessed end; post-expiry pauses do not revive; bankruptcy floors differ from stop-clock pauses; independent outer caps stay separate. User-entered legal directions are labelled planning assumptions, not verified statutes. Unsupported multi-clock modifications remain blocked. No matter answers leave the browser or persist automatically.

Tasks:
- [ ] Red/green tests for note inventory, exact deduplication, context staleness and unresolved answers.
- [ ] Red/green tests for civil-date interval arithmetic, resumption, extension floors, caps and invalid/open-ended dates.
- [ ] Assessment wrapper and source-linked audit export, preserving baseline safety checks.
- [ ] Guided responsive UI with conditional fields, progressive source disclosure and clear blockers.
- [ ] Real-bundle tests, typecheck, lint, build and browser verification.
- [ ] Commit, reconcile concurrent main edits without rewriting history, push and verify deployment.
