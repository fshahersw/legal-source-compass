"""Independent verification of the enforcement_actions build files (second path: raw files + BeautifulSoup text).

  python3 -I -B scripts/enrichment/enforcement_actions/verify_enforcement_actions.py doj|ftc|sec|settlements|all [--sample N]

Checks, each with a failure count (target 0):
  doj          record counts vs unique uuids in the raw API pages (and the API's own count, read once); every stored
               extraction (amount, statute, docket, court, party) is found verbatim in a BeautifulSoup rendering of the
               raw body for a deterministic sample; amount values re-parsed with Decimal; excerpt is a span of the
               body text; court ids / CIKs exist in the saved lookups.
  ftc          every CSV/XLSX row re-read with the csv module / openpyxl and compared field by field; consumer
               protection penalties summed and compared with the workbook's own total line; case pages: docket and
               civil action numbers found in the raw HTML.
  sec          listing rows (unique release numbers) vs build; litigation-release civil action numbers and court
               citations found in the raw page text.
  settlements  every published fact found on the stored official page (BeautifulSoup text); with --recheck, the
               re-read pages from fetch_settlesignal.py --refetch-sample are checked the same way.
Writes private/build/enforcement_actions/verify_<name>.json.
"""
import argparse
import gzip
import hashlib
import io
import json
import os
import re
import sys
from collections import Counter
from decimal import Decimal

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import enf_common as ec  # noqa: E402
import links  # noqa: E402

from bs4 import BeautifulSoup  # noqa: E402


def soup_text(html):
    soup = BeautifulSoup(html or "", "lxml")
    for tag in soup(["script", "style", "template"]):  # not page text; the builders leave them out too
        tag.decompose()
    text = re.sub("[​‌‍﻿]", "", soup.get_text(" "))  # zero-width characters are invisible
    return re.sub(r"\s+", " ", text.replace("\xa0", " ")).strip()


def squash(s):
    return re.sub(r"\s+", " ", (s or "").replace("\xa0", " ")).strip()


def sample(items, n, key):
    if not n or n >= len(items):
        return items
    return sorted(items, key=lambda x: hashlib.sha256(key(x).encode()).hexdigest())[:n]


def load_build(name):
    path = os.path.join(ec.BUILD, f"{name}.json")
    if os.path.exists(path):
        return json.load(open(path, encoding="utf-8"))
    return json.load(gzip.open(path + ".gz", "rt", encoding="utf-8"))


def write(name, result):
    path = os.path.join(ec.BUILD, f"verify_{name}.json")
    with open(path, "w", encoding="utf-8") as h:
        json.dump(result, h, indent=1)
    print(json.dumps(result, indent=1)[:4000])


MULT = {"thousand": Decimal(1000), "million": Decimal(10) ** 6, "billion": Decimal(10) ** 9, "trillion": Decimal(10) ** 12}
ABBR = {"K": "thousand", "k": "thousand", "M": "million", "MM": "million", "m": "million", "mm": "million", "mn": "million",
        "mln": "million", "B": "billion", "BN": "billion", "Bn": "billion", "b": "billion", "bn": "billion"}


def decimal_value(as_written, dollar=True):
    """Second-path value of a figure as written: "$1,500", "$2.3 billion", "$1-Million", "$9 M", "$13K" (and, for title
    figures without "$", "1.4 Million" / "60M")."""
    m = re.match(r"^(\$\s?)?([\d,]+(?:\.\d+)?)(?:[\s-]?((?i:thousand|million|billion|trillion))|\s?(MM|BN|Bn|M|B|K|mm|bn|mln|mn|m|b|k))?$",
                 as_written.strip())
    if not m or (dollar and not m.group(1)):
        return None
    v = Decimal(m.group(2).replace(",", ""))
    word = (m.group(3) or "").lower() or ABBR.get(m.group(4) or "")
    if word:
        v *= MULT[word]
    return v


def check_headline(head, title, body_text, fails, checked, max_res):
    """A headline figure is a verbatim span of the title, or of its sentence and the sentence of the body; its value
    re-parses; differs_from_largest agrees with the stored largest figure."""
    if not head:
        return
    checked["headline_figures"] += 1
    if head["source"] == "title":
        checked["headline_from_title"] += 1
        if squash(head["as_written"]) not in squash(title):
            fails["headline_not_in_title"] += 1
        dv = decimal_value(head["as_written"], dollar=False)
    elif head["source"] == "first resolution sentence":
        checked["headline_from_first_resolution_sentence"] += 1
        sentence = squash(head.get("sentence"))
        if not sentence or squash(head["as_written"]) not in sentence or sentence not in body_text:
            fails["headline_not_in_sentence_or_body"] += 1
        dv = decimal_value(head["as_written"])
    else:
        fails["headline_unknown_source"] += 1
        return
    if dv is None or abs(float(dv) - head["value_usd"]) > 0.01:
        fails["headline_value_mismatch"] += 1
    differs = max_res is not None and abs(head["value_usd"] - max_res) > 0.005
    if bool(head.get("differs_from_largest")) != differs:
        fails["headline_differs_flag_wrong"] += 1


RESOLUTION = {"settlement", "penalty or fine", "restitution", "forfeiture", "disgorgement", "judgment"}


EARLIER_MARK = re.compile(r"(?:19|20)\d{2}|previously|separate|earlier|prior", re.I)


def check_headline_order(head, amounts, fails, checked, none_reason=None):
    """From the stored figures (reading order): without a title figure, the headline is the first stored figure whose
    sentence has a resolution keyword (not a stock paragraph, readable, under $1 trillion), after the k figures the
    builder skipped as being about an earlier or separate matter (each skipped sentence must name a year or say
    previously/separate/earlier/prior); a release with such a figure has a headline unless it says why not."""
    quals = [a for a in amounts if a.get("keyword") in RESOLUTION and not a.get("boilerplate")
             and a.get("value_usd") is not None and a["value_usd"] < 1e12]
    if not quals:
        return
    checked["headline_order_checks"] += 1
    if not head:
        if not none_reason:
            fails["headline_missing"] += 1
        elif not all(EARLIER_MARK.search(a.get("sentence") or "") for a in quals):
            fails["headline_none_but_undated_resolution_sentence"] += 1
        return
    if head["source"] != "first resolution sentence":
        return
    k = head.get("earlier_matter_figures_skipped", 0)
    if not all(EARLIER_MARK.search(a.get("sentence") or "") for a in quals[:k]):
        fails["headline_skipped_an_undated_sentence"] += 1
    if len(quals) > k:
        target = quals[k]
        if head["as_written"] != target["as_written"] or not squash(head.get("sentence")).startswith(squash(target.get("sentence"))[:150]):
            fails["headline_not_first_resolution_figure"] += 1


# ---------------------------------------------------------------- DOJ

def verify_doj(n, headline_only=False):
    """With headline_only, the sample is drawn from releases that have a headline figure (n of them)."""
    pages_dir = os.path.join(ec.ACQ, "doj", "pages")
    raw_ids = set()
    rows_fetched = 0
    for fname in sorted(os.listdir(pages_dir)):
        if fname.endswith(".json.gz"):
            for r in json.loads(gzip.open(os.path.join(pages_dir, fname)).read()).get("results") or []:
                rows_fetched += 1
                if r.get("uuid"):
                    raw_ids.add(r["uuid"])
    index = load_build("doj_press_releases")
    overview = next(r for r in index["rows"] if r["id"] == "doj-index:overview")["item"]["overview"]
    fails = Counter()
    checked = Counter()
    companies = links.Companies()
    courts = links.Courts()
    stored = 0
    sampled = []
    for p in overview["partitions"]:
        build = load_build(p["dataset"])
        if len(build["rows"]) != p["records"]:
            fails["partition_count_mismatch"] += 1
        stored += len(build["rows"])
        for row in build["rows"]:
            rel = row["item"]["release"]
            if row["id"] != f"doj-pr:{rel['uuid']}" or rel["uuid"] not in raw_ids:
                fails["id_not_in_raw"] += 1
            if row["dataset"] != p["dataset"] or (rel["date"] or (rel["created"] or "")[:10] or "0000")[:4] != p["year"]:
                fails["wrong_partition"] += 1
            for c in rel["courts"]:
                if c.get("court_id") and not courts.valid(c["court_id"]):
                    fails["court_id_not_in_lookup"] += 1
            for c in rel["companies"]:
                if c["cik"] not in companies.names:
                    fails["cik_not_in_lookup"] += 1
        # each partition's share of the sample, rounded up so the sample is at least n releases
        pool = [r for r in build["rows"] if r["item"]["release"].get("headline_figure")] if headline_only else build["rows"]
        pool_total = (overview["checks"].get("headline_from_title", 0) + overview["checks"].get("headline_from_first_resolution_sentence", 0)
                      if headline_only else overview["total"])
        # each partition's share of the sample, rounded up so the sample is at least n releases
        if pool:
            sampled.extend(sample(pool, max(1, -(-n * len(pool) // max(1, pool_total))) if n else 0, lambda r: r["id"]))
        del build
    if stored != len(raw_ids):
        fails["stored_vs_unique_raw_uuids"] += abs(stored - len(raw_ids))
    wanted = {row["item"]["release"]["uuid"] for row in sampled}
    raw = {}
    for fname in sorted(os.listdir(pages_dir)):
        if fname.endswith(".json.gz"):
            for r in json.loads(gzip.open(os.path.join(pages_dir, fname)).read()).get("results") or []:
                # the API returns some releases twice; like the builder, keep the copy with the latest "changed"
                if r.get("uuid") in wanted and (r["uuid"] not in raw or (r.get("changed") or "") > (raw[r["uuid"]].get("changed") or "")):
                    raw[r["uuid"]] = r
    for row in sampled:
        rel = row["item"]["release"]
        r = raw.get(rel["uuid"])
        if not r:
            continue
        body_text = soup_text(r.get("body"))
        title = squash(re.sub(r"\s+", " ", BeautifulSoup(r.get("title") or "", "html.parser").get_text()))
        checked["releases"] += 1
        for a in rel["amounts"]:
            checked["amounts"] += 1
            if squash(a["as_written"]) not in body_text:
                fails["amount_not_in_body"] += 1
            dv = decimal_value(a["as_written"])
            if a.get("value_usd") is not None and (dv is None or abs(float(dv) - a["value_usd"]) > 0.01):
                fails["amount_value_mismatch"] += 1
            if a.get("sentence") and squash(a["sentence"]) not in body_text:
                fails["amount_sentence_not_in_body"] += 1
        check_headline(rel.get("headline_figure"), title, body_text, fails, checked, rel["max_resolution_amount_usd"])
        check_headline_order(rel.get("headline_figure"), rel["amounts"], fails, checked, rel.get("headline_none_reason"))
        for s in rel["statutes"]:
            checked["statutes"] += 1
            if squash(s["as_written"]) not in body_text:
                fails["statute_not_in_body"] += 1
        for d in rel["dockets"]:
            checked["dockets"] += 1
            if d["as_written"] not in body_text:
                fails["docket_not_in_body"] += 1
        for c in rel["courts"]:
            checked["courts"] += 1
            if squash(c["as_written"]) not in body_text:
                fails["court_not_in_body"] += 1
        for p in rel["parties"]:
            checked["parties"] += 1
            if p["as_written"] not in title or squash(p["as_written"]) not in body_text:
                fails["party_not_in_title_and_body"] += 1
        excerpt = next((f[1] for f in row["detail"]["facts"] if f[0].startswith("Excerpt")), None)
        if excerpt and excerpt != "Not recorded":
            checked["excerpts"] += 1
            if len(excerpt) > 1500:
                fails["excerpt_over_1500"] += 1
            if squash(excerpt) not in body_text:
                fails["excerpt_not_in_body"] += 1
    api_count = None
    try:
        status, body, _, _ = ec.Fetcher(default_interval=1.0).get("https://www.justice.gov/api/v1/press_releases.json?pagesize=1&page=0")
        api_count = int(json.loads(body)["metadata"]["resultset"]["count"])
    except Exception as error:  # the count is informational; the check below records it
        api_count = f"not read: {error}"
    result = {"dataset": "doj_press_releases (+ partitions)", "stored_records": stored, "unique_raw_uuids": len(raw_ids),
              "rows_fetched": rows_fetched, "duplicate_rows_returned_by_api": rows_fetched - len(raw_ids),
              "api_count_now": api_count, "sampled": dict(checked), "failures": dict(fails), "failure_total": sum(fails.values()),
              "note": "The API's count is read live and moves while releases are published (and fluctuated by +/-300 between identical calls during the harvest); records are checked against the raw pages."}
    if headline_only:
        result["dataset"] += ": sample of releases with a headline figure"
    write("doj_headlines" if headline_only else "doj", result)
    return result


# ---------------------------------------------------------------- FTC

def verify_ftc(n):
    import csv
    import openpyxl

    files = os.path.join(ec.ACQ, "ftc", "files")
    build = load_build("ftc_enforcement_actions")
    by_kind = Counter(r["item"]["ftc_action"]["kind"] for r in build["rows"])
    fails = Counter()
    checked = Counter()
    stored = {}
    for r in build["rows"]:
        a = r["item"]["ftc_action"]
        stored[(a["kind"], a["line"])] = a
    for kind, fname in (("merger", "FTC-Merger-Enforcement-Actions.csv"), ("nonmerger", "FTC-Nonmerger-Enforcement-Actions.csv"), ("bc_penalty", "FTC-BC-Civil-Penalty-Actions.csv")):
        data = gzip.open(os.path.join(files, fname + ".gz")).read()
        try:
            text = data.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = data.decode("cp1252")
        rows = list(csv.reader(io.StringIO(text)))
        header = [h.strip().lower().replace(" ", "") for h in rows[0]]
        body = [r for r in rows[1:] if any(c.strip() for c in r)]
        if len(body) != by_kind[kind]:
            fails[f"{kind}_row_count"] += 1
        for i, values in enumerate(body, 2):
            checked[kind] += 1
            rec = dict(zip(header, [v.strip() for v in values]))
            a = stored.get((kind, i))
            if not a:
                fails[f"{kind}_row_missing"] += 1
                continue
            if (rec.get("matternumber") or None) != a["matter_number"]:
                fails[f"{kind}_matter_number"] += 1
            if (rec.get("mattername") or None) != a["name"]:
                fails[f"{kind}_name"] += 1
            m = re.match(r"(\d{1,2})/(\d{1,2})/(\d{4})", rec.get("matterenforcementdate") or rec.get("mattercivilpenaltydate") or "")
            want = f"{m.group(3)}-{int(m.group(1)):02d}-{int(m.group(2)):02d}" if m else None
            if want != a["date"]:
                fails[f"{kind}_date"] += 1
    wb = openpyxl.load_workbook(io.BytesIO(gzip.open(os.path.join(files, "civil_penalty_cases_fy2000-2026.xlsx.gz")).read()), read_only=True, data_only=True)
    rows = list(wb.worksheets[0].iter_rows(values_only=True))
    data_rows = [r for r in rows[1:] if r[0] and r[1]]
    total_line = next((r for r in rows if r[0] is None and isinstance(r[1], (int, float)) and isinstance(r[3], (int, float))), None)
    penalties = [r["item"]["ftc_action"] for r in build["rows"] if r["item"]["ftc_action"]["kind"] == "bcp_penalty"]
    if len(data_rows) != len(penalties):
        fails["bcp_row_count"] += 1
    built_sum = round(sum(p["ordered_amount"] or 0 for p in penalties), 2)
    if total_line is None or abs(built_sum - float(total_line[3])) > 0.01 or int(total_line[1]) != len(penalties):
        fails["bcp_total_vs_workbook_total_line"] += 1
    by_number = {}
    for p in penalties:
        by_number.setdefault(p["matter_number"], []).append(p)
    for r in data_rows:
        checked["bcp_penalty"] += 1
        cands = by_number.get(str(r[0]).strip(), [])
        want = float(r[3]) if isinstance(r[3], (int, float)) else None  # " -" in the workbook = no amount
        if not any(c["name"] == str(r[1]).strip() and ((want is None and c["ordered_amount"] is None)
                                                       or (want is not None and c["ordered_amount"] is not None and abs(c["ordered_amount"] - want) < 0.01))
                   for c in cands):
            fails["bcp_row_value"] += 1
    cases = load_build("ftc_cases")
    reader = ec.PackReader(os.path.join(ec.ACQ, "ftc", "cases")) if os.path.exists(os.path.join(ec.ACQ, "ftc", "cases", "index.jsonl")) else None
    read_cases = [r for r in cases["rows"] if r["item"]["ftc_case"]["page_read"]]
    for r in sample(read_cases, n, lambda x: x["id"]):
        c = r["item"]["ftc_case"]
        page = soup_text(reader.get(c["url"]).decode("utf-8", "replace")) if reader and c["url"] in reader.index else None
        if page is None:
            fails["case_page_missing_from_raw"] += 1
            continue
        checked["case_pages"] += 1
        for v in c["civil_action_numbers"] + c["docket_numbers"] + c["matter_numbers"]:
            checked["case_numbers"] += 1
            if v not in page:
                fails["case_number_not_in_page"] += 1
        for d in c["documents"][:10]:
            checked["case_documents"] += 1
            if squash(d["title"]) not in page:
                fails["document_title_not_in_page"] += 1
    listing_rows = cases["summary"]["stats"].get("cases")
    result = {"datasets": ["ftc_enforcement_actions", "ftc_cases"], "actions_by_file": dict(by_kind),
              "bcp_sum_built": built_sum, "bcp_workbook_total_line": list(total_line) if total_line else None,
              "cases_listed": listing_rows, "case_pages_read": len(read_cases), "checked": dict(checked),
              "failures": dict(fails), "failure_total": sum(fails.values())}
    write("ftc", result)
    return result


# ---------------------------------------------------------------- SEC

def verify_sec(n):
    import sec_parse

    build = load_build("sec_enforcement_actions")
    reader = ec.PackReader(os.path.join(ec.ACQ, "sec", "listing"))
    lr_numbers, ap_numbers = set(), set()
    for row in reader.rows_by_pack():
        for item in sec_parse.parse_listing(reader.get(row["url"]).decode("utf-8", "replace")):
            if not item["release_number"]:
                continue
            (lr_numbers if "litigation-releases" in row["url"] else ap_numbers).add(item["release_number"])
    built_lr = {r["item"]["sec_action"]["release_number"] for r in build["rows"] if r["id"].startswith("sec-lr:")}
    built_ap = {r["item"]["sec_action"]["release_number"] for r in build["rows"] if r["id"].startswith("sec-ap:")}
    fails = Counter()
    fails["lr_listed_not_built"] = len(lr_numbers - built_lr)
    fails["ap_listed_not_built"] = len(ap_numbers - built_ap)
    fails["built_not_listed"] = len((built_lr - lr_numbers) | (built_ap - ap_numbers))
    lr_reader = ec.PackReader(os.path.join(ec.ACQ, "sec", "releases"))
    checked = Counter()
    with_text = [r for r in build["rows"] if r["id"].startswith("sec-lr:") and r["item"]["sec_action"]["text_read"]]
    for r in sample(with_text, n, lambda x: x["id"]):
        s = r["item"]["sec_action"]
        page = soup_text(lr_reader.get(s["url"]).decode("utf-8", "replace")) if s["url"] in lr_reader.index else None
        if page is None:
            fails["release_missing_from_raw"] += 1
            continue
        checked["releases"] += 1
        for c in s["civil_actions"]:
            checked["civil_actions"] += 1
            if c["as_written"] not in page:
                fails["civil_action_not_in_page"] += 1
        for c in s["courts"]:
            checked["courts"] += 1
            if squash(c["as_written"]) not in page:
                fails["court_not_in_page"] += 1
        for a in s["amounts"]:
            checked["amounts"] += 1
            if squash(a["as_written"]) not in page:
                fails["amount_not_in_page"] += 1
            dv = decimal_value(a["as_written"])
            if a.get("value_usd") is not None and (dv is None or abs(float(dv) - a["value_usd"]) > 0.01):
                fails["amount_value_mismatch"] += 1
        # the page title is part of the page text
        check_headline(s.get("headline_figure"), s.get("title") or "", page, fails, checked, s["max_resolution_amount_usd"])
        if s.get("headline_figure") and s["headline_figure"]["source"] == "title" and squash(s["headline_figure"]["as_written"]) not in page:
            fails["headline_title_not_in_page"] += 1
        check_headline_order(s.get("headline_figure"), s["amounts"], fails, checked, s.get("headline_none_reason"))
    fails = Counter({k: v for k, v in fails.items() if v})
    result = {"dataset": "sec_enforcement_actions", "lr_listed": len(lr_numbers), "ap_listed": len(ap_numbers),
              "lr_built": len(built_lr), "ap_built": len(built_ap), "lr_text_read": len(with_text), "checked": dict(checked),
              "failures": dict(fails), "failure_total": sum(fails.values())}
    write("sec", result)
    return result


# ---------------------------------------------------------------- settlements

def check_settlement(s, page_text):
    fails = Counter()
    dl = s["deadline"]
    if dl.get("status") == "confirmed" and squash(dl.get("as_written")) not in page_text:
        fails["deadline_not_on_page"] += 1
    for a in s["amounts"]:
        if squash(a["page_as_written"]) not in page_text:
            fails["amount_not_on_page"] += 1
    for c in s["courts"]:
        if squash(c["as_written"]) not in page_text:
            fails["court_not_on_page"] += 1
    for c in s["case_numbers"]:
        if c["as_written"] not in page_text:
            fails["case_number_not_on_page"] += 1
    return fails


def verify_settlements(n, recheck):
    build = load_build("settlement_claims_official")
    reader = ec.PackReader(os.path.join(ec.ACQ, "settlesignal", "official_pages"))
    fails = Counter()
    checked = Counter()
    for r in build["rows"]:
        s = r["item"]["settlement"]
        if not s["facts_confirmed"] or not s["name_check"]:
            fails["kept_without_confirmation"] += 1
        raw = reader.get(s["official_url"])
        if raw is None:
            fails["page_missing_from_raw"] += 1
            continue
        checked["stored_pages"] += 1
        fails.update(check_settlement(s, soup_text(raw.decode("utf-8", "replace"))))
    re_result = None
    if recheck:
        rdir = os.path.join(ec.ACQ, "settlesignal", "recheck_pages")
        rreader = ec.PackReader(rdir) if os.path.exists(os.path.join(rdir, "index.jsonl")) else None
        rc = Counter()
        rfails = Counter()
        for r in build["rows"]:
            s = r["item"]["settlement"]
            url = r["source_url"]
            if not rreader or url not in rreader.index:
                continue
            rc["rechecked"] += 1
            f = check_settlement(s, soup_text(rreader.get(url).decode("utf-8", "replace")))
            rfails.update(f)
            rc["records_with_a_changed_fact"] += bool(f)
        re_result = {"rechecked": dict(rc), "failures": dict(rfails),
                     "note": "A fact missing from a page re-read later is a change on the official page (deadline passed, page updated) or a failure; listed for review"}
    result = {"dataset": "settlement_claims_official", "records": len(build["rows"]), "checked": dict(checked),
              "failures": dict(fails), "failure_total": sum(fails.values()), "recheck": re_result}
    write("settlements", result)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("which", choices=["doj", "ftc", "sec", "settlements", "all"])
    parser.add_argument("--sample", type=int, default=3000)
    parser.add_argument("--recheck", action="store_true")
    parser.add_argument("--with-headline", action="store_true", help="doj: sample only releases that have a headline figure")
    args = parser.parse_args()
    if args.which in ("doj", "all"):
        verify_doj(args.sample, args.with_headline)
    if args.which in ("ftc", "all"):
        verify_ftc(args.sample)
    if args.which in ("sec", "all"):
        verify_sec(args.sample)
    if args.which in ("settlements", "all"):
        verify_settlements(args.sample, args.recheck)


if __name__ == "__main__":
    main()
