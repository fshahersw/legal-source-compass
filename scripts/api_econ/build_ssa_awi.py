"""SSA national average wage index (AWI) → econ_ssa_awi.

The Social Security Administration publishes each year's AWI in its annual Federal Register notice "Cost-of-Living
Increase and Other Determinations for <year>". ssa.gov refuses requests from this environment (HTTP 403), so the series
is read from those official notices: the Federal Register API lists them (agency social-security-administration, type
NOTICE); each notice's text is read from GovInfo (https://www.govinfo.gov/content/pkg/FR-<date>/html/<doc>.htm, the
official publication), and the sentence "The national average wage index for <year> is $<amount>." is quoted exactly.
One row per index year, citing the notice that first published it. The next notice restates that value as the base of
its own computation ("based on the <year> national average wage index of $<amount>"); the builder checks the two agree.

  python3 -I -B scripts/api_econ/build_ssa_awi.py --acquire      read the notice list and the notice texts (raw kept)
  python3 -I -B scripts/api_econ/build_ssa_awi.py                build from the kept files
"""
from __future__ import annotations

import argparse
import html
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import econ_common as ec  # noqa: E402

DATASET = "econ_ssa_awi"
FR_API = ("https://www.federalregister.gov/api/v1/documents.json?per_page=100&order=oldest"
          "&conditions%5Bagencies%5D%5B%5D=social-security-administration"
          "&conditions%5Bterm%5D=%22Cost-of-Living+Increase+and+Other+Determinations%22"
          "&conditions%5Btype%5D%5B%5D=NOTICE"
          "&fields%5B%5D=title&fields%5B%5D=document_number&fields%5B%5D=publication_date"
          "&fields%5B%5D=citation&fields%5B%5D=html_url&fields%5B%5D=correction_of")
SSA_PAGE = "https://www.ssa.gov/oact/cola/AWI.html"
RAW = ec.ACQ / "ssa_awi"
# "The national average wage index for 2024 is $69,846.57." / "... for calendar year 1995 is determined to be $24,705.66."
# A computation ("... for 1995 is $23,753.53 times $23,700.11 divided by ...") states a factor, not the index: excluded.
STATED = re.compile(r"national\s+average\s+wage\s+index\s+for\s+(?:calendar\s+year\s+)?(\d{4})\s+(?:is|is\s+determined\s+to\s+be|to\s+be)\s+\$\s?([\d,]+\.\d{2})(?!\s+times)", re.I)
BASE = re.compile(r"based\s+on\s+the\s+(\d{4})\s+national\s+average\s+wage\s+index\s+of\s+\$\s?([\d,]+\.\d{2})", re.I)


def govinfo_url(doc: dict) -> str:
    return f"https://www.govinfo.gov/content/pkg/FR-{doc['publication_date']}/html/{doc['document_number']}.htm"


def acquire() -> None:
    http = ec.Http(min_interval=1.5)
    manifest = RAW / "_manifest.jsonl"
    body = http.get(FR_API)
    ec.save_raw(RAW / "fr_documents.json", body, FR_API, manifest)
    docs = json.loads(body)["results"]
    for d in docs:
        p = RAW / f"{d['document_number']}.htm"
        if p.exists():
            continue
        try:
            ec.save_raw(p, http.get(govinfo_url(d)), govinfo_url(d), manifest)
        except RuntimeError as e:
            print(json.dumps({"document": d["document_number"], "error": str(e)}))
    print(json.dumps({"notices": len(docs), "requests": len(http.requests)}))


def notice_text(path: Path) -> str:
    t = path.read_text(errors="replace")
    t = re.sub(r"<[^>]+>", " ", t)
    return re.sub(r"\s+", " ", html.unescape(t))


def build() -> tuple[list[dict], list[dict], dict]:
    docs = json.loads((RAW / "fr_documents.json").read_text())["results"]
    manifest = {}
    for line in (RAW / "_manifest.jsonl").read_text().splitlines():
        e = json.loads(line)
        manifest[e["path"]] = e
    stated: dict[str, dict] = {}
    restated: dict[str, list[dict]] = {}
    skipped = []
    for d in docs:
        p = RAW / f"{d['document_number']}.htm"
        if not p.exists():
            skipped.append({"document": d["document_number"], "reason": "notice text not retrieved"})
            continue
        text = notice_text(p)
        found = {(y, v) for y, v in STATED.findall(text)}
        for y, v in BASE.findall(text):
            restated.setdefault(y, []).append({"value": v, "document": d["document_number"]})
        if not found:
            skipped.append({"document": d["document_number"], "reason": "no sentence stating an index value"})
            continue
        years = {y for y, _ in found}
        for y in years:
            values = {v for yy, v in found if yy == y}
            if len(values) != 1:
                raise SystemExit(f"{d['document_number']}: more than one value stated for {y}: {values}")
            value = values.pop()
            sentence = re.search(rf"[^.;]*national\s+average\s+wage\s+index\s+for\s+(?:calendar\s+year\s+)?{y}\s+(?:is|is\s+determined\s+to\s+be|to\s+be)\s+\${re.escape(value)}(?!\s+times)[^;]*?(?=\.\s|;|$)", text, re.I)
            entry = {"year": y, "value": value, "doc": d, "sentence": sentence.group(0).strip() if sentence else None,
                     "raw": manifest.get(str(p.relative_to(ec.ROOT)))}
            if y in stated:
                if stated[y]["value"] != value:
                    # a later notice corrects the index (notices are read oldest first): the later value is current and
                    # the superseded value is kept with its notice
                    entry["superseded"] = stated[y].get("superseded", []) + [
                        {"value": stated[y]["value"], "document_number": stated[y]["doc"]["document_number"],
                         "citation": stated[y]["doc"].get("citation"), "publication_date": stated[y]["doc"]["publication_date"]}]
                    stated[y] = entry
                else:
                    stated[y].setdefault("also_in", []).append(d["document_number"])
                continue
            stated[y] = entry
    rows = []
    for y in sorted(stated, key=int):
        e = stated[y]
        d = e["doc"]
        later = [r for r in restated.get(y, []) if r["document"] != d["document_number"]]
        agree = [r["document"] for r in later if r["value"] == e["value"]]
        superseded_docs = {x["document_number"] for x in e.get("superseded", [])}
        disagree = [r for r in later if r["value"] != e["value"] and r["document"] not in superseded_docs
                    and r["document"] > d["document_number"]]
        if disagree:
            raise SystemExit(f"{y}: a later notice restates another value: {disagree}")
        prev = stated.get(str(int(y) - 1))
        change = None
        if prev:
            a, b = float(prev["value"].replace(",", "")), float(e["value"].replace(",", ""))
            change = f"{(b / a - 1) * 100:.2f}% over {int(y) - 1} (computed from the two published values)"
        url = govinfo_url(d)
        facts = [
            ["Index year", y],
            ["National average wage index", f"${e['value']}"],
            ["As stated", e["sentence"] or ec.NOT_RECORDED],
            ["Published in", f"{d['title']} ({d.get('citation') or ec.NOT_RECORDED}, {d['publication_date']}, FR Doc. {d['document_number']})"],
            ["Restated as the base of a later notice", ", ".join(agree) if agree else ec.NOT_RECORDED],
            ["Change from the previous year", change or ec.NOT_RECORDED],
            ["Superseded value", "; ".join(f"${x['value']} ({x['citation'] or x['document_number']}, {x['publication_date']})" for x in e.get("superseded", [])) or "None"],
            ["Used for", "Indexing Social Security benefit formulas and the contribution and benefit base (42 U.S.C. 415(b)(3), 430); in damages work, a published measure of national wage growth."],
        ]
        rows.append(ec.record(
            DATASET, f"awi:{y}", f"National average wage index, {y}: ${e['value']}", source_url=url,
            subtitle=f"Social Security Administration · {d.get('citation') or d['document_number']}",
            cells={"year": y, "value": e["value"], "notice": d.get("citation") or d["document_number"], "published": d["publication_date"]},
            facts=facts,
            text=f"national average wage index AWI {y} Social Security",
            filters={"decade": [f"{y[:3]}0s"]},
            links=[{"url": url, "label": "Notice (GovInfo)"}, {"url": d["html_url"], "label": "Notice (FederalRegister.gov)"},
                   {"url": SSA_PAGE, "label": "SSA AWI page"}],
            extra={"kind": "awi", "awi": {"year": int(y), "value": e["value"], "document_number": d["document_number"],
                                          "citation": d.get("citation"), "publication_date": d["publication_date"],
                                          "sentence": e["sentence"], "restated_in": agree,
                                          "superseded": e.get("superseded", [])}},
        ))
    inputs = [{"url": v["url"], "path": v["path"], "sha256": v["sha256"]} for v in manifest.values()]
    return rows, inputs, {"skipped": skipped}


def main(argv: list[str]) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--acquire", action="store_true")
    ap.add_argument("--out", default=str(ec.BUILD / "ssa_awi"))
    a = ap.parse_args(argv)
    if a.acquire:
        acquire()
        return
    rows, inputs, extra = build()
    ec.write_build(
        Path(a.out), DATASET, "SSA national average wage index, as published in SSA's annual Federal Register notices",
        ec.listing([("year", "Year"), ("value", "Index ($)"), ("notice", "Federal Register"), ("published", "Published")],
                   [("decade", "Decade", {f"{d}0s": f"{d}0s" for d in sorted({r['item']['cells']['year'][:3] for r in rows}, reverse=True)})]),
        {"source": FR_API.split("?")[0], "texts": "https://www.govinfo.gov/app/collection/fr",
         "method": "Federal Register API list of SSA's annual 'Cost-of-Living Increase and Other Determinations' notices; each notice text from GovInfo; the sentence stating the index quoted exactly; each value checked against the later notice that restates it as its base.",
         "terms": "Federal Register and SSA material are U.S. government works (17 U.S.C. 105).",
         "blocked": "ssa.gov answered HTTP 403 to this environment; the SSA AWI page is linked but was not read.",
         "years": f"{rows[0]['item']['cells']['year']} to {rows[-1]['item']['cells']['year']}" if rows else None, **extra},
        rows, inputs)


if __name__ == "__main__":
    main(sys.argv[1:])
