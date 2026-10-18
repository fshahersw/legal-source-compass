"""Write private/build/fda_adverse_events/REPORT.md from the built datasets, the raw files and spot_checks.json.

The offline raw checks here re-derive figures straight from the raw openFDA files with their own simple loops (not
the builder's functions) and compare them with the values displayed in the built rows.
Usage: python3 -I -B scripts/enrichment/fda_adverse_events/report_fda_adverse_events.py
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
BUILD = ROOT / "private" / "build" / "fda_adverse_events"
ACQ = ROOT / "private" / "acq" / "fda_adverse_events"
RAW = ACQ / "openfda"
DS = ("fda_faers_product_series", "fda_faers_national_series", "fda_device_event_series", "fda_caers_series")


def raw(key):
    return json.loads((RAW / f"{key}.json").read_bytes())


def raw_year(key, y):
    return sum(r["count"] for r in raw(key).get("results", []) if str(r["time"]).startswith(str(y)))


def raw_all(key):
    return sum(r["count"] for r in raw(key).get("results", []))


def raw_term(key, term):
    return next((r["count"] for r in raw(key)["results"] if r["term"] == term), 0)


def offline_checks(b):
    P, N, D, C = (b[d] for d in DS)
    ser = lambda rows, rid, y, f: next(p[f] for p in rows[rid]["item"]["series"] if p["year"] == y)  # noqa: E731
    out = []

    def chk(fig, shown, key, value, where):
        out.append((fig, shown, value, f"openfda/{key}.json — {where}", shown == value))

    chk("FAERS 3094 reports 2024 (series)", ser(P, "3094", 2024, "reports"), "faers_3094_year_all", raw_year("faers_3094_year_all", 2024), "sum of daily counts in 2024")
    chk("FAERS 2924 reports 2019 (series)", ser(P, "2924", 2019, "reports"), "faers_2924_year_all", raw_year("faers_2924_year_all", 2019), "sum of daily counts in 2019")
    chk("FAERS 2789 total reports (cell)", P["2789"]["item"]["cells"]["reports"], "faers_2789_year_all", f"{raw_all('faers_2789_year_all'):,}", "sum of all daily counts")
    chk("FAERS 3140 death-outcome total (cell)", P["3140"]["item"]["cells"]["deaths"], "faers_3140_year_death", f"{raw_all('faers_3140_year_death'):,}", "sum of all daily counts")
    chk("FAERS 2875 serious 2019 (series)", ser(P, "2875", 2019, "serious"), "faers_2875_year_serious", raw_year("faers_2875_year_serious", 2019), "sum of daily counts in 2019")
    chk("FAERS 2924 lawyer-reported 2020 (series)", ser(P, "2924", 2020, "lawyer"), "faers_2924_year_lawyer", raw_year("faers_2924_year_lawyer", 2020), "sum of daily counts in 2020")
    top = P["3050"]["item"]["top_reactions_all"][0]
    chk(f"FAERS 3050 top reaction '{top['term']}' (merged)", top["count"], "faers_3050_pt_all",
        sum(raw_term("faers_3050_pt_all", v) for v in top["variants"]), "term count(s) for the listed spellings")
    chk("FAERS 2973 lawyer reporters (mix)", next(x["count"] for x in P["2973"]["item"]["reporters"] if x["code"] == 4), "faers_2973_qual",
        raw_term("faers_2973_qual", 4), "term 4 (Lawyer)")
    chk("FAERS national 2021 lawyer-reported (row)", N["2021"]["item"]["point"]["lawyer"], "faers_nat_year_q4", raw_year("faers_nat_year_q4", 2021), "sum of daily counts in 2021")
    chk("FAERS national 2022 reports (cell)", N["2022"]["item"]["cells"]["reports"], "faers_nat_year_all", f"{raw_year('faers_nat_year_all', 2022):,}", "sum of daily counts in 2022")
    chk("MAUDE 3014 death 2021 (series)", ser(D, "3014", 2021, "death"), "maude_3014_year_death", raw_year("maude_3014_year_death", 2021), "sum of daily counts in 2021")
    chk("MAUDE 2197 malfunction 2011 (series)", ser(D, "2197", 2011, "malfunction"), "maude_2197_year_malfunction", raw_year("maude_2197_year_malfunction", 2011), "sum of daily counts in 2011")
    chk("MAUDE 3181 total reports (cell)", D["3181"]["item"]["cells"]["reports"], "maude_3181_year_all", f"{raw_all('maude_3181_year_all'):,}", "sum of all daily counts")
    chk("MAUDE national injury 2022 (series)", ser(D, "national", 2022, "injury"), "maude_nat_year_injury", raw_year("maude_nat_year_injury", 2022), "sum of daily counts in 2022")
    chk("CAERS national deaths 2021 (row)", C["year-2021"]["item"]["point"]["deaths"], "caers_nat_year_death", raw_year("caers_nat_year_death", 2021), "sum of daily counts in 2021")
    chk("CAERS 3026 total (row)", C["mdl-3026"]["item"]["total"], "caers_3026_year_all", raw_all("caers_3026_year_all"), "sum of all daily counts")
    chk("CAERS industry Cosmetics 2023 (series)", ser(C, "industry-cosmetics", 2023, "reports"), "caers_ind_cosmetics_year_all",
        raw_year("caers_ind_cosmetics_year_all", 2023), "sum of daily counts in 2023")
    return out


def consistency(w, b):
    """Compare each product's total and 2025 count with the cells of the existing agency_safety_mass_tort_signals rows
    (an earlier, separate fetch by fetch_openfda_signals.py; read-only SELECT saved in lookups/)."""
    existing = {}
    for line in (BUILD / "lookups" / "agency_safety_mass_tort_signals_cells.txt").read_text().splitlines():
        if line.strip():
            mdl, kind, total, r25 = line.split("|")
            existing[mdl] = (kind, total, r25)
    mine = {}
    for ds in (DS[0], DS[2], DS[3]):
        for r in b[ds].values():
            it = r["item"]
            if it.get("mdl") is None:
                continue
            total = it["totals"]["reports"] if "totals" in it else it.get("total")
            r25 = next((p["reports"] for p in it.get("series", []) if p["year"] == 2025), None)
            mine[str(it["mdl"])] = (ds, total, r25, it.get("search_basis"))
    fmt = lambda x: "Not recorded" if x is None else f"{x:,}"  # noqa: E731
    same, rows = 0, []
    for mdl, (kind, total, r25) in sorted(existing.items(), key=lambda kv: int(kv[0])):
        if mdl not in mine:
            continue
        ds, t, t25, basis = mine[mdl]
        agree = fmt(t) == total and fmt(t25) == r25
        same += agree
        if not agree:
            rows.append((mdl, kind, total, r25, fmt(t), fmt(t25), basis))
    n = sum(1 for m in existing if m in mine)
    w("\n## Consistency with the existing agency_safety_mass_tort_signals rows\n")
    w(f"The existing 50-row dataset was built from an earlier, separate openFDA fetch (`fetch_openfda_signals.py`). For the {n} non-vehicle MDLs this stream covers, "
      f"**{same} agree exactly** on both the all-time report count and the 2025 count (read-only SELECT of the live rows, 2026-10-18). Differences:\n")
    w("| MDL | Kind | Existing total / 2025 | This stream total / 2025 | Why |\n|---|---|---|---|---|")
    why = {"alternate": "this stream uses a labelled alternate search; the recorded search matches no reports (existing row shows 0)"}
    for mdl, kind, total, r25, t, t25, basis in rows:
        reason = why.get(basis) or "existing row stores no 2025 value when the CAERS query has none; this stream shows the true zero (the national CAERS series has 2025 reports)"
        w(f"| {mdl} | {kind} | {total} / {r25} | {t} / {t25} | {reason} |")
    w("")


def ui_proposals(w, b):
    w("\n## UI proposals (not implemented)\n")
    w("All data are in the four build files; every row also carries `filters.mdl` (product rows), `item.series` (yearly points), a `qualification` string and the exact openFDA query URLs in `item.links`. Every chart or table that uses them must repeat the caveat 'Reports, not incidence; affected by litigation-driven reporting', show the data-through date (`item.data_through`) and mark the partial last year (`point.partial`) with a dashed segment or hatch. Do not turn counts into rates; the only denominators available are national report totals (labelled computed).\n")
    w("""**`/safety/signals`** (agency_safety_mass_tort_signals listing, 50 rows)
- Add three columns that join on MDL: *Reports 2025 / share of FAERS* (`fda_faers_product_series` `cells.reports_latest`, `cells.share_latest`; MAUDE equivalents from `fda_device_event_series`), *Lawyer-reported %* (`cells.lawyer_share`) and a 23-point sparkline of `item.series[].reports` (2004–2026, last point hatched). The sparkline makes litigation-driven spikes visible at a glance (Zantac 2021, Philips 2022).
- Filter chips: *Lawyer-reported share* (`filters.lawyer_band`), *Alternate search* / *Vaccine: FAERS subset* / *Requires review* (row `badges`). Sort by YoY (`item.yoy_latest_complete`).
- Row inspector (existing Inspector primitive): ranked top reactions or device problems, all years vs 2023–2025 with rank movement (`item.top_reactions_all` / `top_reactions_recent`, `item.top_problems_*`), reporter mix bar (`item.reporters`), sex and age bars (`item.sex`, `item.age_years`).
- Persistent one-line caveat above the table; vehicle rows keep their NHTSA source label.

**`/safety`** (overview)
- A *Reporting systems* panel with three small time-series cards from the national rows: FAERS reports per year stacked serious / not serious with a lawyer-reported line (`fda_faers_national_series` `year-*` rows `item.point.{reports, serious, lawyer}`), MAUDE reports per year stacked Death / Injury / Malfunction / other (`fda_device_event_series` row `national`, `item.series`), CAERS reports per year with Death outcomes (`fda_caers_series` `year-*`). Footer of each card: source name, data-through date, openFDA query link, corresponding FDA dashboard title (`summary.dashboards`).
- *Biggest movers* table: top 10 products by `item.yoy_latest_complete` with `cells.reports_latest`, restricted to products with at least 100 reports in the latest complete year so small bases do not dominate.
- A note that FDA's AEMS dashboards run ahead of openFDA (openFDA data end 2026-06-30 for FAERS).

**`/matters/lens/<n>`** (MDL lens; link present on every product row via `/matters/lens/<mdl>`)
- An *Agency reports* card (only when a row with `filters.mdl == n` exists in one of the datasets): bar chart of reports per year with the lawyer-reported portion (FAERS) or Death/Injury/Malfunction stack (MAUDE) and a vertical rule at the MDL's transfer-order date (from mdl_analytics) to show reporting before and after centralisation; second small chart of share of national reports per year (`point.share_of_national`).
- Ranked lists: top 15 reactions / device problems, all years vs 2023–2025, with new-entrant markers; reporter qualification, sex and age distributions with an explicit *Not recorded* segment (these are real remainders, often 40–95%).
- Trust labels on the card: 'FAERS subset (VAERS not in openFDA)' for vaccines, 'Alternate search' for Tepezza with a link to the recorded query that matched nothing, 'Requires review'.
- Query links list (`item.links` openFDA entries) so counsel can re-run any count.

**`/companies/<cik>`**
- *Device adverse-event reports* section from `fda_device_event_series` rows whose `item.manufacturers[].cik` equals the page CIK (all exact matches) or whose row links the company (≥ 5% rule): product, MDL lens link, reports by year, event-type mix, and the exact manufacturer-name spellings matched with their report counts. Label it a lower bound (plants and subsidiaries are not merged) and link the matching `company_adverse_manufacturers` record. Today only 3M Company (Bair Hugger, MDL 2666) crosses the 5% minimum for an SEC link; the others reach their company through the `company_adverse_manufacturers` records.
- No FAERS or CAERS section: those public files carry no manufacturer field tied to the queried product.

**Optional new route `/safety/reports`** (under the existing Safety section): the four datasets as a national explorer (system tabs FAERS / MAUDE / CAERS, year range, event-type or reporter-mix toggles, CSV of the displayed series with source and query columns).
""")


def open_risks(w, b):
    n_withheld = sum(len(r["item"].get("company_links_withheld", [])) for r in b[DS[2]].values())
    w("\n## Open risks and assumptions\n")
    w("""- **Reports are not incidence.** Counts include duplicates FDA has not removed, any-role mentions (suspect, concomitant, interacting) and unverified claims; they cannot support rates, causation or comparisons between products. Lawyer-reported shares and spikes track litigation and advertising (Zantac 2021, Philips 2022), so a rising count can mean more litigation, not more harm.
- **Search expressions are the ones in `scripts/enrichment/mass_tort_products.json`, unchanged.** Some are broad: brand-name device searches such as TRILOGY also match other makers' products (the Philips CPAP row lists Zimmer and St. Jude names among its manufacturers), and the PPI and GLP-1 rows are class searches. This stream did not narrow them. The reviewer should decide whether to tighten the expressions in the tracked file.
- **Tepezza (MDL 3079):** the recorded search matches no report because openFDA does not harmonise this biologic's names. The row uses a labelled alternate search on the reported drug name (`fae_common.ALT_FAERS`), badge 'Alternate search', flagged Requires review. The existing agency_safety_mass_tort_signals row still shows 0. Recommend adding a `faers_alt` field to mass_tort_products.json (tracked file; not edited here).
- **Vaccines (MDL 2848 Zostavax, 3036 Gardasil):** VAERS is not in openFDA and its bulk files sit behind a CAPTCHA (not bypassed), so these rows show only the FAERS subset and are labelled so. The AEMS Vaccines dashboard title was recorded by the first session and could not be re-read.
- **Data currency:** snapshot of openFDA as retrieved 2026-10-18 (FAERS through 2026-06-30, CAERS through 2026-03-31, MAUDE through 2026-09-30). FDA's AEMS now publishes in near real time, so dashboard counts for 2026 run ahead. openFDA revises history, so a re-fetch can change earlier years slightly.
- **Series boundaries:** FAERS series start 2004 and MAUDE 1992 (earlier receive dates are counted in totals, stated in facts, not charted). The last year of every series is partial and flagged; YoY is computed only between complete years.
- **Age:** onset age is counted only where the unit is years; reports with another unit or none are reported as 'none or another unit' (often more than half). Buckets differ from the dashboard's (0–1 month and 2 months–2 years cannot be separated in years).
- **Not covered:** the 8 vehicle MDLs (NHTSA), MDL 3101 baby food (no CAERS search recorded: 'Not recorded'), NEISS / SaferProducts (owner hold, not touched), Time Limits (not touched).
- **Rate limit:** openFDA without a key allows 240 requests/minute and 1,000/day per IP; the fetcher keeps to ≤ 2 requests/second. A refresh needs a new acquisition folder or deleted raw files because the fetcher skips keys already on disk.
- **Verification boundary:** spot checks compare against openFDA itself (same publisher) by a different query route; they confirm the builder's arithmetic and the stored queries, not that openFDA matches FDA's own dashboards.""")
    w(f"- **Company links are deliberately sparse:** exact normalised names only, no subsidiary merging, row-level links only at ≥ 5% of the product's reports (a stated judgement, not a measured optimum; {n_withheld} smaller exact matches are kept in the row data, not linked). CAERS and FAERS rows have no company links.\n")


def main():
    built = {d: json.loads((BUILD / f"{d}.json").read_text()) for d in DS}
    b = {d: {r["id"]: r for r in built[d]["rows"]} for d in DS}
    spots = json.loads((BUILD / "spot_checks.json").read_text()) if (BUILD / "spot_checks.json").exists() else None
    manifest = [json.loads(x) for x in (ACQ / "_manifest.jsonl").read_text().splitlines() if x.strip()]
    statuses = {}
    for m in manifest:
        statuses[m["status"]] = statuses.get(m["status"], 0) + 1
    used = {i["path"] for d in DS for i in built[d]["inputs"] if i["path"].startswith("private/acq")}
    unused = sorted({m["path"] for m in manifest} - used)
    raw_bytes = sum(m["bytes"] for m in manifest)
    P, N, D, C = (b[d] for d in DS)
    nat, dev, cae = N["all_years"]["item"], D["national"]["item"], C["all_years"]["item"]
    off = offline_checks(b)
    L = []
    w = L.append
    w("# fda_adverse_events — validation report\n")
    w(f"Built: {built[DS[0]]['built_at']}. Stream slug `fda_adverse_events`. Four datasets, ready for `corpus_writer.publish` unchanged.\n")
    w("**Every figure is a count of reports, not incidence.** " + built[DS[0]]["summary"]["caveat"] + "\n")
    w("## Sources and terms\n")
    w("| Source | What it backs | Retrieval | Terms |\n|---|---|---|---|")
    w(f"| openFDA drug/event (FAERS public data), https://open.fda.gov/apis/drug/event/ | fda_faers_product_series, fda_faers_national_series; data through {nat['data_through']} (openFDA last updated {nat['last_updated']}) | Direct HTTPS GET, count aggregates, no API key, ≤ 2 req/s | https://open.fda.gov/terms/ ; CC0 1.0 (https://open.fda.gov/license/), no endorsement implied |")
    w(f"| openFDA device/event (MAUDE), https://open.fda.gov/apis/device/event/ | fda_device_event_series; data through {dev['data_through']} (last updated {dev['last_updated']}) | same | same (GMDN terms excluded from CC0; not used) |")
    w(f"| openFDA food/event (CAERS), https://open.fda.gov/apis/food/event/ | fda_caers_series; data through {cae['data_through']} (last updated {cae['last_updated']}) | same | same |")
    w("| FIS dashboards (Qlik Sense), https://fis.fda.gov/sense/app/… | Identified by page title only; no figures taken from them | Qlik pages render client-side; read with `mcp__Firecrawl__firecrawl_scrape` (public pages, no login). Cosmetics title read from the rendered page 2026-10-18; FAERS title from the fis.fda.gov hub listing and FDA's AEMS page that links the app id; the vaccines title was recorded by the first session of this stream and did not render in two later attempts (not re-verified) | FDA website policies |")
    w("| VAERS data sets, https://vaers.hhs.gov/data/datasets.html | Not acquired | Download links (`eSubDownload/index.jsp?fn=…`) return a CAPTCHA page; not bypassed | — |")
    w("\nDashboard ↔ dataset correspondence (titles as read 2026-10-18):\n")
    for k, v in json.loads(json.dumps(built[DS[0]]["summary"]["dashboards"])).items():
        target = {"faers": "fda_faers_product_series + fda_faers_national_series (the FAERS public data via openFDA; FDA says AEMS publishes in near real time while openFDA is refreshed periodically, so counts for recent months differ)",
                  "cosmetics": "fda_caers_series rows `industry-cosmetics` and `mdl-3060` (cosmetic reports in CAERS via openFDA; the dashboard shows current AEMS cosmetic reports, openFDA CAERS data end " + cae["data_through"] + ")",
                  "vaccines": "No openFDA counterpart (VAERS). FAERS rows for Zostavax (2848) and Gardasil (3036) are flagged as the FAERS subset only"}[k]
        w(f"- **{v['title']}** — {v['url']} → {target}")
    w("\nContext: FDA launched the Adverse Event Monitoring System (AEMS) on 2026-03-11 (https://www.fda.gov/news-events/press-announcements/fda-launches-new-adverse-event-look-tool); FDA's announcement lists FAERS, VAERS and the animal-product systems as legacy systems AEMS is replacing, with real-time publication, so the dashboards run ahead of openFDA, whose FAERS data end 2026-06-30 (CAERS 2026-03-31, MAUDE 2026-09-30). Dashboard and openFDA counts for 2026 will therefore differ; the stored openFDA figures are a dated snapshot.")
    w("\nFAERS quarterly data files (fis.fda.gov extensions) were not needed: every requested figure is available as an openFDA count aggregate.\n")
    w(f"Acquisition: {len(manifest)} raw responses ({raw_bytes/1e6:.1f} MB) in `private/acq/fda_adverse_events/openfda/`, manifest `_manifest.jsonl` (url, path, sha256, bytes, retrieved_at, status, method). Status counts: {json.dumps(statuses)}. The builder verifies each file's sha256 against the manifest.\n")
    w("## Coverage\n")
    w(f"- FAERS national: {built[DS[1]]['summary']['period']}.")
    w(f"- FAERS products: {len(P)} drug/biologic entries of mass_tort_products.json ({', '.join(sorted(P, key=int))}); period {built[DS[0]]['summary']['period']}.")
    w(f"- MAUDE: {len(D) - 1} device entries + national row; period {built[DS[2]]['summary']['period']}.")
    w(f"- CAERS: {built[DS[3]]['summary']['period']}; {sum(1 for r in C.values() if r['item']['kind'] == 'caers_year')} year rows, {sum(1 for r in C.values() if r['item']['kind'] == 'caers_industry')} industry rows, {sum(1 for r in C.values() if r['item']['kind'] == 'caers_product')} brand rows, {sum(1 for r in C.values() if r['item']['kind'] == 'caers_mdl')} MDL rows.")
    w("- Out of scope: the 8 vehicle MDLs in mass_tort_products.json (NHTSA, not FDA).\n")
    w("## Record counts\n")
    w("| Dataset | Rows | Raw inputs | Build file |\n|---|---|---|---|")
    for d in DS:
        w(f"| {d} | {len(built[d]['rows'])} | {sum(1 for i in built[d]['inputs'] if i['path'].startswith('private/acq'))} | private/build/fda_adverse_events/{d}.json |")
    w("\n## Spot checks against live openFDA (independent query route)\n")
    if spots:
        w(f"{spots['count']} checks, {spots['mismatches']} mismatches. Each check re-asks openFDA for the figure with a date-range search and reads `meta.results.total` (the builder summed daily `count=` aggregates).\n")
        w("| Figure | Shown | Live | Raw source of the shown value | Match |\n|---|---|---|---|---|")
        for c in spots["checks"]:
            w(f"| {c['figure']} | {c['shown']:,} | {c['live'] if isinstance(c['live'], str) else format(c['live'], ',')} | {c['raw_source']} | {'yes' if c['match'] else 'no'} |")
    else:
        w("Not run.")
    w(f"\n## Offline checks: displayed value vs raw file ({len(off)} figures, {sum(1 for x in off if not x[4])} mismatches)\n")
    w("| Figure | Displayed | Re-derived from raw | Where | Match |\n|---|---|---|---|---|")
    for fig, shown, val, where, okk in off:
        w(f"| {fig} | {shown} | {val} | {where} | {'yes' if okk else 'no'} |")
    w("\n## Cross-references\n")
    lens = [l for d in DS for r in built[d]["rows"] for l in r["item"]["links"] if l["url"].startswith("/matters/lens/")]
    prod_rows = [r for d in DS for r in built[d]["rows"] if r["item"].get("mdl") is not None]
    lens_mdls = {int(l["url"].rsplit("/", 1)[1]) for l in lens}
    titles = {int(x.split("|", 1)[0]) for x in (BUILD / "lookups" / "mdl_analytics_titles.txt").read_text().splitlines() if x.strip()}
    sig_ids = {x.split("|")[0] for x in (BUILD / "lookups" / "agency_safety_mass_tort_signals_cells.txt").read_text().splitlines() if x.strip()}
    sig_links = [l["url"].rsplit("/", 1)[1] for d in DS for r in built[d]["rows"] for l in r["item"]["links"] if l["url"].startswith("/records/agency_safety_mass_tort_signals/")]
    w(f"- `/matters/lens/<n>`: {len(lens)} links on {len(prod_rows)} product rows covering {len(lens_mdls)} MDL numbers; every product row links its MDL because mass_tort_products.json records the number explicitly (no inference); {len(lens_mdls & titles)} of {len(lens_mdls)} numbers exist in the mdl_analytics lookup (read-only SELECT 2026-10-18).")
    w(f"- `/records/agency_safety_mass_tort_signals/<n>`: {len(sig_links)} links (exact MDL key); {len(set(sig_links) & sig_ids)} of {len(set(sig_links))} distinct ids exist in that dataset (read-only SELECT: 50 rows, 8 vehicle MDLs not covered by this stream).")
    cm = built[DS[2]]["summary"]["company_match"]
    w(f"- `/companies/<CIK>` (devices only): {cm['matched']} of {cm['names']} MAUDE manufacturer names (top-100 names per product, 18 products) matched a company_sec_profiles name uniquely after the documented normalisation ({cm['ambiguous']} ambiguous, {cm['unmatched']} unmatched); matched names carry {cm['matched_reports']:,} of {cm['name_reports']:,} name-level report counts ({cm['matched_reports']/cm['name_reports']*100 if cm['name_reports'] else 0:.2f}%) because the names on device reports are mostly plants and subsidiaries (for example STRYKER ORTHOPAEDICS MAHWAH, BOSTON SCIENTIFIC NEUROMODULATION), which are deliberately not merged.")
    w(f"- `/records/company_adverse_manufacturers/<id>`: {cm['record_matched']} manufacturer names equal the title of an 'Exact-name match' record of that dataset (155 records read-only; unique per source: SEC / Open Payments); {cm['record_ambiguous']} ambiguous.")
    w(f"- Row-level company links are added only when the exactly matched names carry at least {built[DS[2]]['summary']['company_match']['min_share'] * 100:.0f}% of the product's reports: {cm['linked_companies']} `/companies/<CIK>` and {cm['linked_records']} `/records/company_adverse_manufacturers/<id>` links; {cm['withheld_below_min_share']} smaller matches stay in `item.manufacturers` / `item.company_links_withheld` and are not linked.")
    for r in D.values():
        for l in r["item"]["links"]:
            if l["url"].startswith(("/companies/", "/records/company_adverse_manufacturers/")):
                w(f"  - MDL {r['id']} ({r['item']['product']}): {l['url']} — {l['label']}")
    withheld = [(r["id"], x) for r in D.values() for x in r["item"].get("company_links_withheld", [])]
    w(f"  - Withheld (below the share minimum), for review: " + "; ".join(f"MDL {i} {x['url']} {x['reports']:,} reports ({x['share'] * 100:.2f}%)" for i, x in withheld if x["url"].startswith("/companies/")))
    w("- FAERS and CAERS rows: no company links (no attributable manufacturer field in the public data).\n")
    w("## Exclusions and gaps\n")
    gaps = [(d, r["id"], g) for d in DS for r in built[d]["rows"] for g in r["item"].get("not_recorded", []) or []]
    w(f"- Figures shown as Not recorded: {len(gaps)}." + "".join(f"\n  - {d}/{rid}: {g}" for d, rid, g in gaps))
    w(f"- Raw responses on disk but not used by the build: {len(unused)} (first-run onset-age queries: `count=patient.patientonsetageunit.exact` answers 404 'Nothing to count' and `limit=1000` answers 403 API_KEY_MISSING without a key; replaced by two range counts with limit 100; the ten MDL 3079 detail queries on the recorded search, all 'No matches found!' (only `faers_3079_year_all` is read, to show the recorded search matches 0); and `faers_diag_3079_medicinalproduct`, a one-off diagnostic superseded by the labelled alternate search `faers_3079alt_*`). All are kept unchanged in the manifest as the record of what was asked.")
    for p in unused:
        w(f"  - {p}")
    w("- Vehicle MDLs (8), VAERS (CAPTCHA), NEISS/SaferProducts (owner hold; not touched).")
    w("- CAERS brand placeholder 'EXEMPTION 4' (name withheld under FOIA Exemption 4) kept in the ranking, excluded from product rows.")
    w("- Reports dated before the series start (FAERS < 2004, MAUDE < 1992 incl. one dated 1900, CAERS < 2004) are counted in totals and stated, not placed in the series.\n")
    w("## Litigation-driven reporting (computed from the built rows)\n")
    w("| MDL | Product | Reports | Lawyer-reported share | Peak lawyer-reported year |\n|---|---|---|---|---|")
    for rid, r in sorted(P.items(), key=lambda kv: -(kv[1]["item"]["lawyer_share"] or 0)):
        it = r["item"]
        lp = max(((p["year"], p["lawyer"]) for p in it["series"] if p["lawyer"]), key=lambda kv: kv[1], default=(None, None))
        w(f"| {rid} | {it['product']} | {it['totals']['reports']:,} | {(it['lawyer_share'] or 0) * 100:.1f}% | {lp[0] or '—'}{f' ({lp[1]:,})' if lp[0] else ''} |")
    peak_law = max(nat["series"], key=lambda p: p["lawyer"] or 0)
    w(f"\nNationally, lawyer-reported FAERS reports peaked in {peak_law['year']} at {peak_law['lawyer']:,} ({peak_law['lawyer_share'] * 100:.1f}% of that year's reports).\n")
    consistency(w, b)
    ui_proposals(w, b)
    open_risks(w, b)
    (BUILD / "REPORT.md").write_text("\n".join(L) + "\n")
    print(json.dumps({"offline_checks": len(off), "offline_mismatches": sum(1 for x in off if not x[4]), "unused_raw": len(unused)}))


if __name__ == "__main__":
    main()
