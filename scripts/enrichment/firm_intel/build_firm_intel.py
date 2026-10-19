"""Build firm_profiles, firm_network and firm_matter_overview from the matter registry's master-docket parties and counsel.

Basis: every counsel entry attached to a party on the MDL master dockets in `sw_matter_parties_v1` (CourtListener party records, read-only
extract in private/build/firm_intel/lookups/). One "appearance" is one counsel entry for one party. Firms are the firm strings on those
entries, merged only by firm_lib.firm_key's documented rules. Side comes from the represented party's type (firm_lib.party_side).

    python3 -I -B scripts/enrichment/firm_intel/build_firm_intel.py
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import sys
import time
from collections import Counter, defaultdict
from itertools import combinations

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "scripts", "enrichment"))
sys.path.insert(0, os.path.join(ROOT, "scripts", "enrichment", "courtlistener"))

import clb_common as cc  # noqa: E402
import corpus_writer as writer  # noqa: E402
import firm_lib as fl  # noqa: E402

LOOK = os.path.join(ROOT, "private", "build", "firm_intel", "lookups")
OUT = os.path.join(ROOT, "private", "build", "firm_intel")
SNAPSHOT = dt.date(2026, 10, 1)
SIDE_LABEL = {"plaintiff": "Plaintiff side", "defense": "Defense side", "other": "Other parties (movants, amici, special masters, objectors ...)"}


def rows_of(name):
    d = json.load(open(os.path.join(LOOK, name)))
    return d["rows"] if isinstance(d, dict) and "rows" in d else d


def slug(key: str) -> str:
    s = "-".join(key.split())
    return "firm:" + (s if len(s) <= 120 else s[:110] + "-" + hashlib.sha256(key.encode()).hexdigest()[:9])


def build():
    parties = rows_of("sw_matter_parties.json")
    matters = {int(r["cells"]["mdl_number"]): r for r in rows_of("sw_matters.json")}
    mdls = {str(r["mdl_number"]): r for r in rows_of("mdls.json")}
    apps = []  # one dict per counsel entry with a firm string: key, raw, mdl, docket, court, party, side, lead, phv, term, atty, pname
    gov = []  # government counsel entries, classed separately and never merged into firms
    excluded = Counter()
    for p in parties:
        if p.get("wh") == "true":
            excluded["counsel for a party whose name the source withholds"] += len(p.get("counsel") or [])
            continue
        side = fl.party_side(p.get("ptypes"))
        for c in p.get("counsel") or []:
            raw = (c.get("firm") or "").strip()
            if not raw:
                excluded["counsel entry without a firm string"] += 1
                continue
            if not fl.is_firm(raw):
                excluded["placeholder, not a firm (pro se; 'counsel not admitted to USDC-NJ bar'; unknown)"] += 1
                continue
            if fl.is_government(raw):
                excluded["government counsel (counted separately)"] += 1
                gov.append({"raw": raw, "mdl": int(p["mdl"]), "party": p["id"], "side": side})
                continue
            key = fl.firm_key(raw)
            if not key:
                excluded["firm string empty after normalisation"] += 1
                continue
            roles = set(c.get("roles") or [])
            apps.append({"key": key, "raw": raw, "mdl": int(p["mdl"]), "docket": p["dk"], "court": p.get("court"), "party": p["id"], "side": side,
                         "lead": "Lead attorney" in roles, "phv": "Pro hac vice" in roles, "term": bool(c.get("terminated")) or "Terminated" in roles,
                         "atty": c.get("native_attorney_id"), "pname": p.get("pname") or "", "ptypes": p.get("ptstr") or ""})
    return parties, matters, mdls, apps, gov, excluded


def mdl_year(mdls, mdl):
    r = mdls.get(str(mdl)) or {}
    y = (r.get("date_filed") or "")[:4]
    return int(y) if y.isdigit() else None


def main():
    t0 = time.time()
    parties, matters, mdls, apps, gov, excluded = build()
    built_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    src = "https://www.courtlistener.com/"
    raw_forms = defaultdict(Counter)
    by_firm = defaultdict(list)
    for a in apps:
        raw_forms[a["key"]][a["raw"]] += 1
        by_firm[a["key"]].append(a)
    display = {}
    for k, v in raw_forms.items():
        shown = Counter()
        for t, n in v.items():
            shown[fl.strip_office(t)] += n
        display[k] = sorted(shown.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]
    mdl_title = {m: (matters[m]["title"] if m in matters else (mdls.get(str(m)) or {}).get("title")) for m in {a["mdl"] for a in apps}}
    mdl_type = {m: (mdls.get(str(m)) or {}).get("litigation_type") for m in mdl_title}

    # ---- networks
    party_firms = defaultdict(set)
    docket_side_firms = defaultdict(lambda: defaultdict(set))
    firm_mdls_side = defaultdict(lambda: defaultdict(set))
    for a in apps:
        party_firms[a["party"]].add(a["key"])
        docket_side_firms[a["docket"]][a["side"]].add(a["key"])
        firm_mdls_side[a["key"]][a["side"]].add(a["mdl"])
    cocounsel = Counter()  # same party represented by both firms
    for fs in party_firms.values():
        for x, y in combinations(sorted(fs), 2):
            cocounsel[(x, y)] += 1
    opposing = Counter()  # plaintiff-side firm vs defense-side firm on the same master docket
    shared_mdl_opp = defaultdict(set)
    for dk, sides in docket_side_firms.items():
        m = next(a["mdl"] for a in apps if a["docket"] == dk)
        for x in sides.get("plaintiff", ()):
            for y in sides.get("defense", ()):
                opposing[(x, y)] += 1
                shared_mdl_opp[(x, y)].add(m)

    # ---- firm profiles
    rows_p = []
    profiles = {}
    for key, lst in by_firm.items():
        side = Counter(a["side"] for a in lst)
        mdl_set = sorted({a["mdl"] for a in lst})
        years = sorted(y for y in (mdl_year(mdls, m) for m in mdl_set) if y)
        per_mdl = []
        for m in mdl_set:
            sub = [a for a in lst if a["mdl"] == m]
            s = Counter(a["side"] for a in sub)
            per_mdl.append({"mdl": m, "title": mdl_title.get(m), "type": mdl_type.get(m), "year": mdl_year(mdls, m), "appearances": len(sub),
                            "parties": len({a["party"] for a in sub}), "side": s.most_common(1)[0][0], "lead": sum(a["lead"] for a in sub),
                            "attorneys": len({a["atty"] for a in sub if a["atty"]}),
                            "link": f"/records/sw_matters_v1/sw-matter:{m}" if m in matters else None})
        defense_parties = Counter(a["pname"] for a in lst if a["side"] == "defense" and a["pname"])
        co = sorted(((y if x == key else x, n) for (x, y), n in cocounsel.items() if key in (x, y)), key=lambda t: (-t[1], t[0]))[:10]
        opp_n, opp_m = Counter(), defaultdict(set)
        for (x, y), n in opposing.items():
            if key in (x, y) and x != y:
                other = y if x == key else x
                opp_n[other] += n
                opp_m[other] |= shared_mdl_opp[(x, y)]
        opp = sorted(opp_n.items(), key=lambda t: (-len(opp_m[t[0]]), -t[1], t[0]))[:10]
        main_side = side.most_common(1)[0][0]
        own = firm_mdls_side[key][main_side]
        comp = []
        for other, sides in firm_mdls_side.items():
            if other == key:
                continue
            shared = own & sides.get(main_side, set())
            if shared:
                union = own | sides.get(main_side, set())
                comp.append((other, len(shared), round(len(shared) / len(union), 3), sorted(shared)))
        comp.sort(key=lambda t: (-t[1], -t[2], t[0]))
        prof = {"key": key, "name": display[key], "raw_forms": [{"text": t, "n": n} for t, n in raw_forms[key].most_common(12)],
                "appearances": len(lst), "parties": len({a["party"] for a in lst}), "attorneys": len({a["atty"] for a in lst if a["atty"]}),
                "mdls": len(mdl_set), "main_side": main_side, "side_mix": {k: side.get(k, 0) for k in ("plaintiff", "defense", "other")},
                "lead_designations": sum(a["lead"] for a in lst), "pro_hac_vice": sum(a["phv"] for a in lst), "terminated": sum(a["term"] for a in lst),
                "first_mdl_year": years[0] if years else None, "last_mdl_year": years[-1] if years else None, "per_mdl": per_mdl,
                "litigation_types": [{"type": t, "mdls": n} for t, n in Counter(x["type"] or "Not recorded" for x in per_mdl).most_common()],
                "courts": [{"court_id": c, "appearances": n, "link": f"/courts/{c}"} for c, n in Counter(a["court"] for a in lst if a["court"]).most_common(6)],
                "defense_parties": [{"name": n, "appearances": c} for n, c in defense_parties.most_common(10)],
                "plaintiffs_represented": len({a["party"] for a in lst if a["side"] == "plaintiff"}),
                "cocounsel": [{"firm": display[f], "key": f, "shared_parties": n, "link": f"/records/firm_profiles/{slug(f)}"} for f, n in co],
                "opposing": [{"firm": display[f], "key": f, "dockets": n, "mdls": sorted(opp_m[f]), "link": f"/records/firm_profiles/{slug(f)}"} for f, n in opp],
                "same_side_overlap": [{"firm": display[f], "key": f, "shared_mdls": n, "jaccard": j, "mdl_list": ms[:12], "link": f"/records/firm_profiles/{slug(f)}"}
                                      for f, n, j, ms in comp[:10]]}
        profiles[key] = prof
    ranked = sorted(profiles.values(), key=lambda p: (-p["appearances"], p["key"]))
    for rank, p in enumerate(ranked, 1):
        p["rank_by_appearances"] = rank
        rows_p.append(writer.record(
            "firm_profiles", slug(p["key"]), f"{p['name']}: appearances on MDL master dockets", source_url=src,
            subtitle=f"{p['appearances']:,} appearances · {p['parties']:,} parties · {p['mdls']} MDLs · {SIDE_LABEL[p['main_side']].split(' (')[0].lower()}",
            cells={"firm": p["name"], "side": p["main_side"], "mdls": p["mdls"], "appearances": p["appearances"], "parties": p["parties"],
                   "attorneys": p["attorneys"], "lead": p["lead_designations"], "first_mdl_year": p["first_mdl_year"], "last_mdl_year": p["last_mdl_year"], "rank": rank},
            badges=["Matter registry", SIDE_LABEL[p["main_side"]].split(" (")[0]],
            facts=[[k, "Not recorded" if v is None else str(v)] for k, v in [
                ("Firm (most frequent spelling)", p["name"]), ("Spellings merged", "; ".join(f"{x['text']} ({x['n']})" for x in p["raw_forms"][:6])),
                ("Appearances (counsel entries for a party on a master docket)", f"{p['appearances']:,}"), ("Parties represented", f"{p['parties']:,}"),
                ("Plaintiff / defense / other appearances", " / ".join(f"{p['side_mix'][k]:,}" for k in ("plaintiff", "defense", "other"))),
                ("MDLs", ", ".join(str(x["mdl"]) for x in p["per_mdl"])),
                ("Lead attorney designations", f"{p['lead_designations']:,} (CM/ECF role for a party; not court-appointed leadership)"),
                ("MDL years on record", f"{p['first_mdl_year']}–{p['last_mdl_year']}" if p["first_mdl_year"] else None),
                ("Counting", "One appearance is one counsel entry for one party on an MDL master docket in the matter registry; member dockets are not included. Firm spellings are merged only by documented rules (case, punctuation and hyphens, & and +, entity forms, 'attorneys at law', office suffix, 'law offices of').")]],
            text=f"law firm {p['name']} " + " ".join(x["text"] for x in p["raw_forms"][:6]), filters={"side": [p["main_side"]], "mdl": [str(x["mdl"]) for x in p["per_mdl"]]},
            links=[x for x in (({"label": f"MDL {m['mdl']} matter", "url": m["link"]} if m["link"] else None) for m in p["per_mdl"][:6]) if x],
            extra={"profile": p}))

    # ---- network edges
    rows_n = []
    for (x, y), n in sorted(cocounsel.items(), key=lambda kv: (-kv[1], kv[0])):
        if n < 3:
            continue
        rows_n.append(writer.record(
            "firm_network", f"co:{slug(x)[5:]}~{slug(y)[5:]}"[:240], f"{display[x]} and {display[y]}: co-counsel", source_url=src,
            subtitle=f"{n:,} parties represented by both firms", cells={"kind": "co-counsel", "firm_a": display[x], "firm_b": display[y], "weight": n},
            badges=["Matter registry", "Co-counsel"], facts=[["Firms", f"{display[x]}; {display[y]}"], ["Parties represented by both", f"{n:,}"],
                                                             ["Counting", "A party counts once when both firms have a counsel entry for it on an MDL master docket."]],
            text=f"co-counsel {display[x]} {display[y]}", filters={"kind": ["co-counsel"]},
            links=[{"label": display[x], "url": f"/records/firm_profiles/{slug(x)}"}, {"label": display[y], "url": f"/records/firm_profiles/{slug(y)}"}],
            extra={"profile": {"kind": "co-counsel", "a": x, "b": y, "weight": n}}))
    for (x, y), n in sorted(opposing.items(), key=lambda kv: (-len(shared_mdl_opp[kv[0]]), -kv[1], kv[0])):
        ms = sorted(shared_mdl_opp[(x, y)])
        if len(ms) < 2 or x == y:
            continue
        rows_n.append(writer.record(
            "firm_network", f"opp:{slug(x)[5:]}~{slug(y)[5:]}"[:240], f"{display[x]} (plaintiff side) opposite {display[y]} (defense side)", source_url=src,
            subtitle=f"{len(ms)} MDL master docket{'s' if len(ms) != 1 else ''} with both firms on opposite sides", cells={"kind": "opposing", "firm_a": display[x], "firm_b": display[y], "weight": len(ms)},
            badges=["Matter registry", "Opposing counsel"], facts=[["Plaintiff-side firm", display[x]], ["Defense-side firm", display[y]], ["MDLs", ", ".join(str(m) for m in ms)],
                                                                   ["Counting", "Both firms have counsel entries on the same MDL master docket, one for a plaintiff-side party and one for a defense-side party."]],
            text=f"opposing counsel {display[x]} {display[y]}", filters={"kind": ["opposing"]},
            links=[{"label": display[x], "url": f"/records/firm_profiles/{slug(x)}"}, {"label": display[y], "url": f"/records/firm_profiles/{slug(y)}"}],
            extra={"profile": {"kind": "opposing", "plaintiff_firm": x, "defense_firm": y, "mdls": ms}}))

    # ---- per-MDL landscape, concentration, overview, correlations
    rows_o = []
    mdl_stats = {}
    for m in sorted({a["mdl"] for a in apps}):
        sub = [a for a in apps if a["mdl"] == m]
        out = {}
        for s in ("plaintiff", "defense"):
            c = Counter(a["key"] for a in sub if a["side"] == s)
            tot = sum(c.values())
            top = c.most_common()
            hhi = round(sum((100.0 * n / tot) ** 2 for _, n in top), 1) if tot else None
            out[s] = {"firms": len(c), "appearances": tot, "hhi": hhi,
                      "top1_pct": cc.share(sum(n for _, n in top[:1]), tot), "top3_pct": cc.share(sum(n for _, n in top[:3]), tot),
                      "top5_pct": cc.share(sum(n for _, n in top[:5]), tot),
                      "top": [{"firm": display[k], "key": k, "appearances": n, "share_pct": cc.share(n, tot), "link": f"/records/firm_profiles/{slug(k)}"} for k, n in top[:10]]}
        lead = Counter(a["key"] for a in sub if a["lead"] and a["side"] == "plaintiff")
        mt = matters.get(m, {}).get("cells", {})
        y = mdl_year(mdls, m)
        mdl_stats[m] = {"plaintiff_firms": out["plaintiff"]["firms"], "defense_firms": out["defense"]["firms"], "hhi_plaintiff": out["plaintiff"]["hhi"],
                        "jpml_total": mt.get("jpml_total"), "registry_members": mt.get("registry_members"), "age_years": (SNAPSHOT.year - y) if y else None,
                        "plaintiff_parties": len({a["party"] for a in sub if a["side"] == "plaintiff"})}
        rows_o.append(writer.record(
            "firm_matter_overview", f"mdl:{m}", f"MDL {m}: law-firm landscape on the master docket", source_url=src,
            subtitle=f"{out['plaintiff']['firms']} plaintiff-side and {out['defense']['firms']} defense-side firms · top 5 plaintiff-side firms hold {out['plaintiff']['top5_pct']}% of plaintiff-side appearances",
            cells={"kind": "mdl", "mdl": m, "title": mdl_title.get(m), "plaintiff_firms": out["plaintiff"]["firms"], "defense_firms": out["defense"]["firms"],
                   "hhi_plaintiff": out["plaintiff"]["hhi"], "top5_plaintiff_pct": out["plaintiff"]["top5_pct"]},
            badges=["Matter registry", "Master docket"],
            facts=[[k, "Not recorded" if v is None else str(v)] for k, v in [
                ("MDL", f"{m} · {mdl_title.get(m)}"), ("Plaintiff-side firms / appearances", f"{out['plaintiff']['firms']:,} / {out['plaintiff']['appearances']:,}"),
                ("Defense-side firms / appearances", f"{out['defense']['firms']:,} / {out['defense']['appearances']:,}"),
                ("Plaintiff-side concentration (HHI of appearance shares, 0–10,000)", out["plaintiff"]["hhi"]),
                ("Top 1 / 3 / 5 plaintiff-side firms' share of plaintiff-side appearances", f"{out['plaintiff']['top1_pct']}% / {out['plaintiff']['top3_pct']}% / {out['plaintiff']['top5_pct']}%"),
                ("Most lead-attorney designations (plaintiff side)", "; ".join(f"{display[k]} {n}" for k, n in lead.most_common(5)) or None),
                ("Counting", "Appearances are counsel entries for parties on this MDL's master docket in the matter registry, not member dockets; concentration describes those entries, not market share.")]],
            text=f"mdl {m} law firms {mdl_title.get(m)}", filters={"kind": ["mdl"]},
            links=[x for x in ({"label": "Matter", "url": f"/records/sw_matters_v1/sw-matter:{m}"} if m in matters else None,) if x],
            extra={"profile": {"mdl": m, "title": mdl_title.get(m), "type": mdl_type.get(m), "year": y, "plaintiff": out["plaintiff"], "defense": out["defense"],
                               "lead_plaintiff": [{"firm": display[k], "key": k, "designations": n} for k, n in lead.most_common(10)], "stats": mdl_stats[m]}}))
    pairs = [("plaintiff_firms", "jpml_total", "Plaintiff-side firms vs JPML total actions"), ("plaintiff_firms", "registry_members", "Plaintiff-side firms vs member dockets in the registry"),
             ("hhi_plaintiff", "age_years", "Plaintiff-side concentration (HHI) vs MDL age in years"), ("hhi_plaintiff", "jpml_total", "Plaintiff-side concentration (HHI) vs JPML total actions"),
             ("defense_firms", "plaintiff_firms", "Defense-side firms vs plaintiff-side firms"), ("plaintiff_parties", "plaintiff_firms", "Plaintiff parties on the master docket vs plaintiff-side firms")]
    for a_key, b_key, label in pairs:
        ms = sorted(mdl_stats)
        xs = [mdl_stats[m][a_key] for m in ms]
        ys = [mdl_stats[m][b_key] for m in ms]
        rho, n = cc.spearman(xs, ys)
        ci = cc.fisher_ci(rho, n) if rho is not None else None
        rows_o.append(writer.record(
            "firm_matter_overview", f"corr:{a_key}~{b_key}", f"{label} (Spearman, across MDLs)", source_url=src,
            subtitle=(f"rho {rho:+.2f} · 95% interval {ci[0]:+.2f} to {ci[1]:+.2f} · n = {n} MDLs · {cc.strength(rho)}" if rho is not None and ci else f"n = {n}; too few MDLs"),
            cells={"kind": "correlation", "title": label, "rho": round(rho, 3) if rho is not None else None, "n": n},
            badges=["Association, not cause"],
            facts=[["Measure", label], ["Spearman rho", f"{rho:+.3f}" if rho is not None else "Not recorded"], ["95% interval (Fisher z)", f"{ci[0]:+.3f} to {ci[1]:+.3f}" if ci else "Not recorded"],
                   ["MDLs", str(n)], ["Reading", "Association across MDLs in the matter registry; it does not show that one causes the other, and the registry holds a selection of MDLs, not all of them."]],
            text=f"correlation {label}", filters={"kind": ["correlation"]}, links=[],
            extra={"profile": {"a": a_key, "b": b_key, "label": label, "rho": rho, "n": n, "ci": list(ci) if ci else None, "strength": cc.strength(rho) if rho is not None else None,
                               "points": [{"mdl": m, "x": mdl_stats[m][a_key], "y": mdl_stats[m][b_key]} for m in ms if mdl_stats[m][a_key] is not None and mdl_stats[m][b_key] is not None]}}))
    side_firms = Counter(p["main_side"] for p in profiles.values())
    gov_strings = Counter(g["raw"] for g in gov)
    gov_mdls = sorted({g["mdl"] for g in gov})
    multi = sum(1 for p in profiles.values() if p["mdls"] >= 2)
    rows_o.append(writer.record(
        "firm_matter_overview", "overview:all", "Law firms on MDL master dockets: overview", source_url=src,
        subtitle=f"{len(profiles):,} firms · {len(apps):,} appearances · {len({a['mdl'] for a in apps})} MDLs · {multi:,} firms in two or more MDLs",
        cells={"kind": "overview", "firms": len(profiles), "appearances": len(apps), "mdls": len({a["mdl"] for a in apps})},
        badges=["Matter registry"],
        facts=[[k, str(v)] for k, v in [
            ("Firms (after merging spellings)", f"{len(profiles):,} from {sum(len(v) for v in raw_forms.values()):,} distinct spellings"),
            ("Appearances counted", f"{len(apps):,}"), ("Firms by main side", "; ".join(f"{SIDE_LABEL[k].split(' (')[0]} {v:,}" for k, v in side_firms.most_common())),
            ("Firms in two or more MDLs", f"{multi:,}"), ("Counsel entries left out", "; ".join(f"{k}: {v:,}" for k, v in excluded.most_common(8))),
            ("Government counsel (attorneys general, departments of justice, U.S. and county attorneys)", f"{len(gov):,} entries, {len(gov_strings):,} distinct office names, {len(gov_mdls)} MDLs; shown as written, not merged"),
            ("Counting", "Master-docket party and counsel records of the matter registry (CourtListener party data captured for the registry's MDLs). Member dockets and attorneys without a firm line are not counted.")]],
        text="law firms overview mdl", filters={"kind": ["overview"]}, links=[],
        extra={"profile": {"firms": len(profiles), "appearances": len(apps), "mdls": len({a["mdl"] for a in apps}), "side_firms": dict(side_firms), "multi_mdl_firms": multi,
                           "excluded": dict(excluded), "government": {"entries": len(gov), "offices": [{"name": t, "entries": n} for t, n in gov_strings.most_common(40)], "mdls": gov_mdls},
                           "top": [{"firm": p["name"], "key": p["key"], "appearances": p["appearances"], "mdls": p["mdls"], "side": p["main_side"],
                                                                "link": f"/records/firm_profiles/{slug(p['key'])}"} for p in ranked[:40]]}}))
    inputs = [{"url": f"corpus:{ds}", "path": f"private/build/firm_intel/lookups/{name}", "sha256": hashlib.sha256(open(os.path.join(LOOK, name), "rb").read()).hexdigest()}
              for ds, name in (("sw_matter_parties_v1", "sw_matter_parties.json"), ("sw_matters_v1", "sw_matters.json"), ("mdls", "mdls.json"))]
    common_summary = {"source": "Matter registry master-docket parties and counsel (sw_matter_parties_v1, CourtListener party records) with MDL metadata (sw_matters_v1, mdls)",
                      "definitions": {"appearance": "one counsel entry for one party on an MDL master docket", "firm": "the firm string on the counsel entry, merged only by documented rules",
                                      "side": "the represented party's type: plaintiff (plaintiff, consolidated plaintiff, intervenor plaintiff, petitioner, claimant), defense (defendant, respondent, third-party defendant), other",
                                      "same-side overlap": "firms on the same side in the same MDLs; it measures overlap, not rivalry",
                                      "co-counsel": "both firms have a counsel entry for the same party", "opposing": "one firm for a plaintiff-side party and the other for a defense-side party on the same master docket",
                                      "lead attorney": "the CM/ECF 'Lead attorney' role for a party, not court-appointed leadership",
                                      "first/last MDL year": "the filing years of the MDLs the firm appears in, not the firm's founding or history"},
                      "caveats": ["Only the registry's MDL master dockets are covered (26 dockets with party records); member dockets are not.", "Firm strings with typos are not merged with the correct spelling.",
                                  "Plaintiff parties are counted, not named, in firm profiles; party names remain in the source dataset."],
                      "merge_rules": "case; punctuation and hyphens; & and + as 'and'; trailing entity forms (LLP, LLC, PC, PA, PLLC, PLC, Ltd, LPA, APLC ...); 'attorneys at law'; trailing ' - Office' segment; leading 'Law Offices of' / 'The'"}
    specs = {
        "firm_profiles": {"label": "Law firms on MDL master dockets: profiles, sides, co-counsel and opposing counsel (matter registry)", "rows": rows_p,
                          "listing": writer.listing([("rank", "Rank"), ("firm", "Firm"), ("side", "Main side"), ("mdls", "MDLs"), ("appearances", "Appearances"), ("parties", "Parties"),
                                                     ("attorneys", "Attorneys"), ("lead", "Lead designations"), ("first_mdl_year", "First MDL year"), ("last_mdl_year", "Last MDL year")],
                                                    [("side", "Main side", {"plaintiff": "Plaintiff side", "defense": "Defense side", "other": "Other"})])},
        "firm_network": {"label": "Law-firm network on MDL master dockets: co-counsel and opposing-counsel pairs (matter registry)", "rows": rows_n,
                         "listing": writer.listing([("kind", "Type"), ("firm_a", "Firm"), ("firm_b", "Other firm"), ("weight", "Weight")],
                                                   [("kind", "Type", {"co-counsel": "Co-counsel", "opposing": "Opposing counsel"})])},
        "firm_matter_overview": {"label": "Law-firm landscape per MDL: firms by side, concentration and associations (matter registry)", "rows": rows_o,
                                 "listing": writer.listing([("kind", "Type"), ("mdl", "MDL"), ("title", "Title"), ("plaintiff_firms", "Plaintiff-side firms"), ("defense_firms", "Defense-side firms"),
                                                            ("hhi_plaintiff", "Plaintiff-side HHI"), ("top5_plaintiff_pct", "Top-5 share %"), ("rho", "rho"), ("n", "n")],
                                                           [("kind", "Type", {"mdl": "MDL", "correlation": "Association", "overview": "Overview"})])},
    }
    os.makedirs(OUT, exist_ok=True)
    for ds, s in specs.items():
        spec = {"dataset": ds, "label": s["label"], "listing_block": s["listing"], "summary": {**common_summary, "grain": ds, "totals": {"records": len(s["rows"])}},
                "rows": s["rows"], "built_at": built_at, "inputs": inputs}
        path = os.path.join(OUT, ds + ".json")
        with open(path + ".tmp", "w") as h:
            json.dump(spec, h, ensure_ascii=False, sort_keys=True, default=str)
        os.replace(path + ".tmp", path)
        print(ds, len(s["rows"]), "rows", os.path.getsize(path) // 1024, "KB")
    merges = [{"key": k, "forms": [{"text": t, "n": n} for t, n in v.most_common()]} for k, v in raw_forms.items() if len(v) > 1]
    with open(os.path.join(OUT, "merge_table.json"), "w") as h:
        json.dump(sorted(merges, key=lambda m: -sum(f["n"] for f in m["forms"])), h, indent=1, ensure_ascii=False)
    print("firms", len(profiles), "appearances", len(apps), "merged keys", len(merges), "excluded", sum(excluded.values()), f"{time.time() - t0:.1f}s")
    for p in ranked[:20]:
        print(f"  {p['rank_by_appearances']:>3} {p['name'][:45]:45s} app={p['appearances']:>5} mdls={p['mdls']:>2} side={p['side_mix']}")


if __name__ == "__main__":
    main()
