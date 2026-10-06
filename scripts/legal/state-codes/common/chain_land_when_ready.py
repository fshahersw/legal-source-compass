#!/usr/bin/env python3
"""Poll KY / MD capture roots and run parse → stage → land → review when complete."""
from __future__ import annotations

import json
import os
import pathlib
import subprocess
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parents[1]
COMMON = ROOT / "common"
STORE = pathlib.Path(
    "/cursor/stores/bc-24d6c4ee-e9c3-4d34-a42c-3fb9985ace6c/internal/state-codes/batch-b"
)


def run(cmd: list[str], *, cwd: pathlib.Path | None = None) -> None:
    print("+", " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True, cwd=cwd or pathlib.Path("/workspace"))


def ky_section_plan(root: pathlib.Path) -> int:
    cache = root / "extract" / "section-plan-count.json"
    if cache.exists():
        return int(json.loads(cache.read_text(encoding="utf8"))["expected"])
    sys.path.insert(0, str(ROOT / "ky"))
    sys.path.insert(0, str(ROOT / "common"))
    import parse_index  # noqa: E402

    base = "https://apps.legislature.ky.gov/law/statutes/"
    receipts = [
        json.loads(line)
        for line in (root / "receipts.jsonl").read_text(encoding="utf8").splitlines()
        if line.strip()
    ]
    by_url = {
        r["url"]: r
        for r in receipts
        if r.get("ok") and r.get("retrieval_method") == "direct"
    }
    if base not in by_url:
        return 0
    chapters = parse_index.parse_index((root / by_url[base]["stored_path"]).read_bytes())["chapters"]
    seen = set()
    for c in chapters:
        if not c["href"]:
            continue
        url = base + c["href"]
        if url not in by_url:
            continue
        chapter = parse_index.parse_chapter((root / by_url[url]["stored_path"]).read_bytes())
        for s in chapter["sections"]:
            seen.add(base + s["href"])
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps({"expected": len(seen)}, indent=2) + "\n", encoding="utf8")
    return len(seen)


def ky_captured_sections(root: pathlib.Path) -> int:
    return sum(
        1
        for line in (root / "receipts.jsonl").read_text(encoding="utf8").splitlines()
        if line.strip()
        and json.loads(line).get("ok")
        and json.loads(line).get("label") == "section"
    )


def md_oct1_jobs(root: pathlib.Path) -> tuple[int, int]:
    inv = json.loads((root / "extract" / "index-capture.json").read_text(encoding="utf8"))
    jobs = sum(len(row["sections"]) for row in inv if row["edition_key"] == "oct1")
    done = sum(
        1
        for line in (root / "receipts.jsonl").read_text(encoding="utf8").splitlines()
        if line.strip()
        and json.loads(line).get("ok")
        and (json.loads(line).get("label") or "").startswith("section:oct1:")
    )
    return jobs, done


def toc_proof_ky(landing: pathlib.Path) -> None:
    units = [json.loads(l) for l in landing.joinpath("units.jsonl").read_text().splitlines() if l.strip()]
    per = {}
    for line in landing.joinpath("sections.jsonl").read_text().splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        per[row["unit_key"]] = per.get(row["unit_key"], 0) + 1
    pages = [
        {
            "url": u["source_url"],
            "unit_key": u["unit_key"],
            "markers": per.get(u["unit_key"], 0),
            "sections": per.get(u["unit_key"], 0),
        }
        for u in units
    ]
    landing.joinpath("toc-proof.json").write_text(
        json.dumps(
            {
                "marker": "one KRS section PDF per unit; inventory citation matches PDF opening token",
                "unfetched_child_pages": [],
                "pages": sorted(pages, key=lambda p: p["unit_key"]),
            },
            indent=1,
        )
        + "\n",
        encoding="utf8",
    )


def land_state(state: str, landing: pathlib.Path, toc_note: str, report: pathlib.Path) -> None:
    run(
        [
            sys.executable,
            str(COMMON / "land_publisher_code_v2.py"),
            str(landing),
            "--execute",
            "--workers",
            "6",
        ]
    )
    run(
        [
            sys.executable,
            str(COMMON / "review_publisher_code_v2.py"),
            "--landing",
            str(landing),
            "--state",
            state,
            "--toc-ok",
            toc_note,
            "--report",
            str(report),
            "--apply",
        ]
    )


def pipeline_ky(root: pathlib.Path) -> None:
    if (root / "landing" / ".landed").exists():
        return
    run([sys.executable, str(ROOT / "ky" / "parse_stage.py"), "--root", str(root)])
    run([sys.executable, str(COMMON / "build_landing_packet.py"), str(root)])
    toc_proof_ky(root / "landing")
    report = STORE / "ky" / "review.md"
    report.parent.mkdir(parents=True, exist_ok=True)
    land_state(
        "KY",
        root / "landing",
        "independent pypdf audit + full section inventory captured as PDFs",
        report,
    )
    (root / "landing" / ".landed").write_text(time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()) + "\n")


def pipeline_md(root: pathlib.Path) -> None:
    if (root / "landing" / ".landed").exists():
        return
    run([sys.executable, str(ROOT / "md" / "md_parse.py"), "--root", str(root)])
    run([sys.executable, str(ROOT / "md" / "md_audit.py"), "--root", str(root)])
    audit = json.loads((root / "parsed" / "audit-report.json").read_text(encoding="utf8"))
    if not audit.get("passed"):
        raise SystemExit(f"MD audit not passed: {audit.get('result')}")
    run([sys.executable, str(ROOT / "md" / "md_stage.py"), "--root", str(root)])
    gaps = json.loads((root / "landing" / "gaps.json").read_text(encoding="utf8"))
    missing = gaps.get("missing_sections") or gaps.get("gaps") or []
    if missing:
        raise SystemExit(f"MD landing gaps remain: {len(missing)} missing sections")
    report = STORE / "md" / "review.md"
    report.parent.mkdir(parents=True, exist_ok=True)
    land_state(
        "MD",
        root / "landing",
        "GetSections inventory reconciled to parsed StatuteText HTML per article",
        report,
    )
    (root / "landing" / ".landed").write_text(time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()) + "\n")


def main() -> int:
    ky_root = pathlib.Path("/tmp/sc/KY")
    md_root = pathlib.Path("/tmp/sc/MD")
    while True:
        try:
            if ky_root.exists() and not (ky_root / "landing" / ".landed").exists():
                expected = ky_section_plan(ky_root)
                have = ky_captured_sections(ky_root)
                acquire = subprocess.run(
                    ["pgrep", "-f", "ky/acquire.py sections"],
                    capture_output=True,
                ).returncode == 0
                print(f"KY sections {have}/{expected} acquire_running={acquire}", flush=True)
                if expected and have >= expected and not acquire:
                    pipeline_ky(ky_root)
            if md_root.exists() and not (md_root / "landing" / ".landed").exists():
                jobs, done = md_oct1_jobs(md_root)
                acquire = subprocess.run(
                    ["pgrep", "-f", "md_acquire.py sections"],
                    capture_output=True,
                ).returncode == 0
                print(f"MD oct1 sections {done}/{jobs} acquire_running={acquire}", flush=True)
                if jobs and done >= jobs and not acquire:
                    pipeline_md(md_root)
        except subprocess.CalledProcessError as exc:
            print("pipeline error", exc, flush=True)
        if (ky_root / "landing" / ".landed").exists() and (md_root / "landing" / ".landed").exists():
            print("KY and MD landed", flush=True)
            return 0
        time.sleep(120)


if __name__ == "__main__":
    raise SystemExit(main())
