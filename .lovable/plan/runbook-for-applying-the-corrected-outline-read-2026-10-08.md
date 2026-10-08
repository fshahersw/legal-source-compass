# Runbook for applying the corrected outline read

## What you will get

One short document, `docs/outline-projection-v3-runbook-2026-10-08.md`, that tells you exactly how to install the fixed outline read in your corpus project and how to prove it worked — without reading the 182-line SQL file.

Current state, checked today: the read is **not** installed in your corpus project (the API reports "Could not find the function"), and the older read still lists nothing for Pennsylvania title 42 → part VI. So this is a real, still-open step, not a duplicate of work already done.

## The runbook's contents

1. **What and where.** The contract file, its size and that it is committed; that it runs in your corpus project's SQL editor, not in this app's database.
2. **Before you start.** It is safe to re-run, it writes no data, the older read stays installed, and only the service role can call it. The site already asks for the new read first and falls back when it is absent.
3. **Apply.** Open the SQL editor in your corpus project, paste the entire file including its opening and closing transaction lines, run once. The file ends by telling the API to reload its schema cache, so no restart of the corpus is needed.
4. **Verify — four checks, copied word for word from the file's own trailer.**

```text
PA  title 42 -> part VI            expect: groups include chapter 55 "LIMITATION OF TIME"
PA  ... chapter 55 -> subchapter B expect: kind sections, includes native id PA:42:5524
PA  chapter 55 -> title 42         expect: rejected with error code 22023 (wrong order)
FL  empty path, new vs old read    expect: same totals and group numbers
```

5. **The dead-ends that should disappear.** Under the old read: Louisiana 48 of 54 titles, Pennsylvania 12 of 51, New York 7 of 94, Connecticut 2 of 110. Each one is listed with its section count so you can spot-check a state other than Pennsylvania.
6. **What changes on the site.** The outline opens where it used to stop, the message "The outline cannot open this position yet" should no longer appear on the Pennsylvania path above, and the outline can show, side by side, divisions of different kinds. A preview that is already running remembers the old answer until it restarts, so check after a fresh load.
7. **Undo.** A single statement removes the new read; the site then falls back to the old one by itself. Nothing else has to be reverted.

## Also touched

A one-line pointer added to the "Owner action" sentence in `docs/state-codes.md` so the runbook is findable from the note that describes the defect. Nothing else in that file changes.

## No app code changes

No component, route or server function is edited, so nothing in the running site changes. The interface does not currently show which read answered, so the runbook's proof comes from the four queries and from the outline actually opening.

## Technical details

- Contract: `database/contracts/corpus-publisher-code-projection-v3-outline.sql` (182 lines, committed). It creates or replaces `public.corpus_publisher_code_projected_outline_v3(text, jsonb)` as `security definer` with `search_path = ''`, revokes from `public`, `anon`, `authenticated`, grants execute to `service_role`, adds a comment, then `notify pgrst, 'reload schema';` before `commit;`.
- Readback queries are quoted verbatim from lines 168–180 of that file; the runbook will not restate them in its own words.
- Site behaviour: `projectedOutline` in `src/lib/law/stateCodeCatalog.server.ts` (lines 621–642) calls the new read first and, once it is reported absent, remembers that in a module-level flag for the life of the process — which is why a running preview keeps using the old read after you install the fix.
- Verification of my own work: after writing, re-read the runbook and confirm the four queries and the undo statement match the contract file character for character, and that `docs/state-codes.md` still reads correctly with the added pointer.
