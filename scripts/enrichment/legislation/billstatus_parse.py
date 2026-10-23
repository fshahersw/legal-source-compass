"""Parse one GovInfo Bill Status XML file (schema 3.0.0) into a compact dict of the published values.

Only elements that are direct children of /billStatus/bill are read (amendment-level sponsors, actions and votes are not
mixed into the bill). Values are kept as published: names, party/state as printed, dates, action text, codes, URLs. Nothing
is inferred here; derived fields (status milestones, link-service URLs) are computed by build_congress_bills.py with the
rules written there.
"""
from __future__ import annotations

import html
import re
import xml.etree.ElementTree as ET
from html.parser import HTMLParser

TYPES = ("hr", "s", "hjres", "sjres", "hconres", "sconres", "hres", "sres")


def _t(el, path: str) -> str | None:
    if el is None:
        return None
    node = el.find(path)
    if node is None or node.text is None:
        return None
    text = node.text.strip()
    return text or None


def _items(el, path: str) -> list:
    if el is None:
        return []
    return el.findall(path)


def _date(value: str | None) -> str | None:
    """YYYY-MM-DD from an ISO date or timestamp as published (no timezone shifting)."""
    if not value:
        return None
    m = re.match(r"^(\d{4}-\d{2}-\d{2})", value)
    return m.group(1) if m else None


def _person(item, *, cosponsor: bool = False) -> dict:
    p = {
        "bioguideId": _t(item, "bioguideId"),
        "fullName": _t(item, "fullName"),
        "firstName": _t(item, "firstName"),
        "middleName": _t(item, "middleName"),
        "lastName": _t(item, "lastName"),
        "party": _t(item, "party"),
        "state": _t(item, "state"),
        "district": _t(item, "district"),
    }
    if cosponsor:
        p["sponsorshipDate"] = _date(_t(item, "sponsorshipDate"))
        p["isOriginalCosponsor"] = _t(item, "isOriginalCosponsor")
        withdrawn = _t(item, "sponsorshipWithdrawnDate")
        if withdrawn:
            p["sponsorshipWithdrawnDate"] = _date(withdrawn)
    else:
        p["isByRequest"] = _t(item, "isByRequest")
        if p["isByRequest"] is None and _t(item, "byRequestType"):
            p["byRequestType"] = _t(item, "byRequestType")
    return {k: v for k, v in p.items() if v is not None}


def _activities(el) -> list[dict]:
    out = []
    for a in _items(el, "activities/item"):
        out.append({k: v for k, v in {"name": _t(a, "name"), "date": _t(a, "date")}.items() if v})
    return out


_BLOCK_TAGS = {"p", "li", "div", "ul", "ol", "table", "tr", "td", "th", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6", "dd", "dt"}


class _Blocks(HTMLParser):
    """Collect every text node; a block-level tag starts a new block. No text is ever dropped."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.blocks: list[dict] = []
        self.kind = "p"
        self.buf: list[str] = []

    def _flush(self) -> None:
        text = re.sub(r"\s+", " ", "".join(self.buf)).strip()
        if text:
            self.blocks.append({"k": self.kind, "x": text})
        self.buf = []

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag in _BLOCK_TAGS:
            self._flush()
            self.kind = "li" if tag == "li" else "h" if re.fullmatch(r"h[1-6]", tag) else "p"
        elif tag == "br":
            self.buf.append(" ")

    def handle_endtag(self, tag):
        if tag.lower() in _BLOCK_TAGS:
            self._flush()
            self.kind = "p"

    def handle_data(self, data):
        self.buf.append(data)

    def close(self):
        super().close()
        self._flush()


def summary_blocks(markup: str | None) -> list[dict]:
    """CRS summary HTML as published -> [{"k": "p"|"li"|"h", "x": text}]. Every word is kept; only tags are dropped."""
    if not markup:
        return []
    p = _Blocks()
    p.feed(markup)
    p.close()
    return p.blocks


def plain_words(markup: str | None) -> str:
    """The summary's words with all markup removed (used by tests and the verifier to prove no text was dropped)."""
    if not markup:
        return ""
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", markup))).strip()


def parse_bill(data: bytes) -> dict:
    root = ET.fromstring(data)
    bill = root.find("bill")
    if bill is None:
        raise ValueError("no <bill> element")
    # Schema 3.0.0 uses type/number; a few files still use the older layout (billType/billNumber, billCommittees,
    # billSubjects, billSummaries, bill-level recordedVotes). Both are read; the layout is recorded in "schema".
    btype = (_t(bill, "type") or _t(bill, "billType") or "").lower()
    out: dict = {
        "schema": _t(root, "version") or ("pre-3.0 (billType/billNumber)" if bill.find("billNumber") is not None else None),
        "congress": int(_t(bill, "congress") or 0),
        "type": btype,
        "number": _t(bill, "number") or _t(bill, "billNumber"),
        "originChamber": _t(bill, "originChamber"),
        "originChamberCode": _t(bill, "originChamberCode"),
        "introducedDate": _date(_t(bill, "introducedDate")),
        "updateDate": _t(bill, "updateDate"),
        "updateDateIncludingText": _t(bill, "updateDateIncludingText"),
        "legislationUrl": _t(bill, "legislationUrl"),
        "title": _t(bill, "title"),
        "policyArea": (_t(bill, "policyArea/name") or _t(bill, "subjects/policyArea/name")
                       or _t(bill, "subjects/billSubjects/policyArea/name")),
    }
    rights = None
    dc = root.find("dublinCore")
    if dc is not None:
        for child in dc:
            if child.tag.endswith("}rights") and child.text:
                rights = child.text.strip()
    out["rights"] = rights

    titles = []
    seen = set()
    for it in _items(bill, "titles/item"):
        t = {"type": _t(it, "titleType"), "code": _t(it, "titleTypeCode"), "title": _t(it, "title"),
             "chamber": _t(it, "chamberName"), "version": _t(it, "billTextVersionName"),
             "versionCode": _t(it, "billTextVersionCode")}
        key = (t["type"], t["title"])
        if not t["title"] or key in seen:
            continue
        seen.add(key)
        titles.append({k: v for k, v in t.items() if v})
    out["titles"] = titles

    out["sponsors"] = [_person(i) for i in _items(bill, "sponsors/item")]
    out["cosponsors"] = [_person(i, cosponsor=True) for i in _items(bill, "cosponsors/item")]

    committees = []
    for c in _items(bill, "committees/item") + _items(bill, "committees/billCommittees/item"):
        entry = {"systemCode": _t(c, "systemCode"), "name": _t(c, "name"), "chamber": _t(c, "chamber"), "type": _t(c, "type"),
                 "activities": _activities(c),
                 "subcommittees": [{k: v for k, v in {"systemCode": _t(s, "systemCode"), "name": _t(s, "name"),
                                                      "activities": _activities(s)}.items() if v}
                                   for s in _items(c, "subcommittees/item")]}
        committees.append({k: v for k, v in entry.items() if v})
    out["committees"] = committees

    out["subjects"] = [n for n in (_t(i, "name") for i in _items(bill, "subjects/legislativeSubjects/item")
                                   + _items(bill, "subjects/billSubjects/legislativeSubjects/item")) if n]

    la = bill.find("latestAction")
    out["latestAction"] = {k: v for k, v in {"actionDate": _date(_t(la, "actionDate")), "actionTime": _t(la, "actionTime"),
                                             "text": _t(la, "text")}.items() if v} if la is not None else None

    actions = []
    for a in _items(bill, "actions/item"):
        votes = []
        for v in _items(a, "recordedVotes/recordedVote"):
            votes.append({k: val for k, val in {"chamber": _t(v, "chamber"), "congress": _t(v, "congress"), "date": _t(v, "date"),
                                                "rollNumber": _t(v, "rollNumber"), "sessionNumber": _t(v, "sessionNumber"),
                                                "url": _t(v, "url")}.items() if val})
        act = {
            "date": _date(_t(a, "actionDate")),
            "time": _t(a, "actionTime"),
            "text": _t(a, "text"),
            "code": _t(a, "actionCode"),
            "type": _t(a, "type"),
            "source": _t(a, "sourceSystem/name"),
            "sourceCode": _t(a, "sourceSystem/code"),
            "calendar": _t(a, "calendarNumber/calendar"),
            "committees": [n for n in (_t(c, "name") for c in _items(a, "committees/item")) if n],
            "votes": votes,
        }
        actions.append({k: v for k, v in act.items() if v})
    out["actions"] = actions

    related = []
    for r in _items(bill, "relatedBills/item"):
        related.append({k: v for k, v in {
            "congress": _t(r, "congress"), "type": (_t(r, "type") or "").lower() or None, "number": _t(r, "number"),
            "title": _t(r, "title") or _t(r, "latestTitle"),
            "latestAction": {k2: v2 for k2, v2 in {"actionDate": _date(_t(r, "latestAction/actionDate")),
                                                    "text": _t(r, "latestAction/text")}.items() if v2} or None,
            "relationships": [{k3: v3 for k3, v3 in {"type": _t(d, "type"), "identifiedBy": _t(d, "identifiedBy")}.items() if v3}
                              for d in _items(r, "relationshipDetails/item")],
        }.items() if v})
    out["relatedBills"] = related

    cbo, seen_cbo = [], set()
    for c in _items(bill, "cboCostEstimates/item"):
        e = {k: v for k, v in {"pubDate": _t(c, "pubDate"), "title": _t(c, "title"), "url": _t(c, "url"),
                               "description": _t(c, "description")}.items() if v}
        key = tuple(sorted(e.items()))
        if key in seen_cbo:
            continue
        seen_cbo.add(key)
        cbo.append(e)
    out["cboCostEstimates"] = cbo

    out["committeeReports"] = [c for c in (_t(r, "citation") for r in _items(bill, "committeeReports/committeeReport")) if c]

    texts = []
    for tv in _items(bill, "textVersions/item"):
        formats = [{k: v for k, v in {"type": _t(f, "type"), "url": _t(f, "url")}.items() if v} for f in _items(tv, "formats/item")]
        texts.append({k: v for k, v in {"type": _t(tv, "type"), "date": _date(_t(tv, "date")),
                                        "formats": [f for f in formats if f.get("url")]}.items() if v})
    out["textVersions"] = texts

    out["laws"] = [{k: v for k, v in {"type": _t(i, "type"), "number": _t(i, "number")}.items() if v} for i in _items(bill, "laws/item")]

    summaries = []
    for s in _items(bill, "summaries/summary") + _items(bill, "summaries/billSummaries/item"):
        summaries.append({k: v for k, v in {"versionCode": _t(s, "versionCode"), "actionDate": _date(_t(s, "actionDate")),
                                            "actionDesc": _t(s, "actionDesc"), "updateDate": _t(s, "updateDate"),
                                            "text": (s.find("text").text if s.find("text") is not None else None)}.items() if v})
    out["summaryCount"] = len(summaries)
    out["summary"] = latest_summary(summaries)

    notes = []
    for n in _items(bill, "notes/item"):
        notes.append({k: v for k, v in {"text": _t(n, "text"),
                                        "links": [{k2: v2 for k2, v2 in {"name": _t(l, "name"), "url": _t(l, "url")}.items() if v2}
                                                  for l in _items(n, "links/link")]}.items() if v})
    out["notes"] = notes
    out["amendmentCount"] = len(_items(bill, "amendments/amendment"))
    # older layout: recorded votes listed once at bill level (with the action name), not inside each action
    out["billVotes"] = [{k: val for k, val in {"chamber": _t(v, "chamber"), "congress": _t(v, "congress"), "date": _t(v, "date"),
                                               "rollNumber": _t(v, "rollNumber"), "sessionNumber": _t(v, "sessionNumber"),
                                               "url": _t(v, "url"), "fullActionName": _t(v, "fullActionName")}.items() if val}
                        for v in _items(bill, "recordedVotes/recordedVote")]
    return out


def latest_summary(summaries: list[dict]) -> dict | None:
    """The latest CRS summary: greatest actionDate, then greatest updateDate, then highest versionCode."""
    usable = [s for s in summaries if s.get("text")]
    if not usable:
        return None
    best = max(usable, key=lambda s: (s.get("actionDate") or "", s.get("updateDate") or "", s.get("versionCode") or ""))
    return {"versionCode": best.get("versionCode"), "actionDesc": best.get("actionDesc"), "actionDate": best.get("actionDate"),
            "updateDate": best.get("updateDate"), "blocks": summary_blocks(best.get("text"))}
