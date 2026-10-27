"""openFDA bulk-file builders for safety/1: the FAERS and MAUDE series and breakdowns that the count API would need tens of
thousands of requests for, counted from the official bulk export (download.open.fda.gov, CC0), plus exact NDC-directory keys
(pharmacologic class, application numbers) for the FAERS product subjects. Workers never load; the lead loads the chunks
with scripts/safety_v2/load.py.

  python -I scripts/safety_v2/openfda_bulk.py <stream> --acq DIR [options]
    index     save https://api.fda.gov/download.json (one request) with its sha256: the partition list of every export
    universe  re-rank the FAERS products with the count API (prefix searches: needs DATA_GOV_API_KEY, openFDA refuses
              wildcard searches without a key); prints sha256 values to compare with the stored safety.subjects
    api-plan  write <acq>/api/subjects/plan.json (MDL device groups + national:maude) for
              openfda_build.py maude --outdir <acq>/api --keyless --skip-breakdowns (their series come from the count API)
    targets   write <acq>/targets.json from the inputs below (no network): the FAERS products and MAUDE subjects to count
                --faers-universe F   JSON [[rank, reports_total, generic_name], ...] or [generic_name, ...] in rank order
                                     (the stored safety.subjects list, checked against it by sha256)
                --maude-codes F      text file of the MAUDE product codes in rank order (safety.subjects device_code)
                --existing F         JSON {"series_complete_ranks": [1, 450], "breakdown_ranks": [1, 450],
                                     "partial_series": {"faers:x": ["faers_reports", ...]}}: what is already loaded
    faers     count every drug/event partition (resumable; one aggregate file per partition under <acq>/faers/parts)
    maude     count every device/event partition (product codes and the MDL device groups of mdl_map.py)
    reduce-faers / reduce-maude   merge the partition aggregates into loader chunks under <acq>/load/<stream>
    accept-groups   compare each MDL device group's offline series with the count API's (<acq>/api); reduce-maude
              then writes bulk breakdowns only for the groups that matched every month
    ndc       NDC directory (drug/ndc bulk file) → subjects rows carrying pharm_class_epc and application_numbers keys
              (--faers-universe [[rank, reports_total, name]] supplies the stored reports_total)
    validate  re-ask the count API for a sample of built rows (--validate-stream faers|maude --n-series --n-breakdowns
              --max-requests); writes <acq>/<stream>/validation.json
    --workers N (default 4)  --limit N (first N partitions only: a validation sample)  --keep-zips

Accuracy rules (the same as openfda_build.py, which they mirror):
- A report is counted in a month by its receivedate / date_received (YYYYMMDD; an implausible date is not counted in any
  month, as the API's date count does not list it). A subject's series runs from its first report month (FAERS floor
  2004-01, MAUDE 1991-01) to the last complete month of the export; a month inside that window without a report is 0.
- FAERS: a report counts for a product when any drug's openfda.generic_name equals the product's name exactly (the API
  search patient.drug.openfda.generic_name.exact:"NAME"); serious and the six outcome criteria count only the value "1".
- MAUDE: a report counts for a product code when a device's device_report_product_code is that code; an MDL group counts
  the reports its stored openFDA search matches, evaluated here with the search's own phrase semantics (standard
  tokenizer, lower case, phrases inside one value). Group results are used only where they equal the API's own series.
- Breakdowns count each report once per distinct published term (the API's count=<field>.exact, which also counts the
  empty string a report publishes, e.g. a blank manufacturer name: stored as '' and shown as Not recorded), keep the
  top N by count then term, and record `returned` as the API would (N when more terms exist). Serious counts are exact here.
- Raw zips are deleted after counting (--keep-zips keeps them); each one's URL, size, sha256 and record count stay in the
  partition aggregate and the manifest, so the input is verifiable against the export.
"""
import argparse
import gzip
import hashlib
import io
import json
import re
import sys
import time
import urllib.request
import zipfile
from collections import defaultdict
from datetime import date
from multiprocessing import Pool
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common as c  # noqa: E402
import mdl_map  # noqa: E402
import openfda_build as ob  # noqa: E402

INDEX_URL = "https://api.fda.gov/download.json"
DATE_RE = re.compile(r"(19|20)\d{6}")
FAERS_FLAGS = ["serious", "seriousnessdeath", "seriousnesshospitalization", "seriousnesslifethreatening",
               "seriousnessdisabling", "seriousnesscongenitalanomali", "seriousnessother"]
# series name, index into the per-month count list (0 = all reports, 1.. = FAERS_FLAGS[i - 1])
FAERS_SERIES = [(name, i) for i, (name, _extra, _unit) in enumerate(ob.FAERS_SERIES)]
MAUDE_EVENT = {"maude_death": "death", "maude_injury": "injury", "maude_malfunction": "malfunction"}
MAUDE_DIMS = [("device_problem", "product_problems.exact", 1000), ("patient_problem", "patient.patient_problems.exact", 200),
              ("manufacturer", "device.manufacturer_d_name.exact", 50), ("brand_name", "device.brand_name.exact", 50)]
GROUP_FIELDS = ("device.brand_name", "device.manufacturer_d_name", "device.device_report_product_code", "device.generic_name")


# ------------------------------------------------------------------------------------------------ streaming JSON
def iter_results(fh, block=1 << 24):
    """Yield the objects of the top-level "results" array of an openFDA export file, reading `fh` (text) in blocks, so a
    multi-gigabyte file never sits in memory. Raises ValueError on a truncated or malformed file."""
    dec = json.JSONDecoder()
    buf = ""
    while '"results"' not in buf:
        chunk = fh.read(block)
        if not chunk:
            raise ValueError("no results array")
        buf += chunk
    i = buf.index('"results"')
    while "[" not in buf[i:]:
        chunk = fh.read(block)
        if not chunk:
            raise ValueError("no results array")
        buf += chunk
    i = buf.index("[", i) + 1
    eof = False
    while True:
        n = len(buf)
        while i < n and buf[i] in " \r\n\t,":
            i += 1
        if i < n and buf[i] == "]":
            return
        if i >= n:
            if eof:
                raise ValueError("results array not closed")
            chunk = fh.read(block)
            eof = not chunk
            buf, i = buf[i:] + chunk, 0
            continue
        try:
            obj, j = dec.raw_decode(buf, i)
        except json.JSONDecodeError:
            if eof:
                raise ValueError("malformed record") from None
            chunk = fh.read(block)
            eof = not chunk
            buf, i = buf[i:] + chunk, 0
            continue
        yield obj
        i = j
        if i > (1 << 23):
            buf, i = buf[i:], 0


def iter_zip_results(path):
    with zipfile.ZipFile(path) as z:
        names = [n for n in z.namelist() if n.endswith(".json")]
        if len(names) != 1:
            raise ValueError(f"{path}: expected one .json member, found {names}")
        with z.open(names[0]) as raw:
            yield from iter_results(io.TextIOWrapper(raw, encoding="utf-8"))


# ------------------------------------------------------------------------------------------------ search semantics
WORD = re.compile(r"\w+")


def tokens(text):
    """Lower-cased word tokens of `text`, approximating the standard (Unicode word-break) tokenizer: runs of word
    characters, joined across one '.', apostrophe or right quote between letters ("C.R." → "c.r"), or across one '.',
    ',', ';' or apostrophe between digits ("1,000" → "1,000")."""
    s = str(text or "").lower()
    out, prev = [], None
    for m in WORD.finditer(s):
        a, b = m.start(), m.end()
        if prev is not None and a == prev[1] + 1:
            sep, left, right = s[prev[1]], s[prev[1] - 1], s[a]
            if (sep in ".'’" and left.isalpha() and right.isalpha()) or (sep in ".,;'’" and left.isdigit() and right.isdigit()):
                prev = (prev[0], b)
                continue
        if prev is not None:
            out.append(s[prev[0]:prev[1]])
        prev = (a, b)
    if prev is not None:
        out.append(s[prev[0]:prev[1]])
    return out


def phrase_in(phrase_tokens, value_tokens):
    n = len(phrase_tokens)
    if not n:
        return False
    return any(value_tokens[i:i + n] == phrase_tokens for i in range(len(value_tokens) - n + 1))


LEX = re.compile(r'\+AND\+|\+OR\+|\(|\)|\+|([A-Za-z_][\w.]*):\(("[^"]*"(?:\+"[^"]*")*)\)|([A-Za-z_][\w.]*):"([^"]*)"')


def parse_search(search):
    """Parse the openFDA search subset the MDL device groups use: field:"phrase", field:("a"+"b"), parentheses, +AND+
    and '+' (OR). A level mixing AND with OR has no unambiguous meaning and raises ValueError."""
    toks, pos = [], 0
    while pos < len(search):
        m = LEX.match(search, pos)
        if not m:
            raise ValueError(f"cannot parse search at {search[pos:pos + 30]!r}")
        t = m.group(0)
        if m.group(1):
            toks.append(("leaf", m.group(1), [p[1:-1] for p in m.group(2).split("+")]))
        elif m.group(3):
            toks.append(("leaf", m.group(3), [m.group(4)]))
        elif t in ("+AND+",):
            toks.append(("op", "AND"))
        elif t in ("+", "+OR+"):
            toks.append(("op", "OR"))
        else:
            toks.append(("paren", t))
        pos = m.end()

    def expr(i):
        items, ops = [], set()
        node, i = term(i)
        items.append(node)
        while i < len(toks) and toks[i][0] == "op":
            ops.add(toks[i][1])
            node, i = term(i + 1)
            items.append(node)
        if len(ops) > 1:
            raise ValueError(f"search mixes AND and OR without parentheses: {search!r}")
        if len(items) == 1:
            return items[0], i
        return (ops.pop(), items), i

    def term(i):
        if i >= len(toks):
            raise ValueError(f"search ends early: {search!r}")
        t = toks[i]
        if t[0] == "leaf":
            if t[1] not in GROUP_FIELDS:
                raise ValueError(f"field {t[1]} is not evaluated offline")
            return ("leaf", t[1], [tokens(p) for p in t[2]]), i + 1
        if t == ("paren", "("):
            node, j = expr(i + 1)
            if j >= len(toks) or toks[j] != ("paren", ")"):
                raise ValueError(f"unbalanced parentheses: {search!r}")
            return node, j + 1
        raise ValueError(f"unexpected token {t} in {search!r}")

    node, i = expr(0)
    if i != len(toks):
        raise ValueError(f"trailing tokens in {search!r}")
    return node


def device_fields(report):
    """{field: [token lists of each value]} for the device fields the group searches use (devices are not nested: a
    report matches field A on one device and field B on another, as the index does)."""
    out = {f: [] for f in GROUP_FIELDS}
    for d in report.get("device") or []:
        for f in GROUP_FIELDS:
            v = d.get(f.split(".", 1)[1])
            for x in (v if isinstance(v, list) else [v]):
                if isinstance(x, str) and x.strip():
                    out[f].append(tokens(x))
    return out


_FIRST = {}


def leaf_words(node):
    """Every phrase's tokens of a parsed search (for the cheap substring prefilter)."""
    if node[0] == "leaf":
        return [t for p in node[2] for t in p]
    return [t for n in node[1] for t in leaf_words(n)]


def _may_match(devices, groups):
    """False only when no group can match: none of the groups' words occurs as a substring of the device fields (a
    phrase match needs its words in the text), so skipping the tokenizer then changes no count."""
    key = id(groups)
    if key not in _FIRST:
        _FIRST.clear()
        _FIRST[key] = sorted({w for node in groups.values() for w in leaf_words(node)})
    text = " ".join(str(d.get(f.split(".", 1)[1]) or "") for d in devices for f in GROUP_FIELDS).lower()
    return any(w in text for w in _FIRST[key])


def matches(node, fields):
    if node[0] == "leaf":
        vals = fields.get(node[1]) or []
        return any(phrase_in(p, v) for p in node[2] for v in vals)
    op, items = node
    return all(matches(n, fields) for n in items) if op == "AND" else any(matches(n, fields) for n in items)


# ------------------------------------------------------------------------------------------------ partition counting
def month_of(day):
    return f"{day[:4]}-{day[4:6]}"


def count_faers(records, targets, bd_grain):
    """Aggregate FAERS reports. targets: {generic_name: index}; bd_grain: {index: 'year' | 'quarter'} for the products
    that get breakdowns. Returns {records, max_date, series: {i: {month: [8]}}, bd: {i: {period: {pt: [n, serious]}}}}."""
    series = defaultdict(lambda: defaultdict(lambda: [0] * len(FAERS_SERIES)))
    bd = defaultdict(lambda: defaultdict(lambda: defaultdict(lambda: [0, 0])))
    totals = defaultdict(int)
    n, max_date = 0, ""
    for r in records:
        n += 1
        day = str(r.get("receivedate") or "")
        valid = bool(DATE_RE.fullmatch(day))
        if valid and day > max_date:
            max_date = day
        patient = r.get("patient") or {}
        hit = set()
        for d in patient.get("drug") or []:
            for g in ((d.get("openfda") or {}).get("generic_name") or []):
                i = targets.get(g)
                if i is not None:
                    hit.add(i)
        if not hit:
            continue
        flags = [1] + [1 if str(r.get(f) or "") == "1" else 0 for f in FAERS_FLAGS]
        pts = None
        for i in hit:
            totals[i] += 1
            if valid:
                row = series[i][month_of(day)]
                for k, v in enumerate(flags):
                    row[k] += v
            grain = bd_grain.get(i)
            if grain is None:
                continue
            if pts is None:
                pts = {x.get("reactionmeddrapt") for x in patient.get("reaction") or []
                       if isinstance(x.get("reactionmeddrapt"), str)}
            periods = ["all"]
            if valid:
                periods.append(day[:4] if grain == "year" else c.quarter_of(month_of(day)))
            for p in periods:
                cell = bd[i][p]
                for pt in pts:
                    v = cell[pt]
                    v[0] += 1
                    v[1] += flags[1]
    return {"records": n, "max_date": max_date, "totals": {str(i): v for i, v in totals.items()},
            "series": {str(i): dict(m) for i, m in series.items()},
            "bd": {str(i): {p: dict(t) for p, t in per.items()} for i, per in bd.items()}}


def count_maude(records, codes, groups):
    """Aggregate MAUDE reports. codes: {product code: index}; groups: {index: parsed search} (indexes after the codes).
    Returns {records, max_date, series: {i: {month: [reports, death, injury, malfunction]}}, bd: {i: {dim: {term: n}}},
    bq: {group i: {quarter: {device problem: n}}}}."""
    series = defaultdict(lambda: defaultdict(lambda: [0, 0, 0, 0]))
    bd = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))
    bq = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))
    n, max_date = 0, ""
    for r in records:
        n += 1
        day = str(r.get("date_received") or "")
        valid = bool(DATE_RE.fullmatch(day))
        if valid and day > max_date:
            max_date = day
        devices = r.get("device") or []
        hit = set()
        for d in devices:
            for t in tokens(d.get("device_report_product_code")):
                i = codes.get(t.upper())
                if i is not None:
                    hit.add(i)
        if groups and _may_match(devices, groups):
            fields = device_fields(r)
            for i, node in groups.items():
                if matches(node, fields):
                    hit.add(i)
        if not hit:
            continue
        et = set(tokens(r.get("event_type")))
        flags = [1, int("death" in et), int("injury" in et), int("malfunction" in et)]
        terms = {
            "device_problem": {x for x in (r.get("product_problems") or []) if isinstance(x, str)},
            "patient_problem": {x for p in (r.get("patient") or []) for x in (p.get("patient_problems") or []) if isinstance(x, str)},
            "manufacturer": {d.get("manufacturer_d_name") for d in devices if isinstance(d.get("manufacturer_d_name"), str)},
            "brand_name": {d.get("brand_name") for d in devices if isinstance(d.get("brand_name"), str)},
        }
        for i in hit:
            if valid:
                row = series[i][month_of(day)]
                for k, v in enumerate(flags):
                    row[k] += v
            for dim, ts in terms.items():
                cell = bd[i][dim]
                for t in ts:
                    cell[t] += 1
            if i in groups and valid:
                cell = bq[i][c.quarter_of(month_of(day))]
                for t in terms["device_problem"]:
                    cell[t] += 1
    return {"records": n, "max_date": max_date, "series": {str(i): dict(m) for i, m in series.items()},
            "bd": {str(i): {k: dict(v) for k, v in per.items()} for i, per in bd.items()},
            "bq": {str(i): {k: dict(v) for k, v in per.items()} for i, per in bq.items()}}


# ------------------------------------------------------------------------------------------------ partitions
def partitions(acq, kind):
    index = json.loads((Path(acq) / "download.json").read_text(encoding="utf-8"))
    cat, ep = kind.split("/")
    return index["results"][cat][ep]["partitions"], index["results"][cat][ep].get("export_date")


def part_name(url):
    """'https://download.open.fda.gov/drug/event/2024q4/drug-event-0002-of-0029.json.zip' → '2024q4-drug-event-0002-of-0029'."""
    p = url.rstrip("/").split("/")
    return f"{p[-2]}-{p[-1].replace('.json.zip', '')}"


def download(url, dest, tries=6):
    """Stream `url` to `dest`; returns (bytes, sha256). Retries network errors; never logs credentials (none used)."""
    for attempt in range(tries):
        try:
            h, size = hashlib.sha256(), 0
            req = urllib.request.Request(url, headers={"User-Agent": c.UA})
            with urllib.request.urlopen(req, timeout=300) as resp, open(dest, "wb") as f:
                for block in iter(lambda: resp.read(1 << 20), b""):
                    f.write(block)
                    h.update(block)
                    size += len(block)
            return size, h.hexdigest()
        except Exception:  # noqa: BLE001 - network hiccups: retry with backoff, then raise
            if attempt == tries - 1:
                raise
            time.sleep(min(120, 5 * 2 ** attempt))


BD_SHARDS = 8


def write_json_gz(path, obj):
    """Write gzip JSON atomically (temporary file, then rename)."""
    path = Path(path)
    tmp = path.with_name(path.name + ".tmp")
    with gzip.open(tmp, "wt", encoding="utf-8", compresslevel=5) as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    tmp.replace(path)


def read_json_gz(path):
    with gzip.open(path, "rt", encoding="utf-8") as f:
        return json.load(f)


_CTX = {}


def _init_worker(ctx):
    _CTX.clear()
    _CTX.update(ctx)
    if ctx["stream"] == "maude":
        _CTX["parsed"] = {int(i): parse_search(s) for i, s in ctx["groups"].items()}


def process_partition(part):
    """Download one partition, count it, write its aggregate (atomic rename), delete the zip. Returns a summary."""
    acq, stream = Path(_CTX["acq"]), _CTX["stream"]
    name = part_name(part["file"])
    out = acq / stream / "parts" / f"{name}.json.gz"
    if out.exists():
        return {"name": name, "skipped": True}
    tmp_dir = acq / stream / "zips"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    zpath = tmp_dir / f"{name}.zip"
    t0 = time.time()
    size, sha = download(part["file"], zpath)
    t1 = time.time()
    if stream == "faers":
        agg = count_faers(iter_zip_results(zpath), _CTX["targets"], {int(k): v for k, v in _CTX["bd_grain"].items()})
    else:
        agg = count_maude(iter_zip_results(zpath), _CTX["codes"], _CTX["parsed"])
    if part.get("records") is not None and agg["records"] != int(part["records"]):
        raise RuntimeError(f"{name}: {agg['records']} records counted, the index lists {part['records']}")
    agg.update({"file": part["file"], "bytes": size, "sha256": sha, "retrieved_at": c.utc_now(),
                "listed_records": part.get("records"), "seconds": [round(t1 - t0, 1), round(time.time() - t1, 1)]})
    if stream == "faers":  # breakdowns go to BD_SHARDS side files, so the reduce holds one shard of products at a time
        bd = agg.pop("bd")
        for k in range(BD_SHARDS):
            write_json_gz(out.parent / f"{name}.bd{k}.json.gz", {i: v for i, v in bd.items() if int(i) % BD_SHARDS == k})
    write_json_gz(out, agg)  # the main file last: its presence marks the partition done
    if not _CTX.get("keep_zips"):
        zpath.unlink()
    return {"name": name, "records": agg["records"], "bytes": size, "seconds": agg["seconds"]}


def run_stream(args, stream):
    acq = Path(args.acq)
    targets = json.loads((acq / "targets.json").read_text(encoding="utf-8"))
    parts, export_date = partitions(acq, "drug/event" if stream == "faers" else "device/event")
    if args.limit:
        parts = parts[: args.limit]
    (acq / stream / "parts").mkdir(parents=True, exist_ok=True)
    if stream == "faers":
        ctx = {"targets": {p["generic_name"]: p["index"] for p in targets["faers"]},
               "bd_grain": {str(p["index"]): p["bd_grain"] for p in targets["faers"] if p.get("bd_grain")}}
    else:
        ctx = {"codes": {s["code"]: s["index"] for s in targets["maude"] if s.get("code")},
               "groups": {str(s["index"]): s["search"] for s in targets["maude"] if not s.get("code")}}
    ctx.update({"acq": str(acq), "stream": stream, "keep_zips": args.keep_zips})
    log = acq / stream / "progress.jsonl"
    done = 0
    with Pool(args.workers, initializer=_init_worker, initargs=(ctx,)) as pool:
        for res in pool.imap_unordered(process_partition, parts):
            done += 1
            with open(log, "a", encoding="utf-8") as f:
                f.write(json.dumps({**res, "at": c.utc_now(), "done": done, "of": len(parts)}) + "\n")
    print(json.dumps({"stream": stream, "partitions": len(parts), "export_date": export_date}))


# ------------------------------------------------------------------------------------------------ reduce helpers
def top_terms(counts, limit):
    """[(term, n, serious|None)] of the `limit` most reported terms (count desc, then term), terms cut to 500 characters
    with the first (largest) count kept when two terms share their first 500 characters; and how many the API returns."""
    items = sorted(counts.items(), key=lambda kv: (-(kv[1][0] if isinstance(kv[1], list) else kv[1]), kv[0]))
    out, seen = [], set()
    for term, v in items[:limit]:
        t = term[:500]
        if t in seen:
            continue
        seen.add(t)
        out.append((t, v[0], v[1]) if isinstance(v, list) else (t, v, None))
    return out, min(limit, len(items))


def last_complete_month(max_date):
    return ob.last_complete_month([{"time": max_date, "count": 1}])


def first_month(months, floor, through, k=0):
    for m in sorted(months):
        if floor <= m <= through and months[m][k] > 0:
            return m
    return None


def series_rows(subject_id, months, names, floor, through, source_id, url_for, method, retrieved_at, only=None):
    """Loader rows for the named series of one subject (all share the window opened by its first report month)."""
    first = first_month(months, floor, through)
    if not first:
        return []
    rows = []
    for name, k, unit in names:
        if only and name not in only:
            continue
        vals = [int(months[m][k]) if m in months else 0 for m in c.month_span(first, through)]
        rows.append({"subject_id": subject_id, "series": name, "unit": unit, "source_id": source_id, "query_url": url_for(name),
                     "method": method, "coverage_from": first, "coverage_to": through, "retrieved_at": retrieved_at, "vals": vals})
    return rows


def breakdown_row(subject_id, dim, period, counts, limit, url, retrieved_at, with_serious):
    terms, returned = top_terms(counts, limit)
    row = {"subject_id": subject_id, "dim": dim, "period": period, "limit_n": limit, "returned": returned, "query_url": url,
           "retrieved_at": retrieved_at, "terms": [t for t, _n, _s in terms], "vals": [int(n) for _t, n, _s in terms]}
    if with_serious and terms:
        row["serious"] = [int(s) for _t, _n, s in terms]
    return row


def periods_for(months, first, through, grain):
    """Complete periods (calendar years or quarters) from `first` to the last complete one before `through` that hold at
    least one report: the periods openfda_build.py plans for a subject."""
    last = through
    if grain == "quarter":
        while int(last[5:7]) % 3 != 0:
            last = c.month_add(last, -1)
    else:
        while last[5:7] != "12":
            last = c.month_add(last, -1)
    out = []
    for m in c.month_span(first, last):
        p = c.quarter_of(m) if grain == "quarter" else m[:4]
        if p not in out and m in months and months[m][0] > 0:
            out.append(p)
    return out


def load_parts(acq, stream):
    """(name, aggregate) of every finished partition (the main files; breakdown side files are read by shard)."""
    for p in sorted((Path(acq) / stream / "parts").glob("*.json.gz")):
        if ".bd" in p.name:
            continue
        yield p.name[: -len(".json.gz")], read_json_gz(p)


def write_chunks(outdir, stream, groups_by_target, source, inputs, notes, chunk_rows=2000):
    """Write loader chunks (common.ChunkWriter), chunks/index.jsonl and manifest.json; returns the outputs."""
    out = Path(outdir)
    if (out / "chunks").exists():
        for p in (out / "chunks").glob("*"):
            p.unlink()
    outputs = []
    for target, rows in groups_by_target.items():
        w = c.ChunkWriter(out / "chunks", f"{target}-{stream.replace('/', '-')}", max_rows=chunk_rows, source=source)
        for r in rows:
            w.add(r)
        res = w.close()
        res["target"] = target
        outputs.append(res)
    with open(out / "chunks" / "index.jsonl", "w", encoding="utf-8") as f:
        for res in outputs:
            for ch in res["chunks"]:
                f.write(json.dumps({**ch, "target": res["target"]}) + "\n")
    c.write_manifest(out, stream, outputs, inputs, notes)
    return outputs


def faers_url(generic, series=None, extra=None, count="receivedate", limit=None):
    search = f'patient.drug.openfda.generic_name.exact:"{generic}"'
    clause = extra if extra is not None else dict((n, e) for n, e, _u in ob.FAERS_SERIES).get(series)
    return c.public_url(c.openfda_query("drug/event.json", search=ob.and_clause(search, clause), count=count, limit=limit))


# ------------------------------------------------------------------------------------------------ reduce: FAERS
def reduce_faers(args):
    acq = Path(args.acq)
    targets = json.loads((acq / "targets.json").read_text(encoding="utf-8"))
    prods = {p["index"]: p for p in targets["faers"]}
    series = defaultdict(lambda: defaultdict(lambda: [0] * len(FAERS_SERIES)))
    totals = defaultdict(int)
    max_date, files, records, retrieved, names_done = "", [], 0, "", []
    for name, agg in load_parts(acq, "faers"):
        names_done.append(name)
        files.append({"file": agg["file"], "bytes": agg["bytes"], "sha256": agg["sha256"], "records": agg["records"]})
        records += agg["records"]
        max_date = max(max_date, agg["max_date"])
        retrieved = max(retrieved, agg["retrieved_at"])
        for i, v in agg.get("totals", {}).items():
            totals[int(i)] += v
        for i, months in agg["series"].items():
            for m, vals in months.items():
                row = series[int(i)][m]
                for k, v in enumerate(vals):
                    row[k] += v
    through = args.through or last_complete_month(max_date)
    bd_rows = []
    for shard in range(BD_SHARDS):
        bd = defaultdict(lambda: defaultdict(lambda: defaultdict(lambda: [0, 0])))
        for name in names_done:
            for i, per in read_json_gz(acq / "faers" / "parts" / f"{name}.bd{shard}.json.gz").items():
                for p, terms in per.items():
                    cell = bd[int(i)][p]
                    for t, (n, s) in terms.items():
                        v = cell[t]
                        v[0] += n
                        v[1] += s
        for i in sorted(j for j, q in prods.items() if q.get("bd_grain") and j % BD_SHARDS == shard):
            p = prods[i]
            months = series.get(i, {})
            first = first_month(months, ob.FAERS_FLOOR, through)
            sid = p["id"]
            per = bd.get(i, {})
            bd_rows.append(breakdown_row(sid, "meddra_pt", "all", per.get("all", {}), args.alltime_limit,
                                         faers_url(p["generic_name"], extra="", count="patient.reaction.reactionmeddrapt.exact",
                                                   limit=args.alltime_limit), retrieved, True))
            if not first:
                continue
            for period in periods_for(months, max(first, ob.FAERS_FLOOR), through, p["bd_grain"]):
                a, b = ob.period_bounds(period)
                bd_rows.append(breakdown_row(sid, "meddra_pt", period, per.get(period, {}), args.reaction_limit,
                                             faers_url(p["generic_name"], extra=f"receivedate:[{a}+TO+{b}]",
                                                       count="patient.reaction.reactionmeddrapt.exact", limit=args.reaction_limit),
                                             retrieved, True))
        del bd
    export = partitions(acq, "drug/event")[1]
    method = (f"Counted from the openFDA bulk export of drug/event (export {export}; {len(files)} files listed at {INDEX_URL}, each "
              f"file's sha256 in the build manifest): reports per receivedate summed by calendar month, from the subject's first "
              f"report month to the last complete month of the data; 0 = no report that month. The query_url is the openFDA count "
              f"request that returns the same numbers.")
    names = [(n, k, u) for (n, k), (_n, _e, u) in zip(FAERS_SERIES, ob.FAERS_SERIES)]
    s_rows, skipped = [], []
    for i, p in sorted(prods.items()):
        need = p.get("series")
        if not need:
            continue
        rows = series_rows(p["id"], series.get(i, {}), names, ob.FAERS_FLOOR, through, "openfda_faers",
                           lambda n, g=p["generic_name"]: faers_url(g, n), method, retrieved, only=set(need))
        if not rows:
            skipped.append(p["id"])
        s_rows += rows
    check = {}
    for i, p in sorted(prods.items()):  # every product's monthly reports (also the ones already loaded: the cross-check)
        months = series.get(i, {})
        first = first_month(months, ob.FAERS_FLOOR, through)
        if first:
            check[p["id"]] = {"from": first, "to": through,
                              "totals": [sum(months[m][k] for m in months if first <= m <= through) for k in range(len(FAERS_SERIES))],
                              "sha": hashlib.sha256(",".join(str(months[m][0]) if m in months else "0"
                                                             for m in c.month_span(first, through)).encode()).hexdigest()}
    (acq / "load").mkdir(parents=True, exist_ok=True)
    (acq / "faers" / "check.json").write_text(json.dumps(check, sort_keys=True), encoding="utf-8")
    # every product's all-time report count, ranked as openfda_build.py ranks (count desc, then name): checked against
    # the stored safety.subjects rank, reports_total and name by sha256 before the NDC subject rows reuse it
    ranked = sorted(((totals.get(i, 0), p["generic_name"]) for i, p in prods.items()), key=lambda t: (-t[0], t[1]))
    universe = [[r, n, g] for r, (n, g) in enumerate(ranked, 1)]
    (acq / "faers" / "universe_bulk.json").write_text(json.dumps(universe, ensure_ascii=False), encoding="utf-8")
    universe_sha = c.sha256_bytes("\n".join(f"{r}|{n}|{g}" for r, n, g in universe).encode("utf-8"))
    outputs = write_chunks(acq / "load" / "faers", "openfda_bulk/faers", {"series": s_rows, "breakdowns": bd_rows}, "openfda_faers",
                           {"index": {"url": INDEX_URL, "sha256": c.sha256_file(acq / "download.json")}, "export_date": export,
                            "files": files, "targets_sha256": c.sha256_file(acq / "targets.json")},
                           {"records": records, "max_receivedate": max_date, "through": through, "no_reports_in_window": skipped,
                            "universe_sha256_rank_count_name": universe_sha})
    print(json.dumps({"through": through, "records": records, "files": len(files), "universe_sha256_rank_count_name": universe_sha,
                      "rows": {o["target"]: o["rows"] for o in outputs}, "no_reports_in_window": len(skipped)}))


# ------------------------------------------------------------------------------------------------ reduce: MAUDE
def maude_url(search, extra=None, count="date_received", limit=None):
    return c.public_url(c.openfda_query("device/event.json", search=ob.and_clause(search, extra), count=count, limit=limit))


def reduce_maude(args):
    acq = Path(args.acq)
    targets = json.loads((acq / "targets.json").read_text(encoding="utf-8"))
    subs = {s["index"]: s for s in targets["maude"]}
    series = defaultdict(lambda: defaultdict(lambda: [0, 0, 0, 0]))
    bd = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))
    bq = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))
    max_date, files, records, retrieved = "", [], 0, ""
    for name, agg in load_parts(acq, "maude"):
        files.append({"file": agg["file"], "bytes": agg["bytes"], "sha256": agg["sha256"], "records": agg["records"]})
        records += agg["records"]
        max_date = max(max_date, agg["max_date"])
        retrieved = max(retrieved, agg["retrieved_at"])
        for i, months in agg["series"].items():
            for m, vals in months.items():
                row = series[int(i)][m]
                for k, v in enumerate(vals):
                    row[k] += v
        for i, per in agg["bd"].items():
            for dim, terms in per.items():
                cell = bd[int(i)][dim]
                for t, n in terms.items():
                    cell[t] += n
        for i, per in agg["bq"].items():
            for q, terms in per.items():
                cell = bq[int(i)][q]
                for t, n in terms.items():
                    cell[t] += n
    through = args.through or last_complete_month(max_date)
    export = partitions(acq, "device/event")[1]
    method = (f"Counted from the openFDA bulk export of device/event (export {export}; {len(files)} files listed at {INDEX_URL}, each "
              f"file's sha256 in the build manifest): reports per date_received summed by calendar month, from the subject's first "
              f"report month to the last complete month of the data; 0 = no report that month. The query_url is the openFDA count "
              f"request that returns the same numbers.")
    names = [(n, k, u) for k, (n, _e, u) in enumerate(ob.MAUDE_SERIES)]
    extra = dict((n, e) for n, e, _u in ob.MAUDE_SERIES)
    accepted = set(json.loads((acq / "maude" / "groups_accepted.json").read_text())) if (acq / "maude" / "groups_accepted.json").exists() else set()
    s_rows, b_rows, check, skipped = [], [], {}, []
    for i, s in sorted(subs.items()):
        months = series.get(i, {})
        first = first_month(months, ob.MAUDE_FLOOR, through)
        if first:
            check[s["id"]] = {"from": first, "to": through,
                              "months": {m: months[m] for m in c.month_span(first, through) if m in months}}
        is_group = not s.get("code")
        if is_group and s["id"] not in accepted:
            continue  # group series come from the count API; its breakdowns only when the offline search reproduced them
        if not is_group:
            rows = series_rows(s["id"], months, names, ob.MAUDE_FLOOR, through, "openfda_maude",
                               lambda n, q=s["search"]: maude_url(q, extra[n]), method, retrieved)
            if not rows:
                skipped.append(s["id"])
            s_rows += rows
        for dim, field, limit in MAUDE_DIMS:
            b_rows.append(breakdown_row(s["id"], dim, "all", bd[i].get(dim, {}), limit,
                                        maude_url(s["search"], count=field, limit=limit), retrieved, False))
        if is_group and first:
            for q in periods_for(months, max(first, "2004-01"), through, "quarter"):
                a, b = ob.period_bounds(q)
                b_rows.append(breakdown_row(s["id"], "device_problem", q, bq[i].get(q, {}), args.reaction_limit,
                                            maude_url(s["search"], f"date_received:[{a}+TO+{b}]", "product_problems.exact",
                                                      args.reaction_limit), retrieved, False))
    (acq / "maude" / "check.json").write_text(json.dumps(check, sort_keys=True), encoding="utf-8")
    outputs = write_chunks(acq / "load" / "maude", "openfda_bulk/maude", {"series": s_rows, "breakdowns": b_rows}, "openfda_maude",
                           {"index": {"url": INDEX_URL, "sha256": c.sha256_file(acq / "download.json")}, "export_date": export,
                            "files": files, "targets_sha256": c.sha256_file(acq / "targets.json")},
                           {"records": records, "max_date_received": max_date, "through": through, "groups_from_bulk": sorted(accepted),
                            "no_reports_in_window": skipped})
    print(json.dumps({"through": through, "records": records, "files": len(files),
                      "rows": {o["target"]: o["rows"] for o in outputs}, "groups_from_bulk": len(accepted)}))


# ------------------------------------------------------------------------------------------------ NDC keys
def ndc_keys(records):
    """{GENERIC NAME (upper case, trimmed): {pharm_class_epc: set, application_numbers: set, products: n}} from the NDC
    directory. pharm_class_epc holds the FDA Established Pharmacologic Class terms ("... [EPC]") the directory lists for
    the product, in openfda.pharm_class_epc (the field FAERS searches use) or in its own pharm_class list; application
    numbers are published as the directory prints them (NDA/ANDA/BLA numbers, OTC monograph ids)."""
    out = {}
    for r in records:
        g = r.get("generic_name")
        if not isinstance(g, str) or not g.strip():
            continue
        e = out.setdefault(g.strip().upper(), {"pharm_class_epc": set(), "application_numbers": set(), "products": 0})
        e["products"] += 1
        for x in ((r.get("openfda") or {}).get("pharm_class_epc") or []):
            if isinstance(x, str) and x.strip():
                e["pharm_class_epc"].add(x.strip())
        for x in r.get("pharm_class") or []:  # the directory's own class list: its "[EPC]" entries are the same vocabulary
            if isinstance(x, str) and x.strip().endswith("[EPC]"):
                e["pharm_class_epc"].add(x.strip())
        a = r.get("application_number")
        if isinstance(a, str) and a.strip():
            e["application_numbers"].add(a.strip())
    return out


def subject_key_rows(products, keys, export_date, as_of):
    """Full safety.subjects rows (the loader replaces a row) for the FAERS products whose name the NDC directory lists:
    the stored fields unchanged, keys extended with pharm_class_epc, application_numbers and ndc_directory."""
    rows = []
    for p in products:
        e = keys.get(p["generic_name"].strip().upper())
        if not e or not (e["pharm_class_epc"] or e["application_numbers"]):
            continue
        k = {"generic_name": p["generic_name"]}
        if e["pharm_class_epc"]:
            k["pharm_class_epc"] = sorted(e["pharm_class_epc"])
        if e["application_numbers"]:
            k["application_numbers"] = sorted(e["application_numbers"])
        k["ndc_directory"] = {"products": e["products"], "export_date": export_date,
                              "match": "NDC directory generic_name equals the openFDA generic name (case-insensitive, exact)",
                              "source_url": "https://download.open.fda.gov/drug/ndc/drug-ndc-0001-of-0001.json.zip"}
        rows.append({"id": p["id"], "subject_type": "product", "kind": "drug", "label": ob.display_label(p["generic_name"]),
                     "keys": k, "search": {"faers": f'patient.drug.openfda.generic_name.exact:"{p["generic_name"]}"'},
                     "rank": p["rank"], "reports_total": p["reports_total"], "as_of": as_of,
                     "source_id": "openfda_faers", "source_url": ob.DOCS["openfda_faers"]})
    return rows


def build_ndc(args):
    acq = Path(args.acq)
    targets = json.loads((acq / "targets.json").read_text(encoding="utf-8"))
    parts, export = partitions(acq, "drug/ndc")
    (acq / "ndc").mkdir(parents=True, exist_ok=True)
    zpath = acq / "ndc" / "drug-ndc-0001-of-0001.json.zip"
    if not zpath.exists():
        download(parts[0]["file"], zpath)
    keys = ndc_keys(iter_zip_results(zpath))
    products = targets["faers"]
    if any(p.get("reports_total") is None for p in products):
        # the stored reports_total must be kept: take it from a [[rank, total, name]] file that matched safety.subjects
        if not args.faers_universe:
            raise SystemExit("--faers-universe [[rank, reports_total, name], ...] is required (checked against safety.subjects)")
        uni = json.loads(Path(args.faers_universe).read_text(encoding="utf-8"))
        by_rank = {r: (n, g) for r, n, g in uni}
        products = [{**p, "reports_total": by_rank[p["rank"]][0]} for p in products if by_rank.get(p["rank"], (0, None))[1] == p["generic_name"]]
        if len(products) != len(targets["faers"]):
            raise SystemExit("the universe file does not list the targets' names at their ranks")
    rows = subject_key_rows(products, keys, export, args.as_of)
    outputs = write_chunks(acq / "load" / "subjects_keys", "openfda_bulk/ndc", {"subjects": rows}, "openfda_faers",
                           {"ndc": {"url": parts[0]["file"], "sha256": c.sha256_file(zpath), "records": parts[0].get("records")},
                            "export_date": export, "targets_sha256": c.sha256_file(acq / "targets.json")},
                           {"products": len(targets["faers"]), "with_keys": len(rows),
                            "with_epc": sum(1 for r in rows if "pharm_class_epc" in r["keys"]),
                            "with_application_numbers": sum(1 for r in rows if "application_numbers" in r["keys"]),
                            "generic_names_in_directory": len(keys)})
    print(json.dumps({"products": len(targets["faers"]), "rows": {o["target"]: o["rows"] for o in outputs}}))


# ------------------------------------------------------------------------------------------------ targets
def faers_ids(universe):
    """Subject ids exactly as openfda_build.build_subjects assigns them (rank order, hash suffix on a repeated slug)."""
    used, out = set(), []
    for rank, total, name in universe:
        out.append(ob.product_id("faers", name, used))
    return out


def build_targets(args):
    acq = Path(args.acq)
    universe = json.loads(Path(args.faers_universe).read_text(encoding="utf-8"))
    if universe and isinstance(universe[0], str):  # names in rank order (reports_total comes later from the bulk count)
        universe = [[r, None, name] for r, name in enumerate(universe, 1)]
    existing = json.loads(Path(args.existing).read_text(encoding="utf-8"))
    lo, hi = existing["series_complete_ranks"]
    blo, bhi = existing["breakdown_ranks"]
    partial = existing.get("partial_series", {})
    all_series = [n for n, _e, _u in ob.FAERS_SERIES]
    faers = []
    for idx, ((rank, total, name), sid) in enumerate(zip(universe, faers_ids(universe))):
        p = {"index": idx, "id": sid, "rank": rank, "reports_total": total, "generic_name": name}
        if sid in partial:
            p["series"] = [s for s in all_series if s not in partial[sid]]
        elif not lo <= rank <= hi:
            p["series"] = all_series
        if not blo <= rank <= bhi:
            p["bd_grain"] = "quarter" if rank <= args.quarter_top else "year"
        faers.append(p)
    codes = Path(args.maude_codes).read_text(encoding="utf-8").split()
    maude = [{"index": i, "id": f"maude:{code}", "code": code, "search": f'device.device_report_product_code:"{code}"'}
             for i, code in enumerate(codes)]
    for e in mdl_map.MDLS:
        if e["kind"] == mdl_map.DEVICE and e.get("maude"):
            parse_search(e["maude"])  # fails early on a search the offline evaluator cannot read
            maude.append({"index": len(maude), "id": f"mdl:{e['mdl']}", "search": e["maude"]})
    out = {"built_at": c.utc_now(), "faers": faers, "maude": maude,
           "inputs": {"faers_universe_sha256": c.sha256_file(args.faers_universe), "maude_codes_sha256": c.sha256_file(args.maude_codes),
                      "existing": existing}}
    (acq / "targets.json").write_text(json.dumps(out, indent=0, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({"faers": len(faers), "faers_series": sum(1 for p in faers if p.get("series")),
                      "faers_breakdowns": sum(1 for p in faers if p.get("bd_grain")), "maude_codes": len(codes),
                      "maude_groups": len(maude) - len(codes)}))


def api_run(args, stream):
    """An openfda_build.Run (request log, field guard) for the few count-API calls this workstream makes."""
    ns = argparse.Namespace(outdir=str(Path(args.acq) / "api"), interval=args.interval, keyless=True,
                            max_requests=args.max_requests, chunk_rows=2000)
    return ob.Run(ns, stream)


def build_universe(args):
    """The ranked FAERS products exactly as openfda_build.py subjects ranks them (count API, prefix partitions), for the
    check against the stored safety.subjects (sha256 of the rank|count|name lines)."""
    run = api_run(args, "universe")
    ranked, info = ob.faers_universe(run, args.faers_products)
    rows = [[rank, cnt, term] for rank, (term, cnt) in enumerate(ranked, 1)]
    out = Path(args.acq) / "faers_universe.json"
    out.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
    run.close()
    lines = "\n".join(f"{r}|{n}|{t}" for r, n, t in rows)
    print(json.dumps({"products": len(rows), "requests": run.http.requests, "info": info,
                      "sha256_rank_count_name": c.sha256_bytes(lines.encode("utf-8")),
                      "sha256_rank_name": c.sha256_bytes("\n".join(f"{r}|{t}" for r, _n, t in rows).encode("utf-8"))}))


def build_api_plan(args):
    """<acq>/api/subjects/plan.json for openfda_build.py maude --skip-breakdowns: the MDL device groups (their stored
    searches, from mdl_map.py) and national:maude, whose series come from the count API itself."""
    subjects = [{"id": "national:maude", "subject_type": "national", "kind": "all", "search": {"maude": "_exists_:date_received"}}]
    for e in mdl_map.MDLS:
        if e["kind"] == mdl_map.DEVICE and e.get("maude"):
            subjects.append({"id": f"mdl:{e['mdl']}", "subject_type": "mdl_group", "kind": "device", "search": {"maude": e["maude"]}})
    out = Path(args.acq) / "api" / "subjects"
    out.mkdir(parents=True, exist_ok=True)
    (out / "plan.json").write_text(json.dumps({"subjects": subjects, "links": []}, indent=0), encoding="utf-8")
    lines = "\n".join(f"{s['id']}|{s['search']['maude']}" for s in sorted(subjects, key=lambda s: s["id"]))
    print(json.dumps({"subjects": len(subjects), "sha256_id_search": c.sha256_bytes(lines.encode("utf-8"))}))


def api_series(acq):
    """{subject_id: {series: row}} of the count-API series chunks under <acq>/api/maude."""
    out = defaultdict(dict)
    index = Path(acq) / "api" / "maude" / "chunks" / "index.jsonl"
    for line in index.read_text().splitlines() if index.exists() else []:
        ch = json.loads(line)
        if ch["target"] != "series":
            continue
        rows, _sha = c.read_chunk(index.parent / ch["file"])
        for r in rows:
            out[r["subject_id"]][r["series"]] = r
    return out


def compare_window(api_row, bulk_months, k):
    """Months of the API row's window where the bulk count differs (bulk months beyond the bulk data are not compared)."""
    diffs = []
    for m, v in zip(c.month_span(api_row["coverage_from"], api_row["coverage_to"]), api_row["vals"]):
        b = bulk_months.get(m)
        b = b[k] if b else 0
        if b != v:
            diffs.append((m, v, b))
    return diffs


def accept_groups(args):
    """Accept the bulk breakdowns of an MDL device group only when the offline search reproduced the API's four monthly
    series exactly over the common window. Writes <acq>/maude/groups_accepted.json and a per-group report."""
    acq = Path(args.acq)
    api = api_series(acq)
    check = json.loads((acq / "maude" / "check.json").read_text())
    report, accepted = {}, []
    for sid in sorted(k for k in api if k.startswith("mdl:")):
        bulk = (check.get(sid) or {}).get("months", {})
        through = (check.get(sid) or {}).get("to")
        res = {}
        for k, (name, _e, _u) in enumerate(ob.MAUDE_SERIES):
            row = api[sid].get(name)
            if not row:
                res[name] = "no API series"
                continue
            if through and row["coverage_to"] > through:
                cut = c.month_span(row["coverage_from"], through)
                row = {**row, "coverage_to": through, "vals": row["vals"][:len(cut)]}
            d = compare_window(row, bulk, k)
            res[name] = {"months": len(row["vals"]), "api_total": sum(row["vals"]), "differing_months": len(d), "first_diffs": d[:5]}
        ok = all(isinstance(v, dict) and v["differing_months"] == 0 and v["months"] > 0 for v in res.values())
        report[sid] = {"accepted": ok, "series": res}
        if ok:
            accepted.append(sid)
    (acq / "maude" / "groups_accepted.json").write_text(json.dumps(accepted), encoding="utf-8")
    (acq / "maude" / "groups_report.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    print(json.dumps({"groups": len(report), "accepted": len(accepted), "rejected": [k for k, v in report.items() if not v["accepted"]]}))


def load_rows(acq, stream, target):
    index = Path(acq) / "load" / stream / "chunks" / "index.jsonl"
    rows = []
    for line in index.read_text().splitlines():
        ch = json.loads(line)
        if ch["target"] == target:
            rows += c.read_chunk(index.parent / ch["file"])[0]
    return rows


def sample(rows, n, key):
    """A deterministic spread sample: rows ordered by the sha256 of their key, first n."""
    return sorted(rows, key=lambda r: hashlib.sha256(key(r).encode("utf-8")).hexdigest())[:n]


def validate(args):
    """Re-ask the count API for a sample of the built rows and compare. Series: every month of the row's window.
    Breakdowns: the API's top min(limit, 100) terms (keyless requests are capped at 100 terms) against the row."""
    acq, stream = Path(args.acq), args.validate_stream
    run = api_run(args, f"validate-{stream}")
    report = {"series": [], "breakdowns": []}
    s_rows = load_rows(acq, stream, "series")
    b_rows = load_rows(acq, stream, "breakdowns")
    for r in sample(s_rows, args.n_series, lambda r: r["subject_id"] + r["series"]):
        if not run.budget_left():
            break
        data, _ = run.get(r["query_url"])
        months = c.day_counts_to_months((data or {}).get("results", []))
        diffs = [(m, v, months.get(m, 0)) for m, v in zip(c.month_span(r["coverage_from"], r["coverage_to"]), r["vals"])
                 if months.get(m, 0) != v]
        report["series"].append({"subject_id": r["subject_id"], "series": r["series"], "months": len(r["vals"]),
                                 "total": sum(r["vals"]), "differing_months": len(diffs), "diffs": diffs[:6]})
    for r in sample(b_rows, args.n_breakdowns, lambda r: r["subject_id"] + r["dim"] + r["period"]):
        if not run.budget_left():
            break
        k = min(r["limit_n"], 100)
        data, _ = run.get(re.sub(r"limit=\d+", f"limit={k}", r["query_url"]))
        api = [(str(x["term"])[:500], int(x["count"])) for x in (data or {}).get("results", [])]
        ours = dict(zip(r["terms"], r["vals"]))
        diffs = [(t, n, ours.get(t)) for t, n in api if ours.get(t) != n]
        report["breakdowns"].append({"subject_id": r["subject_id"], "dim": r["dim"], "period": r["period"], "compared": len(api),
                                     "differing_terms": len(diffs), "diffs": diffs[:6]})
    run.close()
    report["requests"] = run.http.requests
    out = acq / stream / "validation.json"
    out.write_text(json.dumps(report, indent=1, ensure_ascii=False), encoding="utf-8")
    summary = {k: {"checked": len(v), "exact": sum(1 for x in v if not x.get("differing_months", x.get("differing_terms")))}
               for k, v in report.items() if isinstance(v, list)}
    print(json.dumps({"requests": run.http.requests, **summary}))


def build_index(args):
    acq = Path(args.acq)
    acq.mkdir(parents=True, exist_ok=True)
    http = c.Http(min_interval=1.0, log_path=acq / "api_requests.jsonl")
    status, body = http.request(INDEX_URL)
    (acq / "download.json").write_bytes(body)
    print(json.dumps({"status": status, "bytes": len(body), "sha256": c.sha256_bytes(body)}))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("stream", choices=["index", "universe", "api-plan", "targets", "faers", "maude", "reduce-faers",
                                       "accept-groups", "reduce-maude", "ndc", "validate"])
    ap.add_argument("--validate-stream", choices=["faers", "maude"], default="faers")
    ap.add_argument("--n-series", type=int, default=20)
    ap.add_argument("--n-breakdowns", type=int, default=10)
    ap.add_argument("--acq", required=True)
    ap.add_argument("--faers-products", type=int, default=2000)
    ap.add_argument("--interval", type=float, default=0.5)
    ap.add_argument("--max-requests", type=int, default=None)
    ap.add_argument("--faers-universe")
    ap.add_argument("--maude-codes")
    ap.add_argument("--existing")
    ap.add_argument("--quarter-top", type=int, default=300)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--keep-zips", action="store_true")
    ap.add_argument("--through", default=None, help="YYYY-MM: cap the series at this month (default: the export's last complete month)")
    ap.add_argument("--reaction-limit", type=int, default=25)
    ap.add_argument("--alltime-limit", type=int, default=1000)
    ap.add_argument("--as-of", default=date.today().isoformat(), help="the stored subjects' as_of date (kept unchanged)")
    args = ap.parse_args()
    {"index": build_index, "universe": build_universe, "api-plan": build_api_plan, "accept-groups": accept_groups,
     "targets": build_targets, "validate": validate, "faers": lambda a: run_stream(a, "faers"), "maude": lambda a: run_stream(a, "maude"),
     "reduce-faers": reduce_faers, "reduce-maude": reduce_maude, "ndc": build_ndc}[args.stream](args)


if __name__ == "__main__":
    main()
