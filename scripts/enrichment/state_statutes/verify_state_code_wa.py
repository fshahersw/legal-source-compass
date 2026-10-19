"""Independent verification of private/build/state_statutes/wa_code.json.

Usage: python3 -I -B verify_state_code_wa.py <acq_dir> <build.json> <report.json> [--sample 50] [--seed 20261019]

Checks (each with a failure count):
  1. toc_titles: every title on the publisher's RCW title list has a title page; titles with sections have rows.
  2. toc_chapters: every chapter on every title page has a stored full-chapter page.
  3. toc_sections: every section in each chapter's printed "Sections" table (read here with a regex over the raw
     page, not with parse_wa) is a row, and every row is listed there.
  4. live_sample: N seeded-random rows re-fetched one by one from the single-section page
     https://app.leg.wa.gov/RCW/default.aspx?cite={number} (not the chapter pages the build used), parsed with
     BeautifulSoup, and compared word for word: catchline, section text, history.
  5. shape: contract fields present, no empty values, title filter values in the listing.
"""
import collections
import json
import random
import re
import sys
from pathlib import Path

from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).resolve().parent))
import codebuild  # noqa: E402
import fetchlib  # noqa: E402

BASE = "https://app.leg.wa.gov/RCW/default.aspx"


def words(text):
    return (text or "").replace(" ", " ").split()


def fact(row, label):
    return next((f[1] for f in row["detail"].get("facts", []) if f[0] == label), None)


def toc_sections(raw_html):
    """Section numbers in the printed 'Sections' table: the in-page '#<number>' links before the section bodies."""
    # Only the printed "Sections" table: chapter notes before the bodies also link '#<number>' (e.g. "Prior law").
    m = re.search(r">Sections</h3>(.*?)</table>", raw_html, re.S)
    table = m.group(1) if m else ""
    numbers = []
    for row in re.findall(r"<tr>(.*?)</tr>", table, re.S):
        # The row's first in-page link is its section; links inside the caption cell are cross-references.
        first = re.search(r"href=['\"]#(\d+[A-Z]?\.\d+[A-Z]?[.-]\d+[0-9A-Za-z]*)['\"]", row)
        if first:
            numbers.append(first.group(1))
    return list(dict.fromkeys(numbers))


def live_section(number):
    status, body = fetchlib.get(f"{BASE}?cite={number}", interval=1.0, timeout=180)
    if status != 200:
        return None, f"HTTP {status}"
    soup = BeautifulSoup(body.decode("utf-8", "replace"), "html.parser")
    h1 = soup.find("h1")
    h2 = soup.find("h2")
    wrap = soup.find("div", id="contentWrapper")
    if not (h1 and h2 and wrap):
        return None, "page structure not found"
    paras, history = [], ""
    for div in wrap.find_all("div", recursive=False):
        text = " ".join(div.get_text().split())
        if not text:
            continue
        if text.startswith("["):
            history = text
            break
        paras.extend(soup_lines(div))
    return {"cite": " ".join(h1.get_text().split()), "heading": " ".join(h2.get_text().split()), "body": "\n".join(p for p in paras if p), "history": history}, None


def soup_lines(tag):
    """Independent (BeautifulSoup) reading of a block: table cells are separate words, nested blocks separate lines."""
    if tag.name == "table":
        return [" ".join(" ".join(td.get_text().split()) for td in tr.find_all(["td", "th"], recursive=False)).strip()
                for tr in tag.find_all("tr")]
    out, buf = [], []
    for child in tag.children:
        name = getattr(child, "name", None)
        if name in ("div", "p", "table", "ul", "ol", "li", "tr", "blockquote") :
            out.append("".join(buf))
            buf = []
            out.extend(soup_lines(child))
        elif name == "br":
            out.append("".join(buf))
            buf = []
        elif name is None:
            buf.append(str(child) if not child.__class__.__name__ == "Comment" else "")
        else:
            buf.append(child.get_text())
    out.append("".join(buf))
    return [" ".join(line.split()) for line in out if line.split()]


def main(acq_dir, build_path, report_path, sample=50, seed=20261019):
    acq = Path(acq_dir)
    manifest = fetchlib.load_manifest(acq / "_manifest.jsonl")
    build = codebuild.read_build(build_path)
    rows = build["rows"]
    by_id = {r["id"]: r for r in rows}
    base_ids = collections.Counter(r["id"].split("@")[0] for r in rows)
    report = {"dataset": build["dataset"], "rows": len(rows), "checks": {}}

    toc_html = fetchlib.read_raw(manifest[BASE]).decode("utf-8", "replace")
    titles = list(dict.fromkeys(re.findall(r"[?&][Cc]ite=(\d+[A-Z]?)(?=['\"&#])", toc_html)))
    row_titles = {r["filters"]["title"][0] for r in rows}
    missing_title_pages = [t for t in titles if f"{BASE}?Cite={t}" not in manifest]
    report["checks"]["toc_titles"] = {"publisher_titles": len(titles), "titles_with_rows": len(row_titles),
                                      "titles_without_rows": sorted(set(titles) - row_titles),
                                      "failures": len(missing_title_pages) + len(row_titles - set(titles)), "missing_title_pages": missing_title_pages}
    missing_chapters, toc_numbers = [], collections.Counter()
    for t in titles:
        entry = manifest.get(f"{BASE}?Cite={t}")
        if not entry:
            continue
        page = fetchlib.read_raw(entry).decode("utf-8", "replace")
        for cite in dict.fromkeys(re.findall(r"[?&][Cc]ite=(" + re.escape(t) + r"\.\d+[A-Z]?)(?=['\"&#])", page)):
            centry = manifest.get(f"{BASE}?cite={cite}&full=true")
            if not centry:
                missing_chapters.append(cite)
                continue
            for number in toc_sections(fetchlib.read_raw(centry).decode("utf-8", "replace")):
                toc_numbers[number] += 1
    report["checks"]["toc_chapters"] = {"failures": len(missing_chapters), "missing": missing_chapters[:50]}
    missing = sorted(set(toc_numbers) - set(base_ids))
    extra = sorted(set(base_ids) - set(toc_numbers))
    report["checks"]["toc_sections"] = {"toc_sections": len(toc_numbers), "row_numbers": len(base_ids),
                                        "failures": len(missing) + len(extra), "missing": missing[:50], "not_in_toc": extra[:50]}

    rng = random.Random(seed)
    picks = rng.sample(sorted(i for i in by_id if "@" not in i and base_ids[i] == 1), sample)
    # Plus up to 10 sections that print a table (cells must stay separate words).
    tables = sorted(i for i in build["summary"].get("sections_with_tables", []) if "@" not in i and base_ids[i] == 1 and i not in picks)
    picks += rng.sample(tables, min(10, len(tables)))
    results, failures = [], 0
    for rid in picks:
        row = by_id[rid]
        live, error = live_section(rid)
        if error:
            failures += 1
            results.append({"id": rid, "ok": False, "error": error})
            continue
        body = (row["detail"].get("sections") or [{}])[0].get("text", "")
        citation = fact(row, "Citation")
        heading = row["title"][len(citation):].strip()
        checks = {
            "cite": live["cite"] == citation,
            "heading": words(live["heading"]) == words(heading),
            "text": words(live["body"]) == words(body),
            "history": words(re.sub(r"^\[\s*|\s*\]$", "", live["history"])) == words(fact(row, "History") or fact(row, "Source note") or ""),
        }
        ok = all(checks.values())
        failures += 0 if ok else 1
        item = {"id": rid, "ok": ok, **checks, "words": len(words(body))}
        if not ok:
            item["live"] = {k: v[:300] for k, v in live.items()}
            item["built"] = {"heading": heading[:300], "text": body[:300], "history": (fact(row, "History") or "")[:300]}
        results.append(item)
    report["checks"]["live_sample"] = {"sample": len(picks), "random": sample, "table_sections": len(picks) - sample, "seed": seed,
                                       "endpoint": f"{BASE}?cite={{number}}", "failures": failures, "results": results}

    title_values = {o["value"] for f in build["listing_block"]["filters"] if f["name"] == "title" for o in f.get("options", [])}
    shape = []
    for r in rows:
        problems = []
        if not r["title"].startswith(fact(r, "Citation") or "\u0000"):
            problems.append("title does not start with citation")
        if r["filters"]["title"][0] not in title_values:
            problems.append("title filter value not in listing")
        if not r["item"]["cells"].get("chapter"):
            problems.append("no chapter")
        if not r["source_url"].startswith(BASE + "?cite="):
            problems.append("source_url")
        if not r["detail"].get("sections") and r["title"] == fact(r, "Citation"):
            problems.append("no text and no heading")
        if problems:
            shape.append({"id": r["id"], "problems": problems})
    report["checks"]["shape"] = {"failures": len(shape), "examples": shape[:20]}
    report["total_failures"] = sum(c["failures"] for c in report["checks"].values())
    Path(report_path).write_text(json.dumps(report, indent=1, ensure_ascii=False))
    print(json.dumps({k: {kk: vv for kk, vv in v.items() if kk not in ("results", "examples", "missing", "not_in_toc")} for k, v in report["checks"].items()}))
    print("total_failures", report["total_failures"])


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    opts = dict(zip(sys.argv[1:], sys.argv[2:]))
    main(args[0], args[1], args[2], int(opts.get("--sample", 50)), int(opts.get("--seed", 20261019)))
