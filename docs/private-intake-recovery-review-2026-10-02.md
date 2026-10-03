# Independent private intake recovery review

The revised status RPC and bounded worker recovery have no remaining blocking review findings. This review made no database or real network calls, used no actual credentials and did not change the live intake receipt. The administering session must still activate the status RPC and perform the actual persisted-row proof before resuming an existing unknown outcome.

The status function is read-only, `STABLE`, `SECURITY INVOKER`, uses an empty `search_path`, and returns only expected, matched and conflicting row counts. Fixed mode dispatch binds the source namespace to the run and every requested row. Execution is revoked from `PUBLIC`, `anon` and `authenticated`, and granted only to `service_role`. Three SQL statements and the PL/pgSQL body parsed successfully.

A match requires the retained version's schema, complete payload and storage checksum to agree, plus the exact same-run observation identity and complete provenance. HTTP observations also compare source hash, typed source date and retrieval timestamp. Local observations compare file identity/hash/ordinal, original-row hash, typed snapshot date and local read timestamp. A same-key version or occurrence contradiction is counted as a conflict, including storage checksum drift. This closes the initial review finding where incompatible retained evidence could have been mistaken for a zero-match absence.

Recovery is attempted only after a mutation fetch fails before any HTTP status was received. A complete, conflict-free proof acknowledges the write without replay. A zero-match, conflict-free proof permits the identical frozen body to be replayed at most twice. Partial matches, conflicts, failed or malformed audits, HTTP rejection, response JSON failure after a status, and aggregate count contradictions stop the queue. Original provenance is never regenerated.

Thirteen isolated CLI scenarios passed using endpoint-aware mocked `fetch` and synthetic credentials:

- Complete proof acknowledges the first unknown mutation without replay.
- Zero proof replays the exact frozen body, and zero followed by complete proof acknowledges a later uncertain attempt.
- Two retries exhaust the retry budget and stop before another job.
- Partial matches, conflicts and wrong expected counts stop before replay.
- Audit HTTP/JSON failures stop before replay.
- Mutation HTTP, response JSON, received-count and local publisher-count failures are never audited or retried.

Every mocked proof and replay request retained the identical body checksum. Synthetic secret/payload canaries appeared in neither console output nor receipts. Real network and database calls remained zero.

| Reviewed artifact | SHA-256                                                            |
| ----------------- | ------------------------------------------------------------------ |
| Status RPC        | `915c14c8e3bc94cd1d3e67f223381fa86850ac7cee127b6c35d1354bacfa2793` |
| Recovery worker   | `92414b4a80c53562de1da3d9ef813c29c56a31a94c635dc920f1124b981f441c` |

The detailed failure-case receipt remains private. Recovery acknowledgement does not replace final independent counts, payload/provenance signatures, source qualification review or public publication checks.
