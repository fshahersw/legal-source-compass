# Runbook: install the corrected state-code outline read

Written 2026-10-08. Applies the contract that fixes the state-code outline dead-ends
(Louisiana, Pennsylvania, New York, Connecticut) described in
[`state-codes.md`](./state-codes.md).

## 1. What is being installed, and where

- **The file:** `database/contracts/corpus-publisher-code-projection-v3-outline.sql` — 182 lines, committed in this repository. It is in the repository's file browser under `database/contracts/`.
- **Where it runs:** in the **corpus project** — the database the site reads litigation and law data from, the same place `publisher-code-intake/2` and the projection/2 read were applied. It does **not** run in this app's own database.
- **What it creates:** one function, `public.corpus_publisher_code_projected_outline_v3(text, jsonb)`, marked `security definer` with `search_path = ''`, revoked from `public`, `anon` and `authenticated`, and granted execute to `service_role` only. Same access gate as the current read, same no-storage-keys/no-hashes guarantee.
- **What it does not do:** it writes no rows, changes no table, and leaves the current read installed. The site asks for the new function first and falls back to the old one while it is absent, so installing it cannot break a page that works today.

**Live state when this runbook was written (checked 2026-10-08, no recount):** the function is **not** installed — the API answers `HTTP 404, Could not find the function public.corpus_publisher_code_projected_outline_v3(p_jurisdiction, p_path) in the schema cache`, and the current read still returns `total 0, groups 0` for Pennsylvania title 42 → part VI.

## 2. Before you start

- **Safe to re-run.** The file uses `create or replace function`, so running it twice is harmless.
- **Order matters once:** it must be applied after `corpus-publisher-code-projection-v2.sql` (already applied) because it reuses `publisher_code_path_matches_v2` and the projection/2 gate.
- **Run it as an administrative role** (the SQL editor's default is fine) — the file ends with `revoke`/`grant` statements that only an owner can issue.
- **Nothing to deploy here.** No app code changes are needed; the site already prefers the new read.

## 3. Apply

1. Open the SQL editor in your corpus project.
2. Paste the **entire** contents of `database/contracts/corpus-publisher-code-projection-v3-outline.sql`, including the leading `begin;` and the trailing `notify pgrst, 'reload schema';` and `commit;`.
3. Run it once.

The file is one transaction: it creates the function, restricts it to the service role, attaches a comment, then tells the API to reload its schema cache before committing. That last line is what makes the new read visible to the site immediately, without restarting the corpus.

## 4. Verify — four checks

Copied word for word from the contract file's own trailer, which heads them "Expected readback after apply (service role), compared with v2 on the same path:". Run each in the same SQL editor.

```sql
-- 1. A skipped level now opens.
select public.corpus_publisher_code_projected_outline_v3('PA', '[{"level":"title","number":"42"},{"level":"part","number":"VI"}]');
--   -> kind groups, groups include {"level":"chapter","number":"55","heading":"LIMITATION OF TIME"}

-- 2. Following that chapter opens the sections.
select public.corpus_publisher_code_projected_outline_v3('PA',
  '[{"level":"title","number":"42"},{"level":"part","number":"VI"},{"level":"chapter","number":"55"},{"level":"subchapter","number":"B"}]');
--   -> kind sections, includes native_id PA:42:5524

-- 3. A path in the wrong declared order is still refused.
select public.corpus_publisher_code_projected_outline_v3('PA', '[{"level":"chapter","number":"55"},{"level":"title","number":"42"}]');
--   -> error 22023 (declared order)

-- 4. Nothing moved for a code that has no skipped levels.
select public.corpus_publisher_code_projected_outline_v3('FL', '[]') = public.corpus_publisher_code_projected_outline_v2('FL', '[]')
--   minus the added "level"/"levels" keys -> same totals and group numbers.
```

Check 1 is the one that matters: today the same call against the old read returns `total 0, groups 0`.

Optionally, the trailer's fifth note, verbatim: `explain analyze on PA '[]' should use the same plan shape as v2 '[]' (one scan of the state's sections).` No new index is required.

## 5. Dead-ends that should disappear

Measured on 2026-10-08 against the current read, first click only (root group → its outline), reading every top-level group:

| State        | Titles/laws that list nothing | Sections behind them |
| ------------ | ----------------------------- | -------------------- |
| Louisiana    | 48 of 54                      | 38,577               |
| Pennsylvania | 12 of 51                      | 2,058                |
| New York     | 7 of 94                       | 5,370                |
| Connecticut  | 2 of 110                      | 753                  |

Iowa, Kentucky, Nevada, Florida and Colorado were already clean. Spot-check a state other than Pennsylvania — for example open a Louisiana title that lists nothing today and call the new function on it with that title as the path.

## 6. What changes on the site

- The outline opens where it used to stop, and can list divisions of different kinds side by side (chapters beside subparts), each labelled with its own level.
- The message **"The outline cannot open this position yet"** should no longer appear on the Pennsylvania title 42 → part VI path.
- A preview or server process that was **already running** remembers that the new function was missing and keeps using the old read until it restarts. So check after a fresh load of the preview, and after the next publish for the live site — the published workers re-check on their own.
- The interface does not print which read answered, so the proof is the outline opening and the four queries above.

## 7. Undo

One statement, in the same SQL editor:

```sql
drop function public.corpus_publisher_code_projected_outline_v3(text, jsonb);
notify pgrst, 'reload schema';
```

The site then falls back to the old read by itself; nothing else needs reverting, because the contract wrote no data and changed no existing object.

## Technical notes

- Contract: `database/contracts/corpus-publisher-code-projection-v3-outline.sql`, applied as one transaction (`begin;` at line 28, `notify pgrst, 'reload schema';` then `commit;` at lines 181–182).
- Site behaviour: `projectedOutline` in `src/lib/law/stateCodeCatalog.server.ts` (lines 621–642) calls the new function first; when it is reported absent it sets a module-level flag for the life of the process and uses the old read from then on. That flag is why a running preview keeps the old behaviour after you install the fix.
- Which read answered is carried on the outline payload as `read: "v2" | "v3"` (`src/lib/law/stateCodeContract.ts` line 597) but is not printed anywhere in the interface.
- Check installation without the SQL editor (service role): `POST /rest/v1/rpc/corpus_publisher_code_projected_outline_v3` with `{"p_jurisdiction":"PA","p_path":[{"level":"title","number":"42"},{"level":"part","number":"VI"}]}`. `404` means not installed; a body with `"kind":"groups"` means installed.
