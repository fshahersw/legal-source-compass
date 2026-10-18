"""Developer aid: print the rows the layout reader finds on given pages of a profile PDF.

Usage: python3 -I -B survey.py <pdf> <kind: district|circuit> <page numbers comma-separated>
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import profiles  # noqa: E402


def main():
    path, kind, pages = sys.argv[1], sys.argv[2], [int(p) for p in sys.argv[3].split(",")]
    for page in profiles.read_pdf(path, kind, pages=pages):
        print(json.dumps({k: v for k, v in page.items() if k not in ("rows", "panels")}))
        for p, panel in enumerate(page.get("panels", [])):
            for row in panel:
                print(f"  p{p} {row['label'][:60]:60s} | {' '.join(row['values'].get(y, '.') for y in page['years'][p])} | {row['standing']} {row['stray'] or ''}")


if __name__ == "__main__":
    main()
