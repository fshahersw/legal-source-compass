"""Re-runnable pipeline for the mdl-intel lane.

  python3 download_jpml.py          # JPML statistics + hearing PDFs (raw)
  python3 download_govinfo.py       # GovInfo JPML MODS (raw)
  python3 fetch_court_pages.py      # official court MDL pages (raw + extraction)
  python3 run_all.py [--dry]        # parse, build and publish the four mdl_intel_ datasets
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import build_courts_summary  # noqa: E402
import build_hearings  # noqa: E402
import build_stats  # noqa: E402
from common import ACQ, pdftotext  # noqa: E402

TXT = ACQ / "txt"


def ensure_reports():
    TXT.mkdir(exist_ok=True)
    for name, pattern in (("by_type.txt", "*Pending_MDL_Dockets_By_MDL_Type-October-1-2026.pdf"), ("by_district.txt", "*Pending_MDL_Dockets_By_District-October-1-2026.pdf")):
        src = sorted((ACQ / "jpml").glob(pattern))
        if src:
            (TXT / name).write_text(pdftotext(src[0]))


def main(dry=False):
    ensure_reports()
    if dry:
        _, stats = build_stats.build()
        hrows, hov, matters, _ = build_hearings.build()
        print("stats years", len(stats["series"]), "hearing rows", len(hrows))
        return
    build_stats.publish()
    _, stats = build_stats.build()
    build_hearings.publish()
    hrows, hov, matters, _ = build_hearings.build()
    hov["_matters"] = matters
    build_courts_summary.publish(stats, hov, hov["panel_page_orders"])


if __name__ == "__main__":
    main(dry="--dry" in sys.argv)
