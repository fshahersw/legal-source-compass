"""Build public_laws_enacted (every public law, public act and public resolution in the Statutes at Large 1789-2024,
plus public laws GovInfo publishes in PLAW after the last bound volume) and us_code_amendment_links (US Code unit <->
law) from parsed GovInfo and OLRC data.

  python3 -I -B scripts/enrichment/uscode/build_laws.py <release>

Inputs: private/build/uscode/laws/statute.jsonl.gz and plaw.jsonl.gz (statute_parse.py) and
private/build/uscode/parsed/<release>/ (parse_release.py). Outputs: private/build/uscode/public_laws_enacted.json.gz,
us_code_amendment_links.json.gz and link_report.json (counts of every resolved and unresolved citation by reason).

Link kinds (one row per unit-law pair; kinds and evidence list every way the pair is attested):
  source_credit    the law is cited in the unit's source credit (OLRC)
  amendment_note   the law is cited in the unit's "Amendments" note (OLRC)
  status_note      the law is cited in the heading of a repealed/omitted/transferred unit (OLRC)
  law_margin       the law's printed margin cites the unit (GPO Statutes at Large / slip law)
  law_margin_note  the law's margin cites the unit "note" (the provision is set out as a note under it)
  law_text         the law's own text cites the unit (outside quoted text it inserts elsewhere)
"""
import argparse
import datetime
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_uscode  # noqa: E402
import cite  # noqa: E402
import fetchlib  # noqa: E402
import lawindex  # noqa: E402
import parse_release  # noqa: E402
import statute_parse  # noqa: E402

MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
          "November", "December"]
CODE_KINDS = ("source_credit", "amendment_note", "status_note")
KIND_LABELS = {"source_credit": "Source credit", "amendment_note": "Amendments note", "status_note": "Status heading",
               "law_margin": "Law's margin note", "law_margin_note": "Law's margin note (set out as a note)",
               "law_text": "Cited in the law's text"}
PUBLIC_DOCS = {"pLaw", "resolution"}


def long_date(iso):
    if not iso:
        return None
    y, m, d = iso.split("-")
    return f"{MONTHS[int(m) - 1]} {int(d)}, {y}"


def law_kind(law):
    t = (law.get("type") or "").lower()
    if law["doc_tag"] == "resolution":
        return "Public resolution"
    if law.get("public_law"):
        return "Public law"
    if t == "chapter":
        return "Public act (chapter)"
    return "Public act"


def display_label(law):
    """How the Code's own source credits cite the measure: by act date and chapter before 1957, when Congress
    stopped numbering chapters, by public law number after."""
    pl = law.get("public_law")
    if law.get("chapter") is not None and law.get("enacted") and law["enacted"] < "1957":
        return f"Act of {long_date(law['enacted'])}, ch. {law['chapter']}"
    if pl:
        return f"Pub. L. {pl['congress']}–{pl['number']}"
    if law.get("chapter") is not None and law.get("enacted"):
        return f"Act of {long_date(law['enacted'])}, ch. {law['chapter']}"
    if law["doc_tag"] == "resolution":
        return f"{law.get('type') or 'Resolution'} {law.get('doc_number') or ''}".strip()
    return f"{law.get('type') or 'Act'} {law.get('doc_number') or ''}".strip()


def load_laws():
    """Public measures from STATUTE, then PLAW records not already in a bound volume; ids assigned here."""
    laws, taken = [], Counter()
    vol_doc = Counter()

    def assign(law, base):
        taken[base] += 1
        law["id"] = base if taken[base] == 1 else f"{base}-{taken[base]}"

    docs = list(statute_parse.read_laws("statute.jsonl.gz"))
    # Measures are printed one after another: a measure's pages run at most to the start page of the next measure
    # printed in the same volume file (any kind), which bounds its range where GovInfo's page markers are missing.
    for i, law in enumerate(docs):
        lo = law["stat"]["page"] if law.get("stat") else None
        nxt = next((d["stat"]["page"] for d in docs[i + 1:i + 40]
                    if d["file"] == law["file"] and d.get("stat") and d["stat"]["volume"] == (law["stat"] or {}).get("volume")),
                   None)
        his = [x for x in (law.get("last_page"), nxt) if x is not None and (lo is None or x >= lo)]
        law["page_hi"] = max(his) if his else None
    for law in docs:
        vol = int(law["file"].split("-")[1].split(".")[0])
        vol_doc[vol] += 1
        if law["public_private"] != "public" or law["doc_tag"] not in PUBLIC_DOCS:
            continue
        law["sources"] = [{"source": "statute", "url": law["url"]}]
        if law["stat"]:
            assign(law, f"stat-{law['stat']['volume']}-{law['stat']['page']}")
        else:
            assign(law, f"stat-{vol}-doc{vol_doc[vol]}")
        laws.append(law)
    by_pl = defaultdict(list)
    for law in laws:
        if law.get("public_law"):
            by_pl[(law["public_law"]["congress"], law["public_law"]["number"])].append(law)
    plaw_stats = Counter()
    for p in statute_parse.read_laws("plaw.jsonl.gz"):
        if p["public_private"] != "public" or not p.get("public_law"):
            plaw_stats["skipped"] += 1
            continue
        key = (p["public_law"]["congress"], p["public_law"]["number"])
        same = [x for x in by_pl.get(key, []) if p["stat"] and x["stat"] == p["stat"]]
        how = "public law number + Stat. page"
        if not same:
            # one of the two files lacks or misprints the page: same number and same enactment date, unique
            same = [x for x in by_pl.get(key, []) if p["enacted"] and x.get("enacted") == p["enacted"]]
            how = "public law number + enactment date"
        if len(same) == 1:
            x = same[0]
            x["sources"].append({"source": "plaw", "url": p["url"]})
            x["plaw"] = {"title": p["title"], "enacted": p["enacted"], "stat": p["stat"], "bill": p["bill"],
                         "matched_by": how}
            if not x.get("stat") and p["stat"]:
                x["stat"] = p["stat"]
                x["stat_from"] = "plaw"
            x["plaw_usc_refs"] = p["usc_refs"]
            plaw_stats["matched_statute"] += 1
            plaw_stats["matched_by:" + how] += 1
            continue
        if by_pl.get(key):
            plaw_stats["pl_in_statute_other_page"] += 1
        p["sources"] = [{"source": "plaw", "url": p["url"]}]
        if p["stat"]:
            assign(p, f"stat-{p['stat']['volume']}-{p['stat']['page']}")
        else:
            assign(p, f"pl-{key[0]}-{key[1]}")
        laws.append(p)
        by_pl[key].append(p)
        plaw_stats["added_from_plaw"] += 1
    shared = {k for k, v in by_pl.items() if len(v) > 1}
    for law in laws:
        pl = law.get("public_law")
        law["pl_shared"] = bool(pl and (pl["congress"], pl["number"]) in shared)
    return laws, plaw_stats, len(shared)


def govinfo_links(law):
    out = []
    if law.get("stat"):
        out.append({"label": f"{law['stat']['volume']} Stat. {law['stat']['page']} on GovInfo",
                    "url": f"https://www.govinfo.gov/link/statute/{law['stat']['volume']}/{law['stat']['page']}"})
    pl = law.get("public_law")
    if pl and pl["congress"] >= 104 and any(s["source"] == "plaw" for s in law["sources"]) or (
            pl and pl["congress"] >= 104 and not law.get("pl_shared")):
        out.append({"label": f"Public Law {pl['congress']}–{pl['number']} on GovInfo",
                    "url": f"https://www.govinfo.gov/link/plaw/{pl['congress']}/public/{pl['number']}"})
    return out


def law_row(law, linked_units):
    label = display_label(law)
    stat = lawindex.stat_label(law)
    links = govinfo_links(law)
    title = law.get("title") or "Title not recorded"
    facts = [["Law", label], ["Kind", law_kind(law)]]
    if law.get("public_law"):
        facts.append(["Public law number as printed", law["public_law"]["printed"]])
    if law.get("chapter") is not None:
        facts.append(["Chapter", law.get("doc_number") or str(law["chapter"])])
    facts.append(["Enacted", long_date(law.get("enacted")) or "Not recorded"])
    facts.append(["Statutes at Large", (stat or "Not recorded") + (" (from the slip law file)"
                                                                    if law.get("stat_from") == "plaw" else "")])
    pst = (law.get("plaw") or {}).get("stat")
    if pst and law.get("stat") and pst != law["stat"]:
        facts.append(["Slip law file cites", f"{pst['volume']} Stat. {pst['page']}"])
    facts.append(["Congress", str(law["congress"]) if law.get("congress") else "Not recorded"])
    if law.get("bill"):
        facts.append(["Bill", law["bill"]["printed"]])
    facts.append(["US Code units linked", str(linked_units)])
    detail_law = {
        "label": label, "kind": law_kind(law), "type": law.get("type"), "public_law": law.get("public_law"),
        "pl_shared": law["pl_shared"], "chapter": law.get("chapter"), "doc_number": law.get("doc_number"),
        "congress": law.get("congress"), "session": law.get("session"), "enacted": law.get("enacted"),
        "stat": law.get("stat"), "last_page": law.get("last_page"), "title": law.get("title"),
        "bill": law.get("bill"), "govinfo": links, "sources": law["sources"], "usc_refs": len(law["usc_refs"]),
        "code_units": linked_units,
    }
    year = (law.get("enacted") or "")[:4]
    row = {
        "dataset": "public_laws_enacted",
        "id": law["id"],
        "category": "public_laws_enacted",
        "state": "",
        "title": f"{label}: {title}"[:1000],
        "source_url": law["sources"][0]["url"],
        "item": {"id": law["id"], "title": label, "subtitle": title[:300],
                 "cells": {"law": label, "enacted": law.get("enacted") or "", "statutes": stat or "",
                           "congress": law.get("congress") or "", "code_units": linked_units},
                 "badges": [law_kind(law)]},
        "detail": {"title": f"{label}: {title}"[:1000], "facts": facts, "links": links, "law": detail_law},
        "text": " ".join(x for x in [label, stat or "", law.get("bill", {}) and law["bill"]["printed"] or ""] if x),
        "filters": {"_listing": ["yes"], "kind": [law_kind(law)],
                    "congress": [str(law["congress"])] if law.get("congress") else [],
                    "decade": [year[:3] + "0s"] if year else [],
                    "code_links": ["yes" if linked_units else "no"]},
    }
    return row


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("release")
    args = ap.parse_args()
    release = args.release
    laws, plaw_stats, shared_pl = load_laws()
    idx = lawindex.LawIndex(laws)
    units_by_title, cites, url_of = {}, {}, {}
    urls = build_uscode.official_urls(release)
    for f in sorted(parse_release.parsed_dir(release).glob("t*.jsonl.gz")):
        head, containers, units = parse_release.read_parsed(f)
        tkey = head["key"]
        units_by_title[tkey] = units
        for u in units:
            sid = f"{tkey}:{u['key']}"
            cites[sid] = cite.citation(tkey, u, build_uscode.group_heading(u, containers))
            url_of[sid] = build_uscode.unit_url(release, tkey, u, urls)[0]
    sec_index, dup_numbers = lawindex.section_index(units_by_title)

    pairs = {}
    report = Counter()
    unresolved_examples = defaultdict(list)

    def add(sid, law_id, kind, evidence):
        key = (sid, law_id)
        p = pairs.setdefault(key, {"kinds": set(), "evidence": []})
        p["kinds"].add(kind)
        ev = [kind, evidence]
        if ev not in p["evidence"] and len(p["evidence"]) < 4:
            p["evidence"].append(ev)

    for tkey, units in units_by_title.items():
        for u in units:
            sid = f"{tkey}:{u['key']}"
            for g in u["source_credit_groups"]:
                subs = lawindex.split_citation(g.get("items", []))
                if not subs:
                    report["source_credit:no_law_reference"] += 1   # e.g. "R.S. § 1979"
                    continue
                for sub in subs:
                    law_id, why = idx.resolve_group(sub["refs"], sub["dates"])
                    if law_id:
                        add(sid, law_id, "source_credit", g["text"])
                        report["source_credit:resolved"] += 1
                        report["method:" + why] += 1
                    else:
                        report["source_credit:" + why] += 1
                        if len(unresolved_examples["source_credit:" + why]) < 8:
                            unresolved_examples["source_credit:" + why].append(
                                [sid, g["text"], " ".join(t for _, t in sub["refs"])])
            if u["heading_refs"] and u["status"]:
                law_id, why = idx.resolve_group(u["heading_refs"], u.get("heading_dates", ()))
                if law_id:
                    add(sid, law_id, "status_note", u["heading"])
                    report["status_note:resolved"] += 1
                else:
                    report["status_note:" + why] += 1
            for n in u["notes"]:
                if n["topic"] != "amendments":
                    continue
                seen = set()
                for href, printed in n["refs"]:
                    if not href.startswith(("/us/pl/", "/us/act/")):
                        continue
                    base = lawindex.PL_REF.match(href) or lawindex.ACT_REF.match(href)
                    k = base.group(0).rstrip("/") if base else href
                    if k in seen:
                        continue
                    seen.add(k)
                    law_id, why = idx.resolve_group([[href, printed]])
                    if law_id:
                        add(sid, law_id, "amendment_note", printed)
                        report["amendment_note:resolved"] += 1
                    else:
                        report["amendment_note:" + why] += 1
                        if len(unresolved_examples["amendment_note:" + why]) < 8:
                            unresolved_examples["amendment_note:" + why].append([sid, printed])
    for law in laws:
        refs = list(law["usc_refs"]) + list(law.get("plaw_usc_refs", []))
        seen = set()
        for href, printed, where in refs:
            sid = lawindex.usc_target(href, sec_index)
            if where == "margin":
                kind = "law_margin_note" if (printed or "").rstrip(".").lower().endswith("note") else "law_margin"
            else:
                kind = "law_text"
            if not sid:
                report[f"{kind}:section_not_in_current_code"] += 1
                if len(unresolved_examples[f"{kind}:section_not_in_current_code"]) < 8:
                    unresolved_examples[f"{kind}:section_not_in_current_code"].append([law["id"], href, printed])
                continue
            if (sid, kind, printed) in seen:
                continue
            seen.add((sid, kind, printed))
            add(sid, law["id"], kind, printed)
            report[f"{kind}:resolved"] += 1

    linked_units = Counter(law_id for (_, law_id) in pairs)
    law_rows = [law_row(law, linked_units.get(law["id"], 0)) for law in laws]
    link_rows = []
    for (sid, law_id), p in sorted(pairs.items(), key=lambda kv: (kv[0][0], kv[0][1])):
        law = idx.laws[law_id]
        label = display_label(law)
        kinds = sorted(p["kinds"], key=lambda k: list(KIND_LABELS).index(k))
        tkey = sid.split(":", 1)[0]
        source = "both" if any(k in CODE_KINDS for k in kinds) and any(k not in CODE_KINDS for k in kinds) else (
            "code" if kinds[0] in CODE_KINDS else "law")
        link_rows.append({
            "dataset": "us_code_amendment_links",
            "id": f"{sid}|{law_id}",
            "category": "us_code_amendment_links",
            "state": "",
            "title": f"{cites[sid]} ← {label}",
            "source_url": law["sources"][0]["url"] if source == "law" else url_of[sid],
            "item": {"cells": {"section": cites[sid], "law": label,
                               "kinds": "; ".join(KIND_LABELS[k] for k in kinds)}},
            # evidence: up to two printed citations, each cut at 200 characters (the full text is in the source)
            "detail": {"link": {"section": sid, "law": law_id, "kinds": kinds,
                                "evidence": [[k, t[:200]] for k, t in p["evidence"][:2]]}},
            "text": "",
            "filters": {"section": [sid], "law": [law_id], "title": [tkey], "kind": kinds, "source": [source]},
        })
    inputs = [{"url": "https://www.govinfo.gov/bulkdata/STATUTE", "path": str(fetchlib.ACQ / "statute"),
               "sha256": "per file in private/acq/uscode/_manifest.jsonl"},
              {"url": "https://www.govinfo.gov/bulkdata/PLAW", "path": str(fetchlib.ACQ / "plaw"),
               "sha256": "per file in private/acq/uscode/_manifest.jsonl"}]
    kinds_count = Counter(k for r in link_rows for k in r["detail"]["link"]["kinds"])
    law_summary = {
        "source": "GovInfo bulk data (U.S. Government Publishing Office): United States Statutes at Large in USLM XML, "
                  "volumes 1-138 (1789-2024), https://www.govinfo.gov/bulkdata/STATUTE, and Public and Private Laws "
                  "in USLM XML, 113th-119th Congress, https://www.govinfo.gov/bulkdata/PLAW",
        "licence": "Public domain (17 U.S.C. 105, as stated in each file's dc:rights)",
        "scope": "Public laws, public acts (chapters) and public resolutions. Private laws, concurrent resolutions, "
                 "proclamations and treaties printed in the Statutes at Large are not included.",
        "records": len(law_rows),
        "plaw": dict(plaw_stats),
        "public_law_numbers_shared": shared_pl,
        "note": "Values are GovInfo's own metadata (dc:title, citableAs, approvedDate or dc:date, docNumber, "
                "congress); law text stays at GovInfo (link service URLs in detail.law.govinfo). Before 1957 public "
                "laws carried chapter numbers; a public law number shown for those years is the one GPO printed "
                "('Public, No. 244'). Some numbers appear on more than one measure in GovInfo's files "
                "(pl_shared = true); those are never used alone to link a Code section.",
    }
    link_summary = {
        "source": "Office of the Law Revision Counsel USLM XML release point " + release + " (source credits, Amendments "
                  "notes, status headings) and GovInfo USLM Statutes at Large / PLAW (margin notes and in-text US Code "
                  "citations)",
        "records": len(link_rows),
        "by_kind": dict(kinds_count),
        "resolution": "Exact keys only: public law number, act date + chapter, Statutes at Large volume/page (see "
                      "scripts/enrichment/uscode/lawindex.py). Unresolved citations are counted in link_report.json "
                      "and not linked.",
        "report": dict(sorted(report.items())),
    }
    ll = build_uscode.listing([("law", "Law"), ("enacted", "Enacted"), ("statutes", "Statutes at Large"),
                               ("congress", "Congress"), ("code_units", "US Code units")],
                              [("kind", "Kind", {k: (k, n) for k, n in Counter(r["filters"]["kind"][0] for r in law_rows).items()})])
    kl = build_uscode.listing([("section", "US Code unit"), ("law", "Law"), ("kinds", "Attested by")],
                              [("kind", "Attested by", {k: (KIND_LABELS[k], n) for k, n in kinds_count.items()})])
    n1 = build_uscode.write_build(fetchlib.BUILD / "public_laws_enacted.json.gz", "public_laws_enacted",
                                  "Public laws enacted (Statutes at Large and slip laws)", law_rows, ll, law_summary, inputs)
    n2 = build_uscode.write_build(fetchlib.BUILD / "us_code_amendment_links.json.gz", "us_code_amendment_links",
                                  "United States Code: amending and source laws", link_rows, kl, link_summary, inputs)
    (fetchlib.BUILD / "link_report.json").write_text(json.dumps({
        "built_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "report": dict(sorted(report.items())), "unresolved_examples": unresolved_examples,
        "duplicate_section_numbers": sorted(f"{t}:{s}" for t, s in dup_numbers), "plaw": dict(plaw_stats),
        "public_law_numbers_shared": shared_pl}, indent=1, ensure_ascii=False))
    print(json.dumps({"laws": len(law_rows), "links": len(link_rows), "laws_bytes": n1, "links_bytes": n2,
                      "by_kind": dict(kinds_count), "plaw": dict(plaw_stats), "shared_pl": shared_pl}))
    print(json.dumps(dict(sorted(report.items())), indent=0))


if __name__ == "__main__":
    main()
