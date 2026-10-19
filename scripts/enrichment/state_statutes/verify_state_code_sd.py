"""Independent verification of private/build/state_statutes/sd_code.json.

Usage: python3 -I -B verify_state_code_sd.py <acq_dir> <build.json> <report.json> [--sample 50] [--seed 20261019]

Checks (each with a failure count):
  1. toc_sitemap: every section the publisher lists in its sitemap (Statutes.1.xml, Statutes.2.xml) is a row, and
     every row is in the sitemap.
  2. toc_chapter_contents: every entry in the publisher's chapter contents documents is a row.
  3. live_sample: N seeded-random rows re-fetched one by one from https://sdlegislature.gov/api/Statutes/Statute/{n}
     (a different endpoint than the whole-title documents the build used), parsed with BeautifulSoup (a different
     parser than the build's lxml path), and compared word for word: catchline, section text, Source note.
  4. shape: required fields per the state code contract; no empty values; title filter values in the listing.
"""
import gzip
import json
import random
import re
import sys
from pathlib import Path

from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetchlib  # noqa: E402

SITE = "https://sdlegislature.gov"
SECTION = re.compile(r"^\d+[A-Z]?-\d+[A-Z]*-\d+[A-Za-z]*(?:\.\d+[A-Za-z]*)*(?:\([0-9A-Za-z]{1,4}\))*$")
WORD = re.compile(r"\S+")


def words(text):
    return WORD.findall((text or "").replace(" ", " "))


def fact(row, label):
    return next((f[1] for f in row["detail"].get("facts", []) if f[0] == label), None)


def live_section(number):
    """Fetch the single-section record and parse it independently: (heading, body, source)."""
    status, body = fetchlib.get(f"{SITE}/api/Statutes/Statute/{number}", interval=1.0)
    if status != 200:
        return None, f"HTTP {status}"
    data = json.loads(body)
    soup = BeautifulSoup(data.get("Html") or "", "html.parser")
    paras = [" ".join(p.get_text().split()) for p in soup.find_all("p")]
    paras = [p for p in paras if p]
    if not paras:
        # Entries printed only as a catchline (e.g. "1-1-11. Repealed by SL 2006, ch 130, § 1.").
        return {"heading_line": " ".join((data.get("CatchLine") or "").split()), "body": "", "source": ""}, None
    head, rest = paras[0], paras[1:]
    source = " ".join(p for p in rest if p.startswith("Source:"))
    body_paras = []
    for p in rest:
        if p.startswith("Source:"):
            break
        body_paras.append(p)
    return {"heading_line": head, "body": "\n".join(body_paras), "source": source}, None


def main(acq_dir, build_path, report_path, sample=50, seed=20261019):
    acq = Path(acq_dir)
    manifest = fetchlib.load_manifest(acq / "_manifest.jsonl")
    build = json.loads(Path(build_path).read_text())
    rows = build["rows"]
    by_id = {r["id"]: r for r in rows}
    base_ids = {r["id"].split("@")[0] for r in rows}
    for r in rows:
        members = fact(r, "Numbers in this entry")
        if members:
            base_ids.update(m.strip() for m in members.split(","))
    report = {"dataset": build["dataset"], "rows": len(rows), "checks": {}}

    # 1. sitemap
    sitemap = set()
    for url, entry in manifest.items():
        if re.search(r"/Statutes\.\d+\.xml$", url):
            for loc in re.findall(r"<loc>([^<]+)</loc>", fetchlib.read_raw(entry).decode("utf-8")):
                number = loc.rsplit("/Statutes/", 1)[-1]
                if SECTION.match(number):
                    sitemap.add(number)
    excluded = {a.get("number") for a in build["summary"].get("excluded_appendices", []) if a.get("number")}
    missing = sorted(sitemap - base_ids - excluded)
    extra = sorted(base_ids - sitemap)
    report["checks"]["toc_sitemap"] = {"sitemap_sections": len(sitemap), "row_numbers": len(base_ids),
                                       "excluded_appendices_in_sitemap": len(sitemap & excluded),
                                       "failures": len(missing) + len(extra), "missing": missing[:50], "not_in_sitemap": extra[:50]}

    # 2. chapter contents (all whole-title documents)
    sys_path_parse = __import__("parse_sd")
    contents_missing = []
    contents_total = 0
    for url, entry in manifest.items():
        if url.endswith(".html?all=true"):
            parsed = sys_path_parse.parse_title(fetchlib.read_raw(entry))
            for chapter in parsed["chapters"]:
                for number, _ in chapter["rows"]:
                    if number and SECTION.match(number):
                        contents_total += 1
                        if number not in base_ids:
                            contents_missing.append(number)
    report["checks"]["toc_chapter_contents"] = {"entries": contents_total, "failures": len(contents_missing), "missing": contents_missing[:50]}

    # 3. live sample
    rng = random.Random(seed)
    candidates = sorted(r["id"] for r in rows if "@" not in r["id"])
    picks = rng.sample(candidates, sample)
    results, failures = [], 0
    for rid in picks:
        row = by_id[rid]
        live, error = live_section(rid)
        if error:
            failures += 1
            results.append({"id": rid, "ok": False, "error": error})
            continue
        body = (row["detail"].get("sections") or [{}])[0].get("text", "")
        history = fact(row, "Source note") or ""
        citation = fact(row, "Citation")
        heading = row["title"][len(citation):].strip() if citation and row["title"].startswith(citation) else row["title"]
        live_heading_words = words(live["heading_line"])
        expect_heading_words = words(citation.replace("SDCL ", "", 1)) + words(heading)
        checks = {
            "heading": [w.rstrip(".") for w in live_heading_words] == [w.rstrip(".") for w in expect_heading_words],
            "text": words(live["body"]) == words(body),
            "source": words(re.sub(r"^Source:\s*", "", live["source"])) == words(history),
        }
        ok = all(checks.values())
        failures += 0 if ok else 1
        item = {"id": rid, "ok": ok, **checks, "words": len(words(body))}
        if not ok:
            item["live"] = {k: v[:300] for k, v in live.items()}
            item["built"] = {"heading": heading[:300], "text": body[:300], "source": history[:300]}
        results.append(item)
    report["checks"]["live_sample"] = {"sample": sample, "seed": seed, "endpoint": f"{SITE}/api/Statutes/Statute/{{number}}",
                                       "failures": failures, "results": results}

    # 4. shape
    title_values = {o["value"] for f in build["listing_block"]["filters"] if f["name"] == "title" for o in f.get("options", [])}
    shape_failures = []
    for r in rows:
        problems = []
        if not r["title"].startswith(fact(r, "Citation") or "\u0000"):
            problems.append("title does not start with citation")
        if r["filters"]["title"][0] not in title_values:
            problems.append("title filter value not in listing")
        if not r["item"]["cells"].get("chapter"):
            problems.append("no chapter")
        if not r["source_url"].startswith(SITE + "/Statutes/"):
            problems.append("source_url")
        if not (r["detail"].get("sections") or fact(r, "Status as printed") or r["title"] != fact(r, "Citation")):
            problems.append("no text, no status and no heading")
        if problems:
            shape_failures.append({"id": r["id"], "problems": problems})
    report["checks"]["shape"] = {"failures": len(shape_failures), "examples": shape_failures[:20]}
    report["total_failures"] = sum(c["failures"] for c in report["checks"].values())
    Path(report_path).write_text(json.dumps(report, indent=1, ensure_ascii=False))
    print(json.dumps({k: {kk: vv for kk, vv in v.items() if kk not in ("results", "examples", "missing", "not_in_sitemap")} for k, v in report["checks"].items()}))
    print("total_failures", report["total_failures"])


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    opts = dict(zip(sys.argv[1::1], sys.argv[2::1]))
    main(args[0], args[1], args[2], int(opts.get("--sample", 50)), int(opts.get("--seed", 20261019)))
