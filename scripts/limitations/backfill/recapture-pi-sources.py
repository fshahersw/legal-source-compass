#!/usr/bin/env python3
"""Re-capture each state's personal-injury rule source for derived claim types (e.g. 42 U.S.C. § 1983 borrowing).

For every jurisdiction, takes the active personal-injury rule from the built release (LIM_BUNDLE), picks the source
whose retained text holds the rule's literal period evidence, and captures that official URL again with capture.py
under LIM_WORK as `pi-<st>`. Reports whether the rule's excerpt and period evidence are still literal in the fresh
capture. Usage: LIM_BUNDLE=... LIM_WORK=... recapture-pi-sources.py
"""
import json
import os
import re
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).parent
BUNDLE = Path(os.environ["LIM_BUNDLE"])
WORK = Path(os.environ["LIM_WORK"])


def norm(s):
    return re.sub(r"\s+", " ", s or "").strip().lower()


def main():
    rules = {r["id"]: r for r in json.loads((BUNDLE / "rules.json").read_text())["rules"]}
    sources = {s["id"]: s for s in json.loads((BUNDLE / "sources.json").read_text())["sources"]}
    coverage = json.loads((BUNDLE / "coverage.json").read_text())["coverage"]
    jobs = []
    for row in coverage:
        cell = next((c for c in row["claimCoverage"] if c["claimType"] == "personal_injury"), None)
        rule = rules.get(cell.get("ruleId")) if cell else None
        if not rule:
            continue
        evidence = norm((rule.get("provenance") or {}).get("periodEvidence"))
        chosen = None
        for sid in rule["sourceIds"]:
            src = sources.get(sid)
            text_path = BUNDLE / "text" / Path(src.get("textPath", "")).name if src else None
            if src and text_path and text_path.exists() and evidence and evidence in norm(text_path.read_text(encoding="utf-8")):
                chosen = src
                break
        chosen = chosen or sources.get(rule["sourceIds"][0])
        jobs.append((row["state"], rule, chosen))

    env = {**os.environ, "REQUESTS_CA_BUNDLE": "/root/.ccr/ca-bundle.crt"}

    def run(job):
        state, rule, src = job
        cid = f"pi-{state.lower()}"
        p = subprocess.run(["python3", str(HERE / "capture.py"), state, cid, src["url"]], capture_output=True, text=True, env=env, timeout=600)
        result = {"state": state, "ruleId": rule["id"], "sourceId": src["id"], "url": src["url"], "ok": p.returncode == 0}
        txt = WORK / "captures" / state / f"{cid}.txt"
        if txt.exists() and p.returncode == 0:
            t = norm(txt.read_text(encoding="utf-8"))
            prov = rule.get("provenance") or {}
            result["periodEvidenceLiteral"] = norm(prov.get("periodEvidence")) in t
            result["excerptLiteral"] = norm(prov.get("excerpt")) in t
        else:
            result["error"] = ((p.stdout or p.stderr).strip().splitlines() or [""])[-1][:200]
        return result

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(run, jobs))
    (WORK / "pi-recapture.json").write_text(json.dumps(results, indent=1))
    for r in results:
        print(r["state"], "ok" if r["ok"] else "FAIL", r.get("periodEvidenceLiteral"), r.get("excerptLiteral"), r.get("error", "")[:120])


if __name__ == "__main__":
    main()
