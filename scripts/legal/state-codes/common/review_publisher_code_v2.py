#!/usr/bin/env python3
"""Documented pre-publication review of one landed state (batch 4).

Steps (all recorded in the report): section count vs the publisher TOC (evidence supplied by the state's verification), N random landed
sections re-fetched LIVE from the publisher (fresh requests, not the retained originals) and diffed on citation, heading and text,
currency/edition as landed, and the retrieval routes (proxied content is graded and flagged). Any mismatch -> 'held' (quarantine, not public).
All checks pass -> `corpus_publisher_code_review_v2(state, 'reviewed', true, note)`.

    review_publisher_code_v2.py --landing /tmp/sc4/de/landing --state DE --toc-ok "evidence" --report path.md [--n 20] [--seed 1] [--apply]

State-agnostic: reads the shared landing packet (manifest/units/sections.jsonl, see batch-c LANDING-PACKET.md) of any batch, so every
batch can run it after landing. `--toc-ok` is the proof that parsed section counts equal the publisher's own section markers PER PAGE
(index/subchapter pages with zero sections are a red flag, not a pass); leave it empty and the state is held.
"""
import argparse
import json
import os
import random
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "b4"))          # sc_common (archive/fetch helpers, browser-UA retry)
sys.path.insert(0, os.path.join(HERE, "..", "..", "..", "ecfr-text"))  # pgrest (service-role PostgREST from the environment)
import sc_common as sc  # noqa: E402


def live_text(body, url):
    if body[:5] == b"%PDF-":
        with tempfile.NamedTemporaryFile(suffix=".pdf") as f:
            f.write(body)
            f.flush()
            return subprocess.run(["pdftotext", "-layout", f.name, "-"], capture_output=True, text=True, check=True).stdout
    s, _ = sc.decode_html(body)
    if s.lstrip()[:1] in "{[":
        try:
            doc = json.loads(s)
            out = []

            def walk(v):
                if isinstance(v, str):
                    out.append(sc.html_text(v) if "<" in v else v)
                elif isinstance(v, dict):
                    for x in v.values():
                        walk(x)
                elif isinstance(v, list):
                    for x in v:
                        walk(x)
            walk(doc)
            return "\n".join(out)
        except ValueError:
            pass
    return sc.html_text(s)


def squash(t):
    t = t.replace("\u2019", "'").replace("\u2018", "'").replace("\u201c", '"').replace("\u201d", '"')
    return re.sub(r"\s+", "", t)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--landing", required=True, help="landing packet directory (manifest.json, units.jsonl, sections.jsonl)")
    ap.add_argument("--state", required=True)
    ap.add_argument("--n", type=int, default=20)
    ap.add_argument("--seed", type=int, default=20261006)
    ap.add_argument("--toc-ok", default="", help="evidence that parsed section counts equal the publisher TOC (empty = not established)")
    ap.add_argument("--report", required=True)
    ap.add_argument("--apply", action="store_true", help="call corpus_publisher_code_review_v2 (service role from the environment)")
    a = ap.parse_args()
    land = a.landing
    units = {u["unit_key"]: u for u in map(json.loads, open(os.path.join(land, "units.jsonl"), encoding="utf-8"))}
    secs = [json.loads(x) for x in open(os.path.join(land, "sections.jsonl"), encoding="utf-8")]
    manifest = json.load(open(os.path.join(land, "manifest.json")))
    rnd = random.Random(a.seed)
    sample = rnd.sample(secs, min(a.n, len(secs)))
    tmp = tempfile.mkdtemp(prefix="review-")
    arc = sc.Archive(tmp, min_interval=1.0)
    results = []
    for s in sample:
        u = units[s["unit_key"]]
        rec = arc.fetch(u["source_url"], accept="*/*", min_bytes=0)
        row = {"citation_path": s["citation_path"], "citation": s["citation"], "url": u["source_url"], "live_status": rec["http_status"],
               "route": rec["route"], "user_agent": rec.get("user_agent"), "ua_retry": rec.get("ua_retry", False)}
        if rec["state"] != "complete":
            row.update(ok=False, why="live fetch failed")
        else:
            live = squash(live_text(arc.read(rec), u["source_url"]))
            number = s["hierarchy"][-1].get("number") or ""
            row["citation_ok"] = bool(number) and squash(number) in live
            heading = s.get("heading") or ""
            row["heading_ok"] = (not heading) or squash(heading) in live
            if heading and not row["heading_ok"]:
                row["heading_ok"] = squash(re.sub(r"\[[^\]]+\]", "", heading)) in live
            if heading and not row["heading_ok"]:
                row["heading_ok"] = squash(heading.split("[", 1)[0].strip()) in live
            row["text_ok"] = squash(s["text"]) in live
            row["live_sha256"] = rec["sha256"]
            row["ok"] = row["citation_ok"] and row["heading_ok"] and row["text_ok"]
        results.append(row)
    cur = sorted({(x["currency"]["basis"], x["currency"]["statement"][:200], x["currency"]["through_date"], x["currency"]["edition"]) for x in secs})
    proxied = sum(1 for u in units.values() if u["retrieval_method"] == "proxied_fetch")
    passed = all(r["ok"] for r in results)
    toc_ok = bool(a.toc_ok.strip())
    decision = "reviewed" if (passed and toc_ok and proxied == 0) else "held"
    lines = [f"## Review {a.state} ({manifest['parser']['name']}/{manifest['parser']['version']})", "",
             f"- Sections landed: {len(secs)}; units: {len(units)}; reviewed on {sc.utc_now()}.",
             f"- Section count vs publisher TOC: {'OK - ' + a.toc_ok if toc_ok else 'NOT ESTABLISHED'}.",
             f"- Live diff: {sum(1 for r in results if r['ok'])}/{len(results)} random sections match the live publisher page (seed {a.seed}); "
             "checks = section number present, heading present, full text present (whitespace-insensitive, quote-normalised).",
             f"- Currency as landed: {json.dumps(cur, ensure_ascii=False)}",
             f"- Proxied-fetch units: {proxied} (any proxied content blocks automatic review).",
             f"- Decision: **{decision}**", "", "| citation_path | live | route/UA | citation | heading | text |", "|---|---|---|---|---|---|"]
    for r in results:
        lines.append(f"| {r['citation_path']} | {r['live_status']} | {r['route']}{'/browser-UA' if r.get('ua_retry') else ''} | "
                     f"{r.get('citation_ok')} | {r.get('heading_ok')} | {r.get('text_ok')} |")
    with open(a.report, "a", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n\n")
    note = f"batch-4 review {sc.utc_now()}: {sum(1 for r in results if r['ok'])}/{len(results)} live diffs, TOC {'ok' if toc_ok else 'not established'}; see {os.path.basename(a.report)}"
    out = {"state": a.state, "decision": decision, "live_ok": sum(1 for r in results if r["ok"]), "sampled": len(results), "toc_ok": toc_ok, "proxied_units": proxied}
    if a.apply:
        import pgrest
        out["rpc"] = pgrest.rpc("corpus_publisher_code_review_v2", {"p_jurisdiction": a.state, "p_review_status": decision,
                                                                  "p_public_projection_allowed": decision == "reviewed", "p_notes": note})
    print(json.dumps(out, indent=1, default=str))


if __name__ == "__main__":
    main()
