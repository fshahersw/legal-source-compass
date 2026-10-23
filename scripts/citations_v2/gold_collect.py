"""Collects the text windows of the citation gold set (read-only; nothing is written to production).

    set -a; . private/scratch/env.sh; set +a     # inside the one command that needs it
    python3 -I -B scripts/citations_v2/gold_collect.py filings  --n 48 --out private/build/w1025_cite/gold/filings.jsonl
    python3 -I -B scripts/citations_v2/gold_collect.py opinions --n 26 --out private/build/w1025_cite/gold/opinions.jsonl
    python3 -I -B scripts/citations_v2/gold_collect.py reports  --out private/build/w1025_cite/gold/reports.jsonl

Sources (every window keeps its provenance and the sha256 of the full source text it was cut from):
  filings   stored page text of indexed court filings (documents/1 layer, display rule applied), read through the read-only
            RPC documents_export_pages_v1 (GET); a byte set is picked by a seeded random sha256 prefix, so the sample is
            uniform over the indexed sets. Two windows in three come from a page holding a citation-like token (§, " v. ",
            U.S.C., C.F.R., a reporter-like "123 X. 456"), one in three from any page (citation-free text measures false
            positives).
  opinions  opinion text from the private case-law reading store (one ranged GET of one gzip member per opinion), chosen
            by a seeded draw over the local index files of three tiers (Supreme Court, federal appellate/district, state).
  reports   oversight and legal reports from official publishers: GAO (Principles of Federal Appropriations Law chapters)
            and DOJ Office of the Inspector General audit reports (PDF -> pdftotext). The raw PDF is deleted after its text
            and sha256 are recorded. CRS reports were not used: congress.gov answers 403 to scripted requests and its
            robots.txt disallows automated agents (recorded in the handoff).
Window: about 1,500 characters, starting and ending at whitespace, at a seeded offset.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import random
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
UA = "LegalSourceAtlas research contact@legal-source-atlas.example"
WINDOW = 1500
TRIGGER = re.compile(r"§|\sv\.\s|U\.\s?S\.\s?C|C\.\s?F\.\s?R|Fed\.\s?R|\b\d{1,4}\s+[A-Z][A-Za-z.]{0,12}\s?(?:\d[a-z]{1,2}\s)?\d{1,6}\b")

REPORT_URLS = [
    ("gao", "https://www.gao.gov/assets/2019-11/675699.pdf"),
    ("gao", "https://www.gao.gov/assets/2019-11/675709.pdf"),
    ("doj_oig", "https://oig.justice.gov/sites/default/files/reports/26-104.pdf"),
    ("doj_oig", "https://oig.justice.gov/sites/default/files/reports/21-011.pdf"),
]


def creds() -> tuple[str, str]:
    url = os.environ.get("EXTERNAL_SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("EXTERNAL_SUPABASE_KEY") or ""
    if not url or not key:
        raise SystemExit("EXTERNAL_SUPABASE_URL and EXTERNAL_SUPABASE_KEY must be set in the environment")
    return url, key


def headers(key: str) -> dict:
    h = {"apikey": key, "Accept": "application/json", "User-Agent": UA}
    if not key.startswith("sb_"):
        h["Authorization"] = f"Bearer {key}"
    return h


def sha(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def window(text: str, rng: random.Random, anchor: int | None = None) -> tuple[int, str]:
    if len(text) <= WINDOW + 200:
        return 0, text
    if anchor is None:
        start = rng.randrange(0, len(text) - WINDOW)
    else:
        start = max(0, min(len(text) - WINDOW, anchor - rng.randrange(100, WINDOW - 100)))
    while start > 0 and not text[start - 1].isspace():
        start -= 1
    end = min(len(text), start + WINDOW)
    while end < len(text) and not text[end].isspace():
        end += 1
    return start, text[start:end]


def filings(n: int, out: Path, seed: str) -> None:
    url, key = creds()
    rng = random.Random(seed)
    rows = []
    seen = set()
    i = 0
    while len(rows) < n and i < n * 4:
        prefix = hashlib.sha256(f"{seed}:{i}".encode()).hexdigest()[:12]
        i += 1
        q = urllib.parse.urlencode({"p_after": prefix, "p_limit": 1})
        req = urllib.request.Request(f"{url}/rest/v1/rpc/documents_export_pages_v1?{q}", headers=headers(key))
        with urllib.request.urlopen(req, timeout=120) as res:
            data = json.loads(res.read().decode("utf-8"))
        pages = [p for p in data.get("pages") or [] if len(p.get("text") or "") >= 600]
        if not pages or pages[0]["sha256"] in seen:
            continue
        seen.add(pages[0]["sha256"])
        want_trigger = len(rows) % 3 != 2
        pool = [p for p in pages if TRIGGER.search(p["text"])] if want_trigger else pages
        if not pool:
            pool = pages
        p = rng.choice(pool)
        anchor = None
        if want_trigger:
            hits = [m.start() for m in TRIGGER.finditer(p["text"])]
            anchor = rng.choice(hits) if hits else None
        off, text = window(p["text"], rng, anchor)
        rows.append({"id": f"filing-{len(rows) + 1:02d}", "source": "court_filing", "sha256": p["sha256"], "page": p["page"],
                     "page_text_sha256": sha(p["text"]), "page_chars": len(p["text"]), "offset": off, "text": text,
                     "stratum": "citation_token" if want_trigger else "any_page",
                     "provenance": "documents_export_pages_v1 (corpus_ingest.pdf_text_pages, indexed byte sets)"})
        time.sleep(0.3)
    write(out, rows)


STATE_TRIGGER = re.compile(r"(Ann\.|Stat\.|Code|Laws|Regs\.|Admin\.|ILCS|N\.J\.S\.A|O\.C\.G\.A|R\.S\.|RCW|C\.R\.S|Const\.|C\.F\.R|CFR|Fed\. ?Reg)\s*(§|tit\.|art\.|[0-9])")

# Second stratum of filings: pages chosen read-only in SQL (seeded hash over an 8% block sample of indexed pages whose
# text holds a statute/regulation token, STATE_TRIGGER) -- the list is in gold/state_pages.json; the window is anchored
# on a token occurrence.
def filings_list(listing: Path, out: Path, seed: str, start_id: int) -> None:
    url, key = creds()
    rng = random.Random(seed)
    pairs = json.loads(listing.read_text(encoding="utf-8"))
    rows = []
    seen = set()
    for sha256, page in pairs:
        if sha256 in seen:
            continue
        seen.add(sha256)
        q = urllib.parse.urlencode({"p_after": sha256[:63], "p_limit": 1})
        req = urllib.request.Request(f"{url}/rest/v1/rpc/documents_export_pages_v1?{q}", headers=headers(key))
        with urllib.request.urlopen(req, timeout=120) as res:
            data = json.loads(res.read().decode("utf-8"))
        pg = [p for p in data.get("pages") or [] if p["sha256"] == sha256 and int(p["page"]) == int(page)]
        if not pg:
            continue
        p = pg[0]
        hits = [m.start() for m in STATE_TRIGGER.finditer(p["text"])]
        off, text = window(p["text"], rng, rng.choice(hits) if hits else None)
        rows.append({"id": f"filing-{start_id + len(rows):02d}", "source": "court_filing", "sha256": sha256, "page": int(page),
                     "page_text_sha256": sha(p["text"]), "page_chars": len(p["text"]), "offset": off, "text": text,
                     "stratum": "statute_regulation_token",
                     "provenance": "documents_export_pages_v1 (corpus_ingest.pdf_text_pages, indexed byte sets)"})
        time.sleep(0.3)
    write(out, rows)


# Federal Register rules from GovInfo (the official GPO edition, one HTML <pre> per document); chosen in SQL by a seeded hash
# over federal_register_history rules (ordinal 200,000-400,000) that span 8-40 pages. federalregister.gov answered its
# plain-text URLs with a CAPTCHA page (bot check) and is not used.
FR_DOCS = [
    ("2018-06-06", "2018-12081"),
    ("2016-07-29", "2016-17230"),
    ("2015-09-03", "2015-21782"),
    ("2016-05-06", "2016-09059"),
    ("2017-10-13", "2017-22128"),
]


def federal_register(out: Path, seed: str, per_doc: int = 4) -> None:
    import html as htmllib

    rng = random.Random(seed)
    rows = []
    for day, docno in FR_DOCS:
        url = f"https://www.govinfo.gov/content/pkg/FR-{day}/html/{docno}.htm"
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=120) as res:
            raw = res.read()
        body = raw.decode("utf-8", "replace")
        m = re.search(r"<pre>(.*)</pre>", body, re.S)
        if not m:
            raise SystemExit(f"no <pre> text in {url}")
        text = htmllib.unescape(re.sub(r"<[^>]+>", "", m.group(1)))
        hits = [mm.start() for mm in STATE_TRIGGER.finditer(text)]
        rng.shuffle(hits)
        taken: list[tuple[int, int]] = []
        for hit in hits:
            if len(taken) >= per_doc:
                break
            off, win = window(text, rng, hit)
            if any(off < b and a < off + len(win) for a, b in taken):
                continue  # windows of one document never overlap, so no citation is counted twice
            taken.append((off, off + len(win)))
            rows.append({"id": f"fedreg-{len(rows) + 1:02d}", "source": "federal_register", "url": url,
                         "raw_sha256": hashlib.sha256(raw).hexdigest(), "text_sha256": sha(text), "text_chars": len(text),
                         "offset": off, "text": win, "provenance": "GovInfo FR HTML (<pre> text, tags removed, entities decoded)",
                         "retrieved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
        time.sleep(3)
    write(out, rows)


def opinions(n: int, out: Path, seed: str, start_id: int = 1, trigger: re.Pattern | None = None, tiers_plan: list[str] | None = None) -> None:
    url, key = creds()
    rng = random.Random(seed)
    index_dir = ROOT / "private" / "build" / "caselaw_read" / "read" / "index"
    files = sorted(p.name for p in index_dir.glob("*.tsv.gz"))
    tiers = {
        "t1": [f for f in files if f.startswith("t1__scotus__19") or f.startswith("t1__scotus__20")],
        "t2": [f for f in files if f.startswith("t2__") and re.match(r"t2__(ca\d|cadc|cafc|dcd|nysd|cand|ilnd|txsd|paed|njd)", f)],
        "t3": [f for f in files if f.startswith("t3__") and re.search(r"(cal|ny|tex|fla|ill|pa|nj|ohio|mass|wash)", f)],
    }
    plan = tiers_plan or (["t1"] * (n // 3) + ["t2"] * (n // 3) + ["t3"] * (n - 2 * (n // 3)))
    trig = trigger or TRIGGER
    rows = []
    for k, tier in enumerate(plan):
        for _attempt in range(10):
            fname = rng.choice(tiers[tier] or files)
            with gzip.open(index_dir / fname, "rt", encoding="utf-8") as f:
                lines = f.read().splitlines()[1:]
            cand = [ln.split("\t") for ln in lines if ln]
            cand = [c for c in cand if c[7] in ("010combined", "020lead", "015unamimous", "025plurality") and 6000 <= int(c[6]) <= 120000]
            if not cand:
                continue
            row = rng.choice(cand)
            okey, offset, length = row[2], int(row[3]), int(row[4])
            req = urllib.request.Request(f"{url}/storage/v1/object/corpus-originals/{urllib.parse.quote(okey)}",
                                         headers={**headers(key), "Range": f"bytes={offset}-{offset + length - 1}"})
            with urllib.request.urlopen(req, timeout=120) as res:
                raw = res.read()
            member = zlib.decompress(raw, 16 + zlib.MAX_WBITS)
            rec = json.loads(member.decode("utf-8"))
            text = rec.get("text") or ""
            if sha(text) != row[5]:
                raise SystemExit(f"text sha256 mismatch for opinion {row[0]}")
            hits = [m.start() for m in trig.finditer(text)]
            if trigger is not None and not hits:
                continue
            off, win = window(text, rng, rng.choice(hits) if hits and (trigger is not None or k % 4 != 3) else None)
            rows.append({"id": f"opinion-{start_id + len(rows):02d}", "source": "opinion", "opinion_id": row[0], "cluster_id": row[1],
                         "court_file": fname, "object_key": okey, "text_sha256": row[5], "text_chars": len(text), "offset": off,
                         "text": win, "provenance": "case-law reading store (CourtListener bulk opinions, public domain)"})
            time.sleep(0.3)
            break
    write(out, rows)


def reports(out: Path, seed: str, per_doc: int = 5) -> None:
    rng = random.Random(seed)
    acq = ROOT / "private" / "acq" / "w1025_cite"
    acq.mkdir(parents=True, exist_ok=True)
    rows = []
    for publisher, url in REPORT_URLS:
        pdf = acq / Path(urllib.parse.urlparse(url).path).name
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=120) as res, open(pdf, "wb") as f:
            f.write(res.read())
        pdf_sha = hashlib.sha256(pdf.read_bytes()).hexdigest()
        text = subprocess.run(["pdftotext", "-enc", "UTF-8", str(pdf), "-"], check=True, capture_output=True).stdout.decode("utf-8")
        pdf.unlink()
        hits = [m.start() for m in TRIGGER.finditer(text)]
        for j in range(per_doc):
            off, win = window(text, rng, rng.choice(hits) if hits and j % 5 != 4 else None)
            rows.append({"id": f"report-{len(rows) + 1:02d}", "source": f"report_{publisher}", "url": url, "pdf_sha256": pdf_sha,
                         "text_sha256": sha(text), "text_chars": len(text), "offset": off, "text": win,
                         "provenance": "pdftotext -enc UTF-8 of the official PDF", "retrieved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
        time.sleep(3)
    write(out, rows)


def write(out: Path, rows: list[dict]) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(json.dumps({"out": str(out), "windows": len(rows), "chars": sum(len(r["text"]) for r in rows)}))


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("what", choices=["filings", "opinions", "reports", "filings-list", "fedreg", "opinions-statutes"])
    ap.add_argument("--list", default="")
    ap.add_argument("--start-id", type=int, default=1)
    ap.add_argument("--n", type=int, default=30)
    ap.add_argument("--out", required=True)
    ap.add_argument("--seed", default="citations-v2-gold-1")
    a = ap.parse_args(argv)
    out = Path(a.out)
    if a.what == "filings":
        filings(a.n, out, a.seed)
    elif a.what == "opinions":
        opinions(a.n, out, a.seed)
    elif a.what == "reports":
        reports(out, a.seed)
    elif a.what == "filings-list":
        filings_list(Path(a.list), out, a.seed, a.start_id)
    elif a.what == "fedreg":
        federal_register(out, a.seed)
    else:
        # second opinion stratum: state-court opinions with a statute/constitution/regulation token
        opinions(a.n, out, a.seed, a.start_id, STATE_TRIGGER, ["t3"] * a.n)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
