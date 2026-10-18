"""Draw the deterministic review sample for the hazard-theme precision check and print short context windows.

The windows are printed to the terminal / an --out file only (never stored in the build): the reviewer reads them, records
a verdict per sampled position in private/scratch/enrich/saferproducts/theme_verdicts_<round>.json, and
`theme_precision.py` turns the verdicts into counts-only precision estimates
(private/build/saferproducts/lookups/theme_precision.json).

  python3 -I -B scripts/enrichment/saferproducts/theme_sample.py [--out file] <round-label> <sample-size> <theme> [<theme> ...]

Sample order: matching reports sorted by sha256("<round-label>|<theme>|<report no>"), first <sample-size> kept.
"""
import csv
import hashlib
import io
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import spdb_lib as L  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "saferproducts")
WINDOW = 95


def descriptions():
    """report_no -> incident description (read with the same CSV rules as the builder)."""
    text, _enc = L.decode_export(L.read_member(ACQ, "IncidentReports.csv"))
    body = text.split("\n", 1)[1]
    out = {}
    for row in csv.DictReader(io.StringIO(body, newline="")):
        out[L.clean(row["Report No."])] = row["Incident Description"] or ""
    return out


def write_retry(path, text, tries=240):
    """Write `text` to `path`, retrying while the shared disk is momentarily full (ENOSPC)."""
    for _attempt in range(tries):
        try:
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(text)
            return True
        except OSError:
            time.sleep(1)
    return False


def sample(desc, label, theme, size):
    """[(report_no, lowered text, match)] for the first `size` matches in hash order, plus the match count."""
    _lab, rx, stems = L.THEMES[theme]
    hits = []
    for number, text in desc.items():
        lowered = text.lower().replace("’", "'")
        if lowered and any(s in lowered for s in stems):
            match = rx.search(lowered)
            if match:
                key = hashlib.sha256(("%s|%s|%s" % (label, theme, number)).encode()).hexdigest()
                hits.append((key, number, lowered, match))
    hits.sort()
    return [(n, t, m) for _k, n, t, m in hits[:size]], len(hits)


def main(argv):
    out_path = None
    if argv[:1] == ["--out"]:
        out_path, argv = argv[1], argv[2:]
    lines = []
    emit = lines.append if out_path else print
    label, size, themes = argv[0], int(argv[1]), argv[2:]
    desc = descriptions()
    for theme in themes:
        picked, total = sample(desc, label, theme, size)
        emit("=== %s: %d matching reports; sample of %d (round %s)" % (theme, total, len(picked), label))
        for i, (number, lowered, match) in enumerate(picked, 1):
            start, end = max(0, match.start() - WINDOW), min(len(lowered), match.end() + WINDOW)
            window = " ".join(lowered[start:end].split())
            emit("%2d [%s] ...%s..." % (i, number.split("-")[1], window))
    if out_path:
        write_retry(out_path, "\n".join(lines) + "\n")


if __name__ == "__main__":
    main(sys.argv[1:])
