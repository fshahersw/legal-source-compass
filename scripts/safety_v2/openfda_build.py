"""openFDA builders for safety/1: FAERS (drug/event), MAUDE (device/event), CAERS (food/event) and enforcement/recall
series, as count aggregations (no bulk downloads), plus record-level MAUDE reports for the devices MDL titles name.

  python3 -I scripts/safety_v2/openfda_build.py <stream> [options]
    streams: subjects   national totals + MDL groups (mdl_map.py, checked against the title snapshot) + ranked products
             faers      FAERS series (reports, serious, deaths, the six seriousness criteria), all-time and quarterly
                        MedDRA preferred terms with serious counts, for every planned subject
             maude      MAUDE series (reports; death, injury, malfunction), device and patient problems, makers, brands
             other      CAERS series (food/cosmetic MDL groups); FDA enforcement reports and device recalls per MDL group
             records    record-level MAUDE reports of the device MDL groups (date windows of at most 25,000 reports)
    --outdir DIR          default private/build/w1025_safety/openfda
    --faers-products N    ranked FAERS generic names to include (default 2000; 0 = MDL groups and national only)
    --maude-codes N       ranked MAUDE product codes (default: all codes with >= --maude-min reports)
    --maude-min N         default 50
    --mdls 2740,3014      restrict MDL groups (validation samples)
    --quarters all|N      period breakdowns: every period with reports (all) or the latest N periods (default all)
    --quarter-subjects mdl|all   who gets period breakdowns (default all)
    --quarter-top N       FAERS products ranked <= N (and every MDL group) get quarterly MedDRA breakdowns; the other
                          products get calendar-year breakdowns (default 300)
    --reaction-limit N    terms per period breakdown (default 25); --alltime-limit N for the all-time one (default 1000)
    --workers N           concurrent request threads (default 4); --interval S minimum spacing of requests (0.27 s:
                          openFDA allows 240 requests/minute per key)
    --max-requests N      stop after N requests (resumable: rerun to continue; finished tasks are in done.txt)
    --record-limit N      at most N records per MDL device group (validation samples)

Output: gzip NDJSON loader chunks per target (common.ChunkWriter) under <outdir>/<stream>/, done.txt (finished task
keys, so a rerun continues), state.json (per-subject coverage), requests.jsonl (every request: public URL, status,
bytes, sha256, time). Requires DATA_GOV_API_KEY (api.data.gov key, accepted by openFDA as api_key; never recorded).
"""
import argparse
import hashlib
import json
import re
import sys
import threading
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common as c  # noqa: E402
import mdl_map  # noqa: E402

FAERS_FLOOR = "2004-01"  # openFDA FAERS coverage starts 2004-Q1; earlier receive dates are legacy stragglers
MAUDE_FLOOR = "1991-01"
DOCS = {"openfda_faers": "https://open.fda.gov/apis/drug/event/", "openfda_maude": "https://open.fda.gov/apis/device/event/",
        "openfda_caers": "https://open.fda.gov/apis/food/event/", "openfda_enforcement": "https://open.fda.gov/apis/drug/enforcement/",
        "openfda_device_recall": "https://open.fda.gov/apis/device/recall/"}
FAERS_SERIES = [
    ("faers_reports", None, "reports"),
    ("faers_serious", "serious:1", "serious reports"),
    ("faers_death", "seriousnessdeath:1", "reports with death as an outcome"),
    ("faers_hospitalization", "seriousnesshospitalization:1", "reports with hospitalization"),
    ("faers_life_threatening", "seriousnesslifethreatening:1", "reports with a life-threatening outcome"),
    ("faers_disabling", "seriousnessdisabling:1", "reports with disability"),
    ("faers_congenital_anomaly", "seriousnesscongenitalanomali:1", "reports with a congenital anomaly"),
    ("faers_other_serious", "seriousnessother:1", "reports with another medically important condition"),
]
MAUDE_SERIES = [
    ("maude_reports", None, "reports"),
    ("maude_death", 'event_type:"Death"', "reports with event type Death"),
    ("maude_injury", 'event_type:"Injury"', "reports with event type Injury"),
    ("maude_malfunction", 'event_type:"Malfunction"', "reports with event type Malfunction"),
]
TEXT_LIMIT = 40000


def last_complete_month(results):
    days = [r["time"] for r in results if re.fullmatch(r"(19|20)\d{6}", str(r.get("time", "")))]
    last = max(days)
    d = date(int(last[:4]), int(last[4:6]), int(last[6:8]))
    if (d + timedelta(days=1)).month != d.month:
        return f"{d.year:04d}-{d.month:02d}"
    return c.month_add(f"{d.year:04d}-{d.month:02d}", -1)


class FieldMissing(Exception):
    """A search names a field the endpoint does not have. openFDA answers that with the same 404 "No matches found" as a
    true zero, so the result is unusable: nothing is written (a series of zeros would be false)."""


SEARCH_FIELD = re.compile(r"([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*):")


def search_fields(search):
    """The field names an openFDA search uses (quoted values ignored; _exists_/_missing_ are operators)."""
    s = re.sub(r'"[^"]*"', '""', search or "")
    return sorted({m.group(1) for m in SEARCH_FIELD.finditer(s)} - {"_exists_", "_missing_"})


def split_query(url):
    """(endpoint, search) of an openFDA query URL built by common.openfda_query (search None when absent)."""
    m = re.match(re.escape(c.OPENFDA) + r"([a-z]+/[a-z]+\.json)\?(.*)$", url)
    if not m:
        return None, None
    sm = re.search(r"(?:^|&)search=([^&]*)", m.group(2))
    return m.group(1), (urllib.parse.unquote(sm.group(1)) if sm else None)


class Run:
    def __init__(self, args, stream):
        self.args = args
        self.out = Path(args.outdir) / stream
        self.out.mkdir(parents=True, exist_ok=True)
        self.http = c.Http(min_interval=args.interval, log_path=self.out / "requests.jsonl")
        self.key = c.openfda_key()
        if not self.key:
            raise SystemExit("DATA_GOV_API_KEY must be set (load it from private/scratch/secrets.env inside the command)")
        self.done = set()
        done_path = self.out / "done.txt"
        if done_path.exists():
            self.done = set(done_path.read_text().split())
        self.state_path = self.out / "state.json"
        self.state = json.loads(self.state_path.read_text()) if self.state_path.exists() else {}
        self.tag = hashlib.sha1(c.utc_now().encode()).hexdigest()[:6]
        self.writers = {}
        self.lock = threading.RLock()

    def writer(self, target, opts=None, source=None):
        k = (target, json.dumps(opts or {}, sort_keys=True))
        with self.lock:
            return self._writer(k, target, opts, source)

    def _writer(self, k, target, opts, source):
        if k not in self.writers:
            w = c.ChunkWriter(self.out / "chunks", f"{target}-{self.tag}-{len(self.writers):02d}", max_rows=self.args.chunk_rows,
                              opts=opts, source=source)
            w.load_target = target
            self.writers[k] = w
        return self.writers[k]

    def budget_left(self):
        return self.args.max_requests is None or self.http.requests < self.args.max_requests

    def get(self, url):
        """GET; a "No matches" answer is accepted as zero only when every searched field exists on the endpoint (one
        cached _exists_ probe per endpoint and field), else FieldMissing."""
        data, pub = c.openfda_get(self.http, url, self.key)
        if data is None:
            endpoint, search = split_query(url)
            missing = [f for f in search_fields(search) if not self.field_exists(endpoint, f)] if search else []
            if missing:
                raise FieldMissing(f"{endpoint} has no field {', '.join(missing)}")
        return data, pub

    def field_exists(self, endpoint, field):
        k = f"{endpoint}|{field}"
        with self.lock:
            known = self.state.setdefault("_fields", {})
            if k in known:
                return known[k]
        probe, _ = c.openfda_get(self.http, c.openfda_query(endpoint, search=f"_exists_:{field}", limit=1), self.key)
        with self.lock:
            known[k] = probe is not None
            return known[k]

    def unsupported(self, key, reason):
        """Record a task whose query cannot be answered (FieldMissing) and mark it done: nothing is written for it."""
        with self.lock:
            self.state.setdefault("_unsupported", {})[key] = reason
            self.done.add(key)

    def mark(self, key):
        with self.lock:
            self.done.add(key)

    def subject_state(self, sid):
        with self.lock:
            return self.state.setdefault(sid, {})

    def close(self):
        outputs = []
        for w in self.writers.values():
            res = w.close()
            res["target"] = w.load_target
            outputs.append(res)
        with open(self.out / "done.txt", "w") as f:
            f.write("\n".join(sorted(self.done)) + "\n")
        self.state_path.write_text(json.dumps(self.state, indent=1, sort_keys=True))
        index = self.out / "chunks" / "index.jsonl"
        index.parent.mkdir(parents=True, exist_ok=True)
        with open(index, "a") as f:
            for res in outputs:
                for ch in res["chunks"]:
                    f.write(json.dumps({**ch, "target": res["target"]}) + "\n")
        return outputs


# ------------------------------------------------------------------------------------------------ subjects
def load_titles(outdir):
    path = Path(outdir).parent / "mdl" / "titles.json"
    if not path.exists():
        raise SystemExit(f"{path} missing: run scripts/safety_v2/fetch_titles.py first")
    return json.loads(path.read_text()), c.sha256_file(path)


def mdl_groups(titles, only=None):
    """Validated MDL group subjects and their links. Raises if a token is not in the official title."""
    subjects, links = [], []
    for e in mdl_map.MDLS:
        if only and e["mdl"] not in only:
            continue
        t = titles.get(str(e["mdl"]))
        if not t:
            raise SystemExit(f"MDL {e['mdl']}: no official title in the snapshot")
        missing = mdl_map.check_tokens(e, t["title"])
        if missing:
            raise SystemExit(f"MDL {e['mdl']}: tokens {missing} not in title {t['title']!r}")
        search = {}
        if e["kind"] == mdl_map.DRUG:
            search["faers"] = mdl_map.faers_search(e)
            search["enforcement"] = {"endpoint": "drug/enforcement.json", "search": mdl_map.enforcement_search(e)}
        elif e["kind"] == mdl_map.DEVICE:
            search["maude"] = e["maude"]
            if e.get("recall"):
                search["enforcement"] = {"endpoint": "device/enforcement.json", "search": e["recall"]}
                search["device_recall"] = {"endpoint": "device/recall.json", "search": e["recall"]}
        elif e["kind"] in ("food", "cosmetic"):
            search["caers"] = e["caers"]
            if e.get("recall"):
                search["enforcement"] = {"endpoint": "food/enforcement.json", "search": e["recall"]}
        elif e["kind"] == "vehicle":
            search["nhtsa"] = e["nhtsa"]
        source_id = {"drug": "openfda_faers", "device": "openfda_maude", "food": "openfda_caers", "cosmetic": "openfda_caers",
                     "vehicle": "nhtsa_complaints"}[e["kind"]]
        sid = f"mdl:{e['mdl']}"
        subjects.append({"id": sid, "subject_type": "mdl_group", "kind": e["kind"], "label": e["label"],
                         "keys": {"mdl": e["mdl"], "title": t["title"], "tokens": e["tokens"]}, "search": search,
                         "source_id": source_id,
                         "source_url": DOCS.get(source_id, "https://www.nhtsa.gov/nhtsa-datasets-and-apis")})
        links.append({"mdl": e["mdl"], "subject_id": sid, "relation": "mdl_group", "title": t["title"], "title_tokens": e["tokens"],
                      "title_source_dataset": t["dataset"], "title_source_url": t["source_url"], "basis": e["basis"],
                      "basis_note": mdl_map.basis_note(e)})
    return subjects, links


def named_product_links(products, titles, only=None):
    """Per-product FAERS pages linked to an MDL whose title prints the product's generic name (exact, case-insensitive,
    or the title's name followed by a salt/form word: 'Alendronate Sodium' links ALENDRONATE SODIUM only)."""
    by_generic = {}
    for p in products:
        by_generic.setdefault(p["keys"]["generic_name"].lower(), []).append(p)
    links = []
    for e in mdl_map.MDLS:
        if only and e["mdl"] not in only:
            continue
        t = titles.get(str(e["mdl"]))
        for g in e.get("generics", []):
            gl = g.lower()
            hits = by_generic.get(gl, [])
            for p in hits:
                links.append({"mdl": e["mdl"], "subject_id": p["id"], "relation": "named_product", "title": t["title"],
                              "title_tokens": [g], "title_source_dataset": t["dataset"], "title_source_url": t["source_url"],
                              "basis": "title_names_product",
                              "basis_note": f"The JPML title names '{g}', the openFDA harmonised generic name of this product."})
    return links


def faers_universe(run, n, max_depth=3):
    """Top-n openFDA generic names by report count. One count request returns at most 1,000 terms, and a wildcard
    partition (names starting with a prefix) also counts the other drugs listed in the same reports, so a partition is
    complete for every name at or above the cutoff only when it returned fewer than 1,000 terms or its 1,000th count is
    below the cutoff; otherwise it is split by one more character (up to max_depth characters)."""
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    counts, part = {}, {}

    def fetch(prefix):
        pattern = prefix.replace(" ", "?")
        url = c.openfda_query("drug/event.json", search=f"patient.drug.openfda.generic_name.exact:{pattern}*",
                              count="patient.drug.openfda.generic_name.exact", limit=1000)
        data, _ = run.get(url)
        res = (data or {}).get("results", [])
        for r in res:
            if str(r["term"]).upper().startswith(prefix):
                counts[r["term"]] = r["count"]
        part[prefix] = (len(res) >= 1000, min((r["count"] for r in res), default=0))

    for ch in alphabet:
        fetch(ch)
    refined = []
    while True:
        ranked = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
        cutoff = ranked[n - 1][1] if len(ranked) >= n else 1
        todo = [p for p, (hit, low) in part.items() if hit and low >= cutoff and len(p) < max_depth and p not in refined]
        if not todo:
            break
        for p in todo:
            refined.append(p)
            for ch in alphabet + " -":
                fetch(p + ch)
    unresolved = [p for p, (hit, low) in part.items() if hit and low >= cutoff and p not in refined]
    return ranked[:n], {"partitions": len(part), "refined": refined, "cutoff": cutoff, "terms_seen": len(counts),
                        "unresolved_partitions": unresolved}


def product_id(prefix, name, used):
    base = f"{prefix}:{c.slug(name, 90)}"
    pid = base if base not in used else f"{base[:90]}-{hashlib.sha1(name.encode()).hexdigest()[:6]}"
    used.add(pid)
    return pid


def maude_universe(run, n, minimum):
    counts, full = {}, {}
    for ch in "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789":
        url = c.openfda_query("device/event.json", search=f"device.device_report_product_code.exact:{ch}*",
                              count="device.device_report_product_code.exact", limit=1000)
        data, _ = run.get(url)
        res = [r for r in (data or {}).get("results", []) if re.fullmatch(rf"{ch}[A-Z0-9]{{2}}", str(r["term"]))]
        for r in res:
            counts[r["term"]] = r["count"]
        full[ch] = len((data or {}).get("results", [])) >= 1000
    ranked = sorted(((k, v) for k, v in counts.items() if v >= minimum), key=lambda kv: (-kv[1], kv[0]))
    if n:
        ranked = ranked[:n]
    # device names and classes from the FDA product classification database
    names, skip = {}, 0
    while True:
        data, _ = run.get(c.openfda_query("device/classification.json", search="_exists_:product_code", limit=1000, skip=skip))
        res = (data or {}).get("results", [])
        for r in res:
            names.setdefault(r.get("product_code"), r)
        skip += len(res)
        if len(res) < 1000 or skip >= 25000:
            break
    return ranked, names, {"codes_seen": len(counts), "truncated_partitions": [k for k, v in full.items() if v]}


def build_subjects(args):
    run = Run(args, "subjects")
    titles, titles_sha = load_titles(args.outdir)
    only = set(int(x) for x in args.mdls.split(",")) if args.mdls else None
    groups, links = mdl_groups(titles, only)
    subjects = list(groups)
    subjects.append({"id": "national:faers", "subject_type": "national", "kind": "all", "label": "All FAERS reports (openFDA)",
                     "keys": {}, "search": {"faers": "_exists_:receivedate"}, "source_id": "openfda_faers", "source_url": DOCS["openfda_faers"]})
    subjects.append({"id": "national:maude", "subject_type": "national", "kind": "all", "label": "All MAUDE reports (openFDA)",
                     "keys": {}, "search": {"maude": "_exists_:date_received"}, "source_id": "openfda_maude", "source_url": DOCS["openfda_maude"]})
    notes = {"titles_sha256": titles_sha, "mdl_groups": len(groups), "not_mapped": {str(k): v for k, v in mdl_map.NOT_MAPPED.items()}}
    used = set(s["id"] for s in subjects)
    products = []
    if args.faers_products:
        ranked, info = faers_universe(run, args.faers_products)
        notes["faers_universe"] = info
        for rank, (term, cnt) in enumerate(ranked, 1):
            products.append({"id": product_id("faers", term, used), "subject_type": "product", "kind": "drug", "label": term,
                             "keys": {"generic_name": term}, "search": {"faers": f'patient.drug.openfda.generic_name.exact:"{term}"'},
                             "rank": rank, "reports_total": cnt, "as_of": date.today().isoformat(),
                             "source_id": "openfda_faers", "source_url": DOCS["openfda_faers"]})
        links += named_product_links(products, titles, only)
    codes = []
    if args.maude_codes is None or args.maude_codes > 0:
        ranked, names, info = maude_universe(run, args.maude_codes, args.maude_min)
        notes["maude_universe"] = info
        for rank, (code, cnt) in enumerate(ranked, 1):
            cl = names.get(code) or {}
            codes.append({"id": f"maude:{code}", "subject_type": "device_code", "kind": "device",
                          "label": cl.get("device_name") or f"Product code {code}",
                          "keys": {k: v for k, v in {"product_code": code, "device_name": cl.get("device_name"),
                                                      "device_class": cl.get("device_class"),
                                                      "regulation_number": cl.get("regulation_number"),
                                                      "medical_specialty": cl.get("medical_specialty_description")}.items() if v},
                          "search": {"maude": f'device.device_report_product_code:"{code}"'}, "rank": rank, "reports_total": cnt,
                          "as_of": date.today().isoformat(), "source_id": "openfda_maude", "source_url": DOCS["openfda_maude"]})
    w = run.writer("subjects")
    for s in subjects + products + codes:
        w.add(s)
    lw = run.writer("mdl_subjects")
    for link in links:
        lw.add(link)
    outputs = run.close()
    (run.out / "plan.json").write_text(json.dumps({"subjects": subjects + products + codes, "links": links}, indent=0))
    c.write_manifest(run.out, "openfda/subjects", outputs, {"titles": {"path": "private/build/w1025_safety/mdl/titles.json", "sha256": titles_sha}}, notes)
    print(json.dumps({"subjects": len(subjects), "faers_products": len(products), "maude_codes": len(codes), "links": len(links),
                      "requests": run.http.requests}))


# ------------------------------------------------------------------------------------------------ series and breakdowns
def plan_subjects(args, field):
    plan = json.loads((Path(args.outdir) / "subjects" / "plan.json").read_text())
    subs = [s for s in plan["subjects"] if field in (s.get("search") or {})]
    order = {"national": 0, "mdl_group": 1, "product": 2, "device_code": 2}
    subs.sort(key=lambda s: (order[s["subject_type"]], s.get("rank") or 0, s["id"]))
    if args.mdls:
        keep = set(f"mdl:{x}" for x in args.mdls.split(","))
        subs = [s for s in subs if s["subject_type"] != "mdl_group" or s["id"] in keep]
    return subs


def and_clause(search, extra):
    return search if not extra else f"({search})+AND+{extra}"


def series_row(subject_id, series, unit, source_id, url, method, months, first, through):
    """One series row: the monthly counts from `first` to `through` as an array (0 where the source lists no report)."""
    window = c.month_span(first, through)
    vals = [int(months.get(m, 0)) for m in window]
    return {"subject_id": subject_id, "series": series, "unit": unit, "source_id": source_id, "query_url": url,
            "method": method, "coverage_from": first, "coverage_to": through, "retrieved_at": c.utc_now(), "vals": vals}


def series_task(run, subject, stream, series, extra, unit, endpoint, date_field, floor, through, source_id):
    """One count=<date> request → the subject's monthly series row. The subject's first report month (from its main
    series, fetched first) opens the window for all its series; months before the floor are not stored."""
    key = f"series|{subject['id']}|{series}"
    if key in run.done:
        return None
    st = run.subject_state(subject["id"])
    url = c.openfda_query(endpoint, search=and_clause(subject["search"][stream], extra), count=date_field)
    try:
        data, pub = run.get(url)
    except FieldMissing as e:
        run.unsupported(key, str(e))
        return None
    months = c.day_counts_to_months((data or {}).get("results", []))
    if series in ("faers_reports", "maude_reports", "caers_reports"):
        st["first_month"] = next((m for m, v in months.items() if v > 0 and floor <= m <= through), None)
    first = st.get("first_month")
    if first:
        method = (f"openFDA count={date_field} (reports per day) summed by calendar month, from the subject's first report "
                  f"month to the last complete month of the data; 0 = no report that month")
        run.writer("series", None, source_id).add(series_row(subject["id"], series, unit, source_id, pub, method, months, first, through))
    run.mark(key)
    return months


def breakdown_task(run, subject, stream, endpoint, dim, count_field, period, limit, search_extra, serious_clause, source_id):
    """One term-count request (and its serious companion) → one (subject, dim, period) row."""
    key = f"breakdown|{subject['id']}|{dim}|{period}"
    if key in run.done:
        return
    search = and_clause(subject["search"][stream], search_extra)
    url = c.openfda_query(endpoint, search=search, count=count_field, limit=limit)
    try:
        data, pub = run.get(url)
        res = (data or {}).get("results", [])
        sdata = None
        if serious_clause and res:
            sdata, _ = run.get(c.openfda_query(endpoint, search=and_clause(search, serious_clause), count=count_field, limit=limit))
    except FieldMissing as e:
        run.unsupported(key, str(e))
        return
    serious = None
    if serious_clause and res:
        sres = (sdata or {}).get("results", [])
        serious = ({str(r["term"])[:500]: r["count"] for r in sres}, len(sres) >= limit)
    merged = {}
    for r in res:  # keep the first (largest) count of a term; openFDA can return a trimmed term twice
        term = str(r["term"])[:500]
        if term not in merged:
            merged[term] = int(r["count"])
    terms = list(merged)
    row = {"subject_id": subject["id"], "dim": dim, "period": period, "limit_n": limit, "returned": len(res),
           "query_url": pub, "retrieved_at": c.utc_now(), "terms": terms, "vals": [merged[t] for t in terms]}
    if serious is not None:
        got, truncated = serious
        row["serious"] = [min(int(got[t]), merged[t]) if t in got else (None if truncated else 0) for t in terms]
    run.writer("breakdowns", None, source_id).add(row)
    run.mark(key)


def periods_with_reports(run, subject_id, through, floor, grain="quarter", latest=None):
    """Complete quarters (or calendar years) from the subject's first report month to the data cut-off; a period is
    planned only if the subject's monthly series has at least one report in it."""
    st = run.state.get(subject_id) or {}
    first = st.get("first_month")
    if not first:
        return []
    months = st.get("months") or {}
    key = c.quarter_of if grain == "quarter" else (lambda m: m[:4])
    last_full = through
    if grain == "quarter":
        while int(last_full[5:7]) % 3 != 0:
            last_full = c.month_add(last_full, -1)
    else:
        while last_full[5:7] != "12":
            last_full = c.month_add(last_full, -1)
    periods = []
    for m in c.month_span(max(first, floor), last_full):
        p = key(m)
        if p not in periods and (not months or any(months.get(x, 0) for x in c.month_span(m, m))):
            periods.append(p)
    if latest and latest != "all":
        periods = periods[-int(latest):]
    return periods


def period_bounds(period):
    if "-Q" in period:
        return c.quarter_bounds(period)
    return f"{period}0101", f"{period}1231"


def run_subjects(run, subs, worker):
    """Run `worker(subject)` for every subject on args.workers threads; stops scheduling once the budget is spent."""
    stopped = []

    def guarded(s):
        if not run.budget_left():
            stopped.append(s["id"])
            return
        worker(s)

    with ThreadPoolExecutor(max_workers=run.args.workers) as pool:
        for fut in [pool.submit(guarded, s) for s in subs]:
            fut.result()
    return bool(stopped) or not run.budget_left()


def build_faers(args):
    args.stream = "faers"
    run = Run(args, "faers")
    subs = plan_subjects(args, "faers")
    data, _ = run.get(c.openfda_query("drug/event.json", count="receivedate"))
    through = last_complete_month(data["results"])
    run.state["_through"] = through

    def worker(s):
        for series, extra, unit in FAERS_SERIES:
            if not run.budget_left():
                return
            months = series_task(run, s, "faers", series, extra, unit, "drug/event.json", "receivedate", FAERS_FLOOR, through, "openfda_faers")
            if series == "faers_reports" and months is not None:
                run.subject_state(s["id"])["months"] = {m: v for m, v in months.items() if v}
        if s["subject_type"] == "national" or not run.budget_left():
            return
        breakdown_task(run, s, "faers", "drug/event.json", "meddra_pt", "patient.reaction.reactionmeddrapt.exact", "all",
                       args.alltime_limit, None, "serious:1", "openfda_faers")
        grain = "quarter" if (s["subject_type"] == "mdl_group" or (s.get("rank") or 10 ** 9) <= args.quarter_top) else "year"
        if args.quarter_subjects == "mdl" and s["subject_type"] != "mdl_group":
            return
        for p in periods_with_reports(run, s["id"], through, FAERS_FLOOR, grain, args.quarters):
            if not run.budget_left():
                return
            a, b = period_bounds(p)
            breakdown_task(run, s, "faers", "drug/event.json", "meddra_pt", "patient.reaction.reactionmeddrapt.exact", p,
                           args.reaction_limit, f"receivedate:[{a}+TO+{b}]", "serious:1", "openfda_faers")

    stop = run_subjects(run, subs, worker)
    outputs = run.close()
    c.write_manifest(run.out, "openfda/faers", outputs, {"through": through}, {"stopped_at_budget": stop, "requests": run.http.requests,
                                                                     "unsupported": run.state.get("_unsupported", {})})
    print(json.dumps({"through": through, "requests": run.http.requests, "stopped": stop,
                      "rows": {o["target"]: o["rows"] for o in outputs}}))


def build_maude(args):
    args.stream = "maude"
    run = Run(args, "maude")
    subs = plan_subjects(args, "maude")
    data, _ = run.get(c.openfda_query("device/event.json", count="date_received"))
    through = last_complete_month(data["results"])
    run.state["_through"] = through

    def worker(s):
        for series, extra, unit in MAUDE_SERIES:
            if not run.budget_left():
                return
            months = series_task(run, s, "maude", series, extra, unit, "device/event.json", "date_received", MAUDE_FLOOR, through, "openfda_maude")
            if series == "maude_reports" and months is not None:
                run.subject_state(s["id"])["months"] = {m: v for m, v in months.items() if v}
        if s["subject_type"] == "national":
            return
        for dim, field, limit in (("device_problem", "product_problems.exact", 1000), ("patient_problem", "patient.patient_problems.exact", 200),
                                  ("manufacturer", "device.manufacturer_d_name.exact", 50), ("brand_name", "device.brand_name.exact", 50)):
            if not run.budget_left():
                return
            breakdown_task(run, s, "maude", "device/event.json", dim, field, "all", limit, None, None, "openfda_maude")
        if s["subject_type"] != "mdl_group":
            return
        for p in periods_with_reports(run, s["id"], through, "2004-01", "quarter", args.quarters):
            if not run.budget_left():
                return
            a, b = period_bounds(p)
            breakdown_task(run, s, "maude", "device/event.json", "device_problem", "product_problems.exact", p,
                           args.reaction_limit, f"date_received:[{a}+TO+{b}]", None, "openfda_maude")

    stop = run_subjects(run, subs, worker)
    outputs = run.close()
    c.write_manifest(run.out, "openfda/maude", outputs, {"through": through}, {"stopped_at_budget": stop, "requests": run.http.requests,
                                                                     "unsupported": run.state.get("_unsupported", {})})
    print(json.dumps({"through": through, "requests": run.http.requests, "stopped": stop,
                      "rows": {o["target"]: o["rows"] for o in outputs}}))


def build_other(args):
    """CAERS series for food/cosmetic groups; FDA enforcement reports and device recalls per MDL group."""
    args.stream = "other"
    run = Run(args, "other")
    plan = json.loads((Path(args.outdir) / "subjects" / "plan.json").read_text())
    groups = [s for s in plan["subjects"] if s["subject_type"] == "mdl_group"]
    if args.mdls:
        keep = set(f"mdl:{x}" for x in args.mdls.split(","))
        groups = [g for g in groups if g["id"] in keep]
    endpoints = {}
    for ep, field in (("drug/enforcement.json", "report_date"), ("device/enforcement.json", "report_date"),
                      ("food/enforcement.json", "report_date"), ("device/recall.json", "event_date_initiated"),
                      ("food/event.json", "date_created")):
        data, _ = run.get(c.openfda_query(ep, count=field))
        months = c.day_counts_to_months(data["results"])
        first = next(m for m in months if m >= "1990-01")
        endpoints[ep] = (first, last_complete_month(data["results"]))
    run.state["_endpoints"] = endpoints
    for g in groups:
        if not run.budget_left():
            break
        if "caers" in g["search"]:
            caers_from, caers_to = endpoints["food/event.json"]
            series_task(run, g, "caers", "caers_reports", None, "reports", "food/event.json", "date_created", "2004-01", caers_to, "openfda_caers")
        for name, series, field, source_id, unit in (("enforcement", "enforcement_reports", "report_date", "openfda_enforcement", "enforcement reports"),
                                                    ("device_recall", "device_recalls", "event_date_initiated", "openfda_device_recall", "recalls (products)")):
            spec = g["search"].get(name)
            if not spec or not run.budget_left():
                continue
            key = f"series|{g['id']}|{series}"
            if key in run.done:
                continue
            ep = spec["endpoint"]
            url = c.openfda_query(ep, search=spec["search"], count=field)
            try:
                data, pub = run.get(url)
            except FieldMissing as e:
                run.unsupported(key, str(e))
                continue
            months = c.day_counts_to_months((data or {}).get("results", []))
            cov_from, cov_to = endpoints[ep]
            method = (f"openFDA {ep} count={field} summed by calendar month; the window is the endpoint's own coverage, so a "
                      f"month without a matching record is 0")
            run.writer("series", None, source_id).add(series_row(g["id"], series, unit, source_id, pub, method, months, cov_from, cov_to))
            run.mark(key)
    outputs = run.close()
    c.write_manifest(run.out, "openfda/other", outputs, {"endpoints": endpoints}, {"requests": run.http.requests,
                                                                           "unsupported": run.state.get("_unsupported", {})})
    print(json.dumps({"endpoints": endpoints, "requests": run.http.requests, "rows": {o["target"]: o["rows"] for o in outputs}}))


# ------------------------------------------------------------------------------------------------ MAUDE records
def maude_record(r, today):
    devices = r.get("device") or []
    texts = r.get("mdr_text") or []
    event = [t.get("text", "") for t in texts if (t.get("text_type_code") or "").startswith("Description of Event")]
    other = [f"[{t.get('text_type_code') or 'Text'}] {t.get('text', '')}" for t in texts
             if not (t.get("text_type_code") or "").startswith("Description of Event") and t.get("text")]
    uniq = lambda xs: sorted({x.strip() for x in xs if isinstance(x, str) and x.strip() and x.strip() not in ("*", "NI", "UNK")})  # noqa: E731
    patients = r.get("patient") or []
    return {
        "report_number": r.get("report_number"),
        "mdr_report_key": r.get("mdr_report_key") or None,
        "date_received": c.iso(r.get("date_received")),
        "date_of_event": c.iso(r.get("date_of_event")),
        "event_type": r.get("event_type") or None,
        "report_source": uniq(r.get("source_type") or []),
        "reporter_occupation": r.get("reporter_occupation_code") or None,
        "manufacturers": uniq(d.get("manufacturer_d_name") for d in devices),
        "brand_names": uniq(d.get("brand_name") for d in devices),
        "generic_names": uniq(d.get("generic_name") for d in devices),
        "product_codes": uniq(d.get("device_report_product_code") for d in devices),
        "model_numbers": uniq(d.get("model_number") for d in devices),
        "device_problems": uniq(r.get("product_problems") or []),
        "patient_problems": uniq(pp for p in patients for pp in (p.get("patient_problems") or [])),
        "event_text": ("\n\n".join(event))[:TEXT_LIMIT] or None,
        "manufacturer_narrative": ("\n\n".join(other))[:TEXT_LIMIT] or None,
        "retrieved_on": today,
    }


def windows_from_days(days, cap=25000):
    """Split daily counts {YYYYMMDD: n} into [start, end] windows of at most `cap` reports (a single day above the
    cap stays alone; openFDA then returns at most cap + 1,000 of it and the window is flagged incomplete)."""
    out, start, total, prev = [], None, 0, None
    for d in sorted(days):
        n = days[d]
        if start is not None and total + n > cap:
            out.append((start, prev, total))
            start, total = None, 0
        if start is None:
            start = d
        total += n
        prev = d
    if start is not None:
        out.append((start, prev, total))
    return out


def build_records(args):
    run = Run(args, "records")
    today = date.today().isoformat()
    plan = json.loads((Path(args.outdir) / "subjects" / "plan.json").read_text())
    groups = [s for s in plan["subjects"] if s["subject_type"] == "mdl_group" and "maude" in s["search"]]
    if args.mdls:
        keep = set(f"mdl:{x}" for x in args.mdls.split(","))
        groups = [g for g in groups if g["id"] in keep]
    seen = set()
    incomplete = []
    for g in groups:
        try:
            data, _ = run.get(c.openfda_query("device/event.json", search=g["search"]["maude"], count="date_received"))
        except FieldMissing as e:
            run.unsupported(f"records|{g['id']}", str(e))
            continue
        days = {r["time"]: r["count"] for r in (data or {}).get("results", []) if re.fullmatch(r"(19|20)\d{6}", r["time"])}
        taken = 0
        for a, b, expected in windows_from_days(days):
            key = f"records|{g['id']}|{a}|{b}"
            if key in run.done or not run.budget_left():
                continue
            if args.record_limit and taken >= args.record_limit:
                break
            search = f"({g['search']['maude']})+AND+date_received:[{a}+TO+{b}]"
            got, skip, rows, links = 0, 0, [], []
            while skip <= 25000:
                limit = 1000 if not args.record_limit else min(1000, args.record_limit - taken)
                if limit <= 0:
                    break
                page, pub = run.get(c.openfda_query("device/event.json", search=search, limit=limit, skip=skip))
                res = (page or {}).get("results", [])
                for r in res:
                    rec = maude_record(r, today)
                    if not rec["report_number"] or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9-]{2,40}", rec["report_number"]):
                        continue
                    links.append({"subject_id": g["id"], "source": "maude", "record_id": rec["report_number"],
                                  "rule": "subject search.maude"})
                    if rec["report_number"] not in seen:
                        seen.add(rec["report_number"])
                        rows.append(rec)
                got += len(res)
                taken += len(res)
                skip += len(res)
                if len(res) < limit or got >= expected:
                    break
            if not args.record_limit and got != expected:
                incomplete.append({"subject": g["id"], "window": [a, b], "expected": expected, "got": got})
            dedup = {}
            for link in links:
                dedup[(link["subject_id"], link["record_id"])] = link
            for i in range(0, len(rows), args.chunk_rows):
                run.writer("maude_reports", None, "openfda_maude").add_group(rows[i:i + args.chunk_rows])
            links = list(dedup.values())
            for i in range(0, len(links), args.chunk_rows):
                run.writer("record_subjects", None, "openfda_maude").add_group(links[i:i + args.chunk_rows])
            run.mark(key)
    outputs = run.close()
    c.write_manifest(run.out, "openfda/records", outputs, {}, {"incomplete_windows": incomplete, "requests": run.http.requests,
                                                         "unsupported": run.state.get("_unsupported", {})})
    print(json.dumps({"requests": run.http.requests, "incomplete": len(incomplete), "rows": {o["target"]: o["rows"] for o in outputs}}))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("stream", choices=["subjects", "faers", "maude", "other", "records"])
    ap.add_argument("--outdir", default=str(c.BUILD / "openfda"))
    ap.add_argument("--faers-products", type=int, default=2000)
    ap.add_argument("--maude-codes", type=int, default=None)
    ap.add_argument("--maude-min", type=int, default=50)
    ap.add_argument("--mdls", default="")
    ap.add_argument("--quarters", default="all")
    ap.add_argument("--quarter-subjects", choices=["mdl", "all"], default="all")
    ap.add_argument("--reaction-limit", type=int, default=25)
    ap.add_argument("--alltime-limit", type=int, default=1000)
    ap.add_argument("--quarter-top", type=int, default=300)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--max-requests", type=int, default=None)
    ap.add_argument("--record-limit", type=int, default=0)
    ap.add_argument("--chunk-rows", type=int, default=2000)
    ap.add_argument("--interval", type=float, default=0.27)
    args = ap.parse_args()
    {"subjects": build_subjects, "faers": build_faers, "maude": build_maude, "other": build_other, "records": build_records}[args.stream](args)


if __name__ == "__main__":
    main()
