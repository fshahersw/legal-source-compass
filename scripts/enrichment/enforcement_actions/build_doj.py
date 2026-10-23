"""Build the DOJ press-release datasets from the harvested News API pages.

  python3 -I -B scripts/enrichment/enforcement_actions/build_doj.py

Outputs (private/build/enforcement_actions/):
  doj_press_releases.json         index dataset: overview (partitions, coverage, extraction checks), one row per year,
                                  per component and per topic (counts only)
  doj_press_releases_<YYYY>.json  the releases dated in that year (record per release)

Why yearly partitions: about 275,000 releases do not fit publish_build.py's whole-file load (the build, a copy and
the read-back are all held in memory); each year is 1-25k rows. The index row `doj-index:overview` lists the
partition dataset ids so readers never hard-code them.

Each release keeps: id (DOJ uuid), date, title, components, topics, release number, URL, teaser, an excerpt of at most
1,500 characters of the body text (the full body stays in the raw pages, gzip-compressed, never in the database), and
deterministic extractions (extract.py) whose every value is a verbatim span of the release text, re-checked here
(span failures are counted and must be 0): dollar figures with their sentence, statutes, case/docket numbers, federal
court names (court id only on an exact map), and parties named in the title (exactly as written, corroborated in the
body). Companies link only on a unique exact normalised name; courts only to ids in the saved court_spine lookup.
"""
import gzip
import hashlib
import html
import json
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_common as bc  # noqa: E402
import enf_common as ec  # noqa: E402
import extract as ex  # noqa: E402
import links  # noqa: E402

PAGES = os.path.join(ec.ACQ, "doj", "pages")
TMP = os.path.join(ec.BUILD, "doj_tmp")
API = "https://www.justice.gov/api/v1/press_releases.json"
DOCS = "https://www.justice.gov/developer/api-documentation/api_v1"
EXCERPT = 1500
CONTACT_LINE = re.compile(r"^(?:CONTACT|Contact|PHONE|Phone|FAX|Fax|E-?MAIL|E-?mail|Email|PRESS OFFICE|Press Office|For Immediate Release|FOR IMMEDIATE RELEASE|Media Contact|MEDIA CONTACT)\b[^\n]{0,160}$")
TERMS = "U.S. Department of Justice works are in the public domain (17 U.S.C. § 105); photos and attachments may be third-party and are not copied"


def epoch_date(value):
    try:
        return datetime.fromtimestamp(int(value), tz=timezone.utc).strftime("%Y-%m-%d")
    except (TypeError, ValueError, OverflowError, OSError):
        return None


def time_attr(value):
    m = re.search(r'datetime="([^"]+)"', value or "")
    return m.group(1) if m else None


def names(value):
    if not isinstance(value, list):
        return []
    return [html.unescape(v.get("name") or "").strip() for v in value if isinstance(v, dict) and v.get("name")]


def usao_state(components):
    """USPS code of a U.S. Attorney's Office component ("USAO - Pennsylvania, Eastern" -> PA); else None."""
    for c in components:
        m = re.match(r"^USAO - (?P<state>[A-Za-z .]+?)(?:, (?:Northern|Southern|Eastern|Western|Middle|Central))?$", c)
        if not m:
            continue
        state = m.group("state").strip()
        state = {"District of Columbia": "Columbia"}.get(state, state)
        code = ex.STATES.get(state)
        if code and code not in ("nmi",):
            return code.upper()
    return None


BOILERPLATE_MIN = 25  # a figure sentence repeated verbatim in this many releases is a stock paragraph


def sentence_key(sentence):
    return hashlib.sha1(re.sub(r"\s+", " ", sentence or "").strip().lower().encode("utf-8")).hexdigest()[:16]


def amount_sentence_keys(r):
    text = ex.html_to_text(r.get("body") or "")
    return {sentence_key(a.get("sentence")) for a in ex.extract_amounts(text) if a.get("sentence")}


def build_release(r, companies, courts, checks, boilerplate=frozenset()):
    body_html = r.get("body") or ""
    text = ex.html_to_text(body_html)
    title = html.unescape(re.sub(r"\s+", " ", r.get("title") or "")).strip()
    date = epoch_date(r.get("date"))
    components = names(r.get("component"))
    topics = names(r.get("topic"))
    spans = ex.sentence_spans(text)
    amounts = ex.extract_amounts(text, spans)
    statutes = ex.extract_statutes(text)
    dockets = ex.extract_dockets(text)
    court_list = ex.extract_courts(text)
    parties = ex.title_parties(title, text)
    failures = ex.verify_spans(text, amounts + statutes + dockets + court_list)
    failures += sum(1 for p in parties if p["as_written"] not in title or p["as_written"] not in text)
    checks["span_failures"] += failures
    checks["values_checked"] += len(amounts) + len(statutes) + len(dockets) + len(court_list) + len(parties)
    for c in court_list:
        if c.get("court_id") and not courts.valid(c["court_id"]):
            c.pop("court_id")
    company_links = []
    for p in parties:
        m = companies.match(p["as_written"])
        if m:
            company_links.append({**m, "as_written": p["as_written"]})
    for a in amounts:
        if a.get("sentence") and sentence_key(a["sentence"]) in boilerplate:
            a["boilerplate"] = True
            checks["boilerplate_figures"] += 1
    valued = [a for a in amounts if a.get("value_usd") is not None]
    # the largest resolution figure ignores stock paragraphs repeated across many releases (program totals)
    resolution = [a["value_usd"] for a in valued if a.get("keyword") in ex.RESOLUTION_KINDS and not a.get("boilerplate")]
    max_res = max(resolution) if resolution else None
    max_any = max((a["value_usd"] for a in valued), default=None)
    # the excerpt is a contiguous span of the body text; leading press-contact lines (CONTACT/PHONE/FAX...) are skipped
    start = 0
    for line in text.split("\n")[:8]:
        if CONTACT_LINE.match(line):
            start += len(line) + 1
        else:
            break
    excerpt, truncated = bc.clip(text[start:], EXCERPT)
    court_ids = sorted({c["court_id"] for c in court_list if c.get("court_id")})
    state = usao_state(components)
    uuid = r["uuid"]
    url = r.get("url") or ""
    release = {
        "uuid": uuid, "date": date, "created": time_attr(r.get("created")), "changed": time_attr(r.get("changed")),
        "number": (r.get("number") or "").strip() or None, "components": components, "topics": topics, "url": url,
        "teaser": bc.clip(ex.html_to_text(r.get("teaser") or ""), 400)[0],
        "amounts": [{k: a[k] for k in ("as_written", "value_usd", "keyword", "sentence", "range_start", "ambiguous_as_written", "boilerplate") if k in a}
                    | {"sentence": bc.clip(a.get("sentence"), 220)[0]} for a in amounts[:5]],
        "amounts_total": len(amounts), "max_amount_usd": max_any, "max_resolution_amount_usd": max_res,
        "statutes": [{"cite": s["cite"], "as_written": s["as_written"]} for s in statutes[:12]], "statutes_total": len(statutes),
        "dockets": [{"as_written": d["as_written"], "form": d["form"], **({"mdl": d["mdl"]} if "mdl" in d else {})} for d in dockets[:10]],
        "courts": [{"as_written": c["as_written"], **({"court_id": c["court_id"]} if c.get("court_id") else {})} for c in court_list[:6]],
        "parties": [{"as_written": p["as_written"], "kind": p["kind"]} for p in parties[:6]],
        "companies": company_links, "office_state": state,
        "body_chars": len(text), "body_sha256": ec.sha256(body_html.encode("utf-8")), "excerpt_truncated": truncated,
        "excerpt_offset": start,
    }
    checks["releases"] += 1
    checks["with_amount"] += bool(valued)
    checks["with_resolution_amount"] += max_res is not None
    checks["with_statute"] += bool(statutes)
    checks["with_docket"] += bool(dockets)
    checks["with_court"] += bool(court_list)
    checks["with_court_id"] += bool(court_ids)
    checks["with_party"] += bool(parties)
    checks["company_links"] += len(company_links)
    checks["releases_with_company"] += bool(company_links)
    # partition by release date; a release without one is filed under the year it was created (labelled as such)
    year = (date or (release["created"] or "")[:10] or "0000")[:4]
    if not date:
        release["date_basis"] = "DOJ release date not recorded; filed under the year the record was created"
        checks["no_release_date"] += 1
    link_list = [{"url": url, "label": "DOJ press release (justice.gov)"}] if url.startswith("https://") else []
    link_list += [{"url": f"/courts/{cid}", "label": f"Court named in the release: {courts.name(cid)}"} for cid in court_ids]
    link_list += [{"url": f"/companies/{c['cik']}", "label": f"SEC registrant: {c['registrant']} (exact name match)"} for c in company_links]
    if state:
        link_list.append({"url": f"/places/{state}", "label": f"Office state ({state}, from the U.S. Attorney's Office component)"})
    lead_component = next((c for c in components if c.startswith("USAO")), components[0] if components else None)
    facts = [
        ("Date", date), ("Components", components), ("Topics", topics), ("Release number", release["number"]),
        ("Dollar figures stated (as written; first keyword in the sentence)",
         [f"{a['as_written']} ({a.get('keyword') or 'no keyword'})" for a in amounts[:5]]),
        ("Statutes cited", [s["cite"] for s in statutes[:12]]), ("Case or docket numbers", [d["as_written"] for d in dockets[:10]]),
        ("Federal courts named", [c["as_written"] for c in court_list[:6]]),
        ("Named in the title (as written)", [p["as_written"] for p in parties[:6]]),
        ("Excerpt (first 1,500 characters of the release)", excerpt),
        ("Source", "DOJ News API (justice.gov/api/v1/press_releases.json)"),
    ]
    row = bc.record(
        f"doj_press_releases_{year}", f"doj-pr:{uuid}", title or "(untitled release)", source_url=url or API,
        subtitle=" · ".join(x for x in [date, lead_component, bc.money_label(max_res) if max_res else None] if x),
        state=state or "",
        cells={"date": date or bc.NOT_RECORDED, "title": title, "component": lead_component or bc.NOT_RECORDED,
               "amount": bc.money_label(max_res) if max_res else "No resolution figure stated"},
        facts=facts,
        text=" ".join(filter(None, [title, release["teaser"], " ".join(p["as_written"] for p in parties), " ".join(d["as_written"] for d in dockets[:10])])),
        filters={"year": [year], "component": components, "topic": topics, "amount": [bc.amount_bucket(max_res)],
                 "has_docket": ["yes" if dockets else "no"], "court": court_ids, "state": [state] if state else [],
                 "company": [c["cik"] for c in company_links]},
        links=link_list, extra={"release": release},
    )
    return year, row


def main():
    companies = links.Companies()
    courts = links.Courts()
    checks = Counter()
    os.makedirs(TMP, exist_ok=True)
    for name in os.listdir(TMP):
        os.remove(os.path.join(TMP, name))
    handles = {}
    page_files = sorted(f for f in os.listdir(PAGES) if f.endswith(".json.gz"))
    # pass 1: the copy of each release to keep (latest "changed"; a release can appear on two pages when the
    # API's offsets shift during the harvest)
    winner = {}
    for fname in page_files:
        data = json.loads(gzip.open(os.path.join(PAGES, fname)).read())
        for i, r in enumerate(data.get("results") or []):
            uuid = r.get("uuid")
            if not uuid:
                checks["no_uuid"] += 1
                continue
            changed = time_attr(r.get("changed")) or ""
            if uuid in winner:
                checks["duplicate_uuid_rows"] += 1
                if winner[uuid][0] >= changed:
                    continue
            winner[uuid] = (changed, fname, i)
    keep = defaultdict(set)
    for uuid, (_, fname, i) in winner.items():
        keep[fname].add(i)
    # pass 1b: sentences around dollar figures that recur verbatim across many releases (stock program paragraphs)
    sentence_counts = Counter()
    for fname in page_files:
        if fname not in keep:
            continue
        data = json.loads(gzip.open(os.path.join(PAGES, fname)).read())
        for i, r in enumerate(data.get("results") or []):
            if i in keep[fname]:
                sentence_counts.update(amount_sentence_keys(r))
    boilerplate = frozenset(k for k, n in sentence_counts.items() if n >= BOILERPLATE_MIN)
    checks["boilerplate_sentences"] = len(boilerplate)
    # pass 2: build each kept release once, streamed into per-year temporary files
    year_pages = defaultdict(set)
    for fname in page_files:
        if fname not in keep:
            continue
        data = json.loads(gzip.open(os.path.join(PAGES, fname)).read())
        for i, r in enumerate(data.get("results") or []):
            if i not in keep[fname]:
                continue
            year, row = build_release(r, companies, courts, checks, boilerplate)
            year_pages[year].add(fname)
            if year not in handles:
                handles[year] = gzip.open(os.path.join(TMP, f"{year}.jsonl.gz"), "wt", encoding="utf-8")
            handles[year].write(json.dumps(row, ensure_ascii=False) + "\n")
    for h in handles.values():
        h.close()
    checks["pages"] = len(page_files)
    checks["unique_releases"] = len(winner)

    by_year = Counter()
    comp_year = defaultdict(Counter)
    topic_year = defaultdict(Counter)
    bucket_year = defaultdict(Counter)
    comp_latest = {}
    partitions = []
    all_inputs = bc.manifest_inputs(["private/acq/enforcement_actions/doj/pages"])
    for year in sorted(handles):
        inputs = [x for x in all_inputs if os.path.basename(x["path"]) in year_pages[year]]
        rows = {}
        with gzip.open(os.path.join(TMP, f"{year}.jsonl.gz"), "rt", encoding="utf-8") as h:
            for line in h:
                row = json.loads(line)
                prev = rows.get(row["id"])
                if prev is None or (row["item"]["release"]["changed"] or "") >= (prev["item"]["release"]["changed"] or ""):
                    rows[row["id"]] = row
        ordered = sorted(rows.values(), key=lambda r: (r["item"]["release"]["date"] or "", r["item"]["release"]["created"] or ""), reverse=True)
        for row in ordered:
            rel = row["item"]["release"]
            by_year[year] += 1
            for c in rel["components"]:
                comp_year[c][year] += 1
                if c not in comp_latest or (rel["date"] or "") > comp_latest[c][0]:
                    comp_latest[c] = (rel["date"] or "", row["id"], row["title"])
            for t in rel["topics"]:
                topic_year[t][year] += 1
            bucket_year[year][bc.amount_bucket(rel["max_resolution_amount_usd"])] += 1
        dataset = f"doj_press_releases_{year}"
        top_components = Counter({c: comp_year[c][year] for c in comp_year if comp_year[c][year]}).most_common(40)
        top_topics = Counter({t: topic_year[t][year] for t in topic_year if topic_year[t][year]}).most_common(40)
        summary = {
            "source": "DOJ News API press releases", "api": API, "api_docs": DOCS, "terms": TERMS,
            "partition_of": "doj_press_releases", "year": year, "records": len(ordered),
            "body_storage": "Full release bodies stay gzip-compressed in the raw API pages (private/acq/enforcement_actions/doj/pages); records hold at most a 1,500-character excerpt",
            "extraction": "extract.py: dollar figures (value in USD, sentence, first keyword in the sentence), U.S.C./C.F.R./named-act citations, docket numbers, federal court names (court id only on an exact map) and parties named in the title (verbatim, corroborated in the body); every value is a verbatim span of the release text",
            "amount_note": "max_resolution_amount_usd is the largest figure whose sentence contains a settlement, penalty/fine, restitution, forfeiture, disgorgement or judgment keyword; statutory maximums, alleged losses, figures in a sentence repeated verbatim in 25 or more releases (stock program paragraphs) and figures ambiguous as written (a multiplier on a number of 1,000 or more) are excluded. It is a stated figure, not a verified payment.",
        }
        bc.write_build(dataset, f"DOJ press releases, {year}", ordered,
                       bc.listing([("date", "Date"), ("title", "Title"), ("component", "Component"), ("amount", "Largest resolution figure stated")],
                                  [("component", "Component", {c: f"{c} ({n:,})" for c, n in top_components}),
                                   ("topic", "Topic", {t: f"{t} ({n:,})" for t, n in top_topics}),
                                   ("amount", "Largest resolution figure stated", bc.AMOUNT_BUCKETS),
                                   ("has_docket", "Case/docket number stated", {"yes": "Yes", "no": "No"})]),
                       summary, inputs, compress=True)
        partitions.append({"dataset": dataset, "year": year, "records": len(ordered)})
        del rows, ordered
        os.remove(os.path.join(TMP, f"{year}.jsonl.gz"))

    # ---------------------------------------------------------------- index dataset
    index_rows = []
    years = sorted(by_year)
    overview = {
        "partitions": partitions, "years": years, "total": sum(by_year.values()),
        "checks": dict(checks), "company_match": companies.stats,
        "components": [{"name": c, "count": sum(v.values())} for c, v in sorted(comp_year.items(), key=lambda kv: -sum(kv[1].values()))],
        "topics": [{"name": t, "count": sum(v.values())} for t, v in sorted(topic_year.items(), key=lambda kv: -sum(kv[1].values()))],
        "amount_buckets": bc.AMOUNT_BUCKETS,
        "by_year": [{"year": y, "count": by_year[y], "amount": dict(bucket_year[y])} for y in years],
    }
    index_rows.append(bc.record(
        "doj_press_releases", "doj-index:overview", "DOJ press releases: overview", source_url=API,
        subtitle=f"{overview['total']:,} releases, {years[0]}-{years[-1]}",
        cells={"kind": "Overview", "name": "All releases", "count": overview["total"], "years": f"{years[0]}-{years[-1]}"},
        facts=[("Releases", f"{overview['total']:,}"), ("Years (release date)", f"{years[0]}-{years[-1]}"),
               ("Partition datasets", [p["dataset"] for p in partitions]), ("Source", f"DOJ News API ({API})"),
               ("Extraction checks", f"{checks['values_checked']:,} extracted values re-checked against the release text; {checks['span_failures']} failures")],
        text="DOJ press releases overview", filters={"kind": ["overview"]}, extra={"overview": overview},
    ))
    for y in years:
        p = next(p for p in partitions if p["year"] == y)
        top_c = sorted(((c, v[y]) for c, v in comp_year.items() if v[y]), key=lambda kv: -kv[1])[:15]
        top_t = sorted(((t, v[y]) for t, v in topic_year.items() if v[y]), key=lambda kv: -kv[1])[:15]
        index_rows.append(bc.record(
            "doj_press_releases", f"doj-index:year:{y}", f"DOJ press releases dated {y}", source_url=API,
            subtitle=f"{by_year[y]:,} releases", cells={"kind": "Year", "name": y, "count": by_year[y], "years": y},
            facts=[("Releases", f"{by_year[y]:,}"), ("Dataset", p["dataset"]),
                   ("Top components", [f"{c} ({n:,})" for c, n in top_c]), ("Top topics", [f"{t} ({n:,})" for t, n in top_t])],
            text=f"DOJ press releases {y}", filters={"kind": ["year"], "year": [y]},
            links=[],
            extra={"year_stats": {"year": y, "dataset": p["dataset"], "count": by_year[y], "components": top_c, "topics": top_t, "amount": dict(bucket_year[y])}},
        ))
    for kind, table in (("component", comp_year), ("topic", topic_year)):
        for name, counts in sorted(table.items(), key=lambda kv: -sum(kv[1].values())):
            slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:70]
            total = sum(counts.values())
            latest = comp_latest.get(name) if kind == "component" else None
            index_rows.append(bc.record(
                "doj_press_releases", f"doj-index:{kind}:{slug}", name, source_url=API,
                subtitle=f"{total:,} releases ({kind})",
                cells={"kind": kind.title(), "name": name, "count": total, "years": f"{min(counts)}-{max(counts)}"},
                facts=[("Releases", f"{total:,}"), ("Years", f"{min(counts)}-{max(counts)}"),
                       ("Releases by year", [f"{y}: {counts[y]:,}" for y in sorted(counts)]),
                       ("Latest release", f"{latest[0]} {latest[2]}" if latest else None)],
                text=f"{name} DOJ {kind}", filters={"kind": [kind]},
                extra={f"{kind}_stats": {"name": name, "count": total, "by_year": dict(sorted(counts.items())),
                                         **({"latest": {"date": latest[0], "id": latest[1], "title": latest[2]}} if latest else {})}},
            ))
    seen_ids = set()
    unique_rows = []
    for r in index_rows:
        if r["id"] in seen_ids:
            continue
        seen_ids.add(r["id"])
        unique_rows.append(r)
    summary = {
        "source": "DOJ News API press releases (all components: Office of Public Affairs, U.S. Attorneys' Offices, litigating divisions)",
        "api": API, "api_docs": DOCS, "terms": TERMS,
        "partitions": partitions,
        "harvest": "sort=created ASC, pagesize=50, at most 2 request starts/s; every page stored unchanged (gzip) with sha256 in the manifest; justice.gov sitemaps not used",
        "checks": dict(checks),
        "named_individuals": "Shown exactly as DOJ publishes them in the title (owner decision 2026-10-22); nothing is inferred about a person",
    }
    bc.write_build("doj_press_releases", "DOJ press releases: index (years, components, topics)", unique_rows,
                   bc.listing([("kind", "Kind"), ("name", "Name"), ("count", "Releases"), ("years", "Years")],
                              [("kind", "Kind", {"overview": "Overview", "year": "Year", "component": "Component", "topic": "Topic"})]),
                   summary, [{"url": API, "path": "private/acq/enforcement_actions/doj/pages", "sha256": "per page in _manifest.jsonl"}])
    print(json.dumps(dict(checks)))
    print(json.dumps({"company_match": companies.stats}))


if __name__ == "__main__":
    main()
