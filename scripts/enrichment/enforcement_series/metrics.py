"""Harmonised national workload metrics: which published row of which edition supplies each metric.

A metric is a named series (one value per fiscal year). For each edition that publishes it, a rule names the table heading and
row label exactly as printed (regular expressions anchored with ^ and $, case-insensitive). Every rule must match exactly one row
of its edition (or the `nth` row of several, after a named previous row); anything else raises, so a layout change can never
silently remap a figure. Where an edition prints no matching row the metric is "Not recorded" for those years.

Definitions changed between editions (see the footnotes the builder carries with each value). A harmonised series is therefore a
convenience for charts: every value keeps its edition, its page or table/row locator and its printed text.
"""
import re

E70, E80, E90, E00, E10, E15 = "fy1970_1979", "fy1980_1989", "fy1990_1999", "fy2000_2009", "fy2010_2019", "fy2015_2024"
ORDER = [E70, E80, E90, E00, E10, E15]  # oldest to newest publication; a later edition supersedes an earlier one for a shared fiscal year


def R(heading, label, nth=0, prev=None):
    return {"h": re.compile(heading, re.I), "l": re.compile(label, re.I), "nth": nth, "prev": re.compile(prev, re.I) if prev else None,
            "heading": heading, "label": label}


def _same(rule_by_editions, editions):
    return {e: rule_by_editions for e in editions}


def metric(key, label, unit, group, definition, rules, kind="count"):
    return {"key": key, "label": label, "unit": unit, "group": group, "definition": definition, "rules": rules, "kind": kind}


DASH = r"[:–\-]"  # headings print "RESTRAINT OF TRADE: CIVIL", "- CIVIL" or an en dash depending on the edition

METRICS = [
    # ---- criminal enforcement
    metric("crim_filed", "Criminal cases filed", "cases", "criminal", "Total criminal cases filed in the fiscal year (District Court Antitrust Cases, Total Criminal Cases, Filed).", {
        E70: R(r"^Total Criminal Cases$", r"^Filed$"), E80: R(r"^Total Criminal Cases$", r"^Filed$"), E90: R(r"^TOTAL CRIMINAL CASES$", r"^Filed$"),
        E00: R(r"^TOTAL CRIMINAL CASES$", r"^Filed$"), E10: R(r"^TOTAL CRIMINAL CASES$", r"^Filed$"), E15: R(r"^TOTAL CRIMINAL CASES$", r"^Total Criminal Cases Filed$")}),
    metric("crim_won", "Criminal cases won", "cases", "criminal", "Criminal cases terminated in a win (Total Criminal Cases, Won). Pleas count as wins in every edition's Terminated = Won + Lost + Dismissed arithmetic.", {
        E70: R(r"^Total Criminal Cases$", r"^Won$"), E80: R(r"^Total Criminal Cases$", r"^Won$"), E90: R(r"^TOTAL CRIMINAL CASES$", r"^Won$"),
        E00: R(r"^TOTAL CRIMINAL CASES$", r"^Won$"), E10: R(r"^TOTAL CRIMINAL CASES$", r"^Won$"), E15: R(r"^TOTAL CRIMINAL CASES$", r"^Won$")}),
    metric("crim_lost", "Criminal cases lost", "cases", "criminal", "Criminal cases terminated in a loss (Total Criminal Cases, Lost).", {
        E70: R(r"^Total Criminal Cases$", r"^Lost$"), E80: R(r"^Total Criminal Cases$", r"^Lost$"), E90: R(r"^TOTAL CRIMINAL CASES$", r"^Lost$"),
        E00: R(r"^TOTAL CRIMINAL CASES$", r"^Lost$"), E10: R(r"^TOTAL CRIMINAL CASES$", r"^Lost$"), E15: R(r"^TOTAL CRIMINAL CASES$", r"^Lost$")}),
    metric("crim_pending", "Criminal cases pending", "cases", "criminal", "Criminal cases pending at fiscal year end. The definition changed in FY1999 (new statistic), FY2009 and FY2019; see the footnotes.", {
        E70: R(r"^Total Criminal Cases$", r"^Pending$"), E80: R(r"^Total Criminal Cases$", r"^Pending$"), E90: R(r"^TOTAL CRIMINAL CASES$", r"^Pending$"),
        E00: R(r"^TOTAL CRIMINAL CASES$", r"^Pending$"), E10: R(r"^TOTAL CRIMINAL CASES$", r"^Pending$"), E15: R(r"^TOTAL CRIMINAL CASES$", r"^Pending$")}),
    metric("crim_sherman1_filed", "Criminal Sherman Act section 1 cases filed", "cases", "criminal", "Criminal cases charging a Sherman Act section 1 (restraint of trade) violation, Filed.", {
        E70: R(r"^Restraint of Trade - Criminal$", r"^Filed$"), E80: R(r"^Restraint of Trade - Criminal$", r"^Filed$"), E90: R(r"^RESTRAINT OF TRADE: CRIMINAL \(SHERMAN §1\)$", r"^Filed$"),
        E00: R(r"^RESTRAINT OF TRADE - CRIMINAL \(SHERMAN §1\)$", r"^Filed$"), E10: R(r"^RESTRAINT OF TRADE - CRIMINAL \(SHERMAN §1\)$", r"^Filed$"),
        E15: R(r"^CRIMINAL - SHERMAN § 1$", r"^Total Sherman § 1 Cases Filed$")}),
    metric("crim_individuals_charged", "Individuals charged (criminal cases filed)", "individuals", "criminal", "Individuals charged in criminal cases filed in the fiscal year. Not published before FY1990.", {
        E90: R(r"^Criminal Cases Filed$", r"^Individuals Charged$"), E00: R(r"^Criminal Cases Filed$", r"^Individuals Charged$"), E10: R(r"^Criminal Cases Filed$", r"^Individuals Charged$"),
        E15: R(r"^CRIMINAL INVESTIGATIONS$", r"^Individuals Charged$")}),
    metric("crim_corporations_charged", "Corporations charged (criminal cases filed)", "corporations", "criminal", "Corporations charged in criminal cases filed in the fiscal year. Not published before FY1990.", {
        E90: R(r"^Criminal Cases Filed$", r"^Corporations Charged$"), E00: R(r"^Criminal Cases Filed$", r"^Corporations Charged$"), E10: R(r"^Criminal Cases Filed$", r"^Corporations Charged$"),
        E15: R(r"^CRIMINAL INVESTIGATIONS$", r"^Corporations Charged$")}),
    metric("gj_initiated", "Grand jury investigations initiated", "investigations", "criminal", "Grand jury investigations initiated in the fiscal year.", {
        E70: R(r"^Grand Juries$", r"^Initiated$"), E80: R(r"^Grand Juries$", r"^Initiated$"), E90: R(r"^Criminal Investigations: Grand Jury Investigations$", r"^Initiated$"),
        E00: R(r"^Grand Jury Investigations$", r"^Initiated$"), E10: R(r"^Grand Jury Investigations$", r"^Initiated$"), E15: R(r"^CRIMINAL INVESTIGATIONS$", r"^Initiated$")}),
    metric("gj_closed", "Grand jury investigations terminated or closed", "investigations", "criminal", "Grand jury investigations terminated (printed 'Terminated' through FY2019, 'Closed' in the FY2015-2024 edition).", {
        E70: R(r"^Grand Juries$", r"^Terminated$"), E80: R(r"^Grand Juries$", r"^Terminated$"), E90: R(r"^Criminal Investigations: Grand Jury Investigations$", r"^Terminated$"),
        E00: R(r"^Grand Jury Investigations$", r"^Terminated$"), E10: R(r"^Grand Jury Investigations$", r"^Terminated$"), E15: R(r"^CRIMINAL INVESTIGATIONS$", r"^Closed$")}),
    metric("gj_pending", "Grand jury investigations pending", "investigations", "criminal", "Grand jury investigations pending at fiscal year end.", {
        E70: R(r"^Grand Juries$", r"^Pending$"), E80: R(r"^Grand Juries$", r"^Pending$"), E90: R(r"^Criminal Investigations: Grand Jury Investigations$", r"^Pending$"),
        E00: R(r"^Grand Jury Investigations$", r"^Pending$"), E10: R(r"^Grand Jury Investigations$", r"^Pending$"), E15: R(r"^CRIMINAL INVESTIGATIONS$", r"^Pending$")}),
    # ---- fines and sentences
    metric("fine_individual_000", "Individual criminal fines imposed", "$ thousands", "fines", "Total fines imposed on individuals in the fiscal year, in thousands of dollars as printed.", {
        E70: R(r"^Indictments, Fines, and Sentences$", r"^Total Amount Individual Fines \(\$000\)$"), E80: R(r"^Indictments, Fines, and Sentences$", r"^Total Amount Individual Fines \(\$000\)$"),
        E90: R(r"^FINES IMPOSED$", r"^Individual: Total Fines \(\$000\)$"), E00: R(r"^FINES IMPOSED$", r"^Individual: Total Individual Fines \(\$000\)$"),
        E10: R(r"^CRIMINAL FINES & PENALTIES IMPOSED$", r"^Individual: Total Individual Fines \(\$000\)$"), E15: R(r"^CRIMINAL FINES & PENALITES IMPOSED$", r"^Total Individual Fines \(\$000\)$")}, kind="usd000"),
    metric("fine_individuals_n", "Individuals fined", "individuals", "fines", "Number of individuals fined.", {
        E70: R(r"^Indictments, Fines, and Sentences$", r"^No\. Individuals$"), E80: R(r"^Indictments, Fines, and Sentences$", r"^No\. Individuals Fined$"),
        E90: R(r"^FINES IMPOSED$", r"^Number of Individuals Fined$"), E00: R(r"^FINES IMPOSED$", r"^Number of Individuals Fined$"),
        E10: R(r"^CRIMINAL FINES & PENALTIES IMPOSED$", r"^Number of Individuals Fined$"), E15: R(r"^CRIMINAL FINES & PENALITES IMPOSED$", r"^Number of Individuals Fined$")}),
    metric("fine_corporate_000", "Corporate criminal fines imposed", "$ thousands", "fines", "Total fines (and, from FY2010, penalties) imposed on corporations, in thousands of dollars. The FY1970-1979 label prints no unit; the table's other dollar rows are in $000.", {
        E70: R(r"^Indictments, Fines, and Sentences$", r"^Total Corporations Fines$"), E80: R(r"^Indictments, Fines, and Sentences$", r"^Total Corporations Fines \(\$000\)$"),
        E90: R(r"^FINES IMPOSED$", r"^Corporate: Total Fines \(\$000\)$"), E00: R(r"^FINES IMPOSED$", r"^Corporate: Total Corporate Fines \(\$000\)$"),
        E10: R(r"^CRIMINAL FINES & PENALTIES IMPOSED$", r"^Corporate: Total Corporate Fines & Penalties \(\$000\)$"), E15: R(r"^CRIMINAL FINES & PENALITES IMPOSED$", r"^Total Corporate Fines & Penalties \(\$000\)$")}, kind="usd000"),
    metric("fine_corporations_n", "Corporations fined", "corporations", "fines", "Number of corporations paying fines (and penalties).", {
        E70: R(r"^Indictments, Fines, and Sentences$", r"^No\. of Corporations$", nth=0, prev=r"^Total Corporations Fines$"), E80: R(r"^Indictments, Fines, and Sentences$", r"^No\. of Corporations Fined$"),
        E90: R(r"^FINES IMPOSED$", r"^Number of Corporations Fined$"), E00: R(r"^FINES IMPOSED$", r"^Number of Corporations Fined$"),
        E10: R(r"^CRIMINAL FINES & PENALTIES IMPOSED$", r"^Number of Corporations Paying Fines & Penalties$"), E15: R(r"^CRIMINAL FINES & PENALITES IMPOSED$", r"^Number of Corporations Paying Fines & Penalties$")}),
    metric("fine_total_000", "Total criminal fines and penalties imposed", "$ thousands", "fines", "Total criminal fines (and, from FY2010, penalties) imposed by courts in the fiscal year, as printed. Not printed before FY1990; see fine_total_000_computed.", {
        E90: R(r"^FINES IMPOSED$", r"^Total Fines Imposed \(\$000\)$"), E00: R(r"^FINES IMPOSED$", r"^Total Fines Imposed \(\$000\)$"),
        E10: R(r"^CRIMINAL FINES & PENALTIES IMPOSED$", r"^Total Fines & Penalties Imposed \(\$000\)$"), E15: R(r"^CRIMINAL FINES & PENALITES IMPOSED$", r"^Total Fines & Penalties Imposed \(\$000\)$")}, kind="usd000"),
    metric("restitution_000", "Criminal restitution and victim compensation imposed", "$ thousands", "fines", "Restitution imposed in connection with criminal cases, in thousands of dollars. Not printed before FY1990.", {
        E90: R(r"^OTHER CASE RESULTS$", r"^Restitution Imposed in Connection with Criminal Cases \(\$000\)$"), E00: R(r"^OTHER CASE RESULTS$", r"^Restitution Imposed in Connection with Criminal Cases \(\$000\)$"),
        E10: R(r"^OTHER CASE RESULTS$", r"^Restitution Imposed in Connection with Criminal Cases \(\$000\)$"), E15: R(r"^RESITUTION AND VICTIM COMPENSATION$", r"^Restitution and Victim Compensation Imposed \(\$000\)$")}, kind="usd000"),
    metric("hsr_penalties_000", "Hart-Scott-Rodino civil penalties", "$ thousands", "fines", "Civil penalties for Hart-Scott-Rodino Act violations, in thousands of dollars. Not printed before FY1984 (a dash is printed for earlier years in the FY1980-1989 edition).", {
        E80: R(r"^H-S-R Penalties$", r"^Total Penalties \(\$000\)$"), E90: R(r"^OTHER CASE RESULTS$", r"^HSR Penalties \(\$000\)$"), E00: R(r"^OTHER CASE RESULTS$", r"^HSR Penalties \(\$000\)$"),
        E10: R(r"^OTHER CASE RESULTS$", r"^HSR Penalties \(\$000\)$"), E15: R(r"^OTHER CIVIL ENFORCEMENT STATISTICS$", r"^HSR Penalties \(15 U\.S\.C\. §18A\) \(\$000\)$")}, kind="usd000"),
    metric("indiv_sentenced", "Individuals sentenced", "individuals", "sentences", "Number of individuals sentenced. Printed from FY1990.", {
        E90: R(r"^INCARCERATION$", r"^Number of Individuals Sentenced$"), E00: R(r"^INCARCERATION$", r"^Number of Individuals Sentenced$"),
        E10: R(r"^INCARCERATION$", r"^Number of Individuals Sentenced$"), E15: R(r"^INCARCERATION$", r"^Number of Individuals Sentenced$")}),
    metric("indiv_incarcerated", "Individuals sentenced to incarceration", "individuals", "sentences", "Number of individuals sentenced to incarceration time. Printed from FY1990.", {
        E90: R(r"^INCARCERATION$", r"^Number of Individuals Sentenced to Incarceration Time$"), E00: R(r"^INCARCERATION$", r"^Number of Individuals Sentenced to Incarceration Time$"),
        E10: R(r"^INCARCERATION$", r"^Number of Individuals Sentenced to Incarceration Time$"), E15: R(r"^INCARCERATION$", r"^Number of Individuals Sentenced to Incarceration Time$")}),
    metric("incarceration_days_total", "Total days of incarceration imposed", "days", "sentences", "Total number of actual days of incarceration imposed by the court. Printed for FY1990-2009 only.", {
        E90: R(r"^INCARCERATION$", r"^Total Number of Actual Days of Incarceration Imposed by the Court$"), E00: R(r"^INCARCERATION$", r"^Total Number of Actual Days of Incarceration Imposed by the Court$")}),
    metric("incarceration_days_avg_published", "Average days of incarceration (as printed)", "days", "sentences", "Average number of days of incarceration, as printed from FY2010.", {
        E10: R(r"^INCARCERATION$", r"^Average Number of Days of Incarceration$"), E15: R(r"^INCARCERATION$", r"^Average Number of Days of Incarceration$")}),
    # ---- civil enforcement
    metric("civil_filed", "Civil cases filed", "cases", "civil", "Civil antitrust cases filed in district court (Total Civil Cases, Filed). The FY2015-2024 edition prints merger and conduct complaints separately; see civil_filed_computed.", {
        E70: R(r"^Total Civil Cases$", r"^Filed$"), E80: R(r"^Total Civil Cases$", r"^Filed$"), E90: R(r"^TOTAL CIVIL CASES$", r"^Filed$"), E00: R(r"^TOTAL CIVIL CASES$", r"^Filed$"), E10: R(r"^TOTAL CIVIL CASES$", r"^Filed$")}),
    metric("civil_pending", "Civil cases pending", "cases", "civil", "Civil cases pending at fiscal year end. The definition was updated in FY2019 and FY2010-2018 were recalculated (FY2010-2019 footnote 12); the FY2015-2024 edition prints a different 'Pending Litigation' measure that is not mapped here.", {
        E70: R(r"^Total Civil Cases$", r"^Pending$"), E80: R(r"^Total Civil Cases$", r"^Pending$"), E90: R(r"^TOTAL CIVIL CASES$", r"^Pending$"), E00: R(r"^TOTAL CIVIL CASES$", r"^Pending$"), E10: R(r"^TOTAL CIVIL CASES$", r"^Pending$")}),
    metric("civil_sherman1_filed", "Civil Sherman Act section 1 cases filed", "cases", "civil", "Civil restraint-of-trade cases filed. Not printed after FY2019.", {
        E70: R(r"^Restraint of Trade - Civil$", r"^Filed$"), E80: R(r"^Restraint of Trade-Civil$", r"^Filed$"), E90: R(r"^RESTRAINT OF TRADE: CIVIL \(SHERMAN §1\)$", r"^Filed$"),
        E00: R(r"^RESTRAINT OF TRADE - CIVIL \(SHERMAN §1\)$", r"^Filed$"), E10: R(r"^RESTRAINT OF TRADE . CIVIL \(SHERMAN §1\)$", r"^Filed$")}),
    metric("civil_monopoly_filed", "Civil monopoly cases filed", "cases", "civil", "Civil monopolization cases filed (titled 'Oligopoly and Monopoly - Civil' through FY1989 and 'Monopoly: Civil (Sherman §2)' from FY1990). Not printed after FY2019.", {
        E70: R(r"^Oligopoly and Monopoly - Civil$", r"^Filed$"), E80: R(r"^Oligopoly and Monopoly - Civil$", r"^Filed$"), E90: R(r"^MONOPOLY: CIVIL \(SHERMAN §2\)$", r"^Filed$"),
        E00: R(r"^MONOPOLY - CIVIL \(SHERMAN §2\)$", r"^Filed$"), E10: R(r"^MONOPOLY . CIVIL \(SHERMAN §2\)$", r"^Filed$")}),
    metric("merger_complaints_filed", "Merger complaints filed", "cases", "civil", "Merger cases (Clayton Act section 7) filed in district court.", {
        E70: R(r"^Merger Cases$", r"^Filed$"), E80: R(r"^Merger Cases$", r"^Filed$"), E90: R(r"^MERGER CASES \(CLAYTON §7\)$", r"^Filed$"), E00: R(r"^MERGER CASES \(CLAYTON §7\)$", r"^Filed$"),
        E10: R(r"^MERGER CASES$", r"^Filed$"), E15: R(r"^CIVIL LITIGATION$", r"^Total Merger Complaints Filed$")}),
    metric("conduct_complaints_filed", "Non-merger (conduct) civil complaints filed", "cases", "civil", "Civil actions filed in district court from non-merger investigations. Not printed before FY1990 in this form.", {
        E90: R(r"^CIVIL INVESTIGATION RESULTS$", r"^Non-Merger Investigations: Actions Filed in District Court$"), E00: R(r"^Civil Investigation Results$", r"^Non-Merger Investigations: Actions Filed in District Court$"),
        E10: R(r"^Civil Investigation Results$", r"^Non-Merger Investigations: Actions Filed in District Court$"), E15: R(r"^CIVIL LITIGATION$", r"^Total Conduct Complaints Filed$")}),
    # ---- investigations and merger review
    metric("inv_sherman1", "Investigations initiated: Sherman Act section 1", "investigations", "investigations", "Investigations initiated by primary type of conduct, Sherman section 1. Not printed after FY2019.", {
        E70: R(r"^Total Investigations by Type of Conduct$", r"^Sherman §1$"), E80: R(r"^Total Investigations by Type of Conduct$", r"^Sherman §1$"),
        E90: R(r"^Total Investigations Initiated, by Primary Type of Conduct$", r"^Sherman §1 - Restraint of Trade$"), E00: R(r"^Total Investigations Initiated, by Primary Type of Conduct$", r"^Sherman §1 - Restraint of Trade$"),
        E10: R(r"^Total Investigations Initiated, by Primary Type of Conduct$", r"^Sherman §1 - Restraint of Trade$")}),
    metric("inv_sherman2", "Investigations initiated: Sherman Act section 2", "investigations", "investigations", "Investigations initiated by primary type of conduct, Sherman section 2 (monopoly). Not printed after FY2019.", {
        E70: R(r"^Total Investigations by Type of Conduct$", r"^Sherman §2$"), E80: R(r"^Total Investigations by Type of Conduct$", r"^Sherman §2$"),
        E90: R(r"^Total Investigations Initiated, by Primary Type of Conduct$", r"^Sherman §2 - Monopoly$"), E00: R(r"^Total Investigations Initiated, by Primary Type of Conduct$", r"^Sherman §2 - Monopoly$"),
        E10: R(r"^Total Investigations Initiated, by Primary Type of Conduct$", r"^Sherman §2 - Monopoly$")}),
    metric("inv_clayton7", "Investigations initiated: Clayton Act section 7 (mergers)", "investigations", "investigations", "Investigations initiated by primary type of conduct, Clayton section 7 (mergers). Not printed after FY2019.", {
        E70: R(r"^Total Investigations by Type of Conduct$", r"^Clayton §7$"), E80: R(r"^Total Investigations by Type of Conduct$", r"^Clayton §7$"),
        E90: R(r"^Total Investigations Initiated, by Primary Type of Conduct$", r"^Clayton §7 - Mergers$"), E00: R(r"^Total Investigations Initiated, by Primary Type of Conduct$", r"^Clayton §7 - Mergers$"),
        E10: R(r"^Total Investigations Initiated, by Primary Type of Conduct$", r"^Clayton §7 - Mergers$")}),
    metric("hsr_received", "Hart-Scott-Rodino premerger notifications received", "filings", "merger_review", "HSR premerger notifications received (printed 'Received'; 'Total HSR Transactions Filed' in the FY2015-2024 edition). The Act took effect in FY1978.", {
        E70: R(r"^Premerger Notification$", r"^Received$"), E80: R(r"^Premerger Notifications$", r"^Received$"), E90: R(r"^Hart-Scott-Rodino \(HSR\) Premerger Notifications$", r"^Received$"),
        E00: R(r"^Hart-Scott-Rodino \(HSR\) Premerger Notifications$", r"^Received$"), E10: R(r"^Hart-Scott-Rodino \(HSR\) Premerger Notifications$", r"^Received$"),
        E15: R(r"^MERGER INVESTIGATIONS$", r"^Total HSR Transactions Filed$")}),
    metric("hsr_investigations", "HSR investigations initiated", "investigations", "merger_review", "Investigations initiated from HSR premerger notifications.", {
        E70: R(r"^Premerger Notification$", r"^Investigations initiated$"), E80: R(r"^Premerger Notifications$", r"^Investigations initiated$"),
        E90: R(r"^Hart-Scott-Rodino \(HSR\) Premerger Notifications$", r"^HSR Investigations Initiated$"), E00: R(r"^Hart-Scott-Rodino \(HSR\) Premerger Notifications$", r"^HSR Investigations Initiated$"),
        E10: R(r"^Hart-Scott-Rodino \(HSR\) Premerger Notifications$", r"^HSR Investigation Initiated$"), E15: R(r"^MERGER INVESTIGATIONS$", r"^Total HSR Investigations Opened$")}),
    metric("second_requests", "Second requests issued", "requests", "merger_review", "HSR second requests issued in the fiscal year. Not printed before FY1990.", {
        E90: R(r"^Merger Investigations$", r"^Merger Investigations \(Second Requests\)$"), E00: R(r"^Merger Investigations$", r"^HSR Investigations: Second Requests$"),
        E10: R(r"^Merger Investigations$", r"^HSR Investigations: Second Requests Issued$"), E15: R(r"^MERGER INVESTIGATIONS$", r"^Second Requests Issued$")}),
    metric("merger_investigations", "Merger investigations", "investigations", "merger_review", "Merger investigations (HSR and non-HSR). Printed 'Total Number' through FY2019 and 'Total Merger Investigations Opened in Fiscal Year' in the FY2015-2024 edition.", {
        E90: R(r"^Merger Investigations$", r"^Total Number$"), E00: R(r"^Merger Investigations$", r"^Total Number \(HSR and Non-HSR Investigations\)$"),
        E10: R(r"^Merger Investigations$", r"^Total Number \(HSR and Non-HSR Investigations\)$"), E15: R(r"^MERGER INVESTIGATIONS$", r"^Total Merger Investigations Opened in Fiscal Year$")}),
    metric("merger_challenges", "Merger challenges", "investigations", "merger_review", "Merger investigations in which the Division concluded the transaction would lessen competition (public challenges). Printed FY1990-2019 only.", {
        E90: R(r"^CIVIL INVESTIGATION RESULTS$", r"^Merger Investigations: Total Number of Public Challenges$"), E00: R(r"^Civil Investigation Results$", r"^Merger Investigations: Total Number of Public Challenges$"),
        E10: R(r"^Civil Investigation Results$", r"^Merger Investigations: Total Number of Merger Challenges$")}),
    metric("cids_total", "Civil investigative demands issued", "demands", "investigations", "Civil investigative demands issued (total). FY1980 onward.", {
        E70: R(r"^CIDs$", r"^No\. of CIDs issued$"), E80: R(r"^CIDs Issued$", r"^Total Number$"), E90: R(r"^CIDs Issued$", r"^Total Number$"), E00: R(r"^CIDs Issued$", r"^Total number$"),
        E10: R(r"^Civil Investigative Demands Issued$", r"^Total Number$"), E15: R(r"^OTHER CIVIL ENFORCEMENT STATISTICS$", r"^Total Civil Investigative Demands Issued$")}),
    metric("prelim_inquiries", "Preliminary inquiries initiated", "inquiries", "investigations", "Preliminary inquiries initiated. Not printed after FY2019.", {
        E70: R(r"^Preliminary Inquiries$", r"^Initiated$"), E80: R(r"^Preliminary Inquiries$", r"^Initiated$"), E90: R(r"^Total Preliminary Inquiries: Criminal, Civil Non-Merger, and Merger$", r"^Initiated$"),
        E00: R(r"^Total Preliminary Inquiries: Criminal, Civil Non-Merger, and Merger$", r"^Initiated$"), E10: R(r"^Total Preliminary Inquiries: Criminal, Civil Non-Merger, and Merger$", r"^Initiated$")}),
    metric("business_reviews", "Business reviews requested", "requests", "advocacy", "Business review letter requests received.", {
        E70: R(r"^Business Reviews$", r"^Requested$"), E80: R(r"^Business Reviews$", r"^Requested$"), E90: R(r"^Business Reviews$", r"^Requested$"), E00: R(r"^Business Reviews$", r"^Requested$"),
        E10: R(r"^Business Reviews$", r"^Requested$"), E15: R(r"^BUSINESS REVIEWS$", r"^Total Business Reviews Requested$")}),
    metric("bank_merger_screenings", "Bank merger screenings / applications", "applications", "merger_review", "Bank merger proceedings screened by the Division (printed 'Bank Merger Screenings', 'Total Screenings', 'Total Applications', 'Total Bank Merger Applications Received').", {
        E70: R(r"^PARTICIPATION IN BANK MERGER PROCEEDINGS$", r"^Bank Merger Screenings$"), E80: R(r"^PARTICIPATION IN BANK MERGER PROCEEDINGS$", r"^Total Screenings$"),
        E90: R(r"^PARTICIPATION IN BANK MERGER PROCEEDINGS$", r"^Total Screenings$"), E00: R(r"^PARTICIPATION IN BANK MERGER PROCEEDINGS$", r"^Total Screenings$"),
        E10: R(r"^BANK MERGER APPLICATIONS$", r"^Total Applications$"), E15: R(r"^OTHER CIVIL ENFORCEMENT STATISTICS$", r"^Total Bank Merger Applications Received$")}),
    metric("divestitures", "Divestitures (judgment enforcement)", "divestitures", "judgments", "Divestitures completed under judgments. Not printed after FY2019.", {
        E70: R(r"^Judgment Enforcement$", r"^Divestitures$"), E80: R(r"^JUDGMENT ENFORCEMENT$", r"^Divestitures$"), E90: R(r"^JUDGMENT ENFORCEMENT$", r"^Divestitures$"),
        E00: R(r"^JUDGMENT ENFORCEMENT$", r"^Divestitures$"), E10: R(r"^JUDGMENT ENFORCEMENT$", r"^Divestitures$")}),
    metric("appeals_filed", "Division appeals filed (courts of appeals)", "appeals", "appellate", "Antitrust Division cases filed in the courts of appeals.", {
        E70: R(r"^Antitrust Division Cases Court of Appeals$", r"^Filed$"), E80: R(r"^Antitrust Division Cases Court of Appeals$", r"^Filed$"), E90: R(r"^ANTITRUST DIVISION CASES COURT OF APPEALS$", r"^Filed$"),
        E00: R(r"^ANTITRUST DIVISION CASES COURT OF APPEALS$", r"^Filed$"), E10: R(r"^ANTITRUST DIVISION CASES COURT OF APPEALS$", r"^Filed$"), E15: R(r"^ANTIRUST DIVISION CASES COURT OF APPEALS$", r"^Filed$")}),
    metric("appeals_won", "Division appeals won (courts of appeals)", "appeals", "appellate", "Antitrust Division appeals resolved as a win.", {
        E70: R(r"^Antitrust Division Cases Court of Appeals$", r"^Won$"), E80: R(r"^Antitrust Division Cases Court of Appeals$", r"^Won$"), E90: R(r"^ANTITRUST DIVISION CASES COURT OF APPEALS$", r"^Won$"),
        E00: R(r"^ANTITRUST DIVISION CASES COURT OF APPEALS$", r"^Won$"), E10: R(r"^ANTITRUST DIVISION CASES COURT OF APPEALS$", r"^Won$"), E15: R(r"^ANTIRUST DIVISION CASES COURT OF APPEALS$", r"^Won$")}),
    metric("appeals_lost", "Division appeals lost (courts of appeals)", "appeals", "appellate", "Antitrust Division appeals resolved as a loss.", {
        E70: R(r"^Antitrust Division Cases Court of Appeals$", r"^Lost$"), E80: R(r"^Antitrust Division Cases Court of Appeals$", r"^Lost$"), E90: R(r"^ANTITRUST DIVISION CASES COURT OF APPEALS$", r"^Lost$"),
        E00: R(r"^ANTITRUST DIVISION CASES COURT OF APPEALS$", r"^Lost$"), E10: R(r"^ANTITRUST DIVISION CASES COURT OF APPEALS$", r"^Lost$"), E15: R(r"^ANTIRUST DIVISION CASES COURT OF APPEALS$", r"^Lost$")}),
]
BY_KEY = {m["key"]: m for m in METRICS}


class RuleError(Exception):
    pass


def select_row(edition_tables, rule):
    """The single (table, row) the rule names, or raise: no match, or an ambiguous match, is an error, never a guess."""
    found = []
    for t in edition_tables:
        if not rule["h"].search(t["heading"]):
            continue
        for i, r in enumerate(t["rows"]):
            if rule["l"].fullmatch(r["label"]):
                if rule["prev"] is not None:
                    before = t["rows"][i - 1]["label"] if i > 0 else ""
                    if not rule["prev"].fullmatch(before):
                        continue
                found.append((t, r))
    if rule["prev"] is None and len(found) != 1:
        raise RuleError(f"rule {rule['heading']!r} / {rule['label']!r} matched {len(found)} rows")
    if rule["prev"] is not None and len(found) != 1:
        raise RuleError(f"rule {rule['heading']!r} / {rule['label']!r} after {rule['prev'].pattern!r} matched {len(found)} rows")
    return found[0]
