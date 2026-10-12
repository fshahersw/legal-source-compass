# Verification

Install Node.js 22, Bun 1.4.0, and Python 3.10+ (CI uses 3.12), then run:

```sh
bun install --frozen-lockfile
python -m pip install -r scripts/test/requirements.txt
npm run verify
```

`PYTHON` may name an explicit Python executable. Otherwise the Python checks discover `python3`, `python`, or the Windows `py -3` launcher. Capture-text regressions import the capture renderer without making requests; `test:python` runs synthetic court-resource and law-ID contracts, including the pinned identifier conformance cases.

`verify` runs TypeScript, portable Vitest tests, selected offline Node and Python contracts, local court-artwork hash checks, and the production build. The GitHub workflow runs it on Linux and Windows without corpus credentials or downloaded legal data. Synthetic inputs exist only in tests; this does not authorize publishing them.

## Protected snapshot integration checks

```sh
npm run test:private
```

This separate suite retains the assertions against real protected snapshots. Missing files are failures, never skips. Its explicit file list is `scripts/test/private-vitest-files.ts`; mixed research and court-location suites keep their pure checks in portable CI and their source reconciliation checks in `.private.test.ts` files.

Use an already authorized, hash-verified local `private/data` snapshot. Limitations-only checks may use `LIM_BUNDLE_DIR` to select a staged bundle and a file filter, for example `npm run test:private -- src/lib/limitations/bundle-invariants.test.ts`. No verification command downloads fixtures, accesses the live corpus, or recreates removed collections. Some historic snapshot checks have recorded release-specific counts; a passing portable build does not establish that those private release checks passed.

The optional publisher SQL contract suites (`npm run test:sql`) need the pinned PGlite runtime documented in those files. Install it with `npm install --prefix private/tools/publisher-code-contract-tests --save-exact --ignore-scripts @electric-sql/pglite@0.5.8`, or set `PUBLISHER_CODE_PGLITE` to an existing runtime. These use an isolated in-memory database, not the live corpus; they are not replaced by the portable transport/parser checks. Other legacy administrative tests may require their own exact retained private evidence and should be run only with those fixtures available.

Production legal-data approval still requires the existing source/contract release gates and protected snapshot checks. `verify` is an application quality check, not approval to activate data or deploy.

`legal:gate` invokes an administrative corpus validation RPC that scans staged candidates and records a quality report. It is not a read-only status query. Its transport allows six 60-second attempts plus retry delays, so a shorter outer process timeout can end without a result; record that as unconfirmed. Use the service-role-only `corpus_legal_quality_v3` read API to inspect an existing report without rerunning validation, and preserve its timestamp. A historical report cannot establish a fresh deployment pass, and a missing reviewed baseline must not be replaced with an unreviewed baseline simply to pass the gate.
