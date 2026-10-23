"""Corpus rows for `gov_domains` and `gov_domains_summary` (shape: scripts/enrichment/corpus_writer.record).

Each `gov_domains` row carries two payloads the app reads:
  item.gov  the full structured record (both registries side by side, conflicts, lists)
  item.row  the compact list row the state and county pages show (domain, group, types, organization, city, states)
`detail.facts` is the readable version of the same facts for the generic record page.
"""
from __future__ import annotations

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
sys.path.insert(0, HERE)

import corpus_writer as cw  # noqa: E402
import gov_domains_lib as lib  # noqa: E402

# States, DC and Puerto Rico have /places pages; territories without a page get no state link.
PLACE_PAGES = frozenset(
    "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR".split()
)
STATE_LABELS = {code: name for name, code in lib.STATE_NAMES.items()}
CISA_VIEWER = "https://data.get.gov/?file=current-full.csv"
REGISTRY_LABEL = {"cisa": "CISA .gov registry", "gsa": "GSA government URLs"}


def state_name(code: str) -> str:
    return STATE_LABELS[code].title().replace(" Of ", " of ")


def raw_file_url(repo: str, commit: str, name: str) -> str:
    return f"https://raw.githubusercontent.com/{repo}/{commit}/{name}"


def blob_url(repo: str, commit: str, name: str) -> str:
    return f"https://github.com/{repo}/blob/{commit}/{name}"


def types_of(rec: dict) -> list[list[str]]:
    """[[registry, published type]] in registry order, each type exactly as published, distinct per registry."""
    out: list[list[str]] = []
    if rec["cisa"] and rec["cisa"]["type"]:
        out.append(["cisa", rec["cisa"]["type"]])
    if rec["gsa"]:
        seen: list[str] = []
        for r in rec["gsa"]["rows"]:
            if r["type"] and r["type"] not in seen:
                seen.append(r["type"])
        if not rec["gsa"]["rows"]:
            for rows in rec["gsa"]["views"].values():
                for r in rows:
                    if r["level_of_government"] and r["level_of_government"] not in seen:
                        seen.append(r["level_of_government"])
        out += [["gsa", t] for t in seen]
    return out


def gsa_link(rec: dict) -> str | None:
    """The address GSA recorded for the entry (first http(s) link among its rows), else None."""
    if not rec["gsa"]:
        return None
    for r in rec["gsa"]["rows"]:
        if r["link"]:
            return r["link"]
    for rows in rec["gsa"]["views"].values():
        for r in rows:
            if r["link"]:
                return r["link"]
    return None


def home_link(rec: dict) -> str | None:
    """Where the entry's own site is: GSA's recorded link when it gave one; otherwise the registered host itself (CISA
    lists registered names, which do not always serve a website)."""
    link = gsa_link(rec)
    if link:
        return link
    entry = rec["entry"]
    if entry["host_kind"] == "domain":
        return f"https://{entry['host']}/" + (entry["path"] + "/" if entry["path"] else "")
    return None


def gsa_note(rec: dict) -> str | None:
    """GSA's free-text note for the entry (comments minus the trailing "Note added" stamp), first non-empty among its rows."""
    if not rec["gsa"]:
        return None
    for r in rec["gsa"]["rows"]:
        if r["note"]:
            return r["note"]
    for rows in rec["gsa"]["views"].values():
        for r in rows:
            if r["note"]:
                return r["note"]
    return None


def compact_row(rec: dict) -> dict:
    entry = rec["entry"]
    return {
        "domain": entry["host"],
        "path": entry["path"],
        "group": rec["group"],
        "types": types_of(rec),
        "organization": rec["organization"],
        "city": rec["city"],
        "states": rec["states"],
        "registries": rec["registries"],
        "securityContact": rec["cisa"]["security_contact"] if rec["cisa"] else None,
        "link": home_link(rec),
        "note": gsa_note(rec),
        "notUsed": bool(rec["not_used"]),
        "conflict": bool(rec["conflicts"]),
    }


def source_url(rec: dict, meta: dict) -> str:
    if rec["cisa"]:
        return CISA_VIEWER
    g = meta["gsa"]
    name = "1_govt_urls_full.csv" if "gsa_full" in rec["lists"] else next(
        n for n, key in lib.GSA_LISTS.items() if key in rec["lists"]
    )
    return blob_url("GSA/govt-urls", g["commit"], name)


def facts_of(rec: dict, meta: dict) -> list[list[str]]:
    entry = rec["entry"]
    f: list[list[str]] = [["Entry", entry["id"]]]
    if entry["published_as"]:
        f.append(["Published as", entry["published_as"]])
    if entry["path"]:
        f.append(["Scope", f"Only pages under /{entry['path']} on {entry['host']} are listed, not the whole host"])
    f.append(["Listed by", "; ".join(REGISTRY_LABEL[r] for r in rec["registries"])])
    f.append(["Lists", "; ".join(lib.LIST_LABELS[k] for k in rec["lists"])])
    cisa = rec["cisa"]
    if cisa:
        f.append(["Domain type (CISA, as published)", cisa["type"] or "Not recorded"])
        f.append(["Organization (CISA)", cisa["organization"] or "Not recorded"])
        if cisa["suborganization"]:
            f.append(["Suborganization (CISA)", cisa["suborganization"]])
        f.append(["City (CISA)", cisa["city"] or "Not recorded"])
        f.append(["State (CISA)", cisa["state"] or (cisa["state_unresolved"] or "Not recorded")])
        f.append(["Security contact (CISA)", "Published by the registry (address not reproduced here)" if cisa["security_contact"] == "published" else "None on file"])
        if cisa["in_zone"] is not None:
            f.append([f"In the .gov zone file exported {meta['cisa']['zone_export']}", "Yes (delegated)" if cisa["in_zone"] else "No NS records in the zone file"])
    gsa = rec["gsa"]
    if gsa:
        for i, r in enumerate(gsa["rows"], 1):
            tag = f"GSA full list row {i}" if len(gsa["rows"]) > 1 else "GSA full list"
            f.append([f"Type of government ({tag})", r["type"] or "Not recorded"])
            for label, key in (("Agency", "agency"), ("Maintaining office", "maintaining_office"), ("Use case", "use_case"), ("Federal branch", "federal_branch")):
                if r[key]:
                    f.append([f"{label} ({tag})", r[key]])
            f.append([f"State ({tag}, as published)", r["state_as_published"] or "Not recorded"])
            if r["comments"]:
                f.append([f"Comments ({tag}, as published)", r["comments"]])
            if r["link"]:
                f.append([f"Link ({tag})", r["link"]])
            elif r["link_rejected"]:
                f.append([f"Link ({tag}, not an http(s) address)", r["link_rejected"]])
            if r["date_added"]:
                f.append([f"Date added ({tag})", r["date_added"]])
        for key, rows in gsa["views"].items():
            for r in rows:
                label = lib.LIST_LABELS[key].replace("GSA government URLs: ", "GSA ")
                f.append([f"Level of government ({label})", r["level_of_government"] or "Not recorded"])
                f.append([f"Location ({label}, as published)", r["location_as_published"] or "Not recorded"])
                f.append([f"Status ({label})", r["status"] or "Not recorded"])
    if rec["not_used"]:
        nu = rec["not_used"]
        f.append(["Also named in GSA's list of domains out of use", "; ".join(x for x in (nu["status"], nu["level_of_government"], nu["note"]) if x) or "No status given"])
    for c in rec["conflicts"]:
        if c["field"] == "state":
            f.append(["Registries disagree: state", f"CISA {c['cisa']}; GSA {', '.join(c['gsa'])}"])
        else:
            groups = [lib.GROUPS[g] for g in c["gsa"]]
            f.append(["Registries disagree: government level" if "cisa" in c else "GSA rows disagree: government level", (f"CISA {lib.GROUPS[c['cisa']]}; " if "cisa" in c else "") + f"GSA {', '.join(groups)}"])
    if rec["group"]:
        f.append(["Group (from the published type)", lib.GROUPS[rec["group"]]])
    if "cisa" in rec["registries"]:
        c = meta["cisa"]
        f.append(["CISA registry snapshot", f"zone file exported {c['zone_export']} UTC; commit {c['commit'][:7]}"])
    if "gsa" in rec["registries"]:
        g = meta["gsa"]
        f.append(["GSA list snapshot", f"commit {g['commit'][:7]} of {g['commit_date']}"])
    return f


def gov_row(rec: dict, meta: dict) -> dict:
    entry = rec["entry"]
    types = types_of(rec)
    type_cell = "; ".join(f"{t} ({REGISTRY_LABEL[r].split()[0]})" if len(types) > 1 else t for r, t in types) or "Not recorded"
    group_label = lib.GROUPS[rec["group"]] if rec["group"] else "Not recorded"
    state_cell = ", ".join(rec["states"]) if rec["states"] else "Not recorded"
    links = []
    if rec["state"] in PLACE_PAGES:
        links.append({"label": f"{state_name(rec['state'])} page", "url": f"/places/{rec['state']}"})
    home = home_link(rec)
    if home:
        links.append({"label": "Domain website", "url": home})
    cells = {
        "domain": entry["id"],
        "type": type_cell,
        "organization": rec["organization"] or "Not recorded",
        "city": rec["city"] or "Not recorded",
        "state": state_cell,
        "registry": ", ".join(r.upper() for r in rec["registries"]),
    }
    subtitle = " · ".join(x for x in (rec["organization"], group_label if rec["group"] else None) if x)
    badges = [REGISTRY_LABEL[r] for r in rec["registries"]] + (["Registries disagree"] if rec["conflicts"] else [])
    full = {
        "schema": "gov_domain.v1",
        "entry": entry["id"],
        "host": entry["host"],
        "path": entry["path"],
        "hostKind": entry["host_kind"],
        "tld": entry["tld"],
        "publishedAs": entry["published_as"],
        "registries": rec["registries"],
        "lists": rec["lists"],
        "group": rec["group"],
        "states": rec["states"],
        "organization": rec["organization"],
        "city": rec["city"],
        "cisa": rec["cisa"],
        "gsa": rec["gsa"],
        "notUsed": rec["not_used"],
        "conflicts": rec["conflicts"],
    }
    filters = {
        "registry": list(rec["registries"]),
        "group": [rec["group"]] if rec["group"] else [],
        "state": list(rec["states"]),
        "tld": [entry["tld"]] if entry["tld"] else [],
        "entry_kind": ["path" if entry["path"] else entry["host_kind"]],
        "host": [entry["host"]],
    }
    text = " ".join(x for x in [entry["id"], rec["organization"], rec["city"], type_cell, group_label, state_cell] if x and x != "Not recorded")
    row = cw.record(
        lib.DATASET,
        entry["id"],
        entry["id"],
        source_url=source_url(rec, meta),
        cells=cells,
        facts=facts_of(rec, meta),
        text=text,
        filters=filters,
        subtitle=subtitle,
        badges=badges,
        links=links,
        state=rec["state"] or "",
        extra={"gov": full, "row": compact_row(rec)},
    )
    return row


def listing_block(states: list[str]) -> dict:
    return cw.listing(
        [("domain", "Domain"), ("type", "Type (as published)"), ("organization", "Organization"), ("city", "City"), ("state", "State"), ("registry", "Registry")],
        filters=(
            ("registry", "Registry", {"cisa": REGISTRY_LABEL["cisa"], "gsa": REGISTRY_LABEL["gsa"]}),
            ("group", "Government level", dict(lib.GROUPS)),
            ("state", "State", {s: state_name(s) for s in sorted(states, key=state_name)}),
        ),
    )


def summary_rows(records: dict[str, dict], meta: dict) -> list[dict]:
    s = lib.summarize(records)
    source = meta["summary_source_url"]
    rows = []
    allp = {
        "schema": "gov_domains_summary.v1",
        "scope": "all",
        "total": s["records"],
        "registries": s["registries"],
        "lists": s["lists"],
        "groups": s["groups"],
        "cisaTypes": s["cisa_types"],
        "gsaTypes": s["gsa_types"],
        "withState": s["with_state"],
        "withoutState": s["without_state"],
        "conflicts": s["conflicts"],
        "pathEntries": s["path_entries"],
        "snapshot": {
            "cisa": {"zoneExport": meta["cisa"]["zone_export"], "commit": meta["cisa"]["commit"], "retrievedAt": meta["cisa"]["retrieved_at"]},
            "gsa": {"commit": meta["gsa"]["commit"], "commitDate": meta["gsa"]["commit_date"], "retrievedAt": meta["gsa"]["retrieved_at"]},
        },
    }
    facts = [
        ["Records", str(s["records"])],
        ["Listed by the CISA .gov registry", str(s["registries"]["cisa"])],
        ["Listed by the GSA government URLs list", str(s["registries"]["gsa"])],
        ["Listed by both", str(s["registries"]["both"])],
        ["With a publisher-given state", str(s["with_state"])],
        ["Without a state", str(s["without_state"])],
        ["Registries disagree", str(s["conflicts"])],
        ["CISA snapshot", f"zone file exported {meta['cisa']['zone_export']} UTC; commit {meta['cisa']['commit'][:7]}; retrieved {meta['cisa']['retrieved_at']}"],
        ["GSA snapshot", f"commit {meta['gsa']['commit'][:7]} ({meta['gsa']['commit_date']}); retrieved {meta['gsa']['retrieved_at']}"],
    ]
    rows.append(
        cw.record(
            lib.SUMMARY_DATASET, "all", "Registered government domains: all", source_url=source,
            cells={"scope": "All records", "total": str(s["records"]), "cisa": str(s["registries"]["cisa"]), "gsa": str(s["registries"]["gsa"])},
            facts=facts, text="registered government domains totals by type", filters={"scope": ["all"]},
            subtitle="Counts of the published records", extra={"summary": allp},
        )
    )
    for code in sorted(s["states"]):
        st = s["states"][code]
        payload = {"schema": "gov_domains_summary.v1", "scope": "state", "usps": code, "total": st["total"], "cisa": st["cisa"], "gsa": st["gsa"], "groups": st["groups"], "cisaTypes": st["cisa_types"]}
        sfacts = [["State", f"{state_name(code)} ({code})"], ["Records with this state", str(st["total"])], ["CISA .gov registry", str(st["cisa"])], ["GSA list", str(st["gsa"])]]
        sfacts += [[lib.GROUPS.get(g, "Group not recorded"), str(n)] for g, n in sorted(st["groups"].items())]
        rows.append(
            cw.record(
                lib.SUMMARY_DATASET, f"state-{code}", f"Registered government domains: {state_name(code)}", source_url=source,
                cells={"scope": state_name(code), "total": str(st["total"]), "cisa": str(st["cisa"]), "gsa": str(st["gsa"])},
                facts=sfacts, text=f"registered government domains {state_name(code)}", filters={"scope": ["state"], "state": [code]},
                subtitle="Records whose publisher-given state is this state", state=code,
                links=[{"label": f"{state_name(code)} page", "url": f"/places/{code}"}] if code in PLACE_PAGES else [],
                extra={"summary": payload},
            )
        )
    return rows


def summary_listing() -> dict:
    return cw.listing([("scope", "Scope"), ("total", "Records"), ("cisa", "CISA .gov registry"), ("gsa", "GSA list")])
