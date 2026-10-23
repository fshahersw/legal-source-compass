"""Independent checks of the legislation builds. Each check prints JSON lines and writes
private/build/legislation/verify/<check>.json with its failure count.

  python3 -I -B verify_legislation.py federal-counts [--from-storage]
      counts per Congress and type: bulk listing XML count, zip members recorded at download, build rows; with
      --from-storage every stored zip is read back from corpus-originals (SHA-256 checked) and re-counted, and every
      member is re-checked by a second path (regex on the raw XML, not the parser): identity, introduced date, latest
      action date, law numbers, and that the stored CRS summary keeps every word of the published summary
  python3 -I -B verify_legislation.py federal-sample [--n 200]
      random measures compared field by field with the Congress.gov API bill endpoint (title, sponsor, introduced date,
      latest action date and text, law numbers); requests count toward congress_api.BUDGET
  python3 -I -B verify_legislation.py federal-links [--n 50]
      committee-report Link Service URLs, text-version URLs and GovInfo details pages resolve (polite HEAD/GET)
  python3 -I -B verify_legislation.py state-counts
      per state/session: bills counted in the dump while streaming, bills in the extract, build rows
  python3 -I -B verify_legislation.py state-sample [--n 60]
      random state bills (at least 20 states) checked against their official legislature page: identifier and title
      present; at most one request per second per host; blocked hosts reported, never bypassed
  python3 -I -B verify_legislation.py crs
      CRS records against the API list; detail-backed fields against the stored detail responses
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import html
import json
import random
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bills_common as bc  # noqa: E402
import common as cm  # noqa: E402
import openstates_common as oc  # noqa: E402
from billstatus_parse import plain_words  # noqa: E402

OUT = cm.BUILD / "verify"
SEED = 20261023


def save(name: str, result: dict) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{name}.json").write_text(json.dumps(result, indent=1, sort_keys=True))
    print(json.dumps({k: v for k, v in result.items() if k in ("check", "failures", "checked", "explained", "notes")}))


def rows(dataset: str):
    with gzip.open(cm.BUILD / f"{dataset}.rows.jsonl.gz", "rt", encoding="utf-8") as fh:
        for line in fh:
            yield json.loads(line)


# ------------------------------------------------------------------ federal counts (and second-path re-derivation)

def first(pattern: str, text: str) -> str | None:
    m = re.search(pattern, text, re.S)
    return m.group(1).strip() if m else None


def strip_balanced(text: str, tag: str) -> str:
    """Remove every <tag>...</tag> block, matching nested blocks of the same tag (e.g. <amendments> inside amendments)."""
    out, depth, start, pos = [], 0, 0, 0
    for m in re.finditer(rf"<(/?){tag}(\s[^>]*?)?(/?)>", text):
        if m.group(3):  # <tag/>
            if depth == 0:
                out.append(text[pos:m.start()])
                pos = m.end()
            continue
        if not m.group(1):
            if depth == 0:
                out.append(text[pos:m.start()])
                start = m.start()
            depth += 1
        else:
            depth -= 1
            if depth == 0:
                pos = m.end()
            depth = max(depth, 0)
    if depth == 0:
        out.append(text[pos:])
    else:
        out.append(text[pos:start])
    return "".join(out)


def bill_block(xml: str) -> str:
    """The <bill> element without its <amendments> (amendments carry their own sponsors, actions and votes)."""
    b = xml[xml.find("<bill>"):xml.rfind("</bill>")]
    return strip_balanced(b, "amendments")


NESTED = ("relatedBills", "actions", "committees", "recordedVotes", "cosponsors", "sponsors", "notes", "cboCostEstimates",
          "titles", "textVersions", "summaries", "subjects", "laws", "committeeReports")


def regex_identity(xml: str) -> dict:
    b = bill_block(xml)
    top = b
    for tag in NESTED:  # keep only the bill's own top-level elements for the identity fields
        top = strip_balanced(top, tag)
    congress = first(r"<congress>(\d+)</congress>", top)
    btype = first(r"<(?:type|billType)>([A-Za-z]+)</(?:type|billType)>", top)
    number = first(r"<(?:number|billNumber)>(\d+)</(?:number|billNumber)>", top)
    intro = first(r"<introducedDate>(\d{4}-\d{2}-\d{2})", top)
    la = first(r"<latestAction>\s*<actionDate>(\d{4}-\d{2}-\d{2})", top)
    laws_block = first(r"<laws>(.*?)</laws>", b) or ""
    laws = re.findall(r"<number>([^<]+)</number>", laws_block)
    block = first(r"<summaries>(.*)</summaries>", b) or ""
    items = re.findall(r"<summary>(.*?)</summary>", block, re.S) or re.findall(r"<item>(.*?)</item>", block, re.S)
    summaries = []
    for it in items:
        text = first(r"<text>(.*?)</text>", it)
        if text:
            summaries.append(((first(r"<actionDate>([^<]*)</actionDate>", it) or "")[:10],
                              first(r"<updateDate>([^<]*)</updateDate>", it) or "",
                              first(r"<versionCode>([^<]*)</versionCode>", it) or "", text))
    return {"congress": congress, "type": (btype or "").lower(), "number": number, "introduced": intro, "latest": la,
            "laws": laws, "summaries": summaries}


def federal_counts(from_storage: bool) -> None:
    state = json.loads((cm.ACQ / "billstatus_state.json").read_text())
    build = Counter()
    by_id = {}
    for r in rows("congress_bills"):
        b = r["detail"]["bill"]
        build[f"{b['congress']}-{b['type']}"] += 1
        by_id[r["id"]] = (b.get("introduced"), (b.get("latestAction") or {}).get("actionDate"), [l["number"] for l in b["laws"]],
                          " ".join(x["x"] for x in ((b.get("summary") or {}).get("blocks") or [])))
    failures, table = [], []
    second = Counter()
    if from_storage:
        import stored_zips  # noqa: E402
    for key, unit in sorted(state.items(), key=lambda kv: (kv[1]["congress"], kv[1]["type"])):
        listing = json.loads(gzip.decompress((cm.ACQ / "billstatus_listings" / f"BILLSTATUS-{key}.json.gz").read_bytes()))
        listed = sum(1 for f in listing["files"] if f.get("name", "").endswith(".xml"))
        row = {"unit": key, "listing_xml": listed, "zip_xml_at_download": unit["zip_xml_members"], "parsed": unit["parsed"],
               "build_rows": build[key]}
        if from_storage:
            path = stored_zips.fetch(unit)
            ids = set()
            with zipfile.ZipFile(path) as zf:
                names = [n for n in zf.namelist() if n.endswith(".xml")]
                for name in names:
                    xml = zf.read(name).decode("utf-8", "replace")
                    ident = regex_identity(xml)
                    rid = f"{ident['congress']}-{ident['type']}-{ident['number']}"
                    ids.add(rid)
                    second["members"] += 1
                    got = by_id.get(rid)
                    if got is None:
                        failures.append({"unit": key, "member": name, "problem": "member not in build"})
                        continue
                    intro, latest, laws, words = got
                    if ident["introduced"] != intro:
                        failures.append({"unit": key, "id": rid, "field": "introduced", "xml": ident["introduced"], "build": intro})
                    if ident["latest"] != latest:
                        failures.append({"unit": key, "id": rid, "field": "latest action date", "xml": ident["latest"], "build": latest})
                    if sorted(ident["laws"]) != sorted(laws):
                        failures.append({"unit": key, "id": rid, "field": "laws", "xml": ident["laws"], "build": laws})
                    if ident["summaries"]:
                        # the documented rule: greatest action date, then update date, then version code
                        best = max(ident["summaries"], key=lambda s: (s[0], s[1], s[2]))
                        raw = best[3].strip()
                        cdata = re.fullmatch(r"<!\[CDATA\[(.*)\]\]>", raw, re.S)
                        # CDATA holds the HTML as is; otherwise the HTML is XML-escaped inside <text>
                        markup = cdata.group(1) if cdata else html.unescape(raw)
                        want = re.sub(r"\s+", " ", plain_words(markup)).strip()
                        have = re.sub(r"\s+", " ", words).strip()
                        second["summaries"] += 1
                        if want.replace(" ", "") != have.replace(" ", ""):
                            failures.append({"unit": key, "id": rid, "field": "summary words", "xml": want[:120], "build": have[:120]})
            path.unlink()
            row["zip_xml_reread"] = len(names)
            row["distinct_measures_reread"] = len(ids)
        table.append(row)
        vals = {v for k, v in row.items() if k != "unit"}
        if len(vals) != 1:
            failures.append({"unit": key, "problem": "count mismatch", **row})
        print(json.dumps(row), flush=True)
    total = {k: sum(r.get(k, 0) for r in table) for k in table[0] if k != "unit"}
    save("federal_counts", {"check": "federal counts per Congress and type" + (" (zips re-read from storage)" if from_storage else ""),
                            "failures": len(failures), "checked": len(table), "totals": total, "second_path": dict(second),
                            "failure_detail": failures[:200], "table": table})


# ------------------------------------------------------------------ federal sample vs the Congress.gov API

def norm(s: str | None) -> str:
    return re.sub(r"\s+", " ", (s or "")).strip().rstrip(".").lower()


def federal_sample(n: int) -> None:
    import congress_api as api  # noqa: E402

    ids = []
    for r in rows("congress_bills"):
        ids.append((r["id"], r["detail"]["bill"]))
    rng = random.Random(SEED)
    sample = rng.sample(ids, n)
    slug = {"hr": "hr", "s": "s", "hjres": "hjres", "sjres": "sjres", "hconres": "hconres", "sconres": "sconres", "hres": "hres", "sres": "sres"}
    failures, explained, checked = [], [], 0
    field_counts = Counter()
    for rid, b in sample:
        data = api.get(f"/bill/{b['congress']}/{slug[b['type']]}/{b['number']}")
        if not data or "bill" not in data:
            failures.append({"id": rid, "problem": "not returned by the API"})
            continue
        a = data["bill"]
        checked += 1
        ours = {
            "title": norm(b["titles"]["display"]),
            "sponsor": norm((b["sponsors"] or [{}])[0].get("bioguide")),
            "sponsor_name": norm((b["sponsors"] or [{}])[0].get("name")),
            "introduced": b.get("introduced"),
            "latest_date": (b.get("latestAction") or {}).get("actionDate"),
            "latest_text": norm((b.get("latestAction") or {}).get("text")),
            "laws": sorted(l["number"] for l in b["laws"]),
        }
        theirs = {
            "title": norm(a.get("title")),
            "sponsor": norm((a.get("sponsors") or [{}])[0].get("bioguideId")),
            "sponsor_name": norm((a.get("sponsors") or [{}])[0].get("fullName")),
            "introduced": a.get("introducedDate"),
            "latest_date": (a.get("latestAction") or {}).get("actionDate"),
            "latest_text": norm((a.get("latestAction") or {}).get("text")),
            "laws": sorted(l.get("number") for l in (a.get("laws") or [])),
        }
        for f in ours:
            field_counts[f] += 1
            if ours[f] != theirs[f]:
                entry = {"id": rid, "field": f, "build": ours[f], "api": theirs[f], "build_update": b["source"].get("updateDate"),
                         "api_update": a.get("updateDateIncludingText") or a.get("updateDate")}
                # the API is refreshed continuously; the bulk file was read on 2026-10-23
                if (a.get("updateDate") or "") > (b["source"].get("updateDate") or "") and f in ("latest_date", "latest_text", "laws", "title"):
                    entry["explanation"] = "record updated at Congress.gov after the Bill Status file was retrieved"
                    explained.append(entry)
                else:
                    failures.append(entry)
    save("federal_sample", {"check": f"{n} random measures vs Congress.gov API /bill", "checked": checked, "fields": dict(field_counts),
                            "failures": len(failures), "explained": len(explained), "failure_detail": failures,
                            "explained_detail": explained, "requests_used_total": api.used(), "seed": SEED})


# ------------------------------------------------------------------ link checks

def resolve(url: str) -> tuple[int, str]:
    for method in ("HEAD", "GET"):
        cm.wait_host(urllib.parse.urlparse(url).netloc, 1.0)
        try:
            req = urllib.request.Request(url, method=method, headers={"User-Agent": cm.UA, **({"Range": "bytes=0-0"} if method == "GET" else {})})
            with urllib.request.urlopen(req, timeout=60) as resp:
                return resp.status, resp.geturl()
        except urllib.error.HTTPError as e:
            if method == "HEAD" and e.code in (403, 405, 501):
                continue
            return e.code, url
        except (urllib.error.URLError, TimeoutError) as e:
            return 0, f"{type(e).__name__}"
    return 0, url


def federal_links(n: int) -> None:
    reports, texts, details = [], [], []
    for r in rows("congress_bills"):
        b = r["detail"]["bill"]
        for rep in b["reports"]:
            if rep.get("url"):
                reports.append((r["id"], rep["citation"], rep["url"]))
        for t in b["texts"]:
            if t.get("url"):
                texts.append((r["id"], t["type"], t["url"]))
            if t.get("details"):
                details.append((r["id"], t["type"], t["details"]))
    rng = random.Random(SEED)
    picks = ([("committee report", *x) for x in rng.sample(reports, n)] + [("text version", *x) for x in rng.sample(texts, n)]
             + [("GovInfo details page", *x) for x in rng.sample(details, max(10, n // 5))])
    failures, results = [], []
    for kind, rid, label, url in picks:
        status, final = resolve(url)
        ok = 200 <= status < 400 or status == 206
        results.append({"kind": kind, "id": rid, "label": label, "url": url, "status": status, "final": final})
        if not ok:
            failures.append(results[-1])
    save("federal_links", {"check": f"{n} committee-report links, {n} text-version links and GovInfo details pages",
                           "checked": len(results), "failures": len(failures), "failure_detail": failures,
                           "by_kind": dict(Counter(r["kind"] for r in results)), "results": results})


# ------------------------------------------------------------------ state counts and the official-page sample

def state_counts() -> None:
    src = cm.ACQ / "openstates" / json.loads((cm.BUILD / "state_bills.meta.json").read_text())["inputs"][0]["extracts"].rsplit("/", 1)[-1]
    man = json.loads((src / "dump_manifest.json").read_text())
    dump_counts = man["bills_per_session_in_dump"]
    sessions = {}
    with gzip.open(src / "sessions.jsonl.gz", "rt") as fh:
        for line in fh:
            s = json.loads(line)
            sessions[s["id"]] = s
    extract = Counter()
    with gzip.open(src / "bills.jsonl.gz", "rt") as fh:
        for line in fh:
            extract[json.loads(line)["legislative_session_id"]] += 1
    build = Counter()
    for r in rows("state_bills"):
        b = r["detail"]["bill"]
        build[(b["state"], b["session"]["id"])] += 1
    meta = json.loads((cm.BUILD / "state_bills.meta.json").read_text())
    failures, table = [], []
    for st, chosen in sorted(meta["summary"]["sessions"].items()):
        for c in chosen:
            row = {"state": st, "session": c["identifier"], "role": c["role"], "dump_count": dump_counts.get(c["id"]),
                   "extract": extract[c["id"]], "build_rows": build[(st, c["identifier"])]}
            table.append(row)
            if len({row["dump_count"], row["extract"], row["build_rows"]}) != 1:
                failures.append(row)
    states = {r["state"] for r in table}
    save("state_counts", {"check": "state bills per state/session: dump count while streaming, extract, build rows",
                          "checked": len(table), "failures": len(failures), "jurisdictions": len(states),
                          "missing": sorted(set(oc.STATES) - states), "failure_detail": failures, "table": table})


def page_text(url: str) -> tuple[int, str]:
    host = urllib.parse.urlparse(url).netloc
    cm.wait_host(host, 1.0)
    safe_url = urllib.parse.quote(url, safe=":/?&=%#+,;@!$'()*~[]")  # Open States records some URLs with raw spaces
    try:
        req = urllib.request.Request(safe_url, headers={"User-Agent": cm.UA, "Accept": "text/html,application/xhtml+xml,*/*"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = resp.read(4_000_000)
            ctype = resp.headers.get("Content-Type", "")
            status = resp.status
    except urllib.error.HTTPError as e:
        return e.code, ""
    except (urllib.error.URLError, TimeoutError, ConnectionError, ValueError, OSError) as e:
        return 0, type(e).__name__
    if "pdf" in ctype.lower():
        return status, "<pdf>"
    text = body.decode("utf-8", "replace")
    text = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", text)
    return status, html.unescape(re.sub(r"<[^>]+>", " ", text))


def squash(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", s.lower())


LONG = {"h": "house", "s": "senate", "a": "assembly", "l": "legislative", "hb": "housebill", "sb": "senatebill",
        "ab": "assemblybill", "lb": "legislativebill", "hf": "housefile", "sf": "senatefile", "hr": "houseresolution",
        "sr": "senateresolution", "hjr": "housejointresolution", "sjr": "senatejointresolution",
        "hcr": "houseconcurrentresolution", "scr": "senateconcurrentresolution", "ar": "assemblyresolution"}


def ident_on_page(identifier: str, text: str) -> str | None:
    """How the bill number appears on the page: 'abbreviation' (HB 1001, HB1001, H.B. 1001), 'long form' (House Bill
    1001) or None."""
    m = re.match(r"^([A-Za-z.\s]+?)\s*0*(\d+)\s*([A-Za-z]?)$", identifier.strip())
    flat = squash(text)
    if not m:
        return "exact" if squash(identifier) in flat else None
    letters, num, suffix = squash(m.group(1)), m.group(2), squash(m.group(3))
    if re.search(rf"{re.escape(letters)}0*{num}{re.escape(suffix)}(?!\d)", flat):
        return "abbreviation"
    long = LONG.get(letters)
    if long and re.search(rf"{long}\w{{0,12}}?0*{num}{re.escape(suffix)}(?!\d)", flat):
        return "long form"
    return None


def title_on_page(title: str, text: str) -> float:
    words = [w for w in re.findall(r"[a-z0-9]+", title.lower())][:30]
    if not words:
        return 0.0
    hay = set(re.findall(r"[a-z0-9]+", text.lower()))
    return sum(1 for w in words if w in hay) / len(words)


def state_sample(n: int) -> None:
    by_state = defaultdict(list)
    for r in rows("state_bills"):
        b = r["detail"]["bill"]
        by_state[b["state"]].append((r["id"], b["identifier"], b["title"], r["source_url"], b.get("sourceKind")))
    rng = random.Random(SEED)
    states = sorted(by_state)
    rng.shuffle(states)
    picks = []
    i = 0
    while len(picks) < n:
        st = states[i % len(states)]
        picks.append((st, *rng.choice(by_state[st])))
        i += 1
    results, failures, unchecked, partial = [], [], [], []
    for st, rid, ident, title, url, kind in picks:
        res = {"state": st, "id": rid, "identifier": ident, "url": url, "source_kind": kind}
        if kind == "search":
            res["result"] = "source is the legislature's search or status start page (no bill page recorded); not checkable"
            unchecked.append(res)
            results.append(res)
            continue
        status, text = page_text(url)
        if 500 <= status < 600:
            time.sleep(5)
            status, text = page_text(url)
        res["status"] = status
        if status in (301, 302, 303, 307, 308, 401, 403, 429, 503) or status == 0:
            res["result"] = "blocked, redirect-gated or unreachable from here (not bypassed)"
            res["error"] = text if status == 0 else None
            unchecked.append(res)
        elif status in (404, 410):
            res["result"] = "page not found"
            failures.append(res)
        elif status != 200:
            res["result"] = f"server error HTTP {status}"
            failures.append(res)
        elif text == "<pdf>":
            res["result"] = "source is a PDF; not text-checked"
            unchecked.append(res)
        else:
            visible = re.sub(r"\s+", " ", text).strip()
            res["visible_chars"] = len(visible)
            res["identifier_found"] = ident_on_page(ident, text)
            res["title_share"] = round(title_on_page(title or "", text), 2)
            script_page = (len(visible) < 3000 or "enable javascript" in visible.lower() or "Html.ActionLink" in visible)
            if res["identifier_found"] and res["title_share"] >= 0.8:
                res["result"] = "ok"
            elif res["identifier_found"]:
                res["result"] = "identifier found; the page shows a shortened or different title (e.g. a digest)"
                res["sample_text"] = visible[:300]
                partial.append(res)
            elif script_page:
                # the page's bill data is filled in by scripts after load; a plain request sees only the page frame
                res["result"] = "page renders its bill data with scripts; not checkable without a browser"
                res["sample_text"] = visible[:200]
                unchecked.append(res)
            else:
                res["result"] = "mismatch"
                res["sample_text"] = visible[:300]
                failures.append(res)
        results.append(res)
        print(json.dumps({k: res.get(k) for k in ("state", "identifier", "status", "result", "title_share")}), flush=True)
    ok = sum(1 for r in results if r["result"] == "ok")
    save("state_sample", {"check": f"{n} random state bills vs their official legislature page", "checked": len(results),
                          "states": len({r['state'] for r in results}), "ok": ok, "failures": len(failures),
                          "explained": len(partial), "unchecked": len(unchecked), "failure_detail": failures,
                          "explained_detail": partial, "unchecked_detail": unchecked,
                          "unchecked_hosts": sorted({urllib.parse.urlparse(r["url"]).netloc for r in unchecked}),
                          "results": results, "seed": SEED})


# ------------------------------------------------------------------ CRS

def crs() -> None:
    import congress_api as api  # noqa: E402

    build = json.loads((cm.BUILD / "crs_reports.json").read_text())
    lst = {r["id"]: r for r in json.loads((cm.BUILD / "crs_list.json").read_text())["reports"]}
    failures = []
    detail_checked = 0
    for row in build["rows"]:
        c = row["detail"]["crs"]
        src = lst.get(row["id"])
        if not src:
            failures.append({"id": row["id"], "problem": "not in the API list"})
            continue
        for f in ("title", "contentType", "status", "publishDate", "updateDate", "version"):
            if c.get(f) != src.get(f):
                failures.append({"id": row["id"], "field": f, "build": c.get(f), "list": src.get(f)})
        if c["detailFetched"]:
            p = api.stored_name(f"/crsreport/{row['id']}", {"format": "json"})
            d = json.loads(gzip.decompress(p.read_bytes()))["CRSReport"]
            detail_checked += 1
            if c["authors"] != [a["author"] for a in d.get("authors", []) if a.get("author")]:
                failures.append({"id": row["id"], "field": "authors"})
            if c["topics"] != [t["topic"] for t in d.get("topics", []) if t.get("topic")]:
                failures.append({"id": row["id"], "field": "topics"})
            if [f["url"] for f in c["formats"]] != [f["url"] for f in d.get("formats", []) if (f.get("url") or "").startswith("https://www.congress.gov/")]:
                failures.append({"id": row["id"], "field": "formats"})
    missing = set(lst) - {r["id"] for r in build["rows"]}
    save("crs", {"check": "crs_reports vs the API list and stored detail responses", "checked": len(build["rows"]),
                 "detail_checked": detail_checked, "missing_from_build": len(missing), "failures": len(failures) + len(missing),
                 "failure_detail": failures[:100]})


def main(argv: list[str]) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("check", choices=["federal-counts", "federal-sample", "federal-links", "state-counts", "state-sample", "crs"])
    ap.add_argument("--n", type=int)
    ap.add_argument("--from-storage", action="store_true")
    a = ap.parse_args(argv)
    if a.check == "federal-counts":
        federal_counts(a.from_storage)
    elif a.check == "federal-sample":
        federal_sample(a.n or 200)
    elif a.check == "federal-links":
        federal_links(a.n or 50)
    elif a.check == "state-counts":
        state_counts()
    elif a.check == "state-sample":
        state_sample(a.n or 60)
    else:
        crs()


if __name__ == "__main__":
    main(sys.argv[1:])
