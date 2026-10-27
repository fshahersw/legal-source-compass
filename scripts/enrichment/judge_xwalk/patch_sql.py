"""Shared pieces of the judge-link patch contracts (SQL text only; nothing here connects to a database).

A patch contract updates rows of public.corpus_records in place, the way the round-3 data-quality contracts do:
  statement 0  registers the run in corpus_ingest.runs (idempotent);
  statement 1  writes one audit row per target into corpus_ingest.cleanup_decisions with the whole before-image (item, detail,
               filters, row md5) and the replacement, but only when the live row still has the md5 the packet was built from;
  statement 2  applies the replacement from the audit rows, again guarded by the md5;
  statement 3  (optional) records the change in corpus_datasets.metadata.
Rollback restores item, detail and filters (and any text columns the contract names, e.g. title and text) from the audit rows. Values come only from a packet built offline from snapshots.
"""
import uuid

NAMESPACE = uuid.UUID("6f1f3c3e-2b9e-4c55-9a43-6a1f6f0d2a71")


def run_id(name):
    """A stable run id for a named contract (uuid5), so re-running a statement is idempotent."""
    return str(uuid.uuid5(NAMESPACE, name))


def lit(value):
    """SQL literal for None, bool, int or str (single quotes doubled)."""
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def values(rows, width=None):
    """'(a, b, c),\n  (...)' for a VALUES list; every row must have the same number of columns."""
    if not rows:
        raise ValueError("a patch needs at least one row")
    n = width or len(rows[0])
    out = []
    for r in rows:
        if len(r) != n:
            raise ValueError("rows of a VALUES list must have the same width")
        out.append("(" + ", ".join(lit(v) for v in r) + ")")
    return ",\n    ".join(out)


def run_statement(rid, contract, scope, counts):
    import json
    return (f"insert into corpus_ingest.runs (id, contract_version, status, scope, counts, finished_at)\n"
            f"values ('{rid}'::uuid, {lit(contract)}, 'completed', {lit(json.dumps(scope, sort_keys=True))}::jsonb, {lit(json.dumps(counts, sort_keys=True))}::jsonb, now())\n"
            f"on conflict (id) do nothing;\n")


def _scalar_sets(scalars, source):
    """', title = c.<source>->>'title', ...' for text columns the patch also rewrites (each audit row carries them)."""
    return "".join(f", {col} = c.{source}->>{lit(col)}" for col in scalars)


def apply_statement(dataset, issue, rid, scalars=()):
    return f"""with u as (
 update public.corpus_records r
    set item = c.replacement->'item', detail = c.replacement->'detail', filters = c.replacement->'filters'{_scalar_sets(scalars, 'replacement')}
   from corpus_ingest.cleanup_decisions c
  where c.dataset = {lit(dataset)} and c.issue = {lit(issue)} and c.run_id = '{rid}'::uuid
    and r.dataset = {lit(dataset)} and r.id = c.record_id and md5(to_jsonb(r)::text) = c.original_record->>'row_md5'
 returning r.id)
select count(*) as updated from u;
"""


def rollback_text(dataset, issue, rid, scalars=()):
    return (f"--   update public.corpus_records r set item = c.original_record->'item', detail = c.original_record->'detail', filters = c.original_record->'filters'"
            f"{_scalar_sets(scalars, 'original_record')}\n"
            f"--     from corpus_ingest.cleanup_decisions c\n"
            f"--    where c.dataset = {lit(dataset)} and c.issue = {lit(issue)} and c.run_id = '{rid}'::uuid and r.dataset = {lit(dataset)} and r.id = c.record_id;\n")
