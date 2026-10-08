# Confirm the new state-code outline in the app

The v3 outline is installed in the corpus database and passes all checks:
- Pennsylvania title 42 → part VI lists 16 chapters, including chapter 55 "Limitation of Time" (37 sections).
- Going down to subchapter B reaches section 5524.
- A path in the wrong order is refused with the expected error.
- Louisiana's top level lists all 54 titles.

## Remaining steps
1. Open the Pennsylvania, Louisiana, New York and Connecticut code pages in the preview and click into the titles that used to dead-end; confirm they now open to the next level.
2. Remove the "outline gap" notice text from the code pages where it no longer applies, if it still shows.
3. Mark the owner-action item done in the roadmap and state-code notes.

## Technical details
- Browser check via Playwright at localhost:8080 (fresh load, so the old cached answer is not used).
- Update `roadmap.md` and `docs/state-codes.md`; no data or release changes.
