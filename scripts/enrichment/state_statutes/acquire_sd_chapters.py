"""Fetch the publisher's statute record (JSON, with CatchLine) for SD titles and chapters whose caption is not
printed in the whole-title documents: acquire_sd_chapters.py <acq_dir>. Run after acquire_sd.py and
acquire_sd_records.py; safe to re-run (already fetched records are skipped).

Endpoint: https://sdlegislature.gov/api/Statutes/Statute/{number} (the same official API the site uses).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_state_code_sd as b  # noqa: E402
import fetchlib  # noqa: E402
import parse_sd  # noqa: E402


def main(acq_dir):
    acq = Path(acq_dir)
    manifest_path = acq / "_manifest.jsonl"
    got = b.collect(acq)
    need = [t for t, lab in got["title_labels"].items() if lab == f"TITLE {t}"]
    need += sorted({b.chapter_of(e["number"]) for e in got["entries"]} - set(got["chapter_labels"]))
    manifest = fetchlib.load_manifest(manifest_path)
    print("to fetch:", len(need))
    for number in need:
        url = f"{parse_sd.SITE}/api/Statutes/Statute/{number}"
        if url in manifest and manifest[url]["status"] in (200, 404):
            continue
        status, body = fetchlib.get(url, interval=1.0)
        fetchlib.store(manifest_path, acq / "records" / f"{number}.json.gz", url, status, body)
    print("done")


if __name__ == "__main__":
    main(sys.argv[1])
