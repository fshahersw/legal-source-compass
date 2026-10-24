"""Registry of the class action research reports this stream reads: one entry per edition (publisher, family, edition,
period covered, title and date as printed on the report), joined with the fetched file (URL, sha256, pages).

Publisher URLs: Cornerstone Research reports are linked at cornerstone.com where the publisher posts them (its
wp-content uploads), otherwise at the Stanford Securities Class Action Clearinghouse research archive
(securities.stanford.edu/research-reports/), which hosts the series published in cooperation with Cornerstone Research.
NERA reports are linked at nera.com. Dates are the date printed on the report where it prints one; otherwise the month
of the publisher's upload path, otherwise the PDF's own creation date, labelled as such.
"""
from __future__ import annotations

import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cra_fetch  # noqa: E402
import cra_text  # noqa: E402

CR = "Cornerstone Research"
CR_SCAC = "Cornerstone Research and the Stanford Law School Securities Class Action Clearinghouse"
NERA = "NERA Economic Consulting"

FAMILIES = {
    "cr_filings": "Securities class action filings (Year in Review and Midyear Assessment)",
    "cr_settlements": "Securities class action settlements (Review and Analysis and Midyear Assessment)",
    "cr_accounting": "Accounting class action filings and settlements",
    "cr_ma": "Shareholder litigation involving mergers and acquisitions",
    "cr_opt_out": "Opt-out cases in securities class action settlements",
    "cr_tech": "Tech company securities class action filings and settlements",
    "cr_derivative": "Parallel derivative action settlement outcomes",
    "cr_de_ma": "M&A litigation settlements in the Delaware Court of Chancery",
    "cr_appraisal": "Appraisal litigation in Delaware",
    "nera_us": "Recent Trends in Securities Class Action Litigation (full-year, midyear and quarterly)",
    "nera_ai": "AI and securities class action litigation",
}

# (file-name regex, id, family, edition, period covered, title as printed, date as printed or None)
_R: list[tuple[str, str, str, str, str, str, str | None]] = []


def _cr_filings() -> None:
    for y in range(2005, 2026):
        t = (f"Securities Class Action Case Filings {y}: A Year in Review" if y <= 2007 else
             f"Securities Class Action Filings {y}: A Year in Review" if y <= 2009 else
             f"Securities Class Action Filings—{y} Year in Review")
        _R.append((rf"(Filings-{y}-YIR|Filings-?{y}-Year-in-Review)\.pdf$", f"cr-filings-{y}-yir", "cr_filings",
                   f"{y} Year in Review", str(y), t, None))
    for y in range(2006, 2027):
        t = (f"Securities Class Action Case Filings {y} Mid-Year Assessment" if y <= 2007 else
             f"Securities Class Action Filings {y} Mid-Year Assessment" if y <= 2013 else
             f"Securities Class Action Filings—{y} Midyear Assessment")
        _R.append((rf"(Filings-{y}-MYA|Filings-{y}-Midyear-Assessment)\.pdf$", f"cr-filings-{y}-mya", "cr_filings",
                   f"{y} Midyear Assessment", f"{y} H1", t, None))


def _cr_settlements() -> None:
    for y in range(2005, 2026):
        t = ("Post-Reform Act Securities Settlements: 2005 Review and Analysis" if y == 2005 else
             f"Securities Class Action Settlements: {y} Review and Analysis" if y <= 2012 else
             f"Securities Class Action Settlements—{y} Review and Analysis")
        _R.append((rf"(Settlements-Through-12-{y}(-Review)?|Securities-Class-Action-Settlements-{y}-Review-and-Analysis)\.pdf$",
                   f"cr-settlements-{y}", "cr_settlements", f"{y} Review and Analysis", str(y), t, None))
    _R.append((r"Securities-Class-Action-Settlements-2026-Midyear-Assessment\.pdf$", "cr-settlements-2026-mya", "cr_settlements",
               "2026 Midyear Assessment", "2026 H1", "Securities Class Action Settlements—2026 Midyear Assessment", None))


def _cr_accounting() -> None:
    _R.append((r"accounting-class-action-filings-and-settlements-2004-2009\.pdf$", "cr-accounting-2004-2009", "cr_accounting",
               "Review and Analysis 2004–2009", "2004–2009", "Accounting Class Action Filings and Settlements: Review and Analysis 2004–2009", None))
    _R.append((r"accounting-class-action-filings-and-settlements-2011\.pdf$", "cr-accounting-2011", "cr_accounting",
               "2011 Review and Analysis", "2011", "Accounting Class Action Filings and Settlements: 2011 Review and Analysis", None))
    for y in range(2013, 2026):
        _R.append((rf"Accounting-Class-Action-Filings-and-Settlements-{y}(-Review)?\.pdf$", f"cr-accounting-{y}", "cr_accounting",
                   f"{y} Review and Analysis", str(y), f"Accounting Class Action Filings and Settlements—{y} Review and Analysis", None))


def _cr_related() -> None:
    _R.extend([
        (r"Cornerstone-Research-Shareholder-MandA-Litigation-03-2012\.pdf$", "cr-ma-2012-03", "cr_ma", "March 2012 Update", "2011",
         "Recent Developments in Shareholder Litigation Involving Mergers and Acquisitions: March 2012 Update", "March 2012"),
        (r"Shareholder-Litigation-Involving-M-and-A-Feb-2013\.pdf$", "cr-ma-2012", "cr_ma", "Review of 2012 M&A Litigation", "2012",
         "Shareholder Litigation Involving Mergers and Acquisitions: Review of 2012 M&A Litigation", None),
        (r"Shareholder-Litigation-Involving-M-and-A-2013-Filings\.pdf$", "cr-ma-2013-filings", "cr_ma", "Review of 2013 M&A Litigation", "2013",
         "Shareholder Litigation Involving Mergers and Acquisitions—Review of 2013 M&A Litigation", None),
        (r"Shareholder-Litigation-Involving-M-and-A-2013-Settlements\.pdf$", "cr-ma-2013-settlements", "cr_ma",
         "Settlements, Review of 2013 M&A Litigation", "2013",
         "Settlements of Shareholder Litigation Involving Mergers and Acquisitions—Review of 2013 M&A Litigation", None),
        (r"Shareholder-Litigation-Involving-Acquisitions-2014-Review\.pdf$", "cr-ma-2014", "cr_ma", "Review of 2014 M&A Litigation", "2014",
         "Shareholder Litigation Involving Acquisitions of Public Companies—Review of 2014 M&A Litigation", None),
        (r"Shareholder-Litigation-Involving-Acquisitions-of-Public-CompaniesReview-of-2015-and-1H-2016-MA-Litigation\.pdf$", "cr-ma-2015-2016h1",
         "cr_ma", "Review of 2015 and 1H 2016 M&A Litigation", "2015–2016 H1",
         "Shareholder Litigation Involving Acquisitions of Public Companies—Review of 2015 and 1H 2016 M&A Litigation", None),
        (r"Shareholder-Litigation-Involving-Acquisitions-of-Public-Companies-2017\.pdf$", "cr-ma-2017", "cr_ma", "Review of 2017 M&A Litigation",
         "2017", "Shareholder Litigation Involving Acquisitions of Public Companies—Review of 2017 M&A Litigation", None),
        (r"Opt-Out-Cases-Securities-Class-Action-Settlements-1996-2011\.pdf$", "cr-opt-out-1996-2011", "cr_opt_out", "1996–2011", "1996–2011",
         "Opt-Out Cases in Securities Class Action Settlements", None),
        (r"Opt-Out-Cases-Securities-Class-Action-Settlements-2012-2014\.pdf$", "cr-opt-out-2012-2014", "cr_opt_out", "2012–2014 Update",
         "2012–2014", "Opt-Out Cases in Securities Class Action Settlements: 2012–2014 Update", None),
        (r"Opt-Out-Cases-in-Securities-Class-Action-Settlements-2019-H1-2022-Update\.pdf$", "cr-opt-out-2019-2022h1", "cr_opt_out",
         "2019–H1 2022 Update", "2019–2022 H1", "Opt-Outs in Securities Class Action Settlements: 2019–H1 2022 Update", None),
        (r"Tech-Company-Securies-Class-Action-Filings-and-Settlements-2015-Q12020-Review\.pdf$", "cr-tech-2015-2020q1", "cr_tech",
         "2015–Q1 2020 Review and Analysis", "2015–2020 Q1",
         "Tech Company Securities Class Action Filings and Settlements: 2015–Q1 2020 Review and Analysis", None),
        (r"Parallel-Derivative-Action-Settlement-Outcomes\.pdf$", "cr-derivative-2022", "cr_derivative", "2022 study", "2022",
         "Parallel Derivative Action Settlement Outcomes", None),
        (r"Parallel-Derivative-Action-Settlement-Outcomes-2023-Review-and-Analysis\.pdf$", "cr-derivative-2023", "cr_derivative",
         "2023 Review and Analysis", "2023", "Parallel Derivative Action Settlement Outcomes: 2023 Review and Analysis", None),
        (r"Parallel-Derivative-Action-Settlement-Outcomes_2026-Midyear-Review-and-Analysis\.pdf$", "cr-derivative-2026-mid", "cr_derivative",
         "2026 Midyear Review and Analysis", "2026 H1", "Parallel Derivative Action Settlement Outcomes: 2026 Midyear Review and Analysis", None),
        (r"MA-Litigation-Settlements-Delaware-Court-Chancery-2012-2024\.pdf$", "cr-de-ma-2012-2024", "cr_de_ma", "2012–2024 Review and Analysis",
         "2012–2024", "M&A Litigation Settlements in the Delaware Court of Chancery—2012–2024 Review and Analysis", None),
        (r"MA-Litigation-Settlements-Delaware-Court-Chancery-2012-2025\.pdf$", "cr-de-ma-2012-2025", "cr_de_ma", "2012–2025 Review and Analysis",
         "2012–2025", "M&A Litigation Settlements in the Delaware Court of Chancery—2012–2025 Review and Analysis", None),
        (r"Appraisal-Litigation-in-Delaware-2006-2018\.pdf$", "cr-appraisal-2006-2018", "cr_appraisal", "2006–2018", "2006–2018",
         "Appraisal Litigation in Delaware: Trends in Petitions and Opinions 2006–2018", None),
        (r"Appraisal-Litigation-in-Delaware-2006-2022\.pdf$", "cr-appraisal-2006-2022", "cr_appraisal", "2006–2022", "2006–2022",
         "Appraisal Litigation in Delaware: Trends in Petitions and Opinions 2006–2022", None),
    ])


def _nera() -> None:
    T = "Recent Trends in Securities Class Action Litigation"
    rows = [
        ("NERA_Recent_Trends_2003_Early_Update", "nera-us-2003-early", "2003 Early Update", "2003", f"{T}: 2003 Early Update", "February 2004"),
        ("200405BNA_Trends", "nera-us-2003-bna", "2003 Update (BNA Class Action Litigation Report reprint)", "2003", f"{T}: 2003 Update", "23 April 2004"),
        ("Recent_Trends_Final_2.28.05", "nera-us-2004-fy", "February 2005", "2004",
         "Recent Trends in Shareholder Class Action Litigation: Bear Market Cases Bring Big Settlements", "February 2005"),
        ("Recent_Trends_07.2005", "nera-us-2005-mid", "July 2005", "2005 H1",
         "Recent Trends in Shareholder Class Action Litigation: Are WorldCom and Enron the New Standard?", "July 2005"),
        ("BRO_RecentTrends2006_SEC979_PPB-FINAL", "nera-us-2005-fy", "April 2006", "2005",
         "Recent Trends in Shareholder Class Action Litigation: Beyond the Mega-Settlements, is Stabilization Ahead?", "April 2006"),
        ("BRO_Recent_Trends_SEC1288_FINAL_0307", "nera-us-2006-fy", "January 2007", "2006",
         "Recent Trends in Shareholder Class Action Litigation: Filings Plummet, Settlements Soar", "January 2007"),
        ("PUB_RecentTrends_Sep2007-FINAL_4color", "nera-us-2007-mid", "September 2007", "2007 H1",
         "Recent Trends in Shareholder Class Action Litigation: Filings Stay Low and Average Settlements Stay High—But Are These Trends Reversing?",
         "September 2007"),
        ("BRO_Recent_Trends_Dec07_0708_final", "nera-us-2007-fy", "2007 Year End Update", "2007",
         "2007 Year End Update: Recent Trends in Shareholder Class Actions: Filings Return to 2005 Levels as Subprime Cases Take Off; Average Settlements Hit New High",
         None),
        ("BRO_Recent_Trends_8.5x11_0808", "nera-us-2008-mid", "2008 Mid-Year Update", "2008 H1",
         "2008 Mid-Year Update: 2008 Trends: Subprime and Auction-Rate Cases Continue to Drive Filings, and Large Settlements Keep Averages High", None),
        ("PUB_Recent_Trends_Report_1208", "nera-us-2008-fy", "December 2008", "2008",
         "2008 Trends in Securities Class Actions: Annual Filings Are at the Highest Level in Six Years, Driven by the Credit Crisis, While Median Settlement Values Stay Steady",
         "December 2008"),
        ("Recent_Trends_Report_07_09", "nera-us-2009-mid", "2009 Mid-Year Update", "2009 H1", f"{T}: 2009 Mid-Year Update", None),
        ("Recent_Trends_Report_01.10", "nera-us-2009-fy", "2009 Year-End Update", "2009", f"{T}: 2009 Year-End Update", "December 2009"),
        ("PUB_Mid_Year_Trends_2010_0115", "nera-us-2010-mid", "Trends 2010 Mid-Year Study", "2010 H1",
         "Trends 2010 Mid-Year Study: Filings Decline as the Wave of Credit Crisis Cases Subsides, Median Settlement at Record High", None),
        ("PUB_Year_End_Trends_2010_0115", "nera-us-2010-fy", "Trends 2010 Year-End Update", "2010",
         "Trends 2010 Year-End Update: Securities Class Action Filings Accelerate in Second Half of 2010; Median Settlement Value at an All-Time High", None),
        (r"PUB_Mid-Year_Trends_0711\(3\)", "nera-us-2011-mid", "2011 Mid-Year Review", "2011 H1", f"{T}: 2011 Mid-Year Review", "26 July 2011"),
        ("PUB_Year_End_Trends_2011_0115", "nera-us-2011-fy", "2011 Year-End Review", "2011", f"{T}: 2011 Year-End Review", "14 December 2011"),
        ("PUB_Mid_Year_Trends_08.2012", "nera-us-2012-mid", "2012 Mid-Year Review", "2012 H1", f"{T}: 2012 Mid-Year Review", "24 July 2012"),
        ("PUB_Year_End_Trends_Flash_Dec2012", "nera-us-2012-flash", "Flash Update, December 2012", "2012",
         "Flash Update: 2012 Trends in Securities Class Actions", "11 December 2012"),
        ("PUB_Year_End_Trends_01.2013", "nera-us-2012-fy", "2012 Full-Year Review", "2012", f"{T}: 2012 Full-Year Review", "29 January 2013"),
        ("PUB_Year_End_Trends_1.2014", "nera-us-2013-fy", "2013 Full-Year Review", "2013", f"{T}: 2013 Full-Year Review", "21 January 2014"),
        ("PUB_Full_Year_Trends_2014_0115", "nera-us-2014-fy", "2014 Full-Year Review", "2014", f"{T}: 2014 Full-Year Review", "20 January 2015"),
        ("2015_Securities_Trends_Report_NERA", "nera-us-2015-fy", "2015 Full-Year Review", "2015", f"{T}: 2015 Full-Year Review", "25 January 2016"),
        ("PUB_2016_Securities_Year-End_Trends_Report_0117", "nera-us-2016-fy", "2016 Full-Year Review", "2016", f"{T}: 2016 Full-Year Review",
         "January 2017"),
        ("PUB_Year_End_Trends_Report_0118_final", "nera-us-2017-fy", "2017 Full-Year Review", "2017", f"{T}: 2017 Full-Year Review", "29 January 2018"),
        ("Recent_Trends_2018q1", "nera-us-2018-q1", "Q1 2018 Update", "2018 Q1", f"{T}: Q1 2018 Update", "13 April 2018"),
        ("Recent_SCA_Trends_2018_1H", "nera-us-2018-h1", "H1 2018 Update", "2018 H1", f"{T}: H1 2018 Update", None),
        ("Recent_SCA_Trends_2018q3", "nera-us-2018-q3", "Q3 2018 Update", "2018 Q3", f"{T}: Q3 2018 Update", None),
        ("PUB_Year_End_Trends_012819_Final", "nera-us-2018-fy", "2018 Full-Year Review", "2018", f"{T}: 2018 Full-Year Review", "29 January 2019"),
        ("Recent_SCA_Trends_2019Q1", "nera-us-2019-q1", "Q1 2019 Update", "2019 Q1", f"{T}: Q1 2019 Update", None),
        ("2019-H1_Trends_Update_0819-1", "nera-us-2019-h1-aug", "2019 H1 Update (August 2019 file)", "2019 H1", f"{T}: 2019 H1 Update", None),
        ("2019-H1_Trends_Update_1019", "nera-us-2019-h1-oct", "2019 H1 Update (October 2019 file)", "2019 H1", f"{T}: 2019 H1 Update", None),
        ("2019-Q3_Trends_Update_1019", "nera-us-2019-q3", "2019 Q3 Update", "2019 Q3", f"{T}: 2019 Q3 Update", None),
        ("PUB_Year_End_Trends_012120_Final", "nera-us-2019-fy", "2019 Full-Year Review", "2019", f"{T}: 2019 Full-Year Review", "12 February 2020"),
        ("SEC_2020_Q1Trends_Update", "nera-us-2020-q1", "2020 Q1 Update", "2020 Q1", f"{T}: 2020 Q1 Update", None),
        ("SEC_H1-Figures_071720", "nera-us-2020-h1", "2020 H1 Update (figures)", "2020 H1", f"{T}: 2020 H1 Update", None),
        ("PUB_2020_Full-Year_Trends_012221", "nera-us-2020-fy", "2020 Full-Year Review", "2020", f"{T}: 2020 Full-Year Review", "25 January 2021"),
        ("PUB_2021_Full-Year_Trends_012022", "nera-us-2021-fy", "2021 Full-Year Review", "2021", f"{T}: 2021 Full-Year Review", "25 January 2022"),
        ("NERA Mid-Year Update Figures 0822", "nera-us-2022-h1", "2022 Mid-Year Update (figures)", "2022 H1",
         "Recent Trends in Securities Class Action Litigation: 2022 Mid-Year Update figures", None),
        ("PUB_2022_Full_Year_Trends", "nera-us-2022-fy", "2022 Full-Year Review", "2022", f"{T}: 2022 Full-Year Review", "24 January 2023"),
        ("2023 SEC Litigation Mid-Year Trends Figures", "nera-us-2023-h1-figures", "H1 2023 Update (figures)", "2023 H1",
         "Recent Trends in Securities Class Action Litigation: H1 2023 Update figures", None),
        ("H1 2023 Update", "nera-us-2023-h1", "H1 2023 Update", "2023 H1", f"{T}: H1 2023 Update", "2 August 2023"),
        ("PUB_2023_Full-Year_Sec_Trends_0123", "nera-us-2023-fy", "2023 Full-Year Review", "2023", f"{T}: 2023 Full-Year Review", "23 January 2024"),
        ("2024_US_H1-Update", "nera-us-2024-h1", "2024 H1 Update", "2024 H1", f"{T}: 2024 H1 Update", "6 August 2024"),
        ("PUB_2024_Full-Year_Sec_Trends_0122", "nera-us-2024-fy", "2024 Full-Year Review", "2024", f"{T}: 2024 Full-Year Review", "22 January 2025"),
        ("PUB_US-H1_2025_Trends-Report", "nera-us-2025-h1", "H1 2025 Update", "2025 H1", f"{T}: H1 2025 Update", "29 July 2025"),
        ("PUB_2025_Recent_SCA_Trends_Full-Year_0121", "nera-us-2025-fy", "2025 Full-Year Review", "2025", f"{T}: 2025 Full-Year Review",
         "21 January 2026"),
        ("2026_Recent_Trends_H1_Update_0726", "nera-us-2026-h1", "H1 2026 Update", "2026 H1", f"{T}: H1 2026 Update", None),
    ]
    for stem, rid, ed, per, title, date in rows:
        rx = stem if "\\" in stem else re.escape(stem)
        _R.append((rx + r"\.pdf$", rid, "nera_us", ed, per, title, date))
    _R.append((r"20251216_AI-and-Securities-Class-Action-Litigation\.pdf$", "nera-ai-2025", "nera_ai", "December 2025", "2021–2025 Q3",
               "AI and Securities Class Action Litigation", "17 December 2025"))


_cr_filings()
_cr_settlements()
_cr_accounting()
_cr_related()
_nera()

MONTHS = "January February March April May June July August September October November December".split()


def publisher_of(rid: str, family: str) -> str:
    if family == "cr_filings":
        return CR_SCAC
    return NERA if rid.startswith("nera") else CR


def _upload_month(url: str) -> str | None:
    m = re.search(r"wp-content/uploads/(\d{4})/(\d{2})/", url)
    return f"{MONTHS[int(m.group(2)) - 1]} {m.group(1)}" if m else None


def reports() -> list[dict]:
    """Resolved registry entries that have a fetched PDF; each matched by exactly one manifest file."""
    man = [r for r in cra_fetch.load_manifest().values() if r.get("status") == 200 and r.get("sha256")
           and "pdf" in (r.get("content_type") or "").lower()]
    out, used = [], {}
    for rx, rid, fam, ed, per, title, date in _R:
        hits = [r for r in man if re.search(rx, os.path.basename((r.get("final_url") or r["url"]).replace("%20", " ")))]
        if not hits:
            continue
        # prefer the publisher's own site, then the clearinghouse archive copy
        hits.sort(key=lambda r: (0 if "cornerstone.com" in (r.get("final_url") or r["url"]) or "nera.com" in r["url"] else 1))
        f = hits[0]
        url = f.get("final_url") or f["url"]
        if url in used:
            raise ValueError(f"{url} matched {used[url]} and {rid}")
        used[url] = rid
        info = json.load(open(cra_text.text_paths(f["sha256"])[1]))
        if date:
            date_text, date_basis = date, "printed on the report"
        elif _upload_month(url):
            date_text, date_basis = _upload_month(url), "month of the publisher's upload"
        else:
            created = info.get("pdf_created", "")[:10]
            date_text, date_basis = (created or "Not recorded"), ("PDF creation date" if created else "")
        out.append({
            "id": rid, "family": fam, "family_label": FAMILIES[fam], "publisher": publisher_of(rid, fam), "edition": ed,
            "period": per, "title": title, "date": date_text, "date_basis": date_basis, "pdf_url": url,
            "landing_url": f["url"] if f["url"] != url else None,
            "alt_urls": [h.get("final_url") or h["url"] for h in hits[1:]], "sha256": f["sha256"], "bytes": f["bytes"],
            "pages": info["pages"], "text_chars": info["chars"], "retrieved_at": f["retrieved_at"],
            "pdf_created": info.get("pdf_created", "")[:10],
        })
    return out


def unmatched() -> list[str]:
    """Fetched PDFs no registry entry claims (should be empty)."""
    claimed = {r["pdf_url"] for r in reports()} | {u for r in reports() for u in r["alt_urls"]}
    return sorted((r.get("final_url") or r["url"]) for r in cra_fetch.load_manifest().values()
                  if r.get("status") == 200 and "pdf" in (r.get("content_type") or "").lower()
                  and (r.get("final_url") or r["url"]) not in claimed)


if __name__ == "__main__":
    rs = reports()
    for r in rs:
        print(f"{r['id']:28s} {r['pages']:>3}p {r['date']:18s} {r['pdf_url'][-70:]}")
    print(len(rs), "reports;", "unmatched:", unmatched())
