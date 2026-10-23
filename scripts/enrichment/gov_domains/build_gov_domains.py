"""Build the gov_domains and gov_domains_summary build files (nothing is written remotely).

  python3 -I -B scripts/enrichment/gov_domains/build_gov_domains.py

Reads only private/acq/gov_domains/ (files recorded in _manifest.jsonl, re-hashed first) and writes
  private/build/gov_domains/gov_domains.json
  private/build/gov_domains/gov_domains_summary.json
in the shape private/scratch/enrich/publish_build.py expects: {"dataset", "label", "listing_block", "summary", "rows",
"built_at", "inputs"}. Rows are deterministic: the same acquired files always give the same rows.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, ".."))

import acquire_gov_domains as acq  # noqa: E402
import gov_domains_lib as lib  # noqa: E402
import gov_domains_rows as rows_mod  # noqa: E402

ROOT = acq.ROOT
BUILD = os.path.join(ROOT, "private", "build", "gov_domains")
COMMIT_DATES = {"GSA/govt-urls": "2025-11-14", "cisagov/dotgov-data": "2026-10-22"}  # git log -1 of the pinned commits
GSA_REPO, CISA_REPO = "GSA/govt-urls", "cisagov/dotgov-data"

LABEL = "Registered U.S. government domains (CISA .gov registry and GSA government URLs)"
SUMMARY_LABEL = "Registered government domains: counts by type and state"


def load_inputs() -> tuple[dict[tuple[str, str], bytes], list[dict], dict]:
    """{(repo, file): bytes}, input records, per-repo manifest metadata. Every file is re-hashed against the manifest."""
    manifest = acq.read_manifest()
    by_key = {(e["repo"], e["file"]): e for e in manifest}
    data: dict[tuple[str, str], bytes] = {}
    inputs: list[dict] = []
    for repo, spec in acq.REPOS.items():
        for name in spec["files"]:
            entry = by_key.get((repo, name))
            if not entry or entry["commit"] != spec["commit"]:
                raise SystemExit(f"{repo}/{name}: not acquired at the pinned commit; run acquire_gov_domains.py")
            with open(os.path.join(ROOT, entry["path"]), "rb") as handle:
                body = handle.read()
            if hashlib.sha256(body).hexdigest() != entry["sha256"]:
                raise SystemExit(f"{entry['path']}: sha256 differs from the manifest")
            data[(repo, name)] = body
            inputs.append({"url": entry["url"], "path": entry["path"], "sha256": entry["sha256"], "retrieved_at": entry["retrieved_at"]})
    meta_repo = {}
    for repo, spec in acq.REPOS.items():
        stamps = sorted(e["retrieved_at"] for e in manifest if e["repo"] == repo)
        meta_repo[repo] = {"commit": spec["commit"], "retrieved_at": stamps[-1], "commit_date": COMMIT_DATES[repo]}
    return data, inputs, meta_repo


def build() -> tuple[dict, dict]:
    data, inputs, meta_repo = load_inputs()
    zone_text = data[(CISA_REPO, "gov.txt")].decode("utf-8")
    zone = lib.cisa_zone_domains(zone_text)
    cisa = {
        key: lib.parse_cisa(lib.read_csv(data[(CISA_REPO, name)]), zone)
        for name, key in lib.CISA_LISTS.items()
    }
    gsa_full = lib.parse_gsa_full(lib.read_csv(data[(GSA_REPO, "1_govt_urls_full.csv")]))
    gsa_views = {
        key: lib.parse_gsa_view(lib.read_csv(data[(GSA_REPO, name)]))
        for name, key in lib.GSA_LISTS.items()
        if key != "gsa_full"
    }
    not_used = lib.parse_gsa_not_used(lib.read_csv(data[(GSA_REPO, lib.GSA_NOT_USED_FILE)]))

    unmapped = sorted(
        {r["type"] for per in cisa.values() for r in per.values() if r["type"] and not r["group"]}
        | {r["type"] for rows in gsa_full.values() for r in rows if r["type"] and not r["group"]}
    )
    if unmapped:
        raise SystemExit(f"published types without a group mapping: {unmapped}")

    records = lib.assemble(cisa, gsa_full, gsa_views, not_used)
    meta = {
        "cisa": {
            **meta_repo[CISA_REPO],
            "zone_export": lib.zone_export_stamp(zone_text) or "date not recorded",
        },
        "gsa": meta_repo[GSA_REPO],
        "summary_source_url": rows_mod.CISA_VIEWER,
    }
    rows = [rows_mod.gov_row(records[rid], meta) for rid in sorted(records)]
    built_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    stats = lib.summarize(records)
    states = sorted(stats["states"])
    sources = [
        {
            "name": "CISA .gov registry data (dotgov-data)",
            "publisher": "Cybersecurity and Infrastructure Security Agency, .gov registry",
            "official_viewer": rows_mod.CISA_VIEWER,
            "repository": "https://github.com/cisagov/dotgov-data",
            "commit": meta["cisa"]["commit"],
            "files": {n: rows_mod.raw_file_url(CISA_REPO, meta["cisa"]["commit"], n) for n in ("current-full.csv", "current-federal.csv", "gov.txt")},
            "zone_export_utc": meta["cisa"]["zone_export"],
            "retrieved_at": meta["cisa"]["retrieved_at"],
            "licence": "CC0 1.0 Universal (LICENSE file in the repository at the pinned commit)",
        },
        {
            "name": "GSA government URLs (govt-urls)",
            "publisher": "U.S. General Services Administration",
            "repository": "https://github.com/GSA/govt-urls",
            "commit": meta["gsa"]["commit"],
            "commit_date": meta["gsa"]["commit_date"],
            "files": {n: rows_mod.raw_file_url(GSA_REPO, meta["gsa"]["commit"], n) for n in sorted(acq.REPOS[GSA_REPO]["files"]) if n.endswith(".csv")},
            "retrieved_at": meta["gsa"]["retrieved_at"],
            "licence": "No licence file or statement in the repository at the pinned commit; works of the U.S. government (17 U.S.C. 105). Entries are factual domain names and labels.",
        },
    ]
    summary = {
        "what": "One record per domain entry listed by the CISA .gov registry (every domain registered in the .gov zone) or the GSA list of government domains outside .gov and .mil. The two registries are kept side by side on each record; where they disagree the record says so and neither is overwritten.",
        "records": len(rows),
        "snapshot": {"cisa_zone_export_utc": meta["cisa"]["zone_export"], "cisa_commit": meta["cisa"]["commit"], "gsa_commit": meta["gsa"]["commit"], "gsa_commit_date": meta["gsa"]["commit_date"]},
        "sources": sources,
        "counts": {"registries": stats["registries"], "with_state": stats["with_state"], "without_state": stats["without_state"], "registries_disagree": stats["conflicts"], "path_entries": stats["path_entries"]},
        "rules": [
            "Domain type, organization, city and state are shown exactly as the publisher gives them; nothing is inferred from a domain name.",
            "A state is a USPS code only when the publisher's own state field is exactly a state or territory name (GSA) or a USPS code (CISA).",
            "The Security contact email is reduced to whether the registry publishes one.",
            "A GSA entry with a path (for example example.com/Government) lists those pages only, not the whole host.",
            "The GSA list of domains out of use creates no record; a listed domain it also names carries that status.",
            "Membership in a registry is evidence that a domain is registered or listed as a government domain, not a statement about any page on it.",
        ],
    }
    gov_build = {
        "dataset": lib.DATASET,
        "label": LABEL,
        "listing_block": rows_mod.listing_block(states),
        "summary": summary,
        "rows": rows,
        "built_at": built_at,
        "inputs": inputs,
    }
    sum_rows = rows_mod.summary_rows(records, meta)
    sum_build = {
        "dataset": lib.SUMMARY_DATASET,
        "label": SUMMARY_LABEL,
        "listing_block": rows_mod.summary_listing(),
        "summary": {
            "what": "Counts over the published gov_domains records: totals, by registry, by government level, by published type and by publisher-given state.",
            "counting": "Each count is the number of gov_domains records; a record with several publisher-given states counts once in each state. Counts are over the registry snapshot named in the snapshot field.",
            "source_dataset": lib.DATASET,
            "snapshot": summary["snapshot"],
            "records": len(sum_rows),
        },
        "rows": sum_rows,
        "built_at": built_at,
        "inputs": inputs,
    }
    return gov_build, sum_build


def main() -> None:
    gov_build, sum_build = build()
    os.makedirs(BUILD, exist_ok=True)
    for build_file in (gov_build, sum_build):
        path = os.path.join(BUILD, build_file["dataset"] + ".json")
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(build_file, handle, ensure_ascii=False, sort_keys=True)
        print(build_file["dataset"], len(build_file["rows"]), os.path.relpath(path, ROOT), os.path.getsize(path), "bytes")


if __name__ == "__main__":
    main()
