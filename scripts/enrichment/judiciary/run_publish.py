"""Run private/scratch/enrich/publish_build.py with the corpus credentials loaded into this process only.

Inside a worktree the shell may not source private/scratch/env.sh, so this wrapper reads its KEY=VALUE lines into os.environ
(nothing is printed, written or logged) and calls publish_build.main with the same arguments:

  python3 -I -B run_publish.py --check   private/build/judiciary/<dataset>.json [...]
  python3 -I -B run_publish.py --publish private/build/judiciary/<dataset>.json [...]

`--republish-judge-profiles` is the one exception the brief of 2026-10-22 grants: judge_profiles_fjc exists and was not
published by publish_build.py, so publish_build refuses it. For that dataset only, this wrapper performs publish_build's own
steps itself: validation, a backup of the live catalog row and every live record to
private/build/_published_backups/judge_profiles_fjc.<manifest>.json (written before anything is replaced), the publish, and
the record-by-record readback.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path("/home/user/legal-source-compass")
ENV = ROOT / "private" / "scratch" / "env.sh"
sys.path.insert(0, str(ROOT / "private" / "scratch" / "enrich"))
sys.path.insert(0, str(ROOT / "scripts" / "enrichment"))


def load_env() -> None:
    for line in ENV.read_text().splitlines():
        line = line.strip()
        if line.startswith("export "):
            line = line[7:].strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ[key.strip()] = value.strip().strip('"').strip("'")


def republish_judge_profiles(path: str) -> None:
    import corpus_writer as cw
    import publish_build as pb

    f = (ROOT / path).resolve()
    build = json.loads(f.read_text())
    if build.get("dataset") != "judge_profiles_fjc":
        raise SystemExit("--republish-judge-profiles accepts only the judge_profiles_fjc build file")
    problems = pb.validate(build)
    if problems:
        raise SystemExit("not publishable:\n  " + "\n  ".join(problems))
    build["summary"] = {**build["summary"], "published_by": pb.MARK, "build_file": str(f.relative_to(ROOT))}
    ds = build["dataset"]
    cat = pb.live_catalog(cw, ds)
    print(json.dumps({"dataset": ds, "live": bool(cat), "live_records": cat and cat.get("imported_records"), "rows": len(build["rows"]),
                      "sha256": pb.digest(build["rows"])}))
    if cat:
        pb.BACKUPS.mkdir(parents=True, exist_ok=True)
        backup = pb.BACKUPS / f"{ds}.{cat['manifest_sha256'][:16]}.json"
        if not backup.exists():
            live = pb.stored_rows(cw, ds)
            backup.write_text(json.dumps({"catalog": cat, "rows": live}))
            print(json.dumps({"backup": str(backup.relative_to(ROOT)), "rows": len(live)}))
    sent = json.loads(json.dumps(build["rows"]))
    cw.publish(ds, build["label"], build["rows"], listing_block=build["listing_block"], summary=build["summary"])
    back = pb.stored_rows(cw, ds)
    cat = pb.live_catalog(cw, ds)
    bad = [a["id"] for a, b in zip(sent, back) if a != b]
    if len(back) != len(sent) or bad or not cat or not cat["ready"] or cat["imported_records"] != len(sent):
        raise SystemExit(f"{ds}: readback mismatch ({len(back)} stored, {len(bad)} differ, e.g. {bad[:3]}; catalog {cat and cat.get('ready')})")
    print(json.dumps({"dataset": ds, "records": len(back), "manifest_sha256": cat["manifest_sha256"], "readback": "ok"}))


def main(argv: list[str]) -> None:
    load_env()
    os.chdir(ROOT)
    if argv and argv[0] == "--republish-judge-profiles":
        republish_judge_profiles(argv[1])
        return
    import publish_build as pb

    pb.main(argv)


if __name__ == "__main__":
    main(sys.argv[1:])
