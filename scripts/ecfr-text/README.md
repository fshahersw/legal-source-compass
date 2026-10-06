# Official eCFR section text (`ecfr-section-text/1`)

Replaces the unverified `open_us_law` CFR text with official eCFR text and repoints the dependents, as a versioned,
ledgered, reversible `corpus_ingest` run. Contract: `database/contracts/ecfr-section-text-v1.sql` (+ `-setup-v1.sql`).
Credentials are read only from `EXTERNAL_SUPABASE_URL` / `EXTERNAL_SUPABASE_SERVICE_ROLE_KEY`; nothing secret is stored or printed.
`--work` is a scratch directory outside the repository (raw responses are large).

| Step | Command | Writes |
| --- | --- | --- |
| 1. read-only census | `census.py --work W` | `W/census.json`, `W/targets.json` (nothing remote) |
| 2. acquire | `acquire.py --work W` | one `GET /api/versioner/v1/full/<date>/title-T.xml?part=P` per cited part, sequential, `W/raw`, `acquisition.json` (resumable, checksum re-verified) |
| 3. build | `build_packets.py --work W` | `W/packets` (entities, batches, per-target resolution) |
| 4. retain raw | `ecfr_text.py --work W upload-raw` | private bucket `corpus-originals`, `ecfr-text/sha256/<2>/<sha256>.xml`, whole-object hash readback |
| 5. intake | `ecfr_text.py --work W intake` then `verify` | `corpus_ecfr_text_intake_v1`; checkpointed per batch hash |
| 6. project | `ecfr_text.py --work W publish` then `finalize` | dataset `ecfr_section_text` (ready only after full-field verification) |
| 7. repoint | `plan`, `apply --dry`, `apply` (`rollback` reverses) | ledgered, md5-guarded updates of `federal_regulations_sections` and CFR `citation_index` links |
| 8. re-check | `recheck [--deep] [--dataset D]` | read only: remaining `oul:` links |

`rehearse_sql.py` replays steps 5-7 plus rollback on a scratch local PostgreSQL (never the live project) and asserts the rolled-back rows are
md5-identical to the originals. `python3 scripts/ecfr-text/test_ecfr_text.py` runs the unit tests.
