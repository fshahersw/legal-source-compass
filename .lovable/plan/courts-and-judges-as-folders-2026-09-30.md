# Courts and Judges as folders

Same look as the new registry folders. Nothing else changes.

## Courts
```text
Courts
  Federal | State | Other/unrecorded       (folder cards with counts)
    Federal -> Supreme / Appeals / District / Bankruptcy / Specialty
    State   -> pick a state
      -> court type (supreme, appellate, trial...)
        -> clickable court list -> court page
```
- The path at the top shows each step and can be clicked.
- Each court row shows a small line with its number of judges, MDLs and tracked cases, where the data exists.
- Court pages get a "Back to <state> courts" link. The state map pages get a "Courts in this state" folder.
- The current flat directory stays reachable as "All courts (list)".

## Judges
```text
Judges
  Federal | State
    -> court type -> state -> court
      -> judge list (portrait, name) -> judge page
  A–Z by surname (alternate entry)
```
- Judge pages link back to their court folder.
- In the case catalog and on MDL pages, judge names open the judge page when there is exactly one name match. Otherwise they open the A–Z letter, never a guessed person.

## Technical details
- The first step reads the court and judge listings and confirms which fields carry system, court type, state and court id (the sampled court record shows "Court type: Federal district (FD)", "System: Federal", "State: CA"). Grouping uses only those fields; missing values go to "Not recorded".
- A pure `courtTree.ts`/`judgeTree.ts` builds folder counts from the listing rows, with tests. This uses bounded paging through `corpus_query_bounded`, cached. Where a listing is too large to load whole, counts come from filtered count queries instead.
- Routes use search params on `/courts` and `/judges` (`system`, `type`, `state`, `court`), so every folder level has a shareable URL. A `view=list` param shows the old flat browser.
- Judge-name matching uses the existing `nameKey` with an exact match against the judge listing, with a test.
- Then typecheck, tests, build, and a browser walk: Courts → Federal → District → Texas → N.D. Texas page, and Judges → Federal → court → judge page.

## Limits
If the judge listing has no court field for some judges, they appear under "Court not recorded" rather than being placed by guess.
