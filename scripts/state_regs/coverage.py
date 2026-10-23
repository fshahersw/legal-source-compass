"""Coverage matrix of the 51 jurisdictions: sources.py (publishers) + probe.json (measured robots/HTTP/currency) + the
build reports (what was acquired and checked). Writes private/build/w1025_regs/coverage.json (the matrix, for the docs and
the handoff) and codes.json (rows for public.state_reg_load_codes_v1).

  python3 -I -B scripts/state_regs/coverage.py
"""
from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402
from build import STATE_MODULES  # noqa: E402
from sources import SOURCES  # noqa: E402

# Acquisition verdicts that need a sentence (measured on 2026-10-23; see probe.json for the bytes).
NOTES = {
    "TX": ("deferred", "The TAC is served only through the Secretary of State's Rules and Meetings portal, an interactive application "
           "that builds every page through a stateful UI protocol (no bulk file, no documented API); the former readtac pages redirect "
           "there. Not acquired in this wave. The Texas Register issue index is acquired (state_register_issues)."),
    "PA": ("blocked", "robots.txt of www.pacodeandbulletin.gov disallows every path for all user agents other than named search engines "
           "(User-agent: * / Disallow: /); not fetched."),
    "AZ": ("blocked", "apps.azsos.gov and azsos.gov answer automated requests with a browser check (HTTP 403 'Just a moment...'); "
           "never bypassed."),
    "OK": ("blocked", "rules.ok.gov answers automated requests with a browser check (HTTP 403 'Attention Required'); never bypassed."),
    "TN": ("blocked", "sos.tn.gov and publications.tnsosfiles.com answer automated requests with HTTP 403 ('The request could not be "
           "satisfied'); not retried."),
    "ME": ("blocked", "www.maine.gov answers automated requests with HTTP 403 ('The request could not be satisfied'); not retried."),
    "MA": ("blocked", "The official text is sold by the Secretary of the Commonwealth; www.sec.state.ma.us also answers automated requests "
           "with a browser check (Incapsula)."),
    "WI": ("deferred", "docs.legis.wisconsin.gov reset every connection from the acquisition network on 2026-10-23 (it served the earlier "
           "index wave); retry from another network."),
    "NH": ("deferred", "gc.nh.gov closed every connection from the acquisition network on 2026-10-23 without a response; retry."),
    "UT": ("deferred", "adminrules.utah.gov is a single-page application (pages answer HTTP 404 and load data by script); its data "
           "interface is not documented. Not acquired in this wave."),
    "GA": ("index_only", "The rules site is on the state's domain but operated by a commercial vendor that claims copyright in the text; "
           "department, chapter and subject captions only."),
}


def load_json(path):
    with open(path, encoding="utf-8") as h:
        return json.load(h)


def report(st: str, run: str) -> dict | None:
    p = os.path.join(lib.BUILD, st, f"report-{run}.json")
    return load_json(p) if os.path.exists(p) else None


def main():
    probe = {p["state"]: p for p in load_json(os.path.join(lib.BUILD, "probe.json"))["states"]}
    matrix, codes = [], []
    for s in SOURCES:
        st = s["state"]
        pr = probe.get(st, {})
        code_p = pr.get("code") or {}
        reg_p = pr.get("register") or {}
        sample = report(st, "sample")
        index = report(st, "index")
        full = report(st, "full")
        if st in NOTES:
            verdict, reason = NOTES[st]
        elif s["status"] in ("commercial_only", "paid_official", "vendor_operated"):
            verdict, reason = "blocked", s.get("blocked")
        elif full:
            verdict, reason = "acquired", None
        elif sample and sample["summary"]["rules"]:
            verdict, reason = "sample", None
        elif st in STATE_MODULES:
            verdict, reason = "parser_ready", None
        else:
            verdict, reason = "not_started", "Publisher reachable; no parser yet in this wave." if code_p.get("result") == "ok" else (
                f"Publisher page answered {code_p.get('result')}.")
        currency = None
        if sample:
            rules = list(lib.read_jsonl_gz(os.path.join(lib.BUILD, st, sample["shard"]["file"])))
            cur = [r["currency"] for r in rules if r.get("currency")]
            currency = cur[0] if cur else None
        if not currency and code_p.get("currency_statements"):
            currency = code_p["currency_statements"][0]
        acq = {"text": verdict, "reason": reason,
               "sample": {"rules": sample["summary"]["rules"], "checks": sample["summary"]["checks"],
                          "file": sample["shard"]["file"], "sha256": sample["shard"]["sha256"]} if sample else None,
               "index": {"nodes": index["nodes"], "levels": index["levels"], "sha256": index["nodes_sha256"]} if index else None,
               "full": {"rules": full["totals"]["rules"], "units_done": full["units_done"], "units_total": full["units_total"]} if full else None}
        probe_row = {"result": code_p.get("result"), "status": code_p.get("status"), "robots": code_p.get("robots"),
                     "title": code_p.get("title"), "retrieved_at": code_p.get("retrieved_at"), "sha256": code_p.get("sha256"),
                     "browser_check": code_p.get("browser_check"), "currency_statements": code_p.get("currency_statements"),
                     "register": {"result": reg_p.get("result"), "robots": reg_p.get("robots"), "retrieved_at": reg_p.get("retrieved_at")}}
        row = {"state": st, "code_name": s["code"], "cite_form": s.get("cite"), "publisher": s["publisher"], "code_url": s["code_url"],
               "access": s["access"], "status": s["status"], "blocked_reason": s.get("blocked") or (reason if verdict == "blocked" else None),
               "acquisition": acq, "probe": probe_row, "terms_url": (code_p.get("terms_links") or [None])[0],
               "currency": currency, "edition": None, "register_name": s.get("register"), "register_url": s.get("register_url"),
               "register_freq": s.get("register_freq"), "register_note": s.get("register_note") or s.get("access_note")}
        codes.append(row)
        matrix.append({"state": st, "code": s["code"], "publisher": s["publisher"], "url": s["code_url"], "access": s["access"],
                       "status": s["status"], "robots": (code_p.get("robots") or {}).get("allowed"),
                       "crawl_delay": (code_p.get("robots") or {}).get("crawl_delay"), "http": code_p.get("result"),
                       "acquisition": verdict, "reason": reason, "currency": currency, "register": s.get("register"),
                       "register_url": s.get("register_url"), "register_http": reg_p.get("result"),
                       "sample_rules": sample["summary"]["rules"] if sample else 0,
                       "index_nodes": index["nodes"] if index else 0})
    with open(os.path.join(lib.BUILD, "coverage.json"), "w", encoding="utf-8") as h:
        json.dump({"generated_at": lib.utc_now(), "states": matrix}, h, indent=1)
    with open(os.path.join(lib.BUILD, "codes.json"), "w", encoding="utf-8") as h:
        json.dump(codes, h, indent=1)
    counts: dict = {}
    for m in matrix:
        counts[m["acquisition"]] = counts.get(m["acquisition"], 0) + 1
    print(json.dumps({"states": len(matrix), "acquisition": counts}))


if __name__ == "__main__":
    main()
