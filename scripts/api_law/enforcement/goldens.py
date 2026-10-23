"""Golden vectors for the TypeScript port of extract.py (src/lib/ingest/sources/enforcementText.ts).

Runs the original Python extractors (scripts/enrichment/enforcement_actions/extract.py, build_common.clip/money_label)
on real DOJ press releases (the harvested News API pages) and SEC litigation releases (the stored release pages), and
writes inputs with every output. Read-only use of private/acq/enforcement_actions/.

  python3 -I -B scripts/api_law/enforcement/goldens.py --out FILE [--doj-pages 120] [--per-page 2] [--sec 80] [--seed 7]
"""
import argparse
import gzip
import json
import os
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
EA = ROOT / "scripts" / "enrichment" / "enforcement_actions"
sys.path.insert(0, str(EA))
sys.path.insert(0, str(EA.parent))
import build_common as bc  # noqa: E402
import build_doj  # noqa: E402
import build_sec  # noqa: E402
import enf_common as ec  # noqa: E402
import extract as ex  # noqa: E402

ACQ = ROOT / "private" / "acq" / "enforcement_actions"


def outputs(title, text, date, earlier_months):
    spans = ex.sentence_spans(text)
    amounts = ex.extract_amounts(text, spans)
    return {
        "spans": [list(s) for s in spans],
        "amounts": amounts,
        "statutes": ex.extract_statutes(text),
        "dockets": ex.extract_dockets(text),
        "courts": ex.extract_courts(text),
        "court_cites": ex.extract_court_cites(text),
        "parties": ex.title_parties(title, text),
        "title_figures": ex.title_figures(title),
        "headline": ex.headline_figure(title, amounts, date, earlier_months),
        "clip_1500": list(bc.clip(text, 1500)),
        "clip_900": list(bc.clip(text, 900)),
        "money_labels": [bc.money_label(a["value_usd"]) for a in amounts if a.get("value_usd") is not None],
        "buckets": [bc.amount_bucket(a.get("value_usd")) for a in amounts],
        "normalized": [ex.normalize_company(p["as_written"]) for p in ex.title_parties(title, text)],
        "verify": ex.verify_spans(text, amounts + ex.extract_statutes(text) + ex.extract_dockets(text) + ex.extract_courts(text)),
    }


def doj_cases(n_pages, per_page, rng):
    pages = sorted(p for p in os.listdir(ACQ / "doj" / "pages") if p.endswith(".json.gz"))
    pick = sorted(rng.sample(pages, min(n_pages, len(pages))))
    out = []
    for p in pick:
        data = json.loads(gzip.open(ACQ / "doj" / "pages" / p).read())
        results = [r for r in (data.get("results") or []) if r.get("uuid")]
        for r in rng.sample(results, min(per_page, len(results))):
            body = r.get("body") or ""
            raw_title = r.get("title") or ""
            title = __import__("re").sub(r"\s+", " ", __import__("html").unescape(ex._TAG.sub(" ", raw_title))).strip()
            text = ex.html_to_text(body)
            date = build_doj.epoch_date(r.get("date"))
            out.append({"kind": "doj", "page": p, "uuid": r["uuid"], "raw_title": raw_title, "body": body, "date": date,
                        "title": title, "text": text, "teaser_text": ex.html_to_text(r.get("teaser") or ""),
                        "out": outputs(title, text, date, 2)})
    return out


def sec_cases(n, rng):
    reader = ec.PackReader(str(ACQ / "sec" / "releases"))
    urls = sorted(u for u in reader.index if "/litigation-releases/" in u or "/litreleases/" in u)
    out = []
    for url in sorted(rng.sample(urls, min(n, len(urls)))):
        title, text = build_sec.release_text(url, reader)
        if not text:
            continue
        raw = reader.get(url).decode("utf-8", "replace")
        out.append({"kind": "sec", "url": url, "page": raw if len(raw) < 400_000 else None, "title": title, "text": text,
                    "date": None, "out": outputs(title, text, None, 6)})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--doj-pages", type=int, default=120)
    ap.add_argument("--per-page", type=int, default=2)
    ap.add_argument("--sec", type=int, default=80)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--no-bodies", action="store_true", help="drop raw HTML (smaller committed fixture)")
    a = ap.parse_args()
    rng = random.Random(a.seed)
    cases = doj_cases(a.doj_pages, a.per_page, rng) + sec_cases(a.sec, rng)
    if a.no_bodies:
        for c in cases:
            c.pop("page", None)
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as h:
        json.dump({"generator": "scripts/api_law/enforcement/goldens.py", "seed": a.seed, "cases": cases}, h, ensure_ascii=False)
    print(json.dumps({"cases": len(cases), "doj": sum(c["kind"] == "doj" for c in cases), "sec": sum(c["kind"] == "sec" for c in cases),
                      "bytes": os.path.getsize(a.out)}))


if __name__ == "__main__":
    main()
