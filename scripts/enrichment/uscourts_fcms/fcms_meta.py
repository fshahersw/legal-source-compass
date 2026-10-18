"""Static metadata for the FCMS datasets: measure labels and units, publisher definitions, headline measure lists.

Definition strings are copied from the publisher's own explanation files (acquired unchanged under
private/acq/uscourts_fcms/definitions/): explanation-of-selected-terms-2025.pdf (EST),
explanation_of_judicial_caseload_profiles_district.xlsx (DX, cell in brackets) and
explanation_of_judicial_caseload_profiles_appeals.xlsx (AX). Nothing here is read from the profile pages.
"""

SOURCE_TERMS = ("Work of the Administrative Office of the U.S. Courts published for public use on www.uscourts.gov; "
                "the site's Privacy & Security Policy page contains no data-use licence, form or click-through, and robots.txt "
                "does not disallow /data-news/ or /sites/default/files/. No account, form or agreement was used.")

LANDING_URL = "https://www.uscourts.gov/data-news/reports/statistical-reports/federal-court-management-statistics"
DEFINITION_URLS = {
    "EST": "https://www.uscourts.gov/sites/default/files/document/explanation-of-selected-terms-2025.pdf",
    "DX": "https://www.uscourts.gov/sites/default/files/2024-12/explanation_of_judicial_caseload_profiles_district.xlsx",
    "AX": "https://www.uscourts.gov/sites/default/files/2024-12/explanation_of_judicial_caseload_profiles_appeals.xlsx",
}

# measure key -> (label, unit, decimals, definition, source of the definition)
DISTRICT_MEASURES = {
    "filings": ("Filings", "count", 0, "Total civil and criminal felony cases (including transfers) filed and supervised release hearings held", "DX G3"),
    "terminations": ("Terminations", "count", 0, "Total civil and criminal felony cases (including transfers) terminated and supervised release hearings held", "DX G4"),
    "pending": ("Pending cases", "count", 0, "Total civil and criminal felony cases (including transfers) pending at the end of each year", "DX G5"),
    "pct_change_filings": ("Change in total filings, current period over the period of the column", "percent", 1,
                           "Percent change in total filings for current year over previous year / over prior two, three, four and five years (blank in the current-period column)", "DX G6, G7"),
    "judgeships": ("Authorized judgeships", "count", 0, "Number of authorized judgeships (not including senior judges)", "DX G8"),
    "vacant_judgeship_months": ("Vacant judgeship months", "months", 1, "Number of months during the year an authorized judgeship was not filled; the total number of months that vacancies occurred and are still vacant at the end of the reporting period", "DX G9; EST"),
    "pj_filings_total": ("Filings per judgeship", "per judgeship", 0, "Total filings divided by the number of authorized judgeships", "DX G10, I10"),
    "pj_filings_civil": ("Civil filings per judgeship", "per judgeship", 0, "Total civil cases filed, per authorized judgeship", "DX I11"),
    "pj_filings_felony": ("Criminal felony filings per judgeship", "per judgeship", 0, "Total criminal felony cases (including transfers) filed, per authorized judgeship", "DX I12"),
    "pj_supervised_release_hearings": ("Supervised release hearings per judgeship", "per judgeship", 0, "All court proceedings involving the modification of conditions or revocation of a defendant's supervised release, per authorized judgeship", "DX I13"),
    "pj_pending": ("Pending cases per judgeship", "per judgeship", 0, "Total civil and criminal felony cases (including transfers) pending at the end of the year, per authorized judgeship", "DX I14"),
    "pj_weighted_filings": ("Weighted filings per judgeship", "per judgeship", 0, "A mathematical weighting of Total Filings in which a quantitative value is assigned to a case based on the complexity of the case, per authorized judgeship", "DX I15; EST"),
    "pj_weighted_ci_upper": ("Weighted filings per judgeship, 95% confidence upper bound", "per judgeship", 0, "Upper bound printed under weighted filings (editions that print it)", "page"),
    "pj_weighted_ci_lower": ("Weighted filings per judgeship, 95% confidence lower bound", "per judgeship", 0, "Lower bound printed under weighted filings (editions that print it)", "page"),
    "pj_terminations": ("Terminations per judgeship", "per judgeship", 0, "Total civil and criminal felony cases (including transfers) terminated and supervised release hearings held, per authorized judgeship", "DX I16"),
    "pj_trials": ("Trials completed per judgeship", "per judgeship", 0, "Trials completed by district judges, including evidentiary trials, hearings on temporary restraining orders, and preliminary injunctions, per authorized judgeship", "DX I17"),
    "median_months_felony": ("Median months, criminal felony filing to disposition", "months", 1, "Time elapsed (in months) from the date of filing to the date of disposition for the middle (median) case of all closed cases; not computed when the district had fewer than 10 terminations", "DX G18, I18; EST"),
    "median_months_civil": ("Median months, civil filing to disposition", "months", 1, "All civil cases terminated by trial or other disposition, except those involving land condemnation, prisoner petitions, recovery of overpayments, enforcement of judgments, and deportation reviews", "DX G18, I19"),
    "median_months_civil_to_trial": ("Median months, civil filing to trial", "months", 1, "Time elapsed (in months) from the date of filing to the date trial begins for the middle (median) case of all civil cases going to trial under a district judge; not computed when the district had fewer than 10 civil trials", "DX G20"),
    "civil_over_3y_count": ("Civil cases over 3 years old", "count", 0, "Total number of civil cases pending more than three years as of the end of the year", "DX G21"),
    "civil_over_3y_pct": ("Civil cases over 3 years old, share of pending civil caseload", "percent", 1, "The percentage the civil cases pending more than three years represent of the pending civil caseload", "DX G21"),
    "felony_defendants_per_case": ("Average felony defendants filed per case", "average", 1, "Average number of felony defendants in each felony case filed", "DX G22"),
    "jurors_present_avg": ("Average jurors present for jury selection", "average", 1, "Average number of petit jurors reporting to court for jury selection", "DX G23"),
    "jurors_pct_not_selected": ("Jurors not selected or challenged", "percent", 1, "Percent of petit jurors neither selected nor challenged on jury selection days", "DX G24"),
}
CIRCUIT_MEASURES = {
    "filings": ("Appeals filed, total", "count", 0, "Total appeals filed, including reopened and reinstated appeals", "AX I3"),
    "filings_prisoner": ("Appeals filed, prisoner", "count", 0, "Civil filings comprising state and federal prisoner petitions only", "AX I4"),
    "filings_other": ("Appeals filed, other civil", "count", 0, "All other civil filings, original proceedings, and bankruptcy reviews", "AX I5"),
    "filings_criminal": ("Appeals filed, criminal", "count", 0, "All criminal appeals", "AX I6"),
    "filings_administrative": ("Appeals filed, administrative", "count", 0, "All petitions to review administrative agency decisions and applications for enforcement", "AX I7"),
    "pct_change_filings": ("Change in total filings, current period over the period of the column", "percent", 1, "Percent change in total filings for current year over previous year / over prior two, three, four and five years", "AX G8, G9"),
    "terminations": ("Appeals terminated, total", "count", 0, "Total cases disposed of", "AX I10"),
    "terminations_consolidations": ("Terminated by consolidation and cross appeals", "count", 0, "Includes cross appeals and appeals terminated through consolidation with a lead case", "AX I11"),
    "terminations_procedural": ("Procedural terminations", "count", 0, "Includes all dispositions (with and without judicial action) not based on the merits of the case", "AX I12"),
    "merits_terminations": ("Terminations on the merits, total", "count", 0, "Appeals based on the merits of the case; total cases disposed of", "AX I13, J13"),
    "merits_prisoner": ("Terminations on the merits, prisoner", "count", 0, "Prisoner petition dispositions", "AX J14"),
    "merits_other": ("Terminations on the merits, other civil", "count", 0, "All other civil, original proceeding, and bankruptcy dispositions", "AX J15"),
    "merits_criminal": ("Terminations on the merits, criminal", "count", 0, "Criminal dispositions", "AX J16"),
    "merits_administrative": ("Terminations on the merits, administrative", "count", 0, "Administrative agency dispositions", "AX J17"),
    "merits_pct_by_active_judges": ("Merits terminations by active judges", "percent", 1, "Percent of cases terminated by active judges of the court", "AX J18"),
    "pending": ("Pending appeals", "count", 0, "Pending cases at the end of the year", "AX I19"),
    "paj_merits_terminations": ("Terminations on the merits per active judge", "per active judge", 0, "Dispositions based on the merits, divided by the number of judges active during the entire 12-month period", "AX I20, G20"),
    "paj_procedural_terminations": ("Procedural terminations per active judge", "per active judge", 0, "Dispositions after judicial action not based on the merits, per active judge", "AX I21"),
    "paj_written_decisions": ("Written decisions per active judge, total", "per active judge", 0, "Written opinions or orders in cases disposed of on the merits, per active judge", "AX I22"),
    "paj_signed": ("Signed written decisions per active judge", "per active judge", 0, "Opinions authored and signed by a judge writing the majority opinion, per active judge", "AX I23"),
    "paj_unsigned": ("Unsigned written decisions per active judge", "per active judge", 0, "Unsigned opinions of the court that state the legal and factual elements and judgment rationale, per active judge", "AX I24"),
    "paj_without_comment": ("Written decisions without comment per active judge", "per active judge", 0, "Unsigned opinions or orders that do not state the legal and factual elements and judgment rationale, per active judge", "AX I25"),
    "judgeships": ("Authorized judgeships", "count", 0, "Authorized judgeships (not including senior judges)", "AX G29"),
    "panels": ("Authorized three-judge panels", "count", 1, "Authorized three-judge panels", "AX G29"),
    "senior_judges": ("Sitting senior judges", "count", 0, "Number of the court's own senior judges participating in case dispositions", "AX G30"),
    "vacant_judgeship_months": ("Vacant judgeship months", "months", 1, "Number of months during the year an authorized judgeship position was not filled", "AX G31"),
    "pp_filings": ("Appeals filed per panel, total", "per panel", 0, "Total appeals filed divided by the number of authorized panels (general docket)", "AX G32"),
    "pp_filings_prisoner": ("Appeals filed per panel, prisoner", "per panel", 0, "Prisoner appeals filed, per authorized panel", "AX I33"),
    "pp_filings_other": ("Appeals filed per panel, other civil", "per panel", 0, "Other civil appeals filed, per authorized panel", "AX I34"),
    "pp_filings_criminal": ("Appeals filed per panel, criminal", "per panel", 0, "Criminal appeals filed, per authorized panel", "AX I35"),
    "pp_filings_administrative": ("Appeals filed per panel, administrative", "per panel", 0, "Administrative appeals filed, per authorized panel", "AX I36"),
    "pp_terminations": ("Appeals terminated per panel, total", "per panel", 0, "Total cases disposed of, per authorized panel", "AX I37"),
    "pp_terminations_consolidations": ("Consolidations and cross appeals per panel", "per panel", 0, "Cross appeals and consolidations, per authorized panel", "AX I38"),
    "pp_terminations_procedural": ("Procedural terminations per panel", "per panel", 0, "Procedural dispositions, per authorized panel", "AX I39"),
    "pp_merits_terminations": ("Merits terminations per panel, total", "per panel", 0, "Dispositions on the merits, per authorized panel", "AX I40"),
    "pp_merits_prisoner": ("Merits terminations per panel, prisoner", "per panel", 0, "Prisoner dispositions on the merits, per authorized panel", "AX J41"),
    "pp_merits_other": ("Merits terminations per panel, other civil", "per panel", 0, "Other civil dispositions on the merits, per authorized panel", "AX J42"),
    "pp_merits_criminal": ("Merits terminations per panel, criminal", "per panel", 0, "Criminal dispositions on the merits, per authorized panel", "AX J43"),
    "pp_merits_administrative": ("Merits terminations per panel, administrative", "per panel", 0, "Administrative dispositions on the merits, per authorized panel", "AX J44"),
    "pp_pending": ("Pending appeals per panel", "per panel", 0, "Pending cases at the end of the year, per authorized panel", "AX I45"),
    "median_months_notice_to_disposition": ("Median months, notice of appeal to final disposition", "months", 1, "Time elapsed (in months) from the date of filing notice of appeal to the date of final disposition for the middle (median) case of all cases terminated on the merits", "AX G46"),
    "pj_interlocutory_applications": ("Applications for interlocutory appeals per judgeship", "per judgeship", 0, "Dispositions of applications for interlocutory appeals, per judgeship", "AX G47"),
    "pj_rehearing_petitions": ("Petitions for rehearing per judgeship", "per judgeship", 0, "Petitions for rehearing by panel or en banc, per judgeship", "AX G48"),
}

# Measures shown on the record card, kept as long series, ranked and compared year over year.
DISTRICT_HEADLINE = ["filings", "terminations", "pending", "judgeships", "vacant_judgeship_months", "pj_filings_total", "pj_weighted_filings",
                     "pj_pending", "pj_terminations", "pj_trials", "median_months_civil", "median_months_civil_to_trial",
                     "median_months_felony", "civil_over_3y_count", "civil_over_3y_pct"]
CIRCUIT_HEADLINE = ["filings", "terminations", "pending", "judgeships", "vacant_judgeship_months", "pp_filings", "pp_terminations", "pp_pending",
                    "merits_terminations", "median_months_notice_to_disposition"]
# Measures for which a longer time is slower / a bigger backlog (used only to name "slowest" and "fastest").
TIME_MEASURES = {"median_months_civil", "median_months_civil_to_trial", "median_months_felony", "median_months_notice_to_disposition"}
# Ranked lists: (measure, label for "highest", label for "lowest")
DISTRICT_RANKED = [
    ("median_months_civil", "Slowest civil disposition", "Fastest civil disposition"),
    ("median_months_civil_to_trial", "Longest time to civil trial", "Shortest time to civil trial"),
    ("median_months_felony", "Slowest criminal felony disposition", "Fastest criminal felony disposition"),
    ("civil_over_3y_pct", "Highest share of civil cases over 3 years old", "Lowest share of civil cases over 3 years old"),
    ("civil_over_3y_count", "Most civil cases over 3 years old", "Fewest civil cases over 3 years old"),
    ("pj_weighted_filings", "Highest weighted filings per judgeship", "Lowest weighted filings per judgeship"),
    ("pj_filings_total", "Highest filings per judgeship", "Lowest filings per judgeship"),
    ("pj_pending", "Highest pending cases per judgeship", "Lowest pending cases per judgeship"),
    ("pj_trials", "Most trials per judgeship", "Fewest trials per judgeship"),
    ("vacant_judgeship_months", "Most vacant judgeship months", "Fewest vacant judgeship months"),
    ("filings", "Most filings", "Fewest filings"),
    ("pending", "Most pending cases", "Fewest pending cases"),
]
CIRCUIT_RANKED = [
    ("median_months_notice_to_disposition", "Slowest median notice-of-appeal to disposition", "Fastest median notice-of-appeal to disposition"),
    ("pp_filings", "Most appeals filed per panel", "Fewest appeals filed per panel"),
    ("pp_pending", "Most pending appeals per panel", "Fewest pending appeals per panel"),
    ("pp_merits_terminations", "Most merits terminations per panel", "Fewest merits terminations per panel"),
    ("filings", "Most appeals filed", "Fewest appeals filed"),
    ("pending", "Most pending appeals", "Fewest pending appeals"),
    ("vacant_judgeship_months", "Most vacant judgeship months", "Fewest vacant judgeship months"),
]
# Change lists: (measure, minimum base value for a percentage change to be listed)
DISTRICT_CHANGES = [("filings", 100), ("pending", 100), ("terminations", 100), ("pj_weighted_filings", 50), ("median_months_civil", 1),
                    ("median_months_felony", 1), ("civil_over_3y_count", 20), ("civil_over_3y_pct", 1)]
CIRCUIT_CHANGES = [("filings", 100), ("pending", 100), ("terminations", 100), ("median_months_notice_to_disposition", 1)]

CIRCUIT_LABEL = {"cadc": "D.C. Circuit", "ca1": "First Circuit", "ca2": "Second Circuit", "ca3": "Third Circuit", "ca4": "Fourth Circuit",
                 "ca5": "Fifth Circuit", "ca6": "Sixth Circuit", "ca7": "Seventh Circuit", "ca8": "Eighth Circuit", "ca9": "Ninth Circuit",
                 "ca10": "Tenth Circuit", "ca11": "Eleventh Circuit"}

# Comparability breaks stated by the publisher (explanation-of-selected-terms-2025.pdf and the explanation workbooks).
COMPARABILITY_BREAKS = [
    {"measure": "criminal counts (filings, terminations, pending and their per-judgeship values)", "from": "March 2012",
     "statement": "Beginning in March 2012, criminal data in this profile count defendants rather than cases and therefore will not match previously published numbers.",
     "source": "DX A32; EST"},
    {"measure": "median_months_felony", "from": "March 2012",
     "statement": "Prior to March 2012, the median time interval was computed beginning with the defendant's filing date. Therefore, data for March 2012 and thereafter are not comparable to data for previous periods.",
     "source": "EST"},
    {"measure": "nature-of-suit codes", "from": "2005", "statement": "Prior to 2005, alphabetical codes corresponded to different offenses and natures of suit. Therefore, data for 2005 and thereafter are not comparable to data for earlier years.", "source": "EST"},
    {"measure": "pj_weighted_filings", "from": "2004", "statement": "In 2004, the Judicial Resources Committee approved a new civil and criminal case weighting system; weighted totals for prior years were revised on the new weights.", "source": "EST"},
    {"measure": "18 U.S.C. 3582(c) motions", "from": "October 1, 2025", "statement": "Interim case weights for motions to modify an imposed term of imprisonment under 18 U.S.C. 3582(c) are effective as of October 1, 2025.", "source": "EST"},
    {"measure": "terminations_consolidations (appeals)", "from": "December 2011", "statement": "Prior to December 2011, cases disposed of by consolidation and cross appeals were counted separately.", "source": "appeals profile footnote 2 (December 2012 edition)"},
]
STANDING_RULE = ("Numerical standing, as printed: all \"caseload\" statistics are ranked in descending order (highest value/largest caseload receives a rank of 1 - "
                 "e.g., civil filings per judgeship) and all other statistics are ranked in ascending order (lowest value/fastest termination rate or smallest backlog "
                 "is ranked first - e.g., median time). In some categories fewer than 94 courts are ranked because information was not available for all districts. (DX B31)")
