"""Precision check of the extractor on a random sample of stored page text (documents/1).

Input: JSONL of pages or page windows, one JSON array per line: [sha256 or its first 16 hex, page, offset, text], where
`offset` is the code-point position of `text` in the stored page (0 for a whole page). Windows start right after a space
and end at a space, so an extraction inside a window is the extraction of the whole page at that place; rows that touch
the last two characters of a window are not sampled.

Output (in --out): extractions.jsonl.gz (absolute offsets), sample.json (up to --per-kind random rows per kind, seeded),
verify_offsets.sql (one read-only query: is the stored page's text at each sampled [start, end) exactly the matched
text?), verify_links.sql (one read-only query: exact resolution of the sampled linkable keys, as documents_resolve_v1 does,
with a check of each resolved key against the target record). Run the two queries read-only and record their results.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from extract import KINDS, extract_page  # noqa: E402


def windows(paths: list[Path]):
    seen = set()
    for path in paths:
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            sha, page, offset, text = json.loads(line)
            key = (sha[:16], int(page), int(offset))
            if key in seen:
                continue
            seen.add(key)
            yield sha[:16], int(page), int(offset), text


def rows_from_windows(items) -> list[dict]:
    out, seen = [], set()
    for sha, page, offset, text in items:
        for r in extract_page(text):
            if r["end"] > len(text) - 2:
                continue
            row = {**r, "sha16": sha, "page": page, "start": r["start"] + offset, "end": r["end"] + offset}
            v = row.get("value")
            if isinstance(v, dict) and "sentence_start" in v:
                v = {**v, "sentence_start": v["sentence_start"] + offset, "sentence_end": v["sentence_end"] + offset}
                row["value"] = v
            ident = (sha, page, row["start"], row["kind"])
            if ident not in seen:
                seen.add(ident)
                out.append(row)
    return out


def sql_literal(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


def offsets_sql(sample: list[dict]) -> str:
    values = ",\n".join(
        f"({sql_literal(r['sha16'])},{r['page']},{r['start']},{r['end'] - r['start']},{sql_literal(r['kind'])},"
        f"{sql_literal(hashlib.md5(r['matched'].encode('utf-8')).hexdigest()[:10])})"
        for r in sample
    )
    # The sha256 prefix is matched as a key range ([prefix, prefix || 'g')) so the primary key index serves each lookup.
    hit = "p.sha256 >= s.sha16 and p.sha256 < s.sha16 || 'g' and left(p.sha256, 16) = s.sha16 and p.page = s.page"
    return (
        "with s(sha16, page, st, len, kind, md5) as (values\n" + values + "),\n"
        f"m as (select s.*, (select count(*) from corpus_ingest.pdf_text_pages p where {hit}) n,\n"
        "  (select bool_or(left(md5(substr(p.text, s.st + 1, s.len)), 10) = s.md5) from corpus_ingest.pdf_text_pages p\n"
        f"    where {hit}) ok from s)\n"
        "select kind, count(*) checked, count(*) filter (where ok and n = 1) exact, count(*) filter (where not coalesce(ok, false)) mismatched,\n"
        "  count(*) filter (where n <> 1) ambiguous_page,\n"
        "  jsonb_agg(jsonb_build_array(sha16, page, st)) filter (where not coalesce(ok, false) or n <> 1) failures\n"
        "from m group by kind order by kind"
    )


def links_sql(keys: list[tuple[str, str]]) -> str:
    values = ",\n".join(f"({sql_literal(k)},{sql_literal(key)})" for k, key in keys)
    return (
        "with s(kind, key) as (values\n" + values + "),\n"
        "k as (select s.*, string_to_array(s.key, ':') a from s),\n"
        "r as (select k.kind, k.key,\n"
        "  case when k.kind = 'usc' and cardinality(k.a) = 3 then (select jsonb_build_object('target', 'usc:' || x.id, 'title', left(x.title, 90),\n"
        "         'check', x.title like k.a[2] || ' U.S.C. § ' || k.a[3] || ' %' or x.title = k.a[2] || ' U.S.C. § ' || k.a[3])\n"
        "         from public.corpus_records x where x.dataset = 'us_code_sections' and x.id = k.a[2] || ':' || k.a[3])\n"
        "       when k.kind = 'cfr' and cardinality(k.a) = 3 then (select jsonb_build_object('target', x.id, 'title', left(x.title, 90),\n"
        "         'check', x.id = 'cfr:' || k.a[2] || ':' || split_part(k.a[3], '.', 1))\n"
        "         from public.corpus_records x where x.dataset = 'federal_regulations_parts' and x.id = 'cfr:' || k.a[2] || ':' || split_part(k.a[3], '.', 1))\n"
        "       when k.kind = 'case_citation' then (select case when count(*) = 1 then jsonb_build_object('target', 'caselaw/' || min(c.cluster_id),\n"
        "         'title', left(min(c.case_name), 90), 'cites', min(array_to_string(c.citations, '; ')),\n"
        "         'check', bool_and(caselaw.cite_key(substr(k.key, 6)) = any(c.cite_keys))) when count(*) > 1 then jsonb_build_object('ambiguous', count(*)) end\n"
        "         from (select * from caselaw.cases c where c.cite_keys @> array[caselaw.cite_key(substr(k.key, 6))] limit 3) c)\n"
        "       when k.kind = 'mdl_number' then (select jsonb_build_object('target', x.id, 'title', left(x.title, 90), 'check', x.id = substr(k.key, 5))\n"
        "         from public.corpus_records x where x.dataset = 'mdls' and x.id = substr(k.key, 5)) end v from k)\n"
        "select kind, count(*) keys, count(v) filter (where v ? 'target') resolved, count(v) filter (where v ? 'ambiguous') ambiguous,\n"
        "  count(*) filter (where v ? 'target' and (v ->> 'check')::boolean) checked_ok,\n"
        "  jsonb_agg(jsonb_build_array(key, v) order by key) filter (where v ? 'target') detail\n"
        "from r group by kind order by kind"
    )


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("windows", nargs="+")
    ap.add_argument("--out", required=True)
    ap.add_argument("--per-kind", type=int, default=100)
    ap.add_argument("--links", type=int, default=50)
    ap.add_argument("--seed", default="documents-precision-1")
    a = ap.parse_args(argv)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    rows = rows_from_windows(windows([Path(p) for p in a.windows]))
    with gzip.open(out / "extractions.jsonl.gz", "wt", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n")
    rng = random.Random(a.seed)
    sample = []
    counts = {}
    for kind in KINDS:
        pool = [r for r in rows if r["kind"] == kind]
        counts[kind] = len(pool)
        sample += rng.sample(pool, min(a.per_kind, len(pool)))
    linkable = sorted({(r["kind"], r["key"]) for r in rows if r["kind"] in ("usc", "cfr", "case_citation", "mdl_number") and r["key"]})
    (out / "sample.json").write_text(json.dumps({"rows_by_kind": counts, "sample": sample}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    (out / "verify_offsets.sql").write_text(offsets_sql(sample) + "\n", encoding="utf-8")
    (out / "verify_links.sql").write_text(links_sql(linkable) + "\n", encoding="utf-8")
    print(json.dumps({"rows": len(rows), "rows_by_kind": counts, "sampled": len(sample), "linkable_keys": len(linkable)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
