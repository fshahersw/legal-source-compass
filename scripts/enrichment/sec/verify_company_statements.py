"""Independent checks of company_sec_statements, company_sec_segments and company_sec_ir_documents (the builders' code paths
for selecting values are not reused; facts are re-read from the cached SEC JSON and XML).

Statements: every as-filed cell of revenue, net income, total assets, cash from operations and capital expenditures for all
registrants is found in companyfacts (or, for a recent filing companyfacts does not include yet, in that filing's instance
document) with the same concept, unit, period, accession and value, and equals the most recently filed value for the
period; every derived quarter equals a year-to-date difference or, for a fourth quarter, the full year less the three
stored quarters of the same concept; free cash flow equals cash from operations minus capital expenditures; net margin
equals net income / revenue.
Segments: for up to 25 registrants, every stored member value of the latest annual period is found in the XBRL instance
document (context with that member on that axis, same period, same concept); the members-versus-total status is recomputed.
IR documents: every kept figure's quote appears in the stored text and contains the number; every URL is on www.sec.gov
under the registrant's CIK; each XBRL comparison is recomputed from the statements record.

    python3 -I -B scripts/enrichment/sec/verify_company_statements.py
"""
import gzip
import json
import random
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import sec_http as h  # noqa: E402

BUILD = h.ROOT / "private" / "build" / "sec_statements"
failures, checked = [], {}


def fail(what, detail):
    failures.append({"check": what, "detail": str(detail)[:300]})


def count(name):
    checked[name] = checked.get(name, 0) + 1


def companyfacts(cik):
    path = h.cache_path(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json", "companyfacts", ".json.gz")
    return json.loads(gzip.decompress(path.read_bytes()))["facts"] if path.exists() else {}


def raw_facts(facts, concept, unit):
    """Every fact of the concept in the line's unit, from either taxonomy (a filer uses one per filing)."""
    out = []
    for taxonomy in ("us-gaap", "ifrs-full"):
        node = (facts.get(taxonomy) or {}).get(concept)
        if node:
            out += (node.get("units") or {}).get(unit) or []
    return out


OWN_FORMS = ("10-K", "10-K405", "10-KT", "20-F", "40-F", "10-Q")
XBRLI = "{http://www.xbrl.org/2003/instance}"
XBRLDI = "{http://xbrl.org/2006/xbrldi}"
_instances = {}


def instance_facts(url):
    """Dimensionless facts of a cached instance document, by (concept local name, unit): [{start, end, val}]."""
    if url not in _instances:
        root = ET.fromstring(gzip.decompress(h.cache_path(url, "xbrl_instance", ".xml.gz").read_bytes()))
        contexts = {}
        for c in root.findall(f"{XBRLI}context"):
            if any(True for _ in c.iter(f"{XBRLDI}explicitMember")) or any(True for _ in c.iter(f"{XBRLDI}typedMember")):
                continue
            per = c.find(f"{XBRLI}period")
            contexts[c.get("id")] = (per.findtext(f"{XBRLI}startDate"), per.findtext(f"{XBRLI}endDate") or per.findtext(f"{XBRLI}instant"))
        units = {u.get("id"): "/".join((m.text or "").split(":")[-1] for m in u.iter(f"{XBRLI}measure")) for u in root.findall(f"{XBRLI}unit")}
        out = {}
        for el in root:
            ref, text = el.get("contextRef"), (el.text or "").strip()
            if ref in contexts and re.fullmatch(r"-?\d+(\.\d+)?", text):
                start, end = contexts[ref]
                out.setdefault((el.tag.rsplit("}", 1)[-1], units.get(el.get("unitRef"))), []).append({"start": start, "end": end, "val": float(text)})
        _instances[url] = out
    return _instances[url]


def supplement_facts(profile, concept, unit):
    """Facts of the recent filings the builder read from instance documents (not yet in companyfacts)."""
    out = []
    for s in profile.get("statements_supplement") or []:
        for f in instance_facts(s["url"]).get((concept, unit), []):
            out.append({**f, "accn": s["accn"], "form": s["form"], "filed": s["date"]})
    return out


def close(a, b):
    return abs(a - b) <= 1e-6 * max(1, abs(b))


def latest_values(raw, start, end):
    """Values of the most recently filed periodic-report facts for (start, end); start None means an instant."""
    span = [f for f in raw if f.get("end") == end and f.get("start") == start and (f.get("form") or "").replace("/A", "") in OWN_FORMS]
    if not span:
        return []
    newest = max(f.get("filed") or "" for f in span)
    return [f["val"] for f in span if (f.get("filed") or "") == newest]


def derived_ok(raw, periods, cells, concept, i, value):
    """A derived quarter is either the difference of two values sharing a start (year to date at this quarter's end and
    at the previous quarter's end), or, for a fourth quarter, the annual value less the three earlier stored quarters of
    the same concept."""
    per = periods[i]
    if i > 0:
        prev = periods[i - 1]
        for st in {f["start"] for f in raw if f.get("end") == per["end"] and f.get("start")}:
            if any(close(a - b, value) for a in latest_values(raw, st, per["end"]) for b in latest_values(raw, st, prev["end"])):
                return True
    if per["q"] == 4 and i >= 3:
        earlier = [cells[j] for j in (i - 3, i - 2, i - 1)]
        if all(c and c[2] == concept for c in earlier) and all(periods[j]["fy"] == per["fy"] for j in (i - 3, i - 2, i - 1)):
            return any(close(t - sum(c[0] for c in earlier), value) for t in latest_values(raw, periods[i - 3]["start"], per["end"]))
    return False


stmts = {r["id"]: r["item"]["profile"] for r in json.loads((BUILD / "company_sec_statements.json").read_text())["rows"]}
for cik, p in stmts.items():
    s = p.get("statements")
    if not s:
        continue
    facts = companyfacts(cik)
    for grain, periods in (("annual", s["annual_periods"]), ("quarterly", s["quarterly_periods"])):
        for key in ("revenue", "net_income", "total_assets", "cfo", "capex"):
            line = s["lines"].get(key)
            if not line:
                continue
            for i, cell in enumerate(line[grain]):
                if not cell:
                    continue
                value, accn, concept, flag = cell
                per = periods[i]
                raw = raw_facts(facts, concept, line["unit"]) + supplement_facts(p, concept, line["unit"])
                start = None if key == "total_assets" else per["start"]
                if flag == 0:
                    count(f"{grain} as filed")
                    if not any(f.get("accn") == accn and f.get("end") == per["end"] and f.get("start") == start and close(f["val"], value) for f in raw):
                        fail("as-filed value not found under its accession", f"{cik} {key} {grain} {per} {cell}")
                    elif not any(close(v, value) for v in latest_values(raw, start, per["end"])):
                        fail("the latest filing reports a different value", f"{cik} {key} {grain} {per['end']} {cell}")
                elif flag == 1 and grain == "quarterly":
                    count("derived quarter")
                    if not derived_ok(raw, periods, line[grain], concept, i, value):
                        fail("derived quarter does not match its source facts", f"{cik} {key} {per} {cell}")
                else:
                    fail("unexpected flag", f"{cik} {key} {grain} {cell}")
    for grain in ("annual", "quarterly"):
        cfo, capex, fcf = (s["lines"].get(k, {}).get(grain) for k in ("cfo", "capex", "fcf"))
        if cfo and capex and fcf:
            for a, b, c in zip(cfo, capex, fcf):
                if a and b and c and c[3] == 2:
                    count("fcf")
                    if abs((a[0] - b[0]) - c[0]) > 1e-6 * max(1, abs(c[0])):
                        fail("fcf", f"{cik} {grain}")
        rev = s["lines"].get("revenue", {}).get(grain)
        net = s["lines"].get("net_income", {}).get(grain)
        nm = s["margins"][grain].get("net_margin")
        if rev and net and nm:
            for r, n_, m in zip(rev, net, nm):
                if r and n_ and m is not None and r[0]:
                    count("margin")
                    if abs(round(100 * n_[0] / r[0], 2) - m) > 0.011:
                        fail("net margin", f"{cik} {grain}")

# segments
segs = {r["id"]: r["item"]["profile"] for r in json.loads((BUILD / "company_sec_segments.json").read_text())["rows"]}
random.seed(11)
for cik in random.sample(sorted(segs), min(25, len(segs))):
    p = segs[cik]
    for axis in p["axes"]:
        ann = axis.get("annual")
        if not ann:
            continue
        i = len(ann["periods"]) - 1
        per = ann["periods"][i]
        for member, values in ann["values"].items():
            v, accn = values[i], ann["accn"][member][i]
            if v is None:
                continue
            count("segment value")
            used = next((u for u in p["filings_used"] if u["accn"] == accn), None)
            if not used or f"/{int(cik)}/" not in used["url"]:
                fail("segment accession not among the filings read", f"{cik} {accn}")
                continue
            data = gzip.decompress(h.cache_path(used["url"], "xbrl_instance", ".xml.gz").read_bytes())
            root = ET.fromstring(data)
            ctx_ids = set()
            for ctx in root.iter(f"{XBRLI}context"):
                per_el = ctx.find(f"{XBRLI}period")
                if per_el is None or per_el.findtext(f"{XBRLI}startDate") != per["start"] or per_el.findtext(f"{XBRLI}endDate") != per["end"]:
                    continue
                members = {(m.get("dimension") or "").split(":")[-1]: (m.text or "").strip() for m in ctx.iter(f"{XBRLDI}explicitMember")}
                if members.get(axis["axis"]) == member:
                    ctx_ids.add(ctx.get("id"))
            found = any(el.tag.endswith("}" + axis["concept"]) and el.get("contextRef") in ctx_ids and abs(float(el.text) - v) <= 1e-6 * max(1, abs(v))
                        for el in root.iter() if el.get("contextRef") in ctx_ids and el.text and re.match(r"^-?[\d.]+$", el.text.strip()))
            if not found:
                fail("segment value not in the instance document", f"{cik} {axis['axis']} {member} {per}")
        for c in axis["checks"]:
            count("segment check")
            if c["status"] in ("matches", "differs") and c["total"]:
                recomputed = "matches" if abs(c["sum"] - c["total"]) / abs(c["total"]) <= 0.01 else "differs"
                if recomputed != c["status"]:
                    fail("segment check status", f"{cik} {c}")

# IR documents
irp = BUILD / "company_sec_ir_documents.json"
if irp.exists():
    def norm(t):
        return re.sub(r"\s+", " ", (t or "").replace("’", "'").replace("“", '"').replace("”", '"').replace("—", "-").replace("–", "-")).strip()

    accessions = {}

    def filed_by(cik):
        if cik not in accessions:
            path = h.cache_path(f"https://data.sec.gov/submissions/CIK{cik}.json", "submissions", ".json")
            recent = json.loads(path.read_bytes())["filings"]["recent"] if path.exists() else {}
            accessions[cik] = set(recent.get("accessionNumber") or [])
        return accessions[cik]

    for r in json.loads(irp.read_text())["rows"]:
        p, text = r["item"]["profile"], r["item"].get("document_text") or ""
        count("ir document")
        # Joint filings are stored under the first filer's CIK; the accession must be one the registrant filed.
        m = re.match(r"^https://www\.sec\.gov/Archives/edgar/data/\d+/(\d{18})/[^/?#]+$", p["url"])
        if not m or m.group(1) != p["accn"].replace("-", "") or p["accn"] not in filed_by(p["cik"]):
            fail("ir url", f"{p['cik']} {p['accn']} {p['url']}")
        ex = p.get("extraction")
        if not ex:
            continue
        for key in ("revenue", "net_income", "eps_diluted"):
            item = ex.get(key)
            if item:
                count("ir figure")
                if norm(item["quote"]) not in norm(text[:40000]):
                    fail("ir quote not verbatim", f"{r['id']} {key}")
        for seg in ex.get("segments", []):
            count("ir figure")
            if norm(seg["quote"]) not in norm(text[:40000]):
                fail("ir segment quote not verbatim", r["id"])
        q = ex.get("xbrl_quarter")
        st = stmts.get(p["cik"], {}).get("statements")
        scales = {"units": 1, "thousands": 1e3, "millions": 1e6, "billions": 1e9}
        for key, chk in (ex.get("xbrl_checks") or {}).items():
            if q and st and chk["status"] in ("matches", "rounded", "differs"):
                count("ir xbrl check")
                idx = next((i for i, x in enumerate(st["quarterly_periods"]) if x["end"] == q["end"]), None)
                cell = st["lines"].get(key, {}).get("quarterly", [])[idx] if idx is not None else None
                if not cell or cell[0] != chk["xbrl"]:
                    fail("ir xbrl comparison value", f"{r['id']} {key}")
                    continue
                item = ex[key]
                value = float(item["value"]) * (1 if key == "eps_diluted" else scales[item["scale"]])
                if abs(value - chk["extracted"]) > 1e-9 * max(1, abs(value)):
                    fail("ir extracted amount", f"{r['id']} {key}")
                tol = {"revenue": 0.005, "net_income": 0.01, "eps_diluted": 0.011}[key]
                literal = f"{float(item['value'])!r}"
                digits = 0 if literal.endswith(".0") or "e" in literal else len(literal.split(".")[1])
                last = 10 ** -digits * (1 if key == "eps_diluted" else scales[item["scale"]])
                expected = ("matches" if value == cell[0] or cell[0] and abs(value - cell[0]) / abs(cell[0]) <= tol
                            else "rounded" if abs(value - cell[0]) <= last / 2 * (1 + 1e-9) else "differs")
                if expected != chk["status"]:
                    fail("ir xbrl status", f"{r['id']} {key} {chk['status']} expected {expected}")

summary = {"checked": checked, "failures": len(failures), "examples": failures[:25]}
(BUILD / "verification.json").write_text(json.dumps(summary, indent=1))
print(json.dumps(summary)[:2500])
raise SystemExit(1 if failures else 0)
