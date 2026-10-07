#!/usr/bin/env python3
"""Rebuild review packets (manifest/units/sections.jsonl) for the batch A states that landed through their own landers.

The shared reviewer (common/review_publisher_code_v2.py) reads a landing packet and re-fetches each unit's source_url live.
Each packet here is rebuilt from the retained captures by the same parser that landed the state, so a sampled row is the row
that was landed. For publishers whose landed unit is not diffable as-is (XML chapter files, session-bound chapter pages) the
packet carries one live-check unit per section whose source_url is the publisher's own per-section page; retrieval_method still
records how the landed bytes were obtained, so proxied content is still held.

    make_packets.py NC|FL|PA|MI|MO   -> /tmp/rv/<ST>/landing
"""
import json
import os
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
SC = HERE.parent
sys.path[:0] = [str(SC), str(SC / "fl"), str(SC / "pa"), str(SC / "mi"), str(SC / "batch-a-mazmola")]

METHOD = {"publisher_page": "publisher_page", "publisher_bulk_download": "publisher_bulk_download"}


def out_dir(st):
    d = pathlib.Path("/tmp/rv") / st / "landing"
    d.mkdir(parents=True, exist_ok=True)
    return d


def write(st, manifest, units, sections):
    d = out_dir(st)
    (d / "manifest.json").write_text(json.dumps(manifest, indent=1, sort_keys=True))
    for name, rows in (("units.jsonl", units), ("sections.jsonl", sections)):
        with open(d / name, "w", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(json.dumps({"state": st, "units": len(units), "sections": len(sections), "dir": str(d)}))


def method_of(m):
    return "proxied_fetch" if str(m).startswith("proxied") else m


def from_units(st, manifest, units, live_url=None):
    """land_v2-style units: dict(key, sections[...], original{url, method}, currency)."""
    us, ss = [], []
    for u in units:
        o = u["original"]
        for s in u["sections"]:
            key = u["key"] if live_url is None else s["citation_path"]
            if live_url is not None or not us or us[-1]["unit_key"] != key:
                us.append({"unit_key": key, "source_url": live_url(s) if live_url else o["url"],
                           "retrieval_method": method_of(o["method"])})
            ss.append({"unit_key": key, "citation_path": s["citation_path"], "citation": s["citation"], "heading": s["heading"],
                       "text": s["text"], "hierarchy": s["hierarchy"], "currency": u["currency"]})
    return us, ss


def nc():
    root = pathlib.Path("/tmp/sc/NC/work/build/rows.jsonl")
    man = json.loads((root.parent / "manifest.json").read_text())
    units, sections = {}, []
    for line in open(root, encoding="utf-8"):
        r = json.loads(line)
        d, p = r["data"], r["provenance"]
        if r["entity_type"] == "code-source-unit":
            units[d["unit_key"]] = {"unit_key": d["unit_key"], "source_url": p["source_url"], "retrieval_method": method_of(p["retrieval_method"])}
        else:
            sections.append({"unit_key": d["unit_id"].split(":unit:", 1)[1], "citation_path": d["citation_path"], "citation": d["citation"],
                             "heading": d["heading"], "text": d["text"], "hierarchy": d["hierarchy"], "currency": d["currency"]})
    write("NC", man, list(units.values()), sections)


def fl():
    from common.provenance_fetch import Fetcher
    import acquire
    import build
    units, _, _ = build.build_all(Fetcher("FL", acquire.ROOT))
    us, ss = from_units("FL", build.manifest(), units)
    write("FL", build.manifest(), us, ss)


def pa():
    for mod in ("acquire", "build", "parse"):
        sys.modules.pop(mod, None)
    sys.path.insert(0, str(SC / "pa"))
    from common.provenance_fetch import Fetcher
    import acquire
    import build
    f = Fetcher("PA", acquire.ROOT)
    index = [r for r in f.receipts() if r.get("proxy_options") and r.get("ok")][-1]
    titles = ["%02d" % int(t) for t in acquire.title_numbers(f.read(index).decode())]
    units, _ = build.build_all(f, titles)
    us, ss = from_units("PA", build.manifest(), units)
    write("PA", build.manifest(), us, ss)


def mi():
    import importlib.util
    spec = importlib.util.spec_from_file_location("mi_parse", SC / "mi" / "parse.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    parse_chapter = mod.parse_chapter
    root = pathlib.Path("/tmp/sc/MI")
    recs = [json.loads(x) for x in open(root / "receipts.jsonl") if x.strip()]
    man = {"parser": {"name": "mi-mcl-xml", "version": "1"}}
    statement = None
    us, ss = [], []
    for r in recs:
        m = re.search(r"/Chapter%20(\d+)\.xml$", r["url"])
        if not m or r.get("status") != 200:
            continue
        chapter = parse_chapter((root / r["stored_path"]).read_bytes())
        if not chapter["sections"]:
            continue
        const = chapter["name"] == "1"
        for s in chapter["sections"]:
            if const:
                continue
            slug = "mcl-" + re.sub(r"[^0-9a-z]+", "-", s["mcl"].lower()).strip("-")
            us.append({"unit_key": s["mcl"], "source_url": "https://www.legislature.mi.gov/Home/RenderDoc?objectName=" + slug,
                       "retrieval_method": "publisher_bulk_download"})
            ss.append({"unit_key": s["mcl"], "citation_path": s["mcl"], "citation": "MCL %s" % s["mcl"], "heading": s["heading"],
                       "text": s["text"], "hierarchy": s["hierarchy"],
                       "currency": {"basis": "publisher_statement", "statement": "Michigan Compiled Laws Complete Through PA 103 of 2026",
                                    "through_date": None, "edition": None}})
    write("MI", man, us, ss)


def il():
    import importlib.util
    sys.path.insert(0, str(SC / "il"))
    spec = importlib.util.spec_from_file_location("il_land", SC / "il" / "land.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    rec = mod.load_receipts()
    acts = mod.act_index(rec)
    first = next(r for r in rec.values() if r.get("label") == "act-full-text")
    statement = mod.currency_statement(mod.read(first).decode("utf8", "replace"))
    currency = {"basis": "publisher_statement", "statement": statement, "through_date": None, "edition": None}
    counts = {}
    us, ss = [], []
    for url, info in acts.items():
        found, _ = mod.page_for_act(rec, url)
        if found is None:
            continue
        r, docs = found
        secs = [d for d in docs if d["kind"] == "section" and d["text"]]
        key = "act-%s" % info["act_id"]
        if not secs:
            continue
        us.append({"unit_key": key, "source_url": r["url"], "retrieval_method": "publisher_page"})
        for d in secs:
            n = counts.get(d["citation"], 0) + 1
            counts[d["citation"]] = n
            path = mod.path_for(d["citation"], n)
            hier = [{"level": "chapter", "number": info["chapter"]["number"], "heading": info["chapter"]["heading"]},
                    {"level": "act", "number": info["act_number"], "heading": info["act_heading"]}]
            hier += [{"level": "heading", "number": c["number"], "heading": c["heading"]} for c in d["context"]]
            hier.append({"level": "section", "number": d["citation"].split("/", 1)[1], "heading": None})
            ss.append({"unit_key": key, "citation_path": path, "citation": d["citation"], "heading": None, "text": d["text"],
                       "hierarchy": hier, "currency": currency})
    write("IL", {"parser": {"name": "il-ilcs-act-pages", "version": "1"}}, us, ss)


def mo():
    import mo_land
    import mo_parse as P
    _, statement, chapters, _ = mo_land.build()
    ids = {}
    for _, _, secs, _, _ in chapters:
        for s in secs:
            ids[s["id"]] = ids.get(s["id"], 0) + 1
    seen = {}
    us, ss = [], []
    for c, meta, secs, rec, _ in chapters:
        for s in secs:
            path = s["id"]
            if ids[path] > 1:
                seen[path] = seen.get(path, 0) + 1
                path = "%s@%d" % (path, seen[path])
            hier = [{"level": "title", "number": meta["title_number"], "heading": meta["title_heading"]},
                    {"level": "chapter", "number": str(c), "heading": meta["chapter_heading"]},
                    {"level": "section", "number": s["id"], "heading": s["heading"]}]
            us.append({"unit_key": path, "source_url": "https://revisor.mo.gov/main/OneSection.aspx?section=" + s["id"],
                       "retrieval_method": "publisher_page"})
            ss.append({"unit_key": path, "citation_path": path, "citation": "RSMo § %s" % path, "heading": s["heading"],
                       "text": "\n".join(s["lines"]), "hierarchy": hier,
                       "currency": {"basis": "publisher_statement", "statement": statement, "through_date": None, "edition": None}})
    write("MO", {"parser": {"name": "mo-revisor-html", "version": "1"}}, us, ss)


if __name__ == "__main__":
    globals()[sys.argv[1].lower()]()
