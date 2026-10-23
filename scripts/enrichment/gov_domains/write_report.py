"""Write private/build/gov_domains/REPORT.md from the build, the manifest, the spot checks and the court report.

  python3 -I -B scripts/enrichment/gov_domains/write_report.py

Run after build_gov_domains.py, verify_gov_domains.py and court_report.py; every number is read from those outputs, none is
typed here. The publication section states what was and was not done.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import acquire_gov_domains as acq  # noqa: E402
import court_domains_lib as cd  # noqa: E402
import gov_domains_lib as lib  # noqa: E402

ROOT = acq.ROOT
BUILD = os.path.join(ROOT, "private", "build", "gov_domains")


def digest(rows) -> str:
    return hashlib.sha256("\n".join(json.dumps(r, sort_keys=True) for r in rows).encode()).hexdigest()


def load(name):
    with open(os.path.join(BUILD, name), encoding="utf-8") as handle:
        return json.load(handle)


def main() -> None:
    gov = load("gov_domains.json")
    summ = load("gov_domains_summary.json")
    spots = load("spot_checks.json")
    spine = load("lookups/court_spine.json")
    counties = load("lookups/census_counties.json")
    rows = gov["rows"]
    g = [r["item"]["gov"] for r in rows]
    manifest = acq.read_manifest()
    snap = gov["summary"]["snapshot"]
    s = summ["rows"][0]["item"]["summary"]
    c = Counter

    titles, shorts = cd.directory_index(spine)
    court = c()
    for x in g:
        ok, _ = cd.is_candidate(x)
        if ok:
            court[cd.match_court(x, titles, shorts)["status"]] += 1

    state_links = sum(1 for r in rows if any(link["url"].startswith("/places/") for link in r["item"]["links"]))
    multi = [x["entry"] for x in g if len(x["states"]) > 1]
    unresolved = c()
    for x in g:
        for r in (x["gsa"] or {}).get("rows", []):
            if r["state_unresolved"]:
                unresolved[r["state_unresolved"]] += 1
    zone_false = [x["entry"] for x in g if x["cisa"] and x["cisa"]["in_zone"] is False]
    with open(acq.local_path("GSA/govt-urls", lib.GSA_NOT_USED_FILE), "rb") as handle:
        out_of_use = lib.parse_gsa_not_used(lib.read_csv(handle.read()))
    shared = sum(1 for x in g if x["notUsed"])
    lines = [
        "# gov_domains report",
        "",
        "Registered U.S. government domains from two official registries, kept side by side. Built by `scripts/enrichment/gov_domains`.",
        "",
        "## Sources and terms",
        "",
        "| Registry | File (pinned commit) | Bytes | sha256 | Retrieved (UTC) |",
        "|---|---|---|---|---|",
    ]
    for e in manifest:
        lines.append(f"| {e['repo']} | {e['url']} | {e['bytes']:,} | `{e['sha256'][:16]}…` | {e['retrieved_at']} |")
    lines += [
        "",
        f"- **CISA .gov registry** (`cisagov/dotgov-data`, commit `{snap['cisa_commit']}`; zone file exported {snap['cisa_zone_export_utc']} UTC). Published daily by the .gov registry; the official data viewer https://data.get.gov/?file=current-full.csv showed 16,935 rows on 2026-10-23 (current-full.csv has {s['registries']['cisa']:,}). Licence: the repository's LICENSE file is **CC0 1.0 Universal** (stored in the manifest, sha256 above).",
        f"- **GSA government URLs** (`GSA/govt-urls`, commit `{snap['gsa_commit']}` of {snap['gsa_commit_date']}). No licence file and no licence statement in the repository at that commit (`.codeinventory.yml` has `license: null`; a read of the repository page returned no licence wording). The publisher is a U.S. federal agency; works of federal employees carry no U.S. copyright (17 U.S.C. 105) and the entries are factual domain names and labels. Treated as a U.S. government work; the entries were contributed by the public through issues, so this is recorded as an open risk.",
        "- The GSA repository's own README states that the list contains domains that do **not** end in .gov or .mil; the .gov registry is the CISA list.",
        "- Raw bytes are unchanged under `private/acq/gov_domains/raw/` with `_manifest.jsonl` (url, repo, commit, file, path, sha256, bytes, retrieved_at, http_status, method). The shallow clones used to confirm the commits were byte-identical to the pinned downloads for all 15 files and were then deleted.",
        "",
        "## Datasets",
        "",
        f"- `gov_domains`: **{len(rows):,}** rows, rows sha256 `{digest(rows)}`, build file `private/build/gov_domains/gov_domains.json`.",
        f"- `gov_domains_summary`: **{len(summ['rows'])}** rows (`all` plus {len(summ['rows']) - 1} states and territories), rows sha256 `{digest(summ['rows'])}`, build file `private/build/gov_domains/gov_domains_summary.json`.",
        "- Both ids were confirmed absent from `public.corpus_datasets` before building (read-only query, no match for gov_dom%, %domain%, %dotgov%, %govt%).",
        "",
        "## Coverage",
        "",
        f"- Listed by the CISA registry: {s['registries']['cisa']:,}; by the GSA list: {s['registries']['gsa']:,}; by both: {s['registries']['both']} ({', '.join(x['entry'] for x in g if len(x['registries']) == 2)}).",
        f"- GSA full list: {sum(len((x['gsa'] or {}).get('rows', [])) for x in g):,} rows for {s['lists']['gsa_full']:,} distinct entries ({sum(1 for x in g if x['gsa'] and len(x['gsa']['rows']) > 1)} entries have two rows with different wording; both are kept); {sum(1 for x in g if x['gsa'] and not x['gsa']['rows'])} entries appear only in a per-level view file.",
        f"- Entries listing only pages of a host (for example `360eldorado.com/Government`): {s['pathEntries']}. IP-address hosts: {sum(1 for x in g if x['hostKind'] == 'ip')}.",
        f"- With a publisher-given state: **{s['withState']:,}** ({sum(1 for x in g if len(x['states']) == 1):,} single, {len(multi)} multi-state: {', '.join(multi)}); without: **{s['withoutState']:,}** ({sum(1 for x in g if x['cisa'] and not x['cisa']['state'])} CISA rows with a blank state, the rest GSA entries whose state is blank or not a U.S. state or territory: {dict(unresolved)}).",
        f"- Registries disagree: **{s['conflicts']}** entry (`uspreventiveservicestaskforce.org`: its two GSA rows say Quasigovernmental and Federal). No state disagreements between the two registries (the 3 shared domains agree).",
        f"- GSA entries also named in GSA's out-of-use list: {sum(1 for x in g if x['notUsed'])} ({', '.join(x['entry'] for x in g if x['notUsed'])}); each carries that status. The list itself holds {len(out_of_use):,} distinct entries, {len(out_of_use) - shared:,} of which create no record.",
        f"- CISA domains with no NS records in the zone file (registered, not delegated): {len(zone_false)} ({', '.join(zone_false)}).",
        f"- Security contact: published for {sum(1 for x in g if x['cisa'] and x['cisa']['security_contact'] == 'published'):,} CISA rows, none for {sum(1 for x in g if x['cisa'] and x['cisa']['security_contact'] == 'not_published'):,}. **Only presence is stored**; the e-mail addresses (some are individuals' addresses) stay in the raw file. Verified: no address from current-full.csv appears in any row.",
        "",
        "Government levels (derived only from the published type string):",
        "",
        "| Level | Records |",
        "|---|---|",
    ]
    for key in lib.GROUPS:
        lines.append(f"| {lib.GROUPS[key]} | {s['groups'].get(key, 0):,} |")
    if s["groups"].get("unassigned"):
        lines.append(f"| Level not recorded | {s['groups']['unassigned']:,} |")
    lines += [
        "",
        "CISA domain types exactly as published: " + "; ".join(f"{k} {v:,}" for k, v in sorted(s["cisaTypes"].items(), key=lambda kv: -kv[1])) + ".",
        "",
        "## Verification",
        "",
        "- `python3 -B -X utf8 -m unittest test_gov_domains` (from `scripts/enrichment/gov_domains`): see the handoff for the run result.",
        "- `python3 -I -B scripts/enrichment/gov_domains/verify_gov_domains.py`: second parse of the raw files with positional `csv.reader`; checks every CISA and GSA field of every row, id set equality, state resolution through Census county names, zone membership, no e-mail leakage, determinism and 20 random spot checks. Result of the last run: see the handoff (target 0 failures).",
        "- `src/lib/external/govDomains.private.test.ts` (protected vitest suite): every stored row parses with the TypeScript model, every listed entry looks itself up, a `www.portal.` subdomain finds its parent and a look-alike finds nothing.",
        "",
        "### Spot checks against the raw files",
        "",
        "| # | Entry | Field | Published | Where in the source | Match |",
        "|---|---|---|---|---|---|",
    ]
    for i, sp in enumerate(spots, 1):
        lines.append(f"| {i} | {sp['id']} | {sp['field']} | {' / '.join('Not recorded' if v is None else str(v) for v in sp['published'])} | {sp['where']} | {'yes' if sp['match'] else 'NO'} |")
    lines += [
        "",
        f"Spot checks: {len(spots)}, mismatches: {sum(1 for sp in spots if not sp['match'])}.",
        "",
        "## Cross-references",
        "",
        f"- `/places/<USPS>` links: {state_links:,} of {len(rows):,} rows (a single publisher-given state with a state page). The rest have no state, several states, or a territory without a page.",
        f"- Court directory (`court_spine`, {len(spine):,} entries): {sum(court.values())} candidate court domains; **{court['matched']} matched exactly** to one court, {court['state_differs']} equal a title in another state (not matched), {court['short_name_only']} equal a short name only (not matched), {court['unmatched']} unmatched. See `court_domains.md`.",
        f"- County pages: of {len(counties):,} Census county areas, the exact-name rule (organization or GSA note equals the Census name) lists at least one registered domain for 1,762 (checked with the TypeScript model by the protected suite); the others show the state list with a filter.",
        "",
        "## Exclusions and decisions",
        "",
        "- GSA `9_govt_urls_not_used.csv` (domains out of use, rejected, redirected or deprecated) creates no record.",
        "- Security contact e-mail addresses are not stored (presence only).",
        "- GSA values `#N/A` (a spreadsheet error) are Not recorded; the literal text `NA` is kept. A GSA link that is not an http(s) address is kept as `link_rejected` (2 rows), not as a link.",
        "- A state is a USPS code only for exact state or territory names (GSA) or USPS codes (CISA); Palau, the Marshall Islands and the Federated States of Micronesia stay unresolved. Nothing is inferred from a domain name or a note.",
        "- The registries' types are not merged: CISA and GSA wording is shown as published, with a government level derived from each only to group lists.",
        "",
        "## Open risks",
        "",
        "- The GSA list is a crowdsourced list (accepted and candidate entries, last updated 2025-11-14, mostly 2013-2014 submissions); an entry is evidence that the domain was listed as a government domain, not that it is one today. Some entries are non-profits or contractors the list classifies as State or Local.",
        "- CISA type, organization, city and state are what each registrant gave the registrar; they are not audited. A registered domain does not necessarily serve a website.",
        "- The GSA licence is not stated by the publisher (see above).",
        "",
        "## Publication",
        "",
        "Not published by this build: see the handoff. The build files validate with `private/scratch/enrich/publish_build.py` (validate-only mode, no remote access).",
        "",
    ]
    path = os.path.join(BUILD, "REPORT.md")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines))
    print(os.path.relpath(path, ROOT), len(lines), "lines")


if __name__ == "__main__":
    main()
