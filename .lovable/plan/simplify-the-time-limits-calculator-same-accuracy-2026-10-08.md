# Simplify the Time Limits calculator (same accuracy)

## Goal
Fewer screens, fewer repeated boxes and fewer clicks. The rules, the date math and the safety checks stay exactly as they are. No result is shown unless every required confirmation and date is still given.

## What repeats today
- The rule summary (period, repose, scope) appears in step 1 and again in step 2.
- The claim-subtype dropdown appears in both step 1 and step 2.
- The "No unique baseline — no date will be calculated" warning appears twice.
- Confirmations are split up: one repose checkbox on its own, three more under "Confirm the legal framework", then a separate exceptions dropdown plus issue checkboxes.
- The three-step bar and Back/Next buttons make you move between screens to fix anything.

## New flow: one page, three sections that open in order

```text
[1 Claim]    State · Claim type · Subtype      -> one rule summary card (shown once)
[2 Dates]    Only the date fields this rule needs (with short help)
[3 Confirm]  One checklist: governing law, accrual, applicability,
             repose (only if the rule has repose), exceptions/tolling
             -> Calculate
[Result]     Deadline first, then steps, assumptions, sources
```

- Sections stay on one page. A finished section folds into a one-line summary with "Edit". No Back/Next buttons.
- The rule summary card appears once, under the claim choice, and stays pinned beside the dates and checklist on desktop.
- The subtype dropdown appears only once, in section 1.
- If no unique rule exists, section 1 shows one warning with a link to Sources, and sections 2 and 3 stay locked.
- The date fields are the ones the rule already asks for. Fields the rule doesn't use are hidden, as they are today.
- Confirmations become one checklist with plain wording. The rule's conditions and exclusions open under the applicability item. The repose item appears only when the rule has repose.
- Exceptions: one question ("Any tolling or exception facts?" No / Yes / Not sure). Answering Yes shows the issue checkboxes. Not sure keeps today's result: no confident date.
- "Calculate" stays disabled until everything required is filled in. A short note names the missing items and clicking one jumps to it, replacing today's focus-on-error behavior.
- Changing the state, claim or subtype clears the dates and confirmations below it, exactly as it does now.

## What does not change
- The calculation engine, rule bundle, validation, citations, rule evidence, coverage table, Sources tab and exports.
- Every required confirmation. They are merged into one list, not removed.
- Honest outcomes: "Period requires legal review" and no date when the rule isn't unique or the exception answer is unresolved.

## Technical details
- Rework only `LimitationsWorkbench.tsx`: replace the `step` state with section-completion values derived from `input` and `rule`; pull out `RuleSummaryCard`, `DateFields`, `ConfirmChecklist` and `MissingItems` subcomponents; delete the duplicate subtype select, the duplicate summary and the duplicate warning.
- Map the exception question onto the existing `exceptionReview` values. No new input fields go to the engine.
- Add a pure helper `missingRequirements(input, rule)` in `calculatorGuidance.ts`, built from the same conditions that gate the Calculate button today, with unit tests showing it matches today's gating for repose, non-repose, death-limb and discovery rules.
- Keep the engine, validation and bundle tests unchanged. They must all still pass.
- In the browser, check one standard rule, one rule with repose, one state with no unique rule, and the "Not sure" exceptions path, on desktop and mobile.
