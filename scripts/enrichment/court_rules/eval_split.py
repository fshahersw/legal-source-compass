"""Review aid: split every acquired PDF (or the ones named) and print method, section count, coverage and sample labels.

  python3 -I -B scripts/enrichment/court_rules/eval_split.py [path-substring ...]
"""
import glob
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fetchlib  # noqa: E402
import sections as S  # noqa: E402
import textlib  # noqa: E402


def main(argv):
    paths = sorted(glob.glob(os.path.join(fetchlib.ACQ, "**", "*.pdf"), recursive=True))
    if argv:
        paths = [p for p in paths if any(a in p for a in argv)]
    for p in paths:
        try:
            text = textlib.pdf_text(p)
        except Exception as error:
            print(f"ERR {p}: {error}")
            continue
        secs, method = S.split_sections(text)
        rel = os.path.relpath(p, fetchlib.ACQ)
        print(f"{len(secs):4} {method:10} pages={text.count(chr(12)) + 1:4} chars={len(text):7} cov={S.coverage(secs, text)} {rel[:70]}")
        if "-v" in os.environ.get("EVAL_FLAGS", "") or argv:
            for s in secs[:8]:
                print(f"     {s.label[:24]:24} | {s.title[:70]}")


if __name__ == "__main__":
    main(sys.argv[1:])
