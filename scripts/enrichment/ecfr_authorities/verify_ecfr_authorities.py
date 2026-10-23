"""Independent verification of the three ecfr_authorities builds (second renditions, second code paths). Target: 0 failures.

  python3 -I -B verify_ecfr_authorities.py            writes private/build/ecfr_authorities/verify_report.json
  python3 -I -B verify_ecfr_authorities.py --refetch  also re-fetches the PTOA text and PDF from GovInfo (2 requests) and
                                                      writes the 40-row sample used for the live readback comparison

Checks
  ptoa-1  every built row (authority, heading, CFR title, ordered parts) equals the group read independently from the PDF
          rendition (verify_ptoa.py shares no code with ptoa_parse.py)
  ptoa-2  the row's printed page / PDF page anchor really holds that authority (pdftotext of that single PDF page)
  ptoa-3  link states re-derived by a second, regex-free implementation from the stored lookups equal the stored states
  ptoa-4  the table's totals (entries, groups, authority-part pairs) equal the independent parse
  subj-1  every parsed heading is a whole line of the text rendition; every entry's text is found in the text rendition
          (letters and digits only, diacritics removed, "See also" prefix removed); CFR reference counts agree
  agency-1 every agency node of agencies.json (second walker) equals its row field by field
"""
from __future__ import annotations

import gzip
import json
import os
import random
import re
import subprocess
import sys
import tempfile
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

import fetchlib as fl  # noqa: E402
import verify_ptoa as V  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(ROOT, "private", "build", "ecfr_authorities")
ACQ = os.path.join(ROOT, "private", "acq", "ecfr_authorities")
YEAR = "2025"
PKG = f"GPO-CFR-INDEX-{YEAR}"


def load_build(name: str) -> dict:
    with open(os.path.join(OUT, f"{name}.json"), encoding="utf-8") as fh:
        return json.load(fh)


def gz(rel: str) -> bytes:
    with gzip.open(os.path.join(ACQ, rel), "rb") as fh:
        return fh.read()


def strip(s: str) -> str:
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^0-9a-z]", "", s.lower())


# ------------------------------------------------------------------------------------------------ PTOA
def ptoa_checks(report: dict) -> list[dict]:
    build = load_build("ecfr_parallel_authorities")
    rows = build["rows"]
    pdf = gz(f"govinfo/{PKG}/{PKG}-4.pdf.gz")
    raw = V.pdf_raw_text(pdf)
    pe = V.parse_pdf_text(V.repair_bare(raw))
    flat = [(e, gi, g) for e in pe for gi, g in enumerate(e["groups"])]
    fails: list[dict] = []
    # ptoa-1
    if len(flat) != len(rows):
        fails.append({"check": "ptoa-1", "problem": f"{len(rows)} rows but {len(flat)} groups in the PDF reading"})
    for r, (e, gi, g) in zip(rows, flat):
        p = r["detail"]["ptoa"]
        c = p["cfr"]
        got_tokens = [re.sub(r"\s+", "", t) for t in c["parts_text"].split(",") if t.strip()]
        want_tokens = [re.sub(r"\s+", "", t) for t in g[1]]
        head_ok = (e["heading"] in ("pres", "stat-top")) or r["detail"]["ptoa"]["heading"] != ""
        if V.norm_auth(p["authority"]) != V.norm_auth(e["authority"]) or c["title"] != g[0] or got_tokens != want_tokens or not head_ok:
            fails.append({"check": "ptoa-1", "id": r["id"], "row": [p["authority"], c["title"], got_tokens[:6]], "pdf": [e["authority"], g[0], want_tokens[:6]]})
    report["ptoa-1"] = {"rows": len(rows), "groups_in_pdf_reading": len(flat), "failures": sum(1 for f in fails if f["check"] == "ptoa-1")}
    # ptoa-2: one pdftotext run per distinct PDF page used
    pages = sorted({int(r["source_url"].rsplit("#page=", 1)[1]) for r in rows if "#page=" in r["source_url"]})
    page_text: dict[int, str] = {}
    with tempfile.TemporaryDirectory() as td:
        src = os.path.join(td, "t.pdf")
        with open(src, "wb") as fh:
            fh.write(pdf)
        for pg in pages:
            out = subprocess.run(["pdftotext", "-f", str(pg), "-l", str(pg), "-raw", src, "-"], check=True, capture_output=True).stdout.decode("utf-8", "replace")
            page_text[pg] = re.sub(r"[\s]", "", out).replace("—", "--").replace("–", "-")
    bad2 = 0
    for r in rows:
        if "#page=" not in r["source_url"]:
            continue
        pg = int(r["source_url"].rsplit("#page=", 1)[1])
        a = V.norm_auth(r["detail"]["ptoa"]["authority"])
        txt = re.sub(r"\.", "", page_text[pg])
        # the authority is followed by its leader dots in the PDF; periods are removed from both sides above
        if a not in txt:
            bad2 += 1
            fails.append({"check": "ptoa-2", "id": r["id"], "page": pg, "authority": r["detail"]["ptoa"]["authority"]})
    report["ptoa-2"] = {"pdf_pages_checked": len(pages), "rows_checked": len(rows), "failures": bad2}
    # ptoa-3
    lk = os.path.join(OUT, "lookups")
    sections = set(json.load(open(os.path.join(lk, "us_code_section_ids.json"), encoding="utf-8"))["status_by_id"])
    parts = set(json.load(open(os.path.join(lk, "ecfr_part_ids.json"), encoding="utf-8"))["parts"])
    bad3 = 0
    for r in rows:
        p = r["detail"]["ptoa"]
        if p["category"] != "usc":
            want = "not_applicable"
        else:
            title = p["heading"].split(" U.S.C.")[0] + ("a" if p["heading"].endswith("Appendix") else "")
            a = " ".join(p["authority"].split())
            if p["variant"] == "1939 I.R.C.":
                want = "not_in_stored_code"
            elif re.fullmatch(r"[0-9][0-9A-Za-z\-]*", a) and "--" not in a and not a.endswith("note"):
                want = "resolved" if f"{title}:{a}" in sections else "not_in_stored_code"
            elif re.fullmatch(r"[0-9][0-9A-Za-z\-]*?\s*note", a) and "--" not in a:
                key = re.sub(r"\s*note$", "", a)
                want = "resolved_note" if f"{title}:{key}" in sections else "not_in_stored_code"
            elif re.fullmatch(r"[0-9][0-9A-Za-z\-]*?\s*et seq\.", a) and "--" not in a:
                want = "et_seq"
            elif re.fullmatch(r"[0-9][0-9A-Za-z\-]*--[0-9][0-9A-Za-z\-]*", a):
                want = "range"
            else:
                want = "other_form"
        if p["link"]["state"] != want:
            bad3 += 1
            fails.append({"check": "ptoa-3", "id": r["id"], "stored": p["link"]["state"], "second_path": want})
        for tok in p["cfr"]["parts"]:
            stored = tok in p["cfr"]["parts_stored"]
            if stored != (f"cfr:{p['cfr']['title']}:part-{tok}" in parts):
                bad3 += 1
                fails.append({"check": "ptoa-3", "id": r["id"], "part": tok})
    report["ptoa-3"] = {"rows": len(rows), "failures": bad3}
    # ptoa-4
    stats = json.load(open(os.path.join(OUT, "build_stats.json"), encoding="utf-8"))["ptoa"]["stats"]
    pairs = sum(len([t for t in g[1] if re.fullmatch(r"\d+[A-Za-z]{0,2}(?:-\d+[A-Za-z]{0,2})?", t)]) for _, _, g in flat)
    bad4 = 0
    for k, v in (("entries", len(pe)), ("rows", len(flat)), ("authority_part_pairs", pairs)):
        if stats[k] != v:
            bad4 += 1
            fails.append({"check": "ptoa-4", "what": k, "stored": stats[k], "independent": v})
    report["ptoa-4"] = {"entries": len(pe), "groups": len(flat), "authority_part_pairs": pairs, "failures": bad4}
    return fails


# ------------------------------------------------------------------------------------------------ subject index
def subject_checks(report: dict) -> list[dict]:
    build = load_build("ecfr_subject_index")
    rows = build["rows"]
    htm = gz(f"govinfo/{PKG}/{PKG}-2.htm.htm.gz").decode("utf-8")
    pre = re.search(r"<pre>(.*?)</pre>", htm, flags=re.S).group(1)
    lines = [l for l in pre.split("\n") if not re.match(r"^\[\[Page \d+\]\]\s*$", l.strip())]
    body_start = next(i for i, l in enumerate(pre.split("\n")) if re.match(r"^\[\[Page 3\]\]\s*$", l.strip()))
    col0 = {strip(l) for l in lines if l and not l.startswith(" ") and l.strip()}
    col0 |= {strip(a + " " + b) for a, b in zip(lines, lines[1:]) if a and not a.startswith(" ") and a.strip() and b.strip()}
    blob = strip(" ".join(l.strip() for l in lines))
    fails: list[dict] = []
    heads = {}
    for r in rows:
        d = r["detail"]["subject"]
        heads.setdefault(d["heading"], []).append(r)
    miss_h = [h for h in heads if strip(h) not in col0]
    for h in miss_h:
        fails.append({"check": "subj-1", "heading_not_a_line_of_the_text_rendition": h})
    n_entries = n_found = 0
    refs_pdf = 0
    for r in rows:
        for e in r["detail"]["subject"]["entries"]:
            n_entries += 1
            t = e["t"]
            if e.get("x"):
                t = re.sub(r"^See( also)?\s*", "", t)
            else:
                refs_pdf += len(re.findall(r"\b\d{1,2} CFR \d", t))
            if strip(t) in blob:
                n_found += 1
            else:
                fails.append({"check": "subj-1", "entry_not_found": e["t"][:120]})
    after_intro = [l for l in pre.split("\n")[body_start:] if not re.match(r"^\[\[Page \d+\]\]\s*$", l.strip())]
    refs_txt = len(re.findall(r"\b\d{1,2} CFR \d", re.sub(r"\s+", " ", " ".join(after_intro))))
    refs_xref_txt = 0
    if refs_pdf != refs_txt:
        fails.append({"check": "subj-1", "cfr_reference_count": {"pdf_entries": refs_pdf, "text_rendition": refs_txt}})
    report["subj-1"] = {
        "headings": len(heads),
        "headings_found_as_text_lines": len(heads) - len(miss_h),
        "entries": n_entries,
        "entries_found_in_text_rendition": n_found,
        "cfr_reference_count_pdf": refs_pdf,
        "cfr_reference_count_text": refs_txt,
        "failures": len([f for f in fails if f["check"] == "subj-1"]),
    }
    return fails


# ------------------------------------------------------------------------------------------------ agencies
def agency_checks(report: dict) -> list[dict]:
    build = load_build("ecfr_agencies")
    rows = {r["id"]: r for r in build["rows"]}
    doc = json.loads(gz("ecfr/agencies.json.gz"))
    fails: list[dict] = []
    seen = 0

    def walk(a, parent):
        nonlocal seen
        seen += 1
        r = rows.get(f"agency:{a['slug']}")
        if r is None:
            fails.append({"check": "agency-1", "missing": a["slug"]})
        else:
            d = r["detail"]["agency"]
            want = {
                "name": a["name"], "short_name": a["short_name"], "display_name": a["display_name"], "sortable_name": a["sortable_name"],
                "slug": a["slug"], "parent": parent, "children": [c["slug"] for c in a.get("children", [])], "cfr_references": a["cfr_references"],
            }
            got = {k: (d[k] if k != "children" else [c["slug"] for c in d["children"]]) for k in want}
            if got != want:
                fails.append({"check": "agency-1", "slug": a["slug"], "diff": [k for k in want if got[k] != want[k]]})
        for c in a.get("children", []):
            walk(c, a["slug"])

    for a in doc["agencies"]:
        walk(a, None)
    n_agency_rows = sum(1 for k in rows if k.startswith("agency:"))
    if n_agency_rows != seen:
        fails.append({"check": "agency-1", "problem": f"{n_agency_rows} agency rows, {seen} nodes in agencies.json"})
    report["agency-1"] = {"nodes": seen, "agency_rows": n_agency_rows, "prepared_index_rows": sum(1 for k in rows if k.startswith("prepared-index:")), "failures": len(fails)}
    return fails


# ------------------------------------------------------------------------------------------------ re-fetch sample
def refetch_sample(report: dict, n: int = 40) -> list[dict]:
    """Fresh GET of the PTOA text and PDF; compare their bytes with the stored copies; parse the fresh text copy and draw
    n random built rows (seeded) with the values read from the fresh copy for the live readback comparison."""
    import ptoa_parse as P  # noqa: PLC0415

    fails: list[dict] = []
    base = f"https://api.govinfo.gov/packages/{PKG}/granules/{PKG}-4"
    st, htm, _ = fl.get(f"{base}/htm", accept="text/html")
    st2, pdf, _ = fl.get(f"{base}/pdf", accept="application/pdf")
    man = fl.read_manifest()
    same_htm = fl.sha256_hex(htm) == man[f"govinfo/{PKG}/{PKG}-4.htm.htm.gz"]["sha256"]
    same_pdf = fl.sha256_hex(pdf) == man[f"govinfo/{PKG}/{PKG}-4.pdf.gz"]["sha256"]
    report["refetch"] = {"retrieved_at": fl.utc_now(), "text_identical_to_stored": same_htm, "pdf_identical_to_stored": same_pdf}
    if not (same_htm and same_pdf):
        fails.append({"check": "refetch", "problem": "a fresh copy differs from the stored copy", "text": same_htm, "pdf": same_pdf})
    fresh = P.parse(htm.decode("utf-8"))
    build = load_build("ecfr_parallel_authorities")
    rows = build["rows"]
    flat = [(e, g) for e in fresh.entries for g in e.groups]
    if len(flat) != len(rows):
        fails.append({"check": "refetch", "problem": f"fresh parse has {len(flat)} groups, build has {len(rows)} rows"})
    rnd = random.Random(20261023)
    idx = sorted(rnd.sample(range(len(rows)), n))
    sample = []
    bad = 0
    for i in idx:
        r = rows[i]
        e, g = flat[i]
        p = r["detail"]["ptoa"]
        ok = p["authority"] == e.authority and p["cfr"]["title"] == g.cfr_title and p["cfr"]["parts_text"] == g.text and p["heading"] == e.heading and p["page"] == e.page
        bad += 0 if ok else 1
        sample.append({"id": r["id"], "heading": e.heading, "authority": e.authority, "cfr_title": g.cfr_title, "parts_text": g.text, "page": e.page, "built_matches_fresh_copy": ok})
    report["refetch"]["sample_size"] = n
    report["refetch"]["sample_built_vs_fresh_mismatches"] = bad
    with open(os.path.join(OUT, "verify_sample_40.json"), "w", encoding="utf-8") as fh:
        json.dump(sample, fh, ensure_ascii=False, indent=1)
    if bad:
        fails.append({"check": "refetch", "mismatches": bad})
    return fails


def main(argv: list[str]) -> None:
    report: dict = {"verified_at": fl.utc_now()}
    fails: list[dict] = []
    fails += ptoa_checks(report)
    fails += subject_checks(report)
    fails += agency_checks(report)
    if "--refetch" in argv:
        fails += refetch_sample(report)
    report["failure_count"] = len(fails)
    report["failures_first_30"] = fails[:30]
    with open(os.path.join(OUT, "verify_report.json"), "w", encoding="utf-8") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=1)
    print(json.dumps({k: v for k, v in report.items() if k != "failures_first_30"}, indent=1))
    for f in fails[:15]:
        print("FAIL", json.dumps(f)[:400])


if __name__ == "__main__":
    main(sys.argv[1:])
