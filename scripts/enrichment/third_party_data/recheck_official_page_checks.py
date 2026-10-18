"""Re-run the official-page checks against the REBUILT publishable files (36 settlement records + 22 catalog entries).

Settlement records (verification sample, seed 20261018): for each of the 36 sampled records the rebuilt notice must carry exactly the
measured verdict (verdict, per-field result and evidence, source page, hash), the 3 records outside the published set must be absent,
and the rates must recompute from the built rows. For the records whose verdict rests on a direct fetch, the literal evidence
(matter / deadline quotes, dollar figures) is searched again in the saved bytes of the official page (whitespace-normalised, case-folded).
Catalog entries (spot-check sample, seed 20261018): the rebuilt entry must carry the measured result, the listed line must still be present
verbatim on the saved list page, every URL check on every built row is re-derived from the saved check log, and page titles quoted in the
spot-check notes are searched in the saved page titles.

Writes private/build/third_party_data/recheck_official_page_checks.json (private) and prints a summary.
Usage: python3 -I -B recheck_official_page_checks.py
"""
import collections
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))
import build_third_party_data as bt  # noqa: E402
import htmltext  # noqa: E402
import tp_common as tp  # noqa: E402
import vt_parse as vp  # noqa: E402

ROOT = bt.ROOT
ACQ = bt.ACQ
BUILD = bt.BUILD


def load(*parts):
    with open(os.path.join(*parts), encoding="utf-8") as handle:
        return json.load(handle)


def norm(text):
    return " ".join((text or "").replace("\xa0", " ").split()).casefold()


def page_text(path):
    with open(os.path.join(ROOT, path), "rb") as handle:
        raw = handle.read().decode("utf-8", "replace")
    text, _links = htmltext.to_text(raw)
    return norm(text) + " " + norm(re.sub(r"<[^>]+>", " ", raw))


MONEY = r"\$\s?\d[\d,]*(?:\.\d{1,2})?"


def figures(evidence):
    """Dollar figures the evidence says were FOUND on the page (text before any 'not found' clause); a title figure marked
    '(rounded in title)' is the record title's rounding of a page figure, not a page quote, so it is not searched."""
    found = re.split(r"not found", evidence or "", flags=re.I)[0]
    found = re.sub(MONEY + r"\s*\(rounded in title\)", "", found)
    return re.findall(MONEY, found)


def literal_part(evidence):
    """The part of an evidence string that is a page quote: a trailing reviewer parenthetical starting '(the ...)' is dropped, and a
    sentence of the form '<Month d, yyyy> is printed on the page as ...' is searched as its date."""
    date = re.match(r"^([A-Z][a-z]+ \d{1,2}, \d{4}) is printed on the page", evidence)
    if date:
        return date.group(1)
    return re.sub(r"\s*\(the [^()]*\)\s*$", "", evidence)


def settlement_recheck():
    notices = {r["id"]: r for r in load(BUILD, bt.SS_DATASET + ".json")["rows"]}
    verdicts = load(ACQ, "verification", "verdicts.json")
    checks = {c["settlesignal_url"]: c for c in bt.read_jsonl(os.path.join(ACQ, "official_pages", "_checks.jsonl"))}
    out, problems = [], []
    for v in verdicts["rows"]:
        nid = bt.NOTICE_PREFIX + bt.slug_of(v["settlesignal_url"])
        row = notices.get(nid)
        entry = {"title": v["title"], "verdict": v["verdict"], "notice_id": nid, "in_build": row is not None}
        if v["verdict"] == "not_in_published_set":
            entry["ok"] = row is None
            if row is not None:
                problems.append(f"{nid}: should be absent")
            out.append(entry)
            continue
        if row is None:
            entry["ok"] = False
            problems.append(f"{nid}: missing from the build")
            out.append(entry)
            continue
        ver = row["item"]["verification"]
        same = (ver["verdict"] == v["verdict"] and ver["fields"] == v["fields"] and ver["source_url"] == v["source_url"]
                and ver["source_sha256"] == v.get("source_sha256") and row["source_url"] == v["source_url"]
                and row["item"]["cells"]["verification"] == bt.VERDICT_SHORT[v["verdict"]]
                and row["filters"]["verification"] == [v["verdict"]])
        note_ok = ver["note"] == tp.public_wording(v.get("note"))
        entry.update({"measured_equals_built": same, "note_equals_public_wording": note_ok})
        # re-search the literal evidence in the saved bytes of the official page (direct reads only)
        direct = (v.get("method") or "").startswith("direct fetch")
        entry["read"] = "direct" if direct else "firecrawl"
        searched = found = 0
        misses = []
        if direct:
            check = checks.get(v["settlesignal_url"])
            text = page_text(check["path"]) if check and check.get("path") else ""
            for key, field in v["fields"].items():
                evidence = field.get("evidence")
                if field["result"] in ("confirmed", "partly_confirmed", "contradicted") and evidence:
                    if key == "payout":
                        for fig in figures(evidence):
                            searched += 1
                            plain = fig.replace(" ", "")
                            if norm(plain) in text or norm(re.sub(r"\.00$", "", plain)) in text:
                                found += 1
                            else:
                                misses.append(f"{key}: {fig}")
                    else:
                        # a quote may join several page passages with ';' and carry a short reviewer abbreviation such as '(Del. Ch.)'
                        quote = literal_part(evidence)
                        searched += 1
                        if norm(quote) in text:
                            found += 1
                            continue
                        parts = [re.sub(r"\s*\([^()]{1,12}\)", "", p).strip() for p in re.split(r"\s*;\s*", quote)]
                        if all(norm(p) in text for p in parts if p):
                            found += 1
                        else:
                            misses.append(f"{key}: {quote[:60]}")
        entry.update({"evidence_items_searched": searched, "evidence_items_found_again": found, "evidence_misses": misses})
        entry["ok"] = bool(same and note_ok and found == searched)
        if not entry["ok"]:
            problems.append(f"{nid}: same={same} note_ok={note_ok} evidence {found}/{searched} {misses}")
        out.append(entry)
    in_set = [e for e in out if e["verdict"] != "not_in_published_set"]
    counts = collections.Counter(e["verdict"] for e in in_set)
    built_counts = collections.Counter(r["filters"]["verification"][0] for r in notices.values() if r["filters"]["verification"][0] != "not_verified")
    return {"records": out, "problems": problems, "sampled": len(out), "in_published_set": len(in_set), "verdict_counts_from_samples": dict(counts),
            "verdict_counts_in_build_excluding_not_verified": dict(built_counts),
            "build_matches_sample_counts": dict(counts) == dict(built_counts),
            "evidence_items_searched": sum(e.get("evidence_items_searched", 0) for e in out),
            "evidence_items_found_again": sum(e.get("evidence_items_found_again", 0) for e in out),
            "direct_read_records": sum(1 for e in in_set if e.get("read") == "direct")}


def catalog_recheck():
    rows = {r["id"]: r for r in load(BUILD, bt.CAT_DATASET + ".json")["rows"]}
    prov = load(BUILD, "catalog_provenance_private.json")["rows"]
    spot = load(ACQ, "verification", "catalog_spot_checks.json")
    checks = bt.load_catalog_checks()
    lists = {"Federal": {b["text"] for b in vp.blocks(open(os.path.join(ACQ, "violationtracker", "violation-tracker-data-sources.html"), encoding="utf-8").read())},
             "State": {b["text"] for b in vp.blocks(open(os.path.join(ACQ, "violationtracker", "local-state-data-sources.html"), encoding="utf-8").read())}}
    # 1. every URL check on every built row re-derived from the saved check log
    url_mismatch = []
    n_checks = 0
    for rid, row in rows.items():
        for c in row["item"]["url_checks"]:
            n_checks += 1
            state, note = bt.url_state(checks.get(c["url"]))
            if (state, note) != (c["state"], c["note"]):
                url_mismatch.append(rid)
    # 2. the 22 spot-checked entries
    out, problems = [], []
    for s in spot["rows"]:
        rid = bt.SRC_PREFIX + s["entry_id"][len(bt.LEGACY_CAT_PREFIX):]
        row = rows.get(rid)
        entry = {"entry_id": rid, "agency": s["agency"], "result": s["result"], "in_build": row is not None}
        if row is None:
            entry["reason_not_built"] = next((e["reason"] for e in load(BUILD, "enforcement_data_sources_catalog_excluded.json")["rows"] if e["id"] == rid), "not found in the build")
            entry["ok"] = s["result"] == "listing_only" and "no agency URL" in entry["reason_not_built"]
            if not entry["ok"]:
                problems.append(f"{rid}: not built ({entry['reason_not_built']})")
            out.append(entry)
            continue
        kind = "Federal" if row["item"]["entry"]["jurisdiction"] == "Federal" else "State"
        verbatim = prov[rid]["listed_line"] in lists[kind]
        sc = row["item"]["spot_check"]
        carried = bool(sc) and sc["result"] == s["result"] and sc["note"] == tp.public_wording(s["note"]) and sc["entry_text_matches_listing"] == s["listing_verbatim_on_page"]
        # quoted page titles searched in the saved page titles of the row's URLs
        quoted = re.findall(r"Page title '([^']+)'", s["note"])
        title_hits = 0
        for q in quoted:
            titles = [norm(re.sub(r"<[^>]+>", " ", (checks.get(c["url"]) or {}).get("page_title") or "")) for c in row["item"]["url_checks"]]
            notes = [norm(c["note"]) for c in row["item"]["url_checks"]]
            if any(norm(q).split(" | ")[0] in t or norm(q).split(" | ")[0] in n for t, n in zip(titles, notes)):
                title_hits += 1
        entry.update({"listing_verbatim_on_saved_list": verbatim, "measured_equals_built": carried, "quoted_titles": len(quoted), "quoted_titles_found_in_saved_check": title_hits})
        entry["ok"] = bool(verbatim and carried)
        if not entry["ok"]:
            problems.append(f"{rid}: verbatim={verbatim} carried={carried}")
        out.append(entry)
    built = [e for e in out if e["in_build"]]
    return {"entries": out, "problems": problems, "sampled": len(out), "in_published_set": len(built), "not_in_published_set": len(out) - len(built),
            "result_counts_in_published_set": dict(collections.Counter(e["result"] for e in built)),
            "listing_verbatim": sum(1 for e in built if e["listing_verbatim_on_saved_list"]),
            "url_checks_rederived": n_checks, "url_checks_mismatching": len(url_mismatch), "mismatching_rows": url_mismatch[:5],
            "quoted_titles": sum(e.get("quoted_titles", 0) for e in built), "quoted_titles_found_in_saved_check": sum(e.get("quoted_titles_found_in_saved_check", 0) for e in built)}


def main():
    result = {"settlements": settlement_recheck(), "catalog": catalog_recheck()}
    tp.atomic_write(os.path.join(BUILD, "recheck_official_page_checks.json"), json.dumps(result, indent=1, ensure_ascii=False))
    s, c = result["settlements"], result["catalog"]
    print(json.dumps({"settlements": {k: s[k] for k in ("sampled", "in_published_set", "verdict_counts_from_samples", "build_matches_sample_counts", "direct_read_records",
                                                         "evidence_items_searched", "evidence_items_found_again", "problems")},
                      "catalog": {k: c[k] for k in ("sampled", "in_published_set", "not_in_published_set", "result_counts_in_published_set", "listing_verbatim",
                                                    "url_checks_rederived", "url_checks_mismatching", "quoted_titles", "quoted_titles_found_in_saved_check", "problems")}}, indent=1))


if __name__ == "__main__":
    main()
