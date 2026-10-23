"""Gold-set tooling for the citation extractors (review sheets, building the gold file, measuring).

    python3 -I -B scripts/citations_v2/gold_tool.py sheet  [--ids filing-01,filing-02]   # print windows for review
    python3 -I -B scripts/citations_v2/gold_tool.py build                              # draft + corrections -> gold file
    python3 -I -B scripts/citations_v2/gold_tool.py measure [--out report.json]       # old vs new precision/recall

Windows: private/build/w1025_cite/gold/{filings,opinions,reports}.jsonl (gold_collect.py). The gold file
scripts/citations_v2/gold/gold-2026-10-25.json holds, per window, its provenance (source ids, sha256 of the full source
text, the window's offset in it and the sha256 of the window text) and every citation in the window with exact offsets
(code points into the window), kind, form and authority key. It was built from a machine draft (the new extractor) that
was read window by window against the text by hand; every correction is in gold/corrections.json (removed draft items,
added missed citations, changed keys or kinds), so the draft never stands unreviewed.

Scope of a gold citation: a formal citation of an authority (case reporter/neutral/WL/LEXIS citation, U.S.C., C.F.R.,
Treas. Reg., Fed. Reg., Stat., Pub. L., U.S. or state constitution, federal rule, local rule, state statute or
regulation naming its state, MDL number, docket number) or a short form (Id., "550 U.S. at 555", "Name, supra",
"§ 1983" after a full citation, "Rule 12(b)(6)"). Narrative mentions without a citation form ("Title VII", "the
Fourteenth Amendment", "section 5 of the Act"), internal cross-references and page furniture are not citations.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import textwrap
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT / "scripts" / "documents"))

import engine  # noqa: E402

WIN_DIR = ROOT / "private" / "build" / "w1025_cite" / "gold"
GOLD_DIR = HERE / "gold"
GOLD_FILE = GOLD_DIR / "gold-2026-10-25.json"
CORRECTIONS = GOLD_DIR / "corrections.json"

NET = re.compile(r"§|\b\d{1,4}\s+[A-Z][A-Za-z.'’ ]{0,22}\s?\d[0-9,]{0,7}\b|U\.?\s?S\.?\s?C|C\.?\s?F\.?\s?R|Stat\.|Pub\.|Const|"
                 r"\bR(?:ule|\.)\s+\d|L\.\s?R\.|\bId\.|\bid\.|supra|MDL|\d:\d\d-[a-z]{2}-\d|Fed\.\s?R|Reg\.")


def windows() -> list[dict]:
    rows = []
    for name in ("filings", "filings2", "opinions", "opinions2", "reports", "fedreg"):
        p = WIN_DIR / f"{name}.jsonl"
        rows += [json.loads(ln) for ln in p.read_text(encoding="utf-8").splitlines() if ln.strip()]
    return rows


# ------------------------------------------------------------------------------------------------ old extractor
def old_items(text: str) -> list[dict]:
    """documents-extract/1 (scripts/documents) citation kinds, mapped to the v2 kinds and keys for comparison."""
    from extract import extract_page  # noqa: E402

    c = engine.default()
    out = []
    for r in extract_page(text):
        k = r["kind"]
        if k in ("date", "dollar_amount"):
            continue
        key = r["key"]
        kind = {"case_citation": "case", "usc": "usc", "state_code": "state_statute", "mdl_number": "mdl",
                "docket_number": "docket"}.get(k, k)
        if k == "cfr":
            kind = "cfr_part" if key.startswith("cfr-part:") else "cfr"
        if k == "case_citation":
            m = re.match(r"^(\d+) (.+) (\d+)$", r["normalized"])
            if m:
                eds = c.reporters.get(engine.compact(m.group(2)), [])
                rep = eds[0] if len(eds) == 1 else engine.compact(m.group(2))
                key = f"case:{int(m.group(1))}:{rep}:{int(m.group(3))}"
        if k == "state_code":
            key = f"state:{r['value']['state']}:{r['value']['section']}"
        out.append({"kind": kind, "form": "full", "start": r["start"], "end": r["end"], "matched": r["matched"], "key": key})
    # statutes at large, public laws and Federal Register pages were read by the shared parser but not kept as rows in
    # documents/1; measure them from the parser itself
    from citations import extract_citations  # noqa: E402

    for c2 in extract_citations(text, 100000):
        if c2["kind"] in ("statute", "public_law", "federal_register"):
            kind = {"statute": "statutes_at_large"}.get(c2["kind"], c2["kind"])
            out.append({"kind": kind, "form": "full", "start": c2["start"], "end": c2["end"], "matched": text[c2["start"]:c2["end"]],
                        "key": c2["key"]})
    return sorted(out, key=lambda x: (x["start"], x["end"]))


def new_items(text: str) -> list[dict]:
    out = []
    for c in engine.extract(text):
        kind = c["kind"]
        if c["form"] == "short":
            kind = "short"
        out.append({"kind": kind, "form": c["form"], "short": c["short"], "start": c["start"], "end": c["end"],
                    "matched": c["matched"], "key": c["key"]})
    return out


# ------------------------------------------------------------------------------------------------ review sheet
def sheet(ids: set[str] | None) -> None:
    for w in windows():
        if ids and w["id"] not in ids:
            continue
        text = w["text"]
        print("=" * 120)
        print(w["id"], w["source"], {k: w[k] for k in ("sha256", "page", "opinion_id", "url") if k in w})
        for line in textwrap.wrap(text.replace("\n", " ⏎ "), 150):
            print("   ", line)
        new = new_items(text)
        print("  NEW:")
        for i, x in enumerate(new):
            print(f"    n{i:02d} {x['kind']:<18} {x['form']:<5} {x['matched']!r:<60} {x['key']}")
        old = old_items(text)
        covered = [(x["start"], x["end"]) for x in new]
        print("  OLD (not identical to a NEW item):")
        for x in old:
            if not any(x["start"] == a and x["end"] == b for a, b in covered):
                print(f"        {x['kind']:<18} {x['matched']!r:<60} {x['key']}")
        allc = covered + [(x["start"], x["end"]) for x in old]
        miss = [m for m in NET.finditer(text) if not any(a <= m.start() < b for a, b in allc)]
        if miss:
            print("  NET (uncovered):", "; ".join(repr(text[max(0, m.start() - 15): m.end() + 25]) for m in miss[:25]))


# ------------------------------------------------------------------------------------------------ gold build
def locate(text: str, needle: str, occurrence: int = 1) -> tuple[int, int]:
    pos = -1
    for _ in range(occurrence):
        pos = text.find(needle, pos + 1)
        if pos < 0:
            raise ValueError(f"not found: {needle!r} (occurrence {occurrence})")
    return pos, pos + len(needle)


def build() -> dict:
    corr = json.loads(CORRECTIONS.read_text(encoding="utf-8"))
    out_windows = []
    for w in windows():
        text = w["text"]
        cw = corr.get(w["id"], {})
        if cw.get("exclude_window"):
            continue
        draft = new_items(text)
        items = []
        removed = set(cw.get("remove", []))
        rekey = cw.get("rekey", {})
        rekind = cw.get("rekind", {})
        seen = {}
        for x in draft:
            n = seen[x["matched"]] = seen.get(x["matched"], 0) + 1
            ref = x["matched"] if n == 1 else f"{x['matched']}#{n}"
            if ref in removed:
                continue
            kind = rekind.get(ref, x["kind"])
            key = rekey.get(ref, x["key"])
            items.append({"kind": kind, "form": x["form"], "start": x["start"], "end": x["end"], "matched": x["matched"], "key": key,
                          "origin": "draft_confirmed" if ref not in rekey and ref not in rekind else "draft_corrected"})
        for a in cw.get("add", []):
            s, e = locate(text, a["text"], a.get("occurrence", 1))
            same = [x for x in items if x["start"] < e and s < x["end"] and fam(x["kind"]) == fam(a["kind"])]
            if same:  # the draft (a later extractor version) already holds it: the review fixes its span, kind and key
                for x in same:
                    items.remove(x)
            items.append({"kind": a["kind"], "form": a.get("form", "full"), "start": s, "end": e, "matched": text[s:e],
                          "key": a.get("key"), "origin": "added_by_review"})
        ignore = []
        for ig in cw.get("ignore", []):
            s, e = locate(text, ig)
            ignore.append({"start": s, "end": e, "matched": text[s:e], "why": "page furniture cut by the window edge"})
        items = [x for x in items if not any(x["start"] < i["end"] and i["start"] < x["end"] for i in ignore)]
        items.sort(key=lambda x: (x["start"], x["end"]))
        prov = {k: w[k] for k in w if k not in ("text",)}
        prov["window_sha256"] = hashlib.sha256(text.encode("utf-8")).hexdigest()
        prov["window_chars"] = len(text)
        out_windows.append({"window": prov, "citations": items, "ignore": ignore, "reviewed": bool(cw.get("reviewed"))})
    gold = {
        "version": "citations-gold/2026-10-25.1",
        "scope": (__doc__ or "").split("Scope of a gold citation:", 1)[1].strip(),
        "offsets": "code points into the window text; the window starts at window.offset (code points) of the source text",
        "windows": out_windows,
        "counts": count(out_windows),
    }
    GOLD_DIR.mkdir(parents=True, exist_ok=True)
    GOLD_FILE.write_text(json.dumps(gold, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return gold


def count(ws: list[dict]) -> dict:
    by: dict[str, int] = {}
    for w in ws:
        for c in w["citations"]:
            by[c["kind"]] = by.get(c["kind"], 0) + 1
    return {"windows": len(ws), "citations": sum(by.values()), "by_kind": dict(sorted(by.items()))}


# ------------------------------------------------------------------------------------------------ measurement
FAMILY = {"cfr_part": "cfr"}


def fam(kind: str) -> str:
    return FAMILY.get(kind, kind)


def norm_key(kind: str, key: str | None) -> str | None:
    if key is None:
        return None
    if kind == "state_statute":
        m = re.match(r"^state(?:-stat)?:([A-Z]{2}):(?:[^:]*:)?(.*)$", key)
        if m:
            sec = m.group(2).split(":")[-1].split("/")[-1]
            return f"{m.group(1)}:{sec}"
    return key


def match(pred: list[dict], gold: list[dict]) -> tuple[list[tuple[dict, dict]], list[dict], list[dict]]:
    """Greedy one-to-one matching: same family and overlapping spans."""
    used = set()
    pairs = []
    fps = []
    for p in pred:
        best = None
        for j, g in enumerate(gold):
            if j in used or fam(g["kind"]) != fam(p["kind"]):
                continue
            if p["start"] < g["end"] and g["start"] < p["end"]:
                best = j
                break
        if best is None:
            fps.append(p)
        else:
            used.add(best)
            pairs.append((p, gold[best]))
    fns = [g for j, g in enumerate(gold) if j not in used]
    return pairs, fps, fns


def measure(out: Path | None) -> dict:
    gold = json.loads(GOLD_FILE.read_text(encoding="utf-8"))
    texts = {w["id"]: w["text"] for w in windows()}
    report: dict = {"gold_version": gold["version"], "extractors": {}}
    for name, fn in (("old (documents-extract/1 + shared parser)", old_items), ("new (citations-v2)", new_items)):
        stats: dict[str, dict] = {}
        strata: dict[str, dict] = {}
        fp_list, fn_list = [], []
        for w in gold["windows"]:
            text = texts[w["window"]["id"]]
            st = strata.setdefault(w["window"]["id"].split("-")[0], {"windows": 0, "gold": 0, "tp_key": 0, "fp": 0, "key_wrong": 0})
            st["windows"] += 1
            gl = [g for g in w["citations"]]
            ign = w.get("ignore", [])
            pr = [x for x in fn(text) if not any(x["start"] < i["end"] and i["start"] < x["end"] for i in ign)]
            # short forms are scored as one family; an extractor without short forms simply has none
            for x in pr:
                if x["form"] == "short":
                    x["kind"] = "short"
            for g in gl:
                if g["form"] == "short":
                    g = g
            gold_items = [dict(g, kind=("short" if g["form"] == "short" else g["kind"])) for g in gl]
            pairs, fps, fns = match(pr, gold_items)
            st["gold"] += len(gold_items)
            st["fp"] += len(fps)
            for p, g in pairs:
                s = stats.setdefault(fam(g["kind"]), {"tp_span": 0, "tp_key": 0, "fp": 0, "fn": 0, "key_wrong": 0})
                s["tp_span"] += 1
                if g["kind"] == "short" and g.get("key") is None:
                    s["tp_key"] += 1
                    st["tp_key"] += 1
                elif norm_key(g["kind"], p["key"]) == norm_key(g["kind"], g["key"]):
                    s["tp_key"] += 1
                    st["tp_key"] += 1
                else:
                    s["key_wrong"] += 1
                    st["key_wrong"] += 1
                    fp_list.append({"window": w["window"]["id"], "pred": p["matched"], "pred_key": p["key"], "gold_key": g["key"], "why": "key"})
            for p in fps:
                stats.setdefault(fam(p["kind"]), {"tp_span": 0, "tp_key": 0, "fp": 0, "fn": 0, "key_wrong": 0})["fp"] += 1
                fp_list.append({"window": w["window"]["id"], "pred": p["matched"], "kind": p["kind"], "why": "fp"})
            for g in fns:
                stats.setdefault(fam(g["kind"]), {"tp_span": 0, "tp_key": 0, "fp": 0, "fn": 0, "key_wrong": 0})["fn"] += 1
                fn_list.append({"window": w["window"]["id"], "gold": g["matched"], "kind": g["kind"]})
        for k, s in stats.items():
            tp = s["tp_key"]
            s["precision"] = round(tp / (s["tp_span"] + s["fp"]), 4) if s["tp_span"] + s["fp"] else None
            s["recall"] = round(tp / (s["tp_span"] + s["fn"]), 4) if s["tp_span"] + s["fn"] else None
            s["gold"] = s["tp_span"] + s["fn"]
        tot = {k: sum(s[k] for s in stats.values()) for k in ("tp_span", "tp_key", "fp", "fn", "key_wrong")}
        tot["precision"] = round(tot["tp_key"] / (tot["tp_span"] + tot["fp"]), 4) if tot["tp_span"] + tot["fp"] else None
        tot["recall"] = round(tot["tp_key"] / (tot["tp_span"] + tot["fn"]), 4) if tot["tp_span"] + tot["fn"] else None
        for st in strata.values():
            pred = st["tp_key"] + st["key_wrong"] + st["fp"]
            st["precision"] = round(st["tp_key"] / pred, 4) if pred else None
            st["recall"] = round(st["tp_key"] / st["gold"], 4) if st["gold"] else None
        report["extractors"][name] = {"by_kind": dict(sorted(stats.items())), "by_stratum": dict(sorted(strata.items())),
                                      "total": tot, "errors_fp_or_key": fp_list,
                                      "missed": fn_list}
    if out:
        out.write_text(json.dumps(report, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return report


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("what", choices=["sheet", "build", "measure"])
    ap.add_argument("--ids", default="")
    ap.add_argument("--out", default="")
    a = ap.parse_args(argv)
    if a.what == "sheet":
        sheet({x for x in a.ids.split(",") if x} or None)
    elif a.what == "build":
        print(json.dumps(build()["counts"], indent=1))
    else:
        rep = measure(Path(a.out) if a.out else None)
        for name, r in rep["extractors"].items():
            print("##", name, json.dumps(r["total"]))
            for k, s in r["by_kind"].items():
                print(f"   {k:<20} gold {s['gold']:>4}  P {s['precision']}  R {s['recall']}  fp {s['fp']} fn {s['fn']} key_wrong {s['key_wrong']}")
            for k, s in r["by_stratum"].items():
                print(f"   [{k:<8}] windows {s['windows']:>3} gold {s['gold']:>4}  P {s['precision']}  R {s['recall']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
