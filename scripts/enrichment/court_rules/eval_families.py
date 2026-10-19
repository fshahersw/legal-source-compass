"""Review aid: for the PDFs named, show how many headings each label family finds, with samples.

  python3 -I -B scripts/enrichment/court_rules/eval_families.py <path-substring> [...]
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
    for p in [p for p in paths if any(a in p for a in argv)]:
        text = textlib.pdf_text(p)
        print("##", os.path.relpath(p, fetchlib.ACQ))
        for fam in S.FAMILIES:
            secs = S._resolve(S._candidates(text, fam), len(text))
            labels = [f"{s.label}|{s.title[:30]}" for s in secs]
            print(f"  {fam:10} n={len(secs):4} distinct={len({s.number for s in secs}):4} e.g. {labels[:3]} ... {labels[len(labels)//2:len(labels)//2+2]}")


if __name__ == "__main__":
    main(sys.argv[1:])
