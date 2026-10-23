"""Publish the DOJ press-release build files one at a time (partitions are stored gzip-compressed to save disk).

  python3 -I -B scripts/enrichment/enforcement_actions/publish_doj.py --check|--publish [YYYY ...]

For each partition: decompress private/build/enforcement_actions/doj_press_releases_YYYY.json.gz to .json, run the
lead's publish command (run_publish.py: `. private/scratch/env.sh && publish_build.py --publish <file>`), then the same
command with --check, and remove the decompressed copy. The index dataset doj_press_releases is published last, so the
partition list it carries never names a partition that is not live. Outputs are appended to
private/scratch/enrich/enforcement_actions/publish_doj.log.
"""
import gzip
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import enf_common as ec  # noqa: E402

LOG = os.path.join(ec.SCRATCH, "publish_doj.log")


def run(mode, rel):
    result = subprocess.run([sys.executable, "-I", "-B", os.path.join(HERE, "run_publish.py"), mode, rel],
                            capture_output=True, text=True)
    with open(LOG, "a", encoding="utf-8") as h:
        h.write(f"{ec.now_utc()} {mode} {rel} exit={result.returncode}\n{result.stdout}{result.stderr}\n")
    print(result.stdout.strip().splitlines()[-1] if result.stdout.strip() else result.stderr.strip()[-300:])
    return result.returncode


def main(argv):
    mode = argv[0] if argv and argv[0] in ("--check", "--publish") else None
    if not mode:
        raise SystemExit(__doc__)
    years = argv[1:]
    names = sorted(n for n in os.listdir(ec.BUILD) if n.startswith("doj_press_releases_") and n.endswith(".json.gz"))
    if years:
        names = [n for n in names if n[len("doj_press_releases_"):][:4] in years]
    for name in names:
        gz = os.path.join(ec.BUILD, name)
        plain = gz[:-3]
        with gzip.open(gz, "rb") as src, open(plain, "wb") as dst:
            shutil.copyfileobj(src, dst)
        rel = ec.rel(plain)
        try:
            code = run(mode, rel)
            if code == 0 and mode == "--publish":
                code = run("--check", rel)
            if code != 0:
                raise SystemExit(f"{name}: stopped (exit {code}); see {LOG}")
        finally:
            os.remove(plain)
    if not years:
        rel = ec.rel(os.path.join(ec.BUILD, "doj_press_releases.json"))
        code = run(mode, rel)
        if code == 0 and mode == "--publish":
            code = run("--check", rel)
        if code != 0:
            raise SystemExit(f"index: stopped (exit {code}); see {LOG}")


if __name__ == "__main__":
    main(sys.argv[1:])
