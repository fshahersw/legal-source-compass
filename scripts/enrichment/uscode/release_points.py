"""Record every OLRC release point of the US Code and produce a per-section change list when a new one appears.

  python3 -I -B scripts/enrichment/uscode/release_points.py            record + baseline/update + build
  python3 -I -B scripts/enrichment/uscode/release_points.py --rebuild  + rebuild and verify every dataset when new
  python3 -I -B scripts/enrichment/uscode/release_points.py --check    exit 3 when the live current release point is
                                                                        newer than the newest one held (no download)

Reads https://uscode.house.gov/download.html (current release point, titles changed since the previous one in
bold) and https://uscode.house.gov/priorreleasepoints.html (one line per prior release point: law, date, titles
affected). State: private/build/uscode/release_points_state.json {"held": [...], "first_seen": {id: date},
"changes": {id: summary}}.

When the current release point is not held yet, every title zip of it is downloaded (acquire_uscode.py), parsed
(parse_release.py) and compared unit by unit with the newest held release point: added (unit id new), removed
(unit id gone), changed (printed content hash differs, status unchanged), repealed (status became repealed, omitted,
transferred, renumbered, reserved or vacant). Titles whose units are all unchanged keep only their manifest line
(the zip is deleted; sha256 and URL allow re-fetching). The change list goes to
private/build/uscode/changes/<old>__<new>.json and its counts into the us_code_release_points record.

On the first run (nothing compared yet) the baseline compares the held current release point with the release
point before it, for the titles OLRC marks as changed, downloading only those titles of the earlier one.
Writes private/build/uscode/us_code_release_points.json (publish_build format).
"""
import argparse
import datetime
import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import acquire_uscode  # noqa: E402
import build_uscode  # noqa: E402
import cite  # noqa: E402
import fetchlib  # noqa: E402
import olrc  # noqa: E402
import parse_release  # noqa: E402

STATE = fetchlib.BUILD / "release_points_state.json"
CHANGES = fetchlib.BUILD / "changes"
MANIFEST = fetchlib.ACQ / "_manifest.jsonl"
REMOVAL = {"repealed", "omitted", "transferred", "renumbered", "reserved", "vacant"}


def load_state():
    if STATE.exists():
        return json.loads(STATE.read_text())
    held = sorted(p.name for p in fetchlib.ACQ.iterdir() if p.is_dir() and (p / "release.json").exists()
                  and olrc.parse_rp_id(p.name) and not json.loads((p / "release.json").read_text()).get("partial"))
    return {"held": held, "first_seen": {}, "changes": {}}


def save_state(state):
    STATE.write_text(json.dumps(state, indent=1, sort_keys=True))


def rp_order(rp):
    p = olrc.parse_rp_id(rp)
    return (p["congress"], p["through_law"], -len(p["except_laws"]))


def read_pages():
    stamp = fetchlib.now()[:10]
    cur_page, cur_entry = acquire_uscode.fetch_page(olrc.BASE + "download.html",
                                                    fetchlib.ACQ / "pages" / f"download.{stamp}.html.gz")
    prior_page, prior_entry = acquire_uscode.fetch_page(olrc.BASE + "priorreleasepoints.html",
                                                        fetchlib.ACQ / "pages" / f"priorreleasepoints.{stamp}.html.gz")
    return olrc.parse_current(cur_page), olrc.parse_prior(prior_page), cur_entry, prior_entry


def units_of(release, title_files=None):
    """{unit id: (hash, status, citation)} for the parsed titles of a release point."""
    out = {}
    for f in sorted(parse_release.parsed_dir(release).glob("t*.jsonl.gz")):
        key = f.name[1:].split(".")[0]
        if title_files is not None and key not in title_files:
            continue
        head, containers, units = parse_release.read_parsed(f)
        for u in units:
            out[f"{head['key']}:{u['key']}"] = (u["hash"], u["status"],
                                               cite.citation(head["key"], u, build_uscode.group_heading(u, containers)))
    return out


def compare(old, new):
    changes = {"added": [], "removed": [], "changed": [], "repealed": []}
    for uid, (h, status, citation) in new.items():
        if uid not in old:
            changes["added"].append([uid, citation, status])
            continue
        oh, ostatus, _ = old[uid]
        if status in REMOVAL and status != ostatus:
            changes["repealed"].append([uid, citation, status, ostatus])
        elif oh != h:
            changes["changed"].append([uid, citation, status])
    for uid, (h, status, citation) in old.items():
        if uid not in new:
            changes["removed"].append([uid, citation, status])
    return changes


def title_files_for(release, title_numbers):
    """Parsed-file keys ('16', '05a') of a release's title rows whose title number OLRC lists."""
    rel = json.loads((fetchlib.ACQ / release / "release.json").read_text())
    want = {t.lower().lstrip("0") for t in title_numbers}
    return {r["key"].lower() for r in rel["titles"] if r["key"].lower().lstrip("0") in want}


def baseline(state, current, prior):
    """Compare the held current release point with the previous one for the titles OLRC marks as changed."""
    prev = prior[0]["id"] if prior else None
    changed = [t["number"] for t in current["titles"] if t["changed"]]
    if not prev or not changed or current["id"] not in state["held"]:
        return None
    keys = title_files_for(current["id"], changed)
    out_dir = fetchlib.ACQ / prev
    out_dir.mkdir(parents=True, exist_ok=True)
    rows = []
    for key in sorted(keys):
        zkey = next(t["key"] for t in current["titles"] if t["key"].lower() == key)
        url = olrc.title_zip_url(prev, zkey)
        e = fetchlib.fetch_file(url, out_dir / f"xml_usc{zkey}@{prev}.zip", MANIFEST)
        rows.append({"key": zkey, "xml_url": url, "path": e["path"], "sha256": e["sha256"], "bytes": e["bytes"],
                     "last_modified": e.get("last_modified"), "retrieved_at": e["retrieved_at"]})
        parse_release.parse_zip(Path(e["path"]), parse_release.parsed_dir(prev) / f"t{key}.jsonl.gz")
    (out_dir / "release.json").write_text(json.dumps({"id": prev, "partial": True, "titles": rows,
                                                      "note": "only the titles changed by the next release point"},
                                                     indent=1))
    old = units_of(prev, keys)
    new = units_of(current["id"], keys)
    changes = compare(old, new)
    return finish(state, prev, current["id"], changes, sorted(keys), "baseline: titles OLRC marks as changed")


def finish(state, old_rp, new_rp, changes, titles, scope):
    CHANGES.mkdir(parents=True, exist_ok=True)
    path = CHANGES / f"{old_rp}__{new_rp}.json"
    path.write_text(json.dumps({"from": old_rp, "to": new_rp, "titles_compared": titles, "scope": scope,
                                "computed_at": fetchlib.now(), **changes}, indent=1, ensure_ascii=False))
    summary = {"from": old_rp, "titles_compared": titles, "scope": scope,
               **{k: len(v) for k, v in changes.items()}, "file": f"private/build/uscode/changes/{path.name}"}
    state["changes"][new_rp] = summary
    return summary


def update(state, current):
    """Download, parse and compare a new current release point against the newest held one."""
    held = sorted(state["held"], key=rp_order)
    base = held[-1] if held else None
    meta = acquire_uscode.acquire()
    if meta["id"] != current["id"]:
        raise SystemExit(f"download page moved on during the run ({meta['id']} != {current['id']})")
    rp = meta["id"]
    for z in sorted((fetchlib.ACQ / rp).glob("xml_usc*@*.zip")):
        key = z.name[len("xml_usc"):].split("@")[0].lower()
        parse_release.parse_zip(z, parse_release.parsed_dir(rp) / f"t{key}.jsonl.gz")
    state["held"] = sorted(set(state["held"]) | {rp}, key=rp_order)
    if not base:
        return None
    old, new = units_of(base), units_of(rp)
    changes = compare(old, new)
    prune(base, {uid.split(":", 1)[0] for k in changes for uid, *_ in changes[k]})
    return finish(state, base, rp, changes, "all", "all titles")


def prune(old_rp, touched):
    """Disk: the superseded release point keeps only the zips of titles the new one changed (the others are
    byte-for-byte re-fetchable from the URL and sha256 in the manifest) and drops its parsed files."""
    for z in sorted((fetchlib.ACQ / old_rp).glob("xml_usc*@*.zip")):
        key = z.name[len("xml_usc"):].split("@")[0].lower().lstrip("0")
        if key not in touched:
            z.unlink()
    for f in parse_release.parsed_dir(old_rp).glob("t*.jsonl.gz"):
        f.unlink()


def record_rows(state, current, prior):
    ordered = [current] + prior                      # newest first, as OLRC lists them
    rows = []
    today = datetime.date.today().isoformat()
    for i, rp in enumerate(ordered):
        rid = rp["id"]
        state["first_seen"].setdefault(rid, today)
        p = olrc.parse_rp_id(rid)
        prev = ordered[i + 1]["id"] if i + 1 < len(ordered) else None
        laws = olrc.laws_between(prev, rid) if prev else None
        is_current = i == 0
        titles = ([t["number"] for t in current["titles"] if t["changed"]] if is_current
                  else rp["titles_affected"])
        ch = state["changes"].get(rid)
        page = olrc.BASE + "download.html" if is_current else (rp.get("page_url") or olrc.BASE + f"download/{rid}.html")
        facts = [["Release point", rid], ["Current through", f"Public Law {p['congress']}-{p['through_law']}"]]
        if p["except_laws"]:
            facts.append(["Except", ", ".join(f"Public Law {p['congress']}-{n}" for n in p["except_laws"])])
        facts.append(["Law date (as printed)", rp["law_date_text"]])
        facts.append(["Titles affected", ", ".join(titles) if titles else "Not stated"])
        if laws:
            facts.append(["Public laws added since the previous release point",
                          ", ".join(f"{laws[0]}-{n}" for n in laws[1])])
        facts.append(["Section changes", (f"{ch['added']} added, {ch['changed']} changed, {ch['repealed']} repealed or "
                                          f"removed from force, {ch['removed']} no longer listed (vs {ch['from']})")
                      if ch else "Not computed (release point predates this dataset)"])
        facts.append(["Held in the corpus", "Yes" if rid in state["held"] else "No"])
        rows.append({
            "dataset": "us_code_release_points",
            "id": rid,
            "category": "us_code_release_points",
            "state": "",
            "title": f"Release point {rid} (Public Law {rid}, {rp['law_date_text']})",
            "source_url": page,
            "item": {"id": rid, "title": f"Public Law {rid}", "subtitle": rp["law_date_text"],
                     "cells": {"release_point": rid, "law_date": rp["law_date"] or "", "titles": ", ".join(titles),
                               "current": "Current" if is_current else "",
                               "changes": (f"+{ch['added']} / ~{ch['changed']} / -{ch['repealed']}" if ch else "")},
                     "badges": ["Current"] if is_current else []},
            "detail": {"title": f"Release point {rid}", "facts": facts,
                       "links": [{"url": page, "label": "OLRC download page"}],
                       "release_point": {"id": rid, "congress": p["congress"], "through_law": p["through_law"],
                                         "except_laws": p["except_laws"], "law_date": rp["law_date"],
                                         "law_date_text": rp["law_date_text"], "titles_affected": titles,
                                         "laws_added": laws[1] if laws else None,
                                         "laws_added_basis": "difference of consecutive release point ids" if laws else None,
                                         "current": is_current, "held": rid in state["held"],
                                         "first_seen": state["first_seen"][rid], "changes": ch,
                                         "except_text": rp.get("except_text")}},
            "text": " ".join(titles),
            "filters": {"_listing": ["yes"], "current": ["yes" if is_current else "no"],
                        "held": ["yes" if rid in state["held"] else "no"]},
        })
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--rebuild", action="store_true", help="after a new release point, rebuild and verify all datasets")
    args = ap.parse_args()
    state = load_state()
    current, prior, cur_entry, prior_entry = read_pages()
    newest_held = sorted(state["held"], key=rp_order)[-1] if state["held"] else None
    is_new = current["id"] not in state["held"]
    if args.check:
        print(json.dumps({"current": current["id"], "newest_held": newest_held, "new": is_new}))
        sys.exit(3 if is_new else 0)
    summary = None
    if is_new:
        summary = update(state, current)
    elif current["id"] not in state["changes"]:
        summary = baseline(state, current, prior)
    rows = record_rows(state, current, prior)
    save_state(state)
    build_uscode.write_build(
        fetchlib.BUILD / "us_code_release_points.json", "us_code_release_points", "United States Code: release points",
        rows,
        build_uscode.listing([("release_point", "Release point"), ("law_date", "Law date"), ("titles", "Titles affected"),
                              ("changes", "Section changes"), ("current", "Current")], []),
        {"source": "Office of the Law Revision Counsel: https://uscode.house.gov/download.html and "
                   "https://uscode.house.gov/priorreleasepoints.html",
         "records": len(rows), "current": current["id"], "held": state["held"],
         "note": "The law date is the date OLRC prints beside the release point (the enactment date of the last law "
                 "it includes). 'Public laws added' is the difference between consecutive release point ids "
                 "(<congress>-<law>[not<law>]). Section changes are computed only for release points this dataset "
                 "has downloaded.",
         "pages": [{"url": cur_entry["url"], "sha256": cur_entry["sha256"]},
                   {"url": prior_entry["url"], "sha256": prior_entry["sha256"]}]},
        [{"url": cur_entry["url"], "path": cur_entry["path"], "sha256": cur_entry["sha256"]},
         {"url": prior_entry["url"], "path": prior_entry["path"], "sha256": prior_entry["sha256"]}])
    print(json.dumps({"current": current["id"], "prior": len(prior), "records": len(rows), "new": is_new,
                      "change_summary": summary, "requests": fetchlib.COUNTS}))
    if is_new and args.rebuild:
        rebuild(current["id"])


def rebuild(release):
    """After a new release point: resolve its non-plain official URLs, rebuild every dataset and verify the build
    files. Publishing stays a separate, explicit step (publish_build.py)."""
    import subprocess
    here = Path(__file__).resolve().parent
    steps = [["check_official_urls.py", release, "--sample", "50"], ["build_uscode.py", release],
             ["build_laws.py", release], ["verify_uscode.py", release, "--sample", "500"]]
    for script, *rest in steps:
        result = subprocess.run([sys.executable, "-I", "-B", str(here / script), *rest])
        if result.returncode:
            raise SystemExit(f"{script} failed ({result.returncode})")
    report = json.loads((fetchlib.BUILD / "verify_report.json").read_text())
    print(json.dumps({"rebuilt": release, "verify_failures": report["total_failures"]}))
    if report["total_failures"]:
        raise SystemExit(4)


if __name__ == "__main__":
    main()
