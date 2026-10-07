#!/usr/bin/env python3
"""Re-fetch Missouri ViewChapter.aspx units and compare to corpus original_sha256.

Also records section ids listed on revisor.mo.gov/main/recent.aspx (Recent Sections).

    sweep.py --units /tmp/sc/MO/stored_units.json --root /tmp/sc/MO [--workers 8]
"""
import argparse
import hashlib
import json
import pathlib
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "b4"))
import sc_common as sc  # noqa: E402

BROWSER_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"


def recent_section_ids(arc: sc.Archive) -> list[str]:
    rec = arc.fetch("https://revisor.mo.gov/main/recent.aspx", accept="*/*", min_bytes=0)
    if rec.get("state") != "complete":
        return []
    body, _ = sc.decode_html(arc.read(rec))
    return sorted(set(re.findall(r"section=([0-9]+(?:\.[0-9]+[A-Za-z]*)?)", body)))


def chapter_for_section(sec_id: str) -> str:
    return "ch" + sec_id.split(".", 1)[0]


def fetch_one(arc: sc.Archive, unit: dict) -> dict:
    rec = arc.fetch(unit["url"], accept="*/*", min_bytes=8000, user_agent=BROWSER_UA, force=True)
    if rec.get("state") != "complete":
        return {"unit_key": unit["unit_key"], "ok": False, "http": rec.get("http_status")}
    raw = arc.read(rec)
    sha = hashlib.sha256(raw).hexdigest()
    path = pathlib.Path(arc.work) / "captures" / f"{sha}.bin"
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_bytes(raw)
    changed = sha != unit["original_sha256"]
    return {
        "unit_key": unit["unit_key"],
        "ok": True,
        "sha256": sha,
        "stored_path": str(path.relative_to(arc.work)),
        "url": unit["url"],
        "retrieved_at": rec.get("retrieved_at") or sc.utc_now(),
        "changed": changed,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--units", required=True)
    ap.add_argument("--root", required=True)
    ap.add_argument("--workers", type=int, default=8)
    args = ap.parse_args()
    units = json.load(open(args.units, encoding="utf-8"))
    root = pathlib.Path(args.root)
    root.mkdir(parents=True, exist_ok=True)
    arc = sc.Archive(str(root), min_interval=0.35, user_agent=BROWSER_UA)
    recent = recent_section_ids(arc)
    recent_chapters = sorted({chapter_for_section(s) for s in recent if "." in s})
    out = {"unchanged": [], "changed": [], "failed": [], "recent_section_ids": recent, "recent_chapters": recent_chapters}
    results = []
    with ThreadPoolExecutor(args.workers) as ex:
        for res in ex.map(lambda u: fetch_one(arc, u), units):
            results.append(res)
            if not res.get("ok"):
                out["failed"].append(res["unit_key"])
            elif res["changed"]:
                out["changed"].append(res["unit_key"])
            else:
                out["unchanged"].append(res["unit_key"])
    out["finished_at"] = sc.utc_now()
    json.dump(out, open(root / "sweep.json", "w"), indent=1)
    json.dump({r["unit_key"]: r for r in results if r.get("ok")}, open(root / "receipts.json", "w"), indent=1)
    print(json.dumps({k: (len(v) if isinstance(v, list) else v) for k, v in out.items()}))


if __name__ == "__main__":
    main()
