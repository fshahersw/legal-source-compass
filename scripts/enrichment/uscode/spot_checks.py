"""Spot checks of displayed values against the raw official files (and two live official pages).

  python3 -I -B scripts/enrichment/uscode/spot_checks.py [--net]

Each check names the value shown, where in the source it was looked up and whether it matches. Output:
private/build/uscode/spot_checks.json
"""
import argparse
import gzip
import html
import json
import re
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bodytext  # noqa: E402
import fetchlib  # noqa: E402

RP = "119-124"


def rows(name, ids):
    path = fetchlib.BUILD / name
    opener = gzip.open if name.endswith(".gz") else open
    with opener(path, "rt", encoding="utf-8") as fh:
        data = json.load(fh)["rows"]
    return {r["id"]: r for r in data if r["id"] in ids}


def xml_text(zip_name):
    z = zipfile.ZipFile(fetchlib.ACQ / RP / zip_name)
    return z.read(z.namelist()[0]).decode("utf-8")


def plain(s):
    """Characters of the printed text with all whitespace removed (tags removed too), so a value is compared
    character for character whatever the spacing around element boundaries."""
    return re.sub(r"\s+", "", html.unescape(re.sub(r"<[^>]+>", "", s)))




def section_block(xml, identifier):
    m = re.search(r'<(section|courtRule)\b[^>]*identifier="' + re.escape(identifier) + r'"', xml)
    if not m:
        return ""
    end = xml.find(f"</{m.group(1)}>", m.end())
    return xml[m.start():end]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--net", action="store_true")
    args = ap.parse_args()
    checks = []

    def add(what, shown, where, ok):
        checks.append({"value": what, "shown": shown, "source": where, "match": bool(ok)})

    secs = rows("us_code_sections.json.gz", {"42:1983", "26:1", "9:10", "18:1001", "28a:courtRules_Civil_rule4",
                                              "18a:pl_91_538_s2", "42:2000e-2"})
    srcs = {"42:1983": ("xml_usc42@119-124.zip", "/us/usc/t42/s1983"),
            "26:1": ("xml_usc26@119-124.zip", "/us/usc/t26/s1"),
            "9:10": ("xml_usc09@119-124.zip", "/us/usc/t9/s10"),
            "18:1001": ("xml_usc18@119-124.zip", "/us/usc/t18/s1001"),
            "28a:courtRules_Civil_rule4": ("xml_usc28a@119-124.zip", "/us/usc/t28a/courtRules/Civil/rule4"),
            "18a:pl_91_538_s2": ("xml_usc18a@119-124.zip", "/us/usc/t18a/pl/91/538/s2"),
            "42:2000e-2": ("xml_usc42@119-124.zip", "/us/usc/t42/s2000e–2")}
    cache = {}
    for sid, (zname, ident) in srcs.items():
        r = secs[sid]
        xml = cache.setdefault(zname, xml_text(zname))
        block = plain(section_block(xml, ident))
        lines = bodytext.decode(r["text"])
        first = lines[0][1] if lines else ""
        first = " ".join(first) if isinstance(first, list) else first
        snippet = first[:120]
        add(f"{r['detail']['usc']['citation']}: first printed line", snippet,
            f"{zname} <{ident}> text", snippet and plain(snippet) in block)
        add(f"{r['detail']['usc']['citation']}: heading", r["detail"]["usc"]["heading"],
            f"{zname} <{ident}><heading>", plain(r["detail"]["usc"]["heading"]) in block)
    r = secs["42:1983"]
    add("42 U.S.C. § 1983: source credit", r["detail"]["usc"]["credit"], "xml_usc42@119-124.zip <sourceCredit>",
        plain(r["detail"]["usc"]["credit"]) in plain(section_block(cache["xml_usc42@119-124.zip"], "/us/usc/t42/s1983")))

    titles = rows("us_code_titles.json", {"42", "26", "5a"})
    rel = json.loads((fetchlib.ACQ / RP / "release.json").read_text())
    for key in ("42", "26"):
        t = titles[key]["detail"]["usc_title"]
        z = next(x for x in rel["titles"] if x["key"].lstrip("0") == key)
        add(f"Title {key}: positive law flag", t["positive_law"], f"download.html row '{z['label']}' (٭ mark)",
            t["positive_law"] == z["positive_law"])
    add("Release point and date", f"{rel['id']} / {rel['law_date']}", "https://uscode.house.gov/download.html heading",
        rel["id"] == RP and rel["law_date"] == "2026-10-15")

    laws = rows("public_laws_enacted.json.gz", {"stat-118-542", "stat-61-669", "stat-93-1284", "stat-110-3853",
                                                "stat-139-3"})
    for lid, law in sorted(laws.items()):
        d = law["detail"]["law"]
        vol = d["stat"]["volume"]
        if law["source_url"].endswith(f"STATUTE-{vol}.xml"):
            with gzip.open(fetchlib.ACQ / "statute" / f"STATUTE-{vol}.xml.gz", "rt", encoding="utf-8") as fh:
                raw = fh.read()
        else:
            m = re.search(r"/PLAW/(\d+)/public/(PLAW-[^/]+\.xml)$", law["source_url"])
            raw = zipfile.ZipFile(fetchlib.ACQ / "plaw" / f"PLAW-{m.group(1)}-public.zip").read(m.group(2)).decode()
        cite = f"{vol} Stat. {d['stat']['page']}"
        ok = any(re.search(r"<citableAs>\s*" + re.escape(cite) + r"\s*</citableAs>", b) and (d["enacted"] or "") in b
                 for b in re.findall(r"<meta>(.*?)</meta>", raw, re.S))
        add(f"{d['label']}: Statutes at Large citation and date", f"{cite}, {d['enacted']}",
            law["source_url"] + " <meta>", ok)

    links = rows("us_code_amendment_links.json.gz", {"42:1983|stat-93-1284", "42:1983|stat-110-3847",
                                                     "9:10|stat-116-132"})
    for lid, link in sorted(links.items()):
        ev = link["detail"]["link"]["evidence"]
        sid = link["detail"]["link"]["section"]
        sec_rows = rows("us_code_sections.json.gz", {sid}) if sid not in secs else {sid: secs[sid]}
        credit = sec_rows[sid]["detail"]["usc"]["credit"] or ""
        add(f"Link {lid}", "; ".join(t for _, t in ev), "the section's source credit (OLRC)",
            any(t.split(",")[0] in credit for _, t in ev))
    if args.net:
        for sid in ("42:1983", "9:10"):
            r = secs[sid]
            status, body, _, _ = fetchlib.request(r["source_url"], interval=1.0)
            page = plain(body.decode("utf-8", "replace"))
            first = bodytext.decode(r["text"])[0][1][:100]
            add(f"{r['detail']['usc']['citation']}: text on the official page", first, r["source_url"],
                status == 200 and plain(first) in page)
    out = {"checks": checks, "count": len(checks), "mismatches": sum(1 for c in checks if not c["match"])}
    (fetchlib.BUILD / "spot_checks.json").write_text(json.dumps(out, indent=1, ensure_ascii=False))
    print(json.dumps({"count": out["count"], "mismatches": out["mismatches"]}))
    for c in checks:
        if not c["match"]:
            print("MISMATCH", json.dumps(c, ensure_ascii=False)[:400])


if __name__ == "__main__":
    main()
