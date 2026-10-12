# Application production release — October 12, 2026

The owner explicitly authorized finishing and publishing the application. The target is the existing [Legal Source Compass Lovable project](https://lovable.dev/projects/0eaa0e9a-7dcd-41f1-a5ef-3a5305288c1c), published at [firastest1.com](https://firastest1.com). PR #231 contains application fixes and eight changed protected snapshot entries. No database schema migration, graph approval, held collection release, removed collection acquisition, or authentication-policy change is part of this release.

## Release scope and safeguards

The source-backed intake, court resources, artwork identity, agency navigation and search fixes are described in [the enrichment report](open-source-enrichment-2026-10-12.md). A final production review found that withheld assessments could retain a computed baseline inside their detail/export structures. The assessment boundary now clears computed dates, weekend candidates, arithmetic steps and partial scenario results whenever it withholds the assessment; computed deadline strings are also removed from rejection reasons. Source references, rule identity, user inputs and review reasons remain available. Supported conditional calculations retain their evidence trail.

The limitations release remains `2026-10-12.1`: 889 rules and 1,030 sources, with the prior 888 rules and 1,028 sources unchanged. Its 612 general cells include 539 baselines, 59 flagged cells, one research-only cell and 13 unrecorded cells. The added Mississippi judicial evidence enables no calculation, and flagged New Jersey counting evidence enables no automatic weekend extension. This release does not claim comprehensive legal coverage or a verified final filing deadline for every case.

## Independent live corpus readiness

A transaction explicitly marked read-only completed at database time `2026-10-12T18:55:41.889295+00:00`:

- 946,404 staged candidates reconcile to 3,804 retained rejected candidates and 942,600 records: 942,592 pending and eight approved.
- All eight approved records exactly match retained staging and have no retained or current schema errors.
- Two visible edges expose no unapproved records, invalid records, low-confidence LLM relationships or invalid source evidence.
- All 13 legal tables have RLS enabled and deny browser-role SELECT. All eight public legal RPCs deny execution to `anon` and `authenticated` and retain empty search paths.
- The deployment baseline remains absent. The existing 50-record FJC source audit is retained; global entity/source completion audits remain incomplete.

The separate staged-graph gate therefore remains blocked. The existing [October 3](corpus-require-auth-switch-2026-10-03.md) and [October 5](corpus-accuracy-progress-2026-10-05.md) release decisions distinguish that graph from application and protected-snapshot publication. No baseline is established simply to turn the gate green, and no held records are promoted.

The exact executed query, rendered SQL result and parsed evidence are retained under ignored `private/production-release-2026-10-12/readiness-executed.sql`, `readiness-ui.txt` and `readiness.json`. The audit verifies structural controls and release scope; it does not certify the current legal meaning of every retained source.

## Publication and verification

Before publication, production still serves limitations `2026-10-08.8`; its rules and source hashes match the pre-release `main` manifest. The new court-resource snapshot returns 404. All eight changed candidate objects have passed fresh private-storage whole-body SHA-256 and length checks. The release uses a merge commit, preserves Lovable history, and publishes only after the final candidate passes CI and the connected preview is checked.

Final local verification passed 1,009 portable application tests across 107 files, 228 Node contracts, 20 Python tests, five artwork hashes, TypeScript and the production build. The private candidate passed 821 limitations tests. Independent review checked the withholding boundary, rejection messages and valid-result preservation.

Publication is pending. Final commit, live bundle readback and browser evidence will be recorded here after deployment.

## Recovery

The pre-release `main` is `4c455ef0a0c70ee55a71cccc469d5bca4193213b`. Recovery uses a forward revert of the release merge followed by Lovable synchronization and republishing; it does not rewrite history. The previous manifest is preserved privately as `rollback-manifest.json`, along with the original staging/activation receipts. Content-addressed source objects remain retained. Abort or recover on a wrong bundle hash/version, a critical route failure, a withheld deadline appearing, or a private-data boundary failure.
