#!/usr/bin/env python3
"""Prove parsed MO sections contain live-forward needles for a list of citation paths."""
import argparse
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "b4"))
import sc_common as sc  # noqa: E402

from parse import parse_chapter  # noqa: E402


def squash(t):
    import html as html_mod

    t = html_mod.unescape(t or "")
    t = t.replace("\u00ad", "").replace("\u200b", "")
    return re.sub(r"\s+", "", t)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="/tmp/sc/MO")
    ap.add_argument("--paths", nargs="+", required=True)
    args = ap.parse_args()
    root = pathlib.Path(args.root)
    receipts = json.load(open(root / "receipts.json"))
    by_ch = {}
    for path in args.paths:
        ch = path.split(".", 1)[0]
        by_ch.setdefault(ch, []).append(path)
    bad = []
    for ch, paths in sorted(by_ch.items()):
        rec = receipts.get(f"ch{ch}")
        if not rec:
            bad.append({"chapter": ch, "reason": "no receipt"})
            continue
        html_s, _ = sc.decode_html((root / rec["stored_path"]).read_bytes())
        parsed = {s["id"]: s for s in parse_chapter(html_s, ch)}
        for path in paths:
            sec = parsed.get(path)
            if not sec:
                bad.append({"path": path, "reason": "not parsed"})
                continue
            rec_url = f"https://revisor.mo.gov/main/ViewChapter.aspx?chapter={ch}"
            live = squash(sc.html_text(sc.decode_html(sc_common_fetch(rec_url))[0]))
            st = squash(sec["text"] + (sec.get("history") or ""))
            if st not in live:
                bad.append({"path": path, "reason": "not in live", "tail": sec["text"][-80:]})
    print(json.dumps({"checked": len(args.paths), "bad": bad}, indent=1))


def sc_common_fetch(url):
    import urllib.request

    req = urllib.request.Request(
        url,
        headers={"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36"},
    )
    return urllib.request.urlopen(req, timeout=120).read()


if __name__ == "__main__":
    main()
