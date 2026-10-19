"""Segment and dimensional facts from an XBRL instance document (pure functions, unit-tested).

Kept: revenue and operating income facts whose context carries exactly one of the segment, product/service or geographic
axes (optionally with ConsolidationItemsAxis = OperatingSegmentsMember) and no other dimension. Member names come from
the filing's label linkbase (terse label first, then the standard label); a member without a label is shown by its
element name split into words. Members are checked against the consolidated total of the same concept and period; a
difference is reported, never adjusted.
"""
from __future__ import annotations

import io
import re
import xml.etree.ElementTree as ET
from datetime import date

XBRLI = "{http://www.xbrl.org/2003/instance}"
XBRLDI = "{http://xbrl.org/2006/xbrldi}"
LINK = "{http://www.xbrl.org/2003/linkbase}"
XLINK = "{http://www.w3.org/1999/xlink}"

AXES = {
    "StatementBusinessSegmentsAxis": "segment", "SegmentsAxis": "segment",
    "ProductOrServiceAxis": "product", "ProductsAndServicesAxis": "product",
    "StatementGeographicalAxis": "geography", "GeographicalAreasAxis": "geography",
}
CONSOLIDATION_AXIS = "ConsolidationItemsAxis"
# Members that are totals of the axis itself, not parts of it.
AGGREGATE_MEMBERS = {"AllSegmentsMember", "SegmentsTotalMember", "ConsolidatedEntitiesMember", "AllCountriesDomain", "AllCountriesMember"}
CONSOLIDATION_OK = {"OperatingSegmentsMember"}
REVENUE = ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet",
           "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueGoodsNet", "Revenue", "RevenueFromContractsWithCustomers",
           "RevenueFromSaleOfGoods"]
OPERATING = ["OperatingIncomeLoss", "ProfitLossFromOperatingActivities"]
CONCEPTS = set(REVENUE + OPERATING)
LABEL_ROLES = ["http://www.xbrl.org/2003/role/terseLabel", "http://www.xbrl.org/2003/role/label"]


def local(qname: str) -> str:
    return qname.split(":", 1)[-1] if ":" in qname else qname.rsplit("}", 1)[-1]


def humanize(name: str) -> str:
    base = re.sub(r"Member$", "", local(name))
    words = re.sub(r"(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])", " ", base)
    return words.strip()


def parse_instance(data: bytes) -> tuple[dict, list[dict]]:
    """(contexts, facts): contexts {id: {start, end, dims {axis local name: member qname}}}; facts of tracked concepts
    {concept, context, unit, value}. Facts with nil or non-numeric values are skipped."""
    contexts: dict[str, dict] = {}
    facts: list[dict] = []
    for _event, el in ET.iterparse(io.BytesIO(data), events=("end",)):
        tag = el.tag
        if tag == f"{XBRLI}context":
            period = el.find(f"{XBRLI}period")
            start = period.findtext(f"{XBRLI}startDate") if period is not None else None
            end = period.findtext(f"{XBRLI}endDate") if period is not None else None
            instant = period.findtext(f"{XBRLI}instant") if period is not None else None
            dims = {}
            typed = False
            for seg in el.iter():
                if seg.tag == f"{XBRLDI}explicitMember":
                    dims[local(seg.get("dimension") or "")] = (seg.text or "").strip()
                elif seg.tag == f"{XBRLDI}typedMember":
                    typed = True
            contexts[el.get("id")] = {"start": (start or "").strip() or None, "end": (end or instant or "").strip() or None,
                                      "instant": bool(instant), "dims": dims, "typed": typed}
            el.clear()
        elif "}" in tag and not tag.startswith((XBRLI, LINK, XBRLDI)):
            name = tag.rsplit("}", 1)[1]
            if name in CONCEPTS and el.get("contextRef"):
                text = (el.text or "").strip()
                if text and el.get("{http://www.w3.org/2001/XMLSchema-instance}nil") != "true":
                    try:
                        value = float(text)
                    except ValueError:
                        value = None
                    if value is not None:
                        facts.append({"concept": name, "context": el.get("contextRef"), "unit": el.get("unitRef"), "value": value})
            el.clear()
    return contexts, facts


def parse_labels(data: bytes) -> dict[str, str]:
    """Element id (e.g. 'abt_NutritionalProductsMember') -> label, preferring the terse label."""
    root = ET.fromstring(data)
    out: dict[str, dict[str, str]] = {}
    for link in root.iter(f"{LINK}labelLink"):
        locs = {}
        labels: dict[str, list[tuple[str, str]]] = {}
        arcs = []
        for el in link:
            kind = el.get(f"{XLINK}type")
            if kind == "locator":
                href = el.get(f"{XLINK}href") or ""
                locs[el.get(f"{XLINK}label")] = href.split("#", 1)[-1]
            elif kind == "resource":
                labels.setdefault(el.get(f"{XLINK}label"), []).append((el.get(f"{XLINK}role") or "", (el.text or "").strip()))
            elif kind == "arc":
                arcs.append((el.get(f"{XLINK}from"), el.get(f"{XLINK}to")))
        for frm, to in arcs:
            element = locs.get(frm)
            if not element:
                continue
            for role, text in labels.get(to, []):
                if text:
                    out.setdefault(element, {})[role] = text
    result = {}
    for element, roles in out.items():
        for role in LABEL_ROLES:
            if role in roles:
                result[element] = roles[role]
                break
    return result


def member_label(member: str, labels: dict[str, str]) -> str:
    element = member.replace(":", "_")
    label = labels.get(element)
    if label:
        return re.sub(r"\s*\[Member\]\s*$", "", label).strip()
    return humanize(member)


def member_labels(members: list[str], labels: dict[str, str]) -> list[str]:
    """Labels for a list of members; two members sharing a label are told apart by their element names."""
    base = [member_label(m, labels) for m in members]
    counts: dict[str, int] = {}
    for b in base:
        counts[b] = counts.get(b, 0) + 1
    return [f"{b} ({humanize(m)})" if counts[b] > 1 and humanize(m) != b else b for b, m in zip(base, members)]


def span_days(start: str, end: str) -> int:
    return (date.fromisoformat(end) - date.fromisoformat(start)).days


def segment_facts(contexts: dict, facts: list[dict], form: str) -> tuple[list[dict], list[dict]]:
    """(dimensional, totals): dimensional facts on one tracked axis (annual 340-380 days in a 10-K/20-F, quarterly 80-100
    days in a 10-Q) and the consolidated (dimensionless) values of the same concepts and periods."""
    annual_form = form.replace("/A", "") in {"10-K", "20-F", "40-F", "10-KT"}
    dimensional, totals = [], []
    for f in facts:
        ctx = contexts.get(f["context"])
        if not ctx or ctx["instant"] or ctx["typed"] or not ctx["start"] or not ctx["end"]:
            continue
        days = span_days(ctx["start"], ctx["end"])
        grain = "annual" if (annual_form and 340 <= days <= 380) else "quarterly" if 80 <= days <= 100 else None
        if not grain:
            continue
        dims = ctx["dims"]
        base = {"concept": f["concept"], "start": ctx["start"], "end": ctx["end"], "grain": grain, "unit": f["unit"], "value": f["value"]}
        if not dims:
            totals.append(base)
            continue
        axes = [a for a in dims if a in AXES]
        others = [a for a in dims if a not in AXES and a != CONSOLIDATION_AXIS]
        if len(axes) != 1 or others:
            continue
        consolidation = dims.get(CONSOLIDATION_AXIS)
        if consolidation and local(consolidation) not in CONSOLIDATION_OK:
            continue
        if local(dims[axes[0]]) in AGGREGATE_MEMBERS:
            continue
        dimensional.append({**base, "axis": axes[0], "kind": AXES[axes[0]], "member": dims[axes[0]]})
    return dimensional, totals


def sum_checks(dimensional: list[dict], totals: list[dict], tolerance: float = 0.01) -> list[dict]:
    """Per (axis, concept, period): members' sum against the consolidated total; within tolerance or the difference."""
    total_by = {(t["concept"], t["start"], t["end"], t["unit"]): t["value"] for t in totals}
    groups: dict[tuple, dict[str, float]] = {}
    for d in dimensional:
        groups.setdefault((d["axis"], d["concept"], d["start"], d["end"], d["unit"]), {})[d["member"]] = d["value"]
    out = []
    for (axis, concept, start, end, unit), members in sorted(groups.items()):
        total = total_by.get((concept, start, end, unit))
        s = sum(members.values())
        if total in (None, 0):
            out.append({"axis": axis, "concept": concept, "start": start, "end": end, "members": len(members), "sum": s, "total": total, "status": "no_total"})
            continue
        diff = (s - total) / abs(total)
        out.append({"axis": axis, "concept": concept, "start": start, "end": end, "members": len(members), "sum": s, "total": total,
                    "diff_pct": round(100 * diff, 2), "status": "matches" if abs(diff) <= tolerance else "differs"})
    return out


def _taxonomy(namespace: str) -> str | None:
    if "fasb.org/us-gaap" in namespace:
        return "us-gaap"
    if "xbrl.ifrs.org" in namespace:
        return "ifrs-full"
    return None


def consolidated_facts(data: bytes, concepts: set[str]) -> tuple[str | None, list[dict]]:
    """(entity CIK, facts) from an instance document's dimensionless contexts, for filling in a periodic report that SEC
    companyfacts does not include yet. The CIK is dei:EntityCentralIndexKey in a dimensionless context, so a combined
    filing's facts are only attributed to its primary registrant. Facts: {taxonomy, concept, start, end, unit, value},
    units named as companyfacts names them (USD, shares, USD/shares)."""
    contexts: dict[str, dict] = {}
    units: dict[str, str] = {}
    raw: list[tuple] = []
    for _event, el in ET.iterparse(io.BytesIO(data), events=("end",)):
        tag = el.tag
        if tag == f"{XBRLI}context":
            period = el.find(f"{XBRLI}period")
            dims = any(m.tag in (f"{XBRLDI}explicitMember", f"{XBRLDI}typedMember") for m in el.iter())
            if period is not None:
                start = (period.findtext(f"{XBRLI}startDate") or "").strip() or None
                end = (period.findtext(f"{XBRLI}endDate") or period.findtext(f"{XBRLI}instant") or "").strip() or None
                contexts[el.get("id")] = {"start": start, "end": end, "dims": dims}
            el.clear()
        elif tag == f"{XBRLI}unit":
            measures = [local((m.text or "").strip()) for m in el.iter(f"{XBRLI}measure")]
            if el.find(f"{XBRLI}divide") is not None and len(measures) == 2:
                units[el.get("id")] = f"{measures[0]}/{measures[1]}"
            elif len(measures) == 1:
                units[el.get("id")] = measures[0]
            el.clear()
        elif "}" in tag and not tag.startswith((XBRLI, LINK, XBRLDI)) and el.get("contextRef"):
            namespace, name = tag[1:].split("}", 1)
            if name == "EntityCentralIndexKey":
                raw.append(("dei", name, el.get("contextRef"), None, (el.text or "").strip()))
            elif name in concepts and _taxonomy(namespace) and el.get("{http://www.w3.org/2001/XMLSchema-instance}nil") != "true":
                raw.append((_taxonomy(namespace), name, el.get("contextRef"), el.get("unitRef"), (el.text or "").strip()))
            el.clear()
    entity, out, seen = None, [], set()
    for taxonomy, name, ref, unit_ref, text in raw:
        ctx = contexts.get(ref)
        if not ctx or ctx["dims"]:
            continue
        if taxonomy == "dei":
            entity = text.zfill(10) if text.isdigit() else entity
            continue
        try:
            value = float(text)
        except ValueError:
            continue
        unit = units.get(unit_ref or "")
        key = (taxonomy, name, ctx["start"], ctx["end"], unit)
        if not unit or key in seen:
            continue
        seen.add(key)
        out.append({"taxonomy": taxonomy, "concept": name, "start": ctx["start"], "end": ctx["end"], "unit": unit,
                    "value": int(value) if value.is_integer() else value})
    return entity, out
