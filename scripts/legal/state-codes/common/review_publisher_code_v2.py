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
import html as html_mod
import json
import os
import random
import re
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET

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


def publisher_section_number(body):
    """Section number as printed by the publisher on the live page (not derived from landed text)."""
    raw = body.lstrip()
    if not (raw.startswith(b"<?xml") or raw.startswith(b"<section") or raw.startswith(b"<SECTION")):
        return None
    try:
        root = ET.fromstring(body)
    except ET.ParseError:
        return None
    tag = root.tag.split("}", 1)[-1] if root.tag else ""
    if tag.lower() != "section":
        return None
    num = root.get("number")
    return num.strip() if num else None


def live_ia_section_row(body, url, section):
    """Re-parse Iowa slim chapter XML and return the matching section row."""
    if "_slim.xml" not in url:
        return None
    ia_dir = os.path.join(HERE, "..", "ia")
    if ia_dir not in sys.path:
        sys.path.insert(0, ia_dir)
    from ia_parse import parse_chapter  # noqa: WPS433
    hier = section.get("hierarchy") or []
    title = next((x["number"] for x in hier if x.get("level") == "title"), "I")
    chapter = next((x["number"] for x in hier if x.get("level") == "chapter"), None)
    if not chapter:
        cp = section.get("citation_path") or section.get("citation") or ""
        chapter = cp.split(".", 1)[0] if cp else None
    chapter_row = {"title": title, "title_heading": None, "chapter": chapter}
    raw = body if isinstance(body, bytes) else body.encode("utf-8", "replace")
    parsed = parse_chapter(raw, chapter_row)
    target = section.get("citation_path") or section.get("citation")
    for row in parsed["sections"]:
        if row["number"] == target:
            return row
    return None


def live_wv_section_row(body, url, section):
    """Extract one section from get_all_sections JSON/HTML (West Virginia)."""
    if "get_all_sections" not in url:
        return None
    wv_dir = os.path.join(HERE, "..", "wv")
    if wv_dir not in sys.path:
        sys.path.insert(0, wv_dir)
    from wv_common import norm_slug, sections_from_article_html  # noqa: WPS433
    raw = body.decode("utf-8", "replace") if isinstance(body, bytes) else body
    try:
        doc = json.loads(raw)
        html = doc.get("html") or ""
    except ValueError:
        html = raw
    token = norm_slug((section.get("citation_path") or section.get("citation") or "").replace("§", ""))
    for item in sections_from_article_html(html):
        if norm_slug(item["citation_token"]) == token:
            return {
                "citation_token": item["citation_token"],
                "heading": item.get("catchline"),
                "text": item.get("text") or "",
                "status_label": item.get("catchline") if not (item.get("text") or "").strip() else None,
            }
    return None


def live_fetch(arc, url, state):
    """Live publisher fetch; WV ajax needs XHR (Firecrawl fallback when empty)."""
    extra = None
    min_bytes = 0
    if "admin-ajax.php" in url and "get_all_sections" in url:
        extra = {"X-Requested-With": "XMLHttpRequest"}
        min_bytes = 80
    if extra:
        status, body, meta = arc._http(url, accept="*/*", extra=extra)
        retrieved = sc.utc_now()
        rec = {"url": url, "http_status": status, "retrieved_at": retrieved, "bytes": len(body), "route": "direct",
               "user_agent": arc.ua, **{k: v for k, v in meta.items() if v not in (None, [])}}
        if status == 200 and len(body) >= min_bytes:
            sha = sc.sha256_hex(body)
            rel = f"{sha[:2]}/{sha}"
            path = os.path.join(arc.raw, rel)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "wb") as f:
                f.write(body)
            rec.update({"state": "complete", "sha256": sha, "file": os.path.join("raw", rel)})
        else:
            rec.update({"state": "failed"})
    else:
        rec = arc.fetch(url, accept="*/*", min_bytes=min_bytes)
    if state == "WV" and os.environ.get("FIRECRAWL_API_KEY"):
        empty = rec.get("state") != "complete"
        if not empty:
            try:
                body = arc.read(rec)
                doc = json.loads(body.decode("utf-8", "replace"))
                empty = len((doc.get("html") or "").strip()) < 40
            except (ValueError, KeyError, json.JSONDecodeError):
                empty = len(body) < 40
        if empty:
            rec = arc.fetch(url, route="firecrawl", force=True, min_bytes=40)
    return rec


def live_ks_section_row(body, url, section):
    """Re-parse Kansas Revisor section HTML with the same parser as landing (TOC meta only)."""
    html = body.decode("utf-8", "replace") if isinstance(body, bytes) else body
    if "ksrevisor.gov/statutes" not in url or 'id="print"' not in html:
        return None
    ks_dir = os.path.join(HERE, "..", "ks")
    if ks_dir not in sys.path:
        sys.path.insert(0, ks_dir)
    from ks_parse import parse_section_html  # noqa: WPS433
    meta = {"heading": section.get("heading"), "citation": section.get("citation")}
    rows, _ = parse_section_html(html, url, "review-live", meta)
    return rows[0] if rows else None


def live_section_body(body):
    """Operative section text from the live publisher file (Utah section XML uses parse_ut.section_body)."""
    if publisher_section_number(body) is None:
        return None
    ut_dir = os.path.join(HERE, "..", "ut")
    if ut_dir not in sys.path:
        sys.path.insert(0, ut_dir)
    from parse_ut import load_section, section_body  # noqa: WPS433
    section, _ = load_section(body)
    tag = section.tag.split("}", 1)[-1] if section.tag else ""
    if tag.lower() != "section":
        return None
    return section_body(section)


def squash(t):
    t = html_mod.unescape(t)
    t = t.replace("\u2019", "'").replace("\u2018", "'").replace("\u201c", '"').replace("\u201d", '"')
    for dash in ("\u2013", "\u2014", "\u2012", "\u2212"):
        t = t.replace(dash, "-")
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
    ap.add_argument(
        "--must-include",
        action="append",
        default=[],
        help="citation_path or citation values always included in the live sample",
    )
    a = ap.parse_args()
    land = a.landing
    units = {u["unit_key"]: u for u in map(json.loads, open(os.path.join(land, "units.jsonl"), encoding="utf-8"))}
    secs = [json.loads(x) for x in open(os.path.join(land, "sections.jsonl"), encoding="utf-8")]
    manifest = json.load(open(os.path.join(land, "manifest.json")))
    rnd = random.Random(a.seed)
    must_rows = []
    for token in a.must_include:
        for s in secs:
            if s["citation_path"] == token or s.get("citation") == token:
                must_rows.append(s)
                break
    pool = [s for s in secs if s not in must_rows]
    sample_size = min(a.n, len(secs))
    extra = max(0, sample_size - len(must_rows))
    sample = must_rows + (rnd.sample(pool, min(extra, len(pool))) if pool and extra else [])
    tmp = tempfile.mkdtemp(prefix="review-")
    arc = sc.Archive(tmp, min_interval=1.0)
    results = []
    for s in sample:
        u = units[s["unit_key"]]
        rec = live_fetch(arc, u["source_url"], a.state)
        row = {"citation_path": s["citation_path"], "citation": s["citation"], "url": u["source_url"], "live_status": rec["http_status"],
               "route": rec["route"], "user_agent": rec.get("user_agent"), "ua_retry": rec.get("ua_retry", False)}
        if rec["state"] != "complete":
            row.update(ok=False, why="live fetch failed")
        else:
            body = arc.read(rec)
            live = squash(live_text(body, u["source_url"]))
            number = s["hierarchy"][-1].get("number") or ""
            citation = s.get("citation") or ""
            pub_num = publisher_section_number(body)
            if pub_num:
                sp, sn, sqc = squash(pub_num), squash(number), squash(citation)
                row["citation_ok"] = (bool(sn) and sp == sn) or (bool(sqc) and sp == sqc)
            else:
                row["citation_ok"] = bool(number) and squash(number) in live
            heading = s.get("heading") or ""
            parsed_row = (
                live_ks_section_row(body, u["source_url"], s)
                or live_ia_section_row(body, u["source_url"], s)
                or live_wv_section_row(body, u["source_url"], s)
            )
            ks_row = parsed_row
            if ks_row is not None:
                if ks_row.get("citation_token"):
                    wv_dir = os.path.join(HERE, "..", "wv")
                    if wv_dir not in sys.path:
                        sys.path.insert(0, wv_dir)
                    from wv_common import norm_slug  # noqa: WPS433
                    row["citation_ok"] = norm_slug(ks_row["citation_token"]) == norm_slug(
                        (s.get("citation_path") or s.get("citation") or "").replace("§", "")
                    )
                lh = ks_row.get("heading") or ""
                live_body = ks_row.get("text") or ""
                if not live_body.strip():
                    live_body = ks_row.get("status_label") or lh
                row["heading_ok"] = (not heading) or squash(heading) == squash(lh) or squash(heading) in squash(lh)
                if heading and not row["heading_ok"]:
                    row["heading_ok"] = squash(re.sub(r"\[[^\]]+\]", "", heading)) in squash(lh)
                row["text_ok"] = squash(s["text"]) == squash(live_body)
            else:
                row["heading_ok"] = (not heading) or squash(heading) in live
                if heading and not row["heading_ok"]:
                    row["heading_ok"] = squash(re.sub(r"\[[^\]]+\]", "", heading)) in live
                if heading and not row["heading_ok"]:
                    row["heading_ok"] = squash(heading.split("[", 1)[0].strip()) in live
                live_body = live_section_body(body)
                if live_body is not None:
                    row["text_ok"] = squash(s["text"]) == squash(live_body)
                else:
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
