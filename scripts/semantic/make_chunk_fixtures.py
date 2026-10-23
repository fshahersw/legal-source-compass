"""Golden fixtures for the TypeScript port of the semantic chunker and source builders.

    python3 -I -B scripts/semantic/make_chunk_fixtures.py collect   # once: sample rows -> src/lib/semantic/fixtures/semantic-rows.json
    python3 -I -B scripts/semantic/make_chunk_fixtures.py build     # Python expectations -> src/lib/semantic/fixtures/chunk-golden.json
    python3 -I -B scripts/semantic/make_chunk_fixtures.py check     # rebuild in memory, compare with the committed golden file

`collect` takes a few real rows per collection, chosen by fixed rules (heading marks, tables, appendix ids with spaces,
reserved and empty sections, capped records, bills with and without summaries, reports with and without descriptions), from
the published build files under private/build/ (the exact rows published to corpus_records) and, for U.S. Code sections and
titles, by read-only REST GETs of corpus_records (EXTERNAL_SUPABASE_URL / EXTERNAL_SUPABASE_KEY in the environment; never
printed). Rows are trimmed to the fields the builders read plus two unrelated fields, so the projection test sees pruning.

`build` runs the Python code (chunking.py, sources.py, refresh_rows.py, numpy float16 + load.vector_text formatting) over the
committed rows and the synthetic documents below and writes every expected output: spans, passages' offsets and hashes, embed
strings' hashes, embed keys, snippets, Doc fields, pruned rows, links, and float16 vector text. The TypeScript test
(src/lib/semantic/chunking.test.ts) must reproduce all of it; test_chunk_parity.py checks the committed file is current.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import random
import struct
import sys
import unicodedata
import urllib.parse
import urllib.request

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import chunking as ck  # noqa: E402
import refresh_rows as rr  # noqa: E402
import sources as src  # noqa: E402
import voyage as vg  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
FIXTURES = os.path.join(ROOT, "src", "lib", "semantic", "fixtures")
ROWS_PATH = os.path.join(FIXTURES, "semantic-rows.json")
GOLDEN_PATH = os.path.join(FIXTURES, "chunk-golden.json")
MARK = ck.MARK


def sha(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------------------------------------- collect
KEEP = {  # builder fields per collection (refresh_rows.SPECS) plus two unrelated ones
    "us_code_sections": {"detail": {"usc": ["title", "key", "citation", "heading", "path", "status", "notes_count"]}, "item": ["subtitle"]},
    "ecfr_sections_full": {"detail": ["reserved", "title_number", "identifier", "subtitle", "ecfr_url", "part", "as_of"], "item": ["subtitle", "id"]},
    "crs_reports": {"detail": {"crs": ["title", "topics", "contentType", "id", "version"]}, "item": {"cells": ["title", "date"]}},
    "congress_bills": {
        "detail": {"bill": ["titles", "display", "subjects", "policyArea", "summary", "type", "number", "congress", "statusLabel", "introduced"]},
        "item": {"cells": ["citation", "status"]},
    },
    "oversight_reports": {"item": {"oversight": ["description", "oig", "agency_reviewed", "type", "date", "report_id"]}},
    "doj_oig_reports": {"item": {"dojoig": ["components", "type", "entity", "location", "description", "date", "number"]}},
    "ftc_publications_index": {"item": ["summary", "page_url", "cells", "id"]},
}


def _trim(spec, value):
    if isinstance(spec, list):
        return {k: value[k] for k in spec if k in value} if isinstance(value, dict) else value
    if isinstance(value, dict):
        return {k: _trim(sub, value[k]) for k, sub in spec.items() if k in value}
    return value


def trim_row(dataset: str, row: dict) -> dict:
    out = {k: row[k] for k in ("dataset", "id", "category", "title", "source_url", "text") if k in row}
    out["dataset"] = dataset
    for top, spec in KEEP[dataset].items():
        if top in row:
            out[top] = _trim(spec, row[top])
    if dataset == "ftc_publications_index" and isinstance(out.get("item", {}).get("cells"), dict):
        out["item"]["cells"] = {k: v for k, v in out["item"]["cells"].items() if k in ("series", "date")}
    return out


def pick_rows(dataset: str, rules: list[tuple[str, callable]]) -> list[dict]:
    """First row (in file order) satisfying each rule; a row is taken once."""
    found: dict[str, dict] = {}
    for row in src._load_rows(src.SOURCE_FILES[dataset]):
        for name, rule in rules:
            if name not in found and rule(row):
                found[name] = row
                break
        if len(found) == len(rules):
            break
    return [{"rule": name, **trim_row(dataset, found[name])} for name, _ in rules if name in found]


def _doc_chunks(builder, row):
    doc = builder(row)
    return ck.chunk_doc(doc) if doc else []


def rest_rows(dataset: str, ids: list[str] | None = None, select: str = "id,title,source_url,text,detail,item") -> list[dict]:
    url = os.environ.get("EXTERNAL_SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("EXTERNAL_SUPABASE_KEY", "")
    if not url or not key:
        raise SystemExit("EXTERNAL_SUPABASE_URL / EXTERNAL_SUPABASE_KEY are needed for the U.S. Code rows")
    q = f"{url}/rest/v1/corpus_records?select={select},ordinal&dataset=eq.{dataset}&order=ordinal.asc"
    if ids:
        q += "&id=in." + urllib.parse.quote("(" + ",".join(f'"{i}"' for i in ids) + ")")
    headers = {"apikey": key, "Accept": "application/json"}
    if not key.startswith("sb_"):
        headers["Authorization"] = "Bearer " + key
    with urllib.request.urlopen(urllib.request.Request(q, headers=headers), timeout=120) as r:
        rows = json.load(r)
    for row in rows:
        row["dataset"] = dataset
    return rows


def collect() -> dict:
    ecfr = pick_rows("ecfr_sections_full", [
        ("first", lambda r: True),
        ("appendix_space_id", lambda r: " " in r["id"] and 800 < len(r.get("text") or "") < 6000),
        ("table_tabs", lambda r: (r.get("text") or "").count("\t") > 200 and len(r["text"]) < 12000),
        ("reserved", lambda r: (r.get("detail") or {}).get("reserved") is True),
        ("multi_chunk", lambda r: 9000 < len(r.get("text") or "") < 12000 and "(a)" in r["text"]),
        ("capped", lambda r: 100000 < len(r.get("text") or "") < 140000
            and len(_doc_chunks(src.cfr_doc, r)) == 60 and _doc_chunks(src.cfr_doc, r)[0].chunk_total > 60),
        ("no_item_subtitle", lambda r: not (r.get("item") or {}).get("subtitle") and (r.get("text") or "").strip() != ""),
    ])
    bills = pick_rows("congress_bills", [
        ("first", lambda r: True),
        ("no_summary", lambda r: not ((r.get("detail") or {}).get("bill") or {}).get("summary")),
        ("li_blocks", lambda r: any(b.get("k") == "li" for b in ((((r.get("detail") or {}).get("bill") or {}).get("summary") or {}).get("blocks") or []))
            and len(json.dumps(r["detail"]["bill"]["summary"])) < 6000),
        ("two_official", lambda r: len((((r.get("detail") or {}).get("bill") or {}).get("titles") or {}).get("official") or []) >= 3
            and len(json.dumps(r["detail"]["bill"].get("summary"))) < 4000),
        ("capped", lambda r: 17000 < len(json.dumps((((r.get("detail") or {}).get("bill") or {}).get("summary")))) < 30000
            and (lambda c: bool(c) and c[0].chunk_total > len(c))(_doc_chunks(src.bill_doc, r))),
    ])
    crs = pick_rows("crs_reports", [
        ("first", lambda r: True),
        ("no_topics", lambda r: not ((r.get("detail") or {}).get("crs") or {}).get("topics")),
        ("many_topics", lambda r: len(((r.get("detail") or {}).get("crs") or {}).get("topics") or []) >= 4),
    ])
    oversight = pick_rows("oversight_reports", [
        ("first", lambda r: True),
        ("no_description", lambda r: not ((r.get("item") or {}).get("oversight") or {}).get("description")),
        ("long_description", lambda r: len(((r.get("item") or {}).get("oversight") or {}).get("description") or "") > 3500),
    ])
    doj = pick_rows("doj_oig_reports", [
        ("first", lambda r: True),
        ("components", lambda r: len(((r.get("item") or {}).get("dojoig") or {}).get("components") or []) >= 2),
        ("location", lambda r: bool(((r.get("item") or {}).get("dojoig") or {}).get("location"))),
    ])
    ftc = pick_rows("ftc_publications_index", [
        ("first", lambda r: True),
        ("no_summary", lambda r: not (r.get("item") or {}).get("summary")),
        ("page_url", lambda r: bool((r.get("item") or {}).get("page_url")) and (r.get("item") or {}).get("page_url") != r.get("source_url")),
    ])
    usc_ids = ["15:78u-6", "42:1983", "5:551", "11a:ptI_rule1003", "10:1036"]
    usc = [{"rule": "live", **trim_row("us_code_sections", r)} for r in rest_rows("us_code_sections", usc_ids)]
    titles = []
    for r in rest_rows("us_code_titles", select="id,detail"):
        ut = (r.get("detail") or {}).get("usc_title") or {}
        titles.append({"dataset": "us_code_titles", "id": r["id"], "ordinal": r["ordinal"],
                       "detail": {"usc_title": {k: ut[k] for k in ("number", "name", "label") if k in ut}}})
    return {
        "note": "Sample corpus_records rows (trimmed to the fields the semantic builders read plus two unrelated ones), from the "
                "published build files and read-only corpus reads; inputs of chunk-golden.json. Public U.S. government records.",
        "rows": [*usc, *ecfr, *bills, *crs, *oversight, *doj, *ftc],
        "us_code_titles": titles,
    }


# ------------------------------------------------------------------------------------------------------ synthetic docs
def statute(n_subsections: int, words: int = 120) -> str:
    out = []
    for i in range(n_subsections):
        letter = chr(ord("a") + i)
        out.append(f"{MARK}({letter}) Subsection {i}")
        out.append("\t" + " ".join(f"The covered person shall comply with requirement {i}-{w}." for w in range(words // 8)))
        for p in range(1, 3):
            out.append(f"\t{MARK}({p}) Paragraph {p}")
            out.append("\t\t" + " ".join(f"Each filing under paragraph {p} must be made within {w} days." for w in range(words // 10)))
    return "\n".join(out)


def regulation(n: int) -> str:
    return "\n".join(
        f"({chr(ord('a') + i)}) Heading {i}. " + " ".join(f"Sentence {i}.{s} sets out what the operator must record." for s in range(40))
        for i in range(n)
    )


def synthetic_docs() -> list[dict]:
    rnd = random.Random(20261025)
    words = ["shall", "the", "operator", "record", "§", "Secretary", "“notice”", "(i)", "1.5", "U.S.C.", "and/or", "—", "data"]
    table = "\n".join("\t".join(f"{rnd.choice(words)}{rnd.randint(0, 999)}" for _ in range(9)) for _ in range(120))
    unicode_mix = (
        "(a) The term “𝑥-factor” means the value 𝑥 ∈ ℝ, see 𝟏 and 🏛 continued. "
        + "Next sentence follows. " * 60
        + "\n(١) Arabic-Indic paragraph marker line.\n(𝟏) Mathematical bold digit marker line.\n(B) Upper.\n"
        + ("Text with\x1cfile\x1dgroup\x1frecord separators and\x85next-line and　ideographic nbsp. " * 40)
        + "﻿BOM inside﻿"
    )
    docs = [
        ("statute_marked", "Title 15 Commerce and Trade > CHAPTER 2B— SECURITIES EXCHANGES > 15 U.S.C. § 78u–6 Whistleblowers", statute(6), 60),
        ("regulation_paragraphs", "Code of Federal Regulations > Title 40 · Chapter I · Part 63 > § 63.1 Applicability.", regulation(9), 60),
        ("table_lines", "Code of Federal Regulations > Table", table, 60),
        ("one_long_token", "Heading", "x" * 7000 + " tail", 60),
        ("whitespace_only", "Heading", " \n\t\x1c　 ", 60),
        ("empty_heading", "", "(a) First. Second sentence here.\n(b) Third? Fourth! (5) Fifth: “Sixth” 7 eight.", 60),
        ("unicode_mix", "Title 𝟓 > “Quoted” heading", unicode_mix, 60),
        ("long_heading", "H" * 2500, regulation(4), 60),
        ("crlf_lines", "Heading", "\r\n".join(f"({chr(97 + i)}) Line {i} " + "words " * 120 for i in range(8)), 60),
        ("levels", "Heading", "\n".join(["(aa) two letters " + "a " * 400, "(AA) two capitals " + "b " * 400, "(123) three digits " + "c " * 400,
                                          "(1234) four digits " + "d " * 400, "(a)no space after", "\t(1) tab digit " + "e " * 400,
                                          "\t\t\t" + MARK + "deep mark " + "f " * 400, "(z)", "(Z)\tTab after"]), 60),
        ("capped_small", "Cap", regulation(5), 3),
        ("snippet_no_spaces", "", "y" * 600, 60),
        ("snippet_punct", "", ("word, " * 46) + "end.", 60),
        ("sentence_quotes", "Q", ("He said: “Stop.” Then; (b) it went. 2 items? Yes! " * 120), 60),
        ("leading_trailing_space", "H", "\n\n   (a) Body text that is short.   \n\n", 60),
    ]
    return [{"name": n, "heading": h, "text": t, "max_chunks": m} for n, h, t, m in docs]


LINE_LEVEL_CASES = [
    "(a) x", "(aa) x", "(aaa) x", "(1) x", "(12) x", "(123) x", "(1234) x", "(A) x", "(AB) x", "(ABC) x", "(a)", "(a)x", "(a)\tx",
    "(a)\x1cx", "(a)\x85x", "(a)　x", "(a)﻿x", "\t(a) x", "\t(1) x", MARK + "(a) x", "\t" + MARK + "x", "\t\t" + MARK + "x",
    "\t\t\t\t" + MARK + "x", "(١) x", "(١٢٣) x", "(𝟏) x", "(𝟏𝟐) x", "(５) x", "plain", "", "\t", "(a) x", "(B)", " (a) x",
]

HREF_CASES = [
    "/law/uscode/15/78u-6", "/law/cfr/2/Appendix A to Part 180", "/records/crs_reports/R12345", "/law/cfr/40/63.1 (a)",
    "/x/a+b:c,d;e=f&g", "/x/already%20encoded", "/x/%E2%80%94dash", "/x/%zz-bad", "/x/§ 1", "/x/[1]", "/x/a%2Fb",
    "/x/%C3", "/x/ünïcödé", "/x/!~*'()", "/cases/12345",
]

ONE_LINE_CASES = [
    "  a  b\tc\nd  ", "x\x1cy\x1dz", "　lead", "trail\x85", "﻿bom﻿", "", "   ", "no-change", "𝑥  𝑦",
]

PY_STR_CASES = [None, True, False, 0, 5, -3, 1.5, 0.0001, 1e-05, 1.5e16, 123456789.25, "text", ["a", 1, None], {"k": "v"}]


def vector_cases() -> dict:
    rng = np.random.default_rng(20261025)
    vals = list(rng.normal(0, 0.03, 1500).astype("<f4"))
    edges = [0.0, -0.0, 1.0, -1.0, 6.103515625e-05, 5.960464477539063e-08, 2.98e-08, 3.0e-08, 65504.0, 0.1, -0.2, 1 / 3,
             0.000123, 0.0004882812, 0.00048828125, 0.000488281308, 2049.0, 2051.0, 0.09997, 0.099975,
             0.00390625, 0.0234375, 1000.5, 0.15625, 2.0009765625, 65519.0, 65520.0, -1e-09, 1.2e-07]  # 2^-8 and 3*2^-7: exact .5g ties
    vals += [np.float32(x) for x in edges]
    f32 = np.array(vals, dtype="<f4")
    with np.errstate(over="ignore"):  # 65520 overflows to inf on purpose
        f16 = f32.astype(np.float16)  # embed.py: the service's float32 values stored as float16
    texts = [format(float(x), ".5g") for x in f16.astype(np.float32)]  # load.py vector_text, element by element
    import load as ld

    first = ld.vector_text(f16[:1024])  # the loader's own function on the first 1,024 values
    if first != "[" + ",".join(texts[:1024]) + "]":
        raise SystemExit("load.vector_text formatting differs from the element formatting used here")
    return {"f32_hex": f32.tobytes().hex(), "f16_text": texts}


# -------------------------------------------------------------------------------------------------------- expectations
def chunk_expect(chunks: list[ck.Chunk]) -> list[dict]:
    return [
        {
            "chunk_no": c.chunk_no,
            "chunk_total": c.chunk_total,
            "start": c.start,
            "end": c.end,
            "text_sha256": c.text_sha256,
            "embed_text_sha256": sha(c.embed_text),
            "embed_key": hashlib.sha256(f"{vg.MODEL}\x00document\x00{c.embed_text}".encode()).hexdigest(),
            "snippet": c.snippet,
        }
        for c in chunks
    ]


def doc_expect(doc: ck.Doc | None) -> dict | None:
    if doc is None:
        return None
    return {
        "dataset": doc.dataset, "record_id": doc.record_id, "title": doc.title, "heading": doc.heading, "href": doc.href,
        "source_url": doc.source_url, "max_chunks": doc.max_chunks, "text_sha256": sha(doc.text), "text_chars": len(doc.text),
    }


BUILDERS = {
    "ecfr_sections_full": src.cfr_doc, "crs_reports": src.crs_doc, "congress_bills": src.bill_doc,
    "oversight_reports": src.oversight_doc, "doj_oig_reports": src.doj_oig_doc, "ftc_publications_index": src.ftc_publication_doc,
}


def build_doc(dataset: str, row: dict, title_rows: list[dict]) -> ck.Doc | None:
    if dataset == "us_code_sections":
        names = {}
        for t in title_rows:  # sources._usc_title_names over the title rows
            ut = t.get("detail", {}).get("usc_title", {})
            if ut.get("number") is not None and ut.get("name"):
                names[str(ut["number"])] = src._one_line(ut["name"])
        return src.usc_doc(row, names)
    return BUILDERS[dataset](row)


def build(rows_doc: dict) -> dict:
    titles = rows_doc["us_code_titles"]
    out_rows = []
    for row in rows_doc["rows"]:
        ds = row["dataset"]
        full = {k: v for k, v in row.items() if k != "rule"}
        pruned = rr.prune(ds, full, titles)
        doc_full = build_doc(ds, full, titles)
        if ds == "us_code_sections":
            doc_pruned = src.usc_doc(pruned, rr.titles_map(pruned["_title_names"]))
        else:
            doc_pruned = BUILDERS[ds](pruned)
        if doc_expect(doc_full) != doc_expect(doc_pruned) or (doc_full and doc_full.text != doc_pruned.text):
            raise SystemExit(f"{ds} {row['id']}: the pruned row builds a different document")
        # the pruned row's text is the input row's text verbatim; it is left out here and restored by the reader
        pruned_stored = {k: v for k, v in pruned.items() if k != "text"}
        out_rows.append({
            "dataset": ds, "id": row["id"], "rule": row.get("rule"), "pruned": pruned_stored, "pruned_has_text": "text" in pruned,
            "doc": doc_expect(doc_full),
            "chunks": chunk_expect(ck.chunk_doc(doc_full)) if doc_full else [],
        })
    docs = []
    for d in synthetic_docs():
        doc = ck.Doc(dataset="synthetic", record_id=d["name"], title=d["name"], heading=d["heading"], text=d["text"],
                     href=f"/x/{d['name']}", source_url=None, max_chunks=d["max_chunks"])
        cases = []
        for mc in (ck.MAX_CHARS, 1200, 400):
            spans = ck.split_spans(d["text"], mc)
            cases.append({"max_chars": mc, "spans": [[s.start, s.end] for s in spans]})
        docs.append({**d, "body_limit": ck.body_limit(d["heading"]), "cases": cases, "chunks": chunk_expect(ck.chunk_doc(doc)),
                     "estimate_tokens": ck.estimate_tokens(ck.embedding_text(d["heading"], d["text"]))})
    space = [ord(c) for c in map(chr, range(0x110000)) if c.isspace()]
    import re

    digits = [ord(c) for c in map(chr, range(0x110000)) if re.match(r"\d", c)]
    ranges, s, p = [], digits[0], digits[0]
    for x in digits[1:]:
        if x == p + 1:
            p = x
            continue
        ranges.append([s, p])
        s = p = x
    ranges.append([s, p])
    return {
        "meta": {
            "generator": "scripts/semantic/make_chunk_fixtures.py",
            "chunker_version": ck.CHUNKER_VERSION, "max_chars": ck.MAX_CHARS, "max_embed_chars": ck.MAX_EMBED_CHARS,
            "snippet_chars": ck.SNIPPET_CHARS, "python": sys.version.split()[0], "unicode": unicodedata.unidata_version,
            "input_type": "document",
        },
        "specs": rr.SPECS,
        "python_space": space,
        "python_digit_ranges": ranges,
        "line_levels": [[x, ck.line_level(x)] for x in LINE_LEVEL_CASES],
        "hrefs": [[x, src.encode_href(x)] for x in HREF_CASES],
        "one_line": [[x, src._one_line(x)] for x in ONE_LINE_CASES],
        "py_str": [[x, str(x)] for x in PY_STR_CASES],
        "clean": [[x, ck.clean_for_embedding(x), ck.snippet_of(x)] for x in ONE_LINE_CASES + [d["text"][:400] for d in synthetic_docs()]],
        "vectors": vector_cases(),
        "docs": docs,
        "rows": out_rows,
    }


def dump(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=None, separators=(",", ":"), sort_keys=True) + "\n"


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("cmd", choices=["collect", "build", "check"])
    args = p.parse_args(argv)
    os.makedirs(FIXTURES, exist_ok=True)
    if args.cmd == "collect":
        rows = collect()
        with open(ROWS_PATH, "w", encoding="utf-8") as fh:
            fh.write(json.dumps(rows, ensure_ascii=False, indent=1, sort_keys=True) + "\n")
        print(f"{len(rows['rows'])} rows, {len(rows['us_code_titles'])} title rows -> {os.path.relpath(ROWS_PATH, ROOT)}")
        return 0
    with open(ROWS_PATH, encoding="utf-8") as fh:
        rows_doc = json.load(fh)
    golden = dump(build(rows_doc))
    if args.cmd == "build":
        with open(GOLDEN_PATH, "w", encoding="utf-8") as fh:
            fh.write(golden)
        print(f"{os.path.relpath(GOLDEN_PATH, ROOT)}: {len(golden):,} bytes, sha256 {sha(golden)}")
        return 0
    with open(GOLDEN_PATH, encoding="utf-8") as fh:
        current = fh.read()
    if current != golden:
        print("chunk-golden.json is not what the Python code produces; run `make_chunk_fixtures.py build`", file=sys.stderr)
        return 1
    print("chunk-golden.json is current")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
