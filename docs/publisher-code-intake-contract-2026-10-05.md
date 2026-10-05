# Private publisher-code intake — October 5, 2026

The dedicated Texas intake contract is prepared and tested locally. **It is not deployed, and no new Storage objects, database records or public calculator rules were created by this work.** The reviewed packet remains `full-state-codes/tx/private-intake-v3`, manifest SHA-256 `87b76b96ba6ce3130167193a474f992307c0856cc9a162f2848aeb8ed711a5da`. Older packets remain superseded.

## Contract and boundaries

`database/contracts/corpus-publisher-code-intake-v1.sql` is additive preparation, requiring the existing `corpus-ingest-v1` and `canonical-integer-jsonb-v1` contracts plus Supabase's Storage catalog. It creates four private, RLS-enabled packet/object/receipt tables and two service-role-only `public` RPCs with `SECURITY DEFINER` and an empty search path. Anonymous and authenticated clients cannot execute them or read the private tables. The service role has no direct write grant on the new tables.

The run must explicitly identify this contract, Texas, the exact packet-manifest hash, and private-only scope with publication/calculator activation disabled. Registration binds the ordered batch list and asset plan to that hash. Each content-addressed asset must have a whole-object authenticated readback receipt consistent with its hash and length and an existing object in the private `corpus-originals` bucket. Objects are keyed by bytes; multiple chapter/source references remain distinct.

SQL checks receipt consistency and catalog metadata; **it cannot independently hash remote Storage bytes**. The eventual uploader must perform an authenticated complete-object GET, compute SHA-256 from that response, and preserve the real receipt. An asset plan, successful upload status, partial-range checksum or this local simulation is not a readback receipt.

Intake checks exact canonical batch hashes, byte lengths, order and replay identity; chapter/archive/member/derivative bindings; native citation and occurrence composites; source URLs and retrieval evidence; existing parent versions; and all private-only flags. The base writer retains payload versions and observations and preserves quarantine/review status. A run-local batch lock serializes intake and avoids duplicate observations on retry. There are no public collection, law projection or calculator writes.

The packet preparer and independent parser audit establish the Unicode section spans against actual chapter text. SQL enforces the bound packet and a coarse span bound against the parent's byte length; it does not reparse chapter text or independently establish section hash correctness, current law, accrual, repose or tolling. Publisher edition and historical applicability still require review before publication or rule activation.

## Verification

Eight isolated PostgreSQL tests pass: access controls, replay, source-file binding, changed batches, ordering, closed runs, private gates, quarantine/version preservation, and invalid parent/span rejection. They run with PGlite 0.5.8, installed only under ignored `private/tools/publisher-code-contract-tests`, leaving application dependencies unchanged. No network or credentials are used by these tests.

The full reviewed Texas packet also passed an isolated PostgreSQL simulation from 17:03:27Z to 17:05:12Z:

| Checked item | Result |
|---|---:|
| Local asset files rehashed | 5,023 / 165,260,936 bytes |
| Reviewed batches accepted in order | 254 |
| Chapter records | 4,993 |
| Section occurrences | 121,902 |
| Retained source versions / observations | 126,895 each |
| Public data tables created | 0 |

The simulation used a **local Storage test double**. It proves contract acceptance and count reconciliation, not a cloud upload, deployed RPC or production readback. Its output is ignored under `private/audit-2026-10-05/full-state-codes/tx/sql-simulation-v1/`; its contract hash is `dee7770b812244f42db7fd16622789be2a540ca8a4e0124dd20096bb41dfce95`. Do not use its test database or test-only receipts for production intake.

Reproduction:

```powershell
node --test scripts/legal/state-codes/publisher-code-intake.test.mjs
node scripts/legal/state-codes/simulate-publisher-code-intake.mjs private/audit-2026-10-05/full-state-codes/tx/private-intake-v3 private/audit-2026-10-05/full-state-codes/tx/NEW-SIMULATION-DIRECTORY 87b76b96ba6ce3130167193a474f992307c0856cc9a162f2848aeb8ed711a5da
```

## Deployment work remaining

Use only project `xosqzzsnhxcyehcnirpa`. Recheck available Supabase plugin capabilities; this turn's tool catalog exposed no Supabase or Lovable callable methods, despite the owner's connected status. Do not repeat browser sign-in requests. Before an eventual deployment, compare the live dependency definitions and grants, retain the schema before-image, and apply this additive contract only once. It is deliberately not a migration that silently replaces unknown live objects.

Prepare the actual uploader with immutable receipts and verified-byte reuse, establish the real private run, register verified objects, and import the exact ordered packet. Reconcile run counts, source dates, source-version preservation and untouched holds afterward. Application full-text access and independent publication/currentness review remain separate work. Open US Law and the legal graph remain held; the deleted peripheral collections stay deleted.
