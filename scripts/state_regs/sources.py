"""Coverage registry: the official publisher of each state's administrative code and of its register (51 jurisdictions).

Every entry names the official government publisher and the address the stream reads. `status`:
  official_free      the state's own publisher serves the current code text free of charge (acquired here);
  official_partial   the state's own publisher serves only part of the code or only per-agency files;
  vendor_operated    the state's own domain serves the code, but a commercial vendor operates it and claims copyright in
                     the text: index metadata only, text not copied;
  commercial_only    the official code is published only through a commercial vendor: BLOCKED. The vendor host is never
                     fetched; index-level metadata may come from the state's own pages (register, agency lists);
  paid_official      the official code is sold by the state (no free official text): BLOCKED for text;
  no_compiled_code   the state publishes no compiled code (rules live on agency pages).

`access` is how the text is served: api (JSON), html (one page per rule/section or chapter), pdf (one file per
chapter/rule), bulk (downloadable files). `register` is the official rulemaking bulletin (None when the state publishes
none). Robots verdicts, HTTP status, currency statements and terms are measured by probe.py and stored in
private/build/w1025_regs/coverage.json (never assumed here).
"""
from __future__ import annotations

SOURCES: list[dict] = [
    {"state": "AL", "code": "Alabama Administrative Code", "cite": "Ala. Admin. Code r.", "publisher": "Alabama Legislative Services Agency, Legal Division",
     "code_url": "https://admincode.legislature.state.al.us/administrative-code", "access": "api", "status": "official_free",
     "register": "Alabama Administrative Monthly", "register_url": "https://admincode.legislature.state.al.us/administrative-monthly", "register_freq": "monthly"},
    {"state": "AK", "code": "Alaska Administrative Code", "cite": "Alaska Admin. Code tit.", "publisher": "Alaska State Legislature (Legislative Affairs Agency)",
     "code_url": "https://www.akleg.gov/basis/aac.asp", "access": "html", "status": "official_free",
     "register": "Alaska Administrative Register", "register_url": "https://www.akleg.gov/basis/aac.asp#register", "register_freq": "quarterly"},
    {"state": "AZ", "code": "Arizona Administrative Code", "cite": "Ariz. Admin. Code", "publisher": "Arizona Secretary of State, Administrative Rules Division",
     "code_url": "https://apps.azsos.gov/public_services/CodeTOC.htm", "access": "pdf", "status": "official_free",
     "register": "Arizona Administrative Register", "register_url": "https://azsos.gov/rules/arizona-administrative-register", "register_freq": "weekly"},
    {"state": "AR", "code": "Code of Arkansas Rules", "cite": "Ark. Code R.", "publisher": "Arkansas Legislative Council, Bureau of Legislative Research",
     "code_url": "https://codeofarrules.arkansas.gov/", "access": "html", "status": "official_free",
     "register": "Arkansas Register", "register_url": "https://www.sos.arkansas.gov/rules-regulations/arkansas-register/", "register_freq": "monthly"},
    {"state": "CA", "code": "California Code of Regulations", "cite": "Cal. Code Regs. tit.", "publisher": "California Office of Administrative Law",
     "code_url": "https://oal.ca.gov/publications/ccr/", "access": "none", "status": "commercial_only",
     "blocked": "The official online CCR is hosted on a commercial vendor's site (Westlaw); not fetched. Index metadata only from oal.ca.gov.",
     "register": "California Regulatory Notice Register", "register_url": "https://oal.ca.gov/publications/notice_register/", "register_freq": "weekly"},
    {"state": "CO", "code": "Code of Colorado Regulations", "cite": "Colo. Code Regs.", "publisher": "Colorado Secretary of State",
     "code_url": "https://www.sos.state.co.us/CCR/NumericalDeptList.do", "access": "pdf", "status": "official_free",
     "register": "Colorado Register", "register_url": "https://www.sos.state.co.us/CCR/RegisterHome.do", "register_freq": "semi-monthly"},
    {"state": "CT", "code": "Regulations of Connecticut State Agencies", "cite": "Conn. Agencies Regs.", "publisher": "Connecticut Secretary of the State (eRegulations System)",
     "code_url": "https://eregulations.ct.gov/eRegsPortal/Browse/RCSA", "access": "html", "status": "official_free",
     "register": "eRegulations System notices (Connecticut Law Journal publishes legal notices)", "register_url": "https://eregulations.ct.gov/eRegsPortal/Search/RMRView", "register_freq": "continuous"},
    {"state": "DE", "code": "Delaware Administrative Code", "cite": "Del. Admin. Code", "publisher": "Delaware Registrar of Regulations (Division of Research, Legislative Council)",
     "code_url": "https://regulations.delaware.gov/AdminCode/", "access": "html", "status": "official_free",
     "register": "Delaware Register of Regulations", "register_url": "https://regulations.delaware.gov/register/", "register_freq": "monthly"},
    {"state": "DC", "code": "District of Columbia Municipal Regulations", "cite": "D.C. Mun. Regs. tit.", "publisher": "D.C. Office of Documents and Administrative Issuances",
     "code_url": "https://www.dcregs.dc.gov/Common/DCMR/TitleList.aspx", "access": "html", "status": "official_free",
     "register": "District of Columbia Register", "register_url": "https://www.dcregs.dc.gov/Common/DCR/Issues/IssueList.aspx", "register_freq": "weekly"},
    {"state": "FL", "code": "Florida Administrative Code", "cite": "Fla. Admin. Code R.", "publisher": "Florida Department of State, Administrative Code and Register",
     "code_url": "https://www.flrules.org/gateway/organization.asp", "access": "html", "status": "official_free",
     "register": "Florida Administrative Register", "register_url": "https://www.flrules.org/Default.asp", "register_freq": "daily"},
    {"state": "GA", "code": "Rules and Regulations of the State of Georgia", "cite": "Ga. Comp. R. & Regs.", "publisher": "Georgia Secretary of State, Administrative Procedure Division",
     "code_url": "https://rules.sos.ga.gov/gac", "access": "html", "status": "vendor_operated",
     "blocked": "The Secretary of State's rules site is operated by a commercial vendor that claims copyright in the published text ('Copyright (c) 2026 Fastcase, Inc - All rights reserved' on every page); rule text is not copied. Index metadata (department, chapter, subject and rule numbers with captions) is read from the state's own domain.",
     "register": None, "register_url": None, "register_freq": None,
     "register_note": "Georgia publishes no state register; agencies give notice of proposed rules themselves (O.C.G.A. 50-13-4)."},
    {"state": "HI", "code": "Hawaii Administrative Rules", "cite": "Haw. Code R.", "publisher": "Office of the Lieutenant Governor (rules posted by each department)",
     "code_url": "https://ltgov.hawaii.gov/the-office/administrative-rules/", "access": "pdf", "status": "official_partial",
     "register": None, "register_url": None, "register_freq": None,
     "register_note": "Hawaii publishes no register; public notices of rulemaking appear on the Lieutenant Governor's page and in newspapers."},
    {"state": "ID", "code": "Idaho Administrative Code (IDAPA)", "cite": "Idaho Admin. Code r.", "publisher": "Idaho Office of the Administrative Rules Coordinator (Division of Financial Management)",
     "code_url": "https://adminrules.idaho.gov/rules/current/", "access": "pdf", "status": "official_free",
     "register": "Idaho Administrative Bulletin", "register_url": "https://adminrules.idaho.gov/latest-bulletins/", "register_freq": "monthly"},
    {"state": "IL", "code": "Illinois Administrative Code", "cite": "Ill. Admin. Code tit.", "publisher": "Illinois General Assembly, Joint Committee on Administrative Rules",
     "code_url": "https://www.ilga.gov/commission/jcar/admincode/titles.html", "access": "html", "status": "official_free",
     "register": "Illinois Register", "register_url": "https://www.ilsos.gov/departments/index/register/home.html", "register_freq": "weekly"},
    {"state": "IN", "code": "Indiana Administrative Code", "cite": "Ind. Admin. Code tit.", "publisher": "Indiana Legislative Services Agency (Indiana Register)",
     "code_url": "https://iar.iga.in.gov/code/current", "access": "api", "status": "official_free",
     "register": "Indiana Register", "register_url": "https://iar.iga.in.gov/register", "register_freq": "weekly"},
    {"state": "IA", "code": "Iowa Administrative Code", "cite": "Iowa Admin. Code r.", "publisher": "Iowa Legislative Services Agency",
     "code_url": "https://www.legis.iowa.gov/law/administrativeRules/agencies", "access": "pdf", "status": "official_free",
     "register": "Iowa Administrative Bulletin", "register_url": "https://www.legis.iowa.gov/law/administrativeRules/bulletinSupplementListings", "register_freq": "biweekly"},
    {"state": "KS", "code": "Kansas Administrative Regulations", "cite": "Kan. Admin. Regs.", "publisher": "Kansas Secretary of State",
     "code_url": "https://sos.ks.gov/publications/kansas-administrative-regulations.html", "access": "pdf", "status": "official_free",
     "register": "Kansas Register", "register_url": "https://sos.ks.gov/publications/kansas-register.html", "register_freq": "weekly"},
    {"state": "KY", "code": "Kentucky Administrative Regulations", "cite": "Ky. Admin. Regs.", "publisher": "Kentucky Legislative Research Commission",
     "code_url": "https://apps.legislature.ky.gov/law/kar/titles.htm", "access": "html", "status": "official_free",
     "register": "Administrative Register of Kentucky", "register_url": "https://legislature.ky.gov/Law/kar/Pages/Registers.aspx", "register_freq": "monthly"},
    {"state": "LA", "code": "Louisiana Administrative Code", "cite": "La. Admin. Code tit.", "publisher": "Louisiana Office of the State Register (Division of Administration)",
     "code_url": "https://www.doa.la.gov/doa/osr/louisiana-administrative-code/", "access": "pdf", "status": "official_free",
     "register": "Louisiana Register", "register_url": "https://www.doa.la.gov/doa/osr/louisiana-register/", "register_freq": "monthly"},
    {"state": "ME", "code": "Code of Maine Rules", "cite": "Code Me. R.", "publisher": "Maine Secretary of State, Administrative Procedures Act Office",
     "code_url": "https://www.maine.gov/sos/rulemaking/agency-rules", "access": "html", "status": "official_free",
     "register": "Weekly Notices of Rule-Making", "register_url": "https://www.maine.gov/sos/rulemaking/weekly-notices", "register_freq": "weekly"},
    {"state": "MD", "code": "Code of Maryland Regulations (COMAR)", "cite": "Md. Code Regs.", "publisher": "Maryland Division of State Documents",
     "code_url": "https://regs.maryland.gov/us/md/exec/comar/index.json", "access": "api", "status": "official_free",
     "register": "Maryland Register", "register_url": "https://dsd.maryland.gov/Pages/MDRegister.aspx", "register_freq": "biweekly"},
    {"state": "MA", "code": "Code of Massachusetts Regulations", "cite": "Mass. Code Regs.", "publisher": "Secretary of the Commonwealth, Regulations Division (official text sold by the State Bookstore)",
     "code_url": "https://www.sec.state.ma.us/divisions/regs/", "access": "none", "status": "paid_official",
     "blocked": "The official CMR text is sold by the Secretary of the Commonwealth; agency pages on mass.gov are unofficial copies. Index metadata only.",
     "register": "Massachusetts Register", "register_url": "https://www.sec.state.ma.us/divisions/regs/", "register_freq": "biweekly"},
    {"state": "MI", "code": "Michigan Administrative Code", "cite": "Mich. Admin. Code R", "publisher": "Michigan Office of Administrative Hearings and Rules (ARS)",
     "code_url": "https://ars.apps.lara.state.mi.us/AdminCode/AdminCode", "access": "html", "status": "official_free",
     "register": "Michigan Register", "register_url": "https://ars.apps.lara.state.mi.us/MiRegister/MiRegister", "register_freq": "semi-monthly"},
    {"state": "MN", "code": "Minnesota Rules", "cite": "Minn. R.", "publisher": "Minnesota Office of the Revisor of Statutes",
     "code_url": "https://www.revisor.mn.gov/rules/", "access": "html", "status": "official_free",
     "register": "Minnesota State Register", "register_url": "https://mn.gov/admin/bookstore/register.jsp", "register_freq": "weekly"},
    {"state": "MS", "code": "Mississippi Administrative Code", "cite": "Miss. Admin. Code", "publisher": "Mississippi Secretary of State, Administrative Procedures Division",
     "code_url": "https://www.sos.ms.gov/adminsearch/default.aspx", "access": "pdf", "status": "official_free",
     "register": "Mississippi Administrative Bulletin", "register_url": "https://www.sos.ms.gov/regulation-enforcement/administrative-bulletin", "register_freq": "continuous"},
    {"state": "MO", "code": "Missouri Code of State Regulations", "cite": "Mo. Code Regs. Ann. tit.", "publisher": "Missouri Secretary of State, Administrative Rules Division",
     "code_url": "https://www.sos.mo.gov/adrules/csr/csr", "access": "pdf", "status": "official_free",
     "register": "Missouri Register", "register_url": "https://www.sos.mo.gov/adrules/moreg/moreg", "register_freq": "semi-monthly"},
    {"state": "MT", "code": "Administrative Rules of Montana", "cite": "Mont. Admin. R.", "publisher": "Montana Secretary of State",
     "code_url": "https://rules.mt.gov/", "access": "api", "status": "official_free",
     "register": "Montana Administrative Register", "register_url": "https://rules.mt.gov/register", "register_freq": "biweekly"},
    {"state": "NE", "code": "Nebraska Administrative Code", "cite": "Neb. Admin. Code", "publisher": "Nebraska Secretary of State, Rules and Regulations Division",
     "code_url": "https://www.nebraska.gov/rules-and-regs/regsearch/", "access": "pdf", "status": "official_free",
     "register": None, "register_url": None, "register_freq": None,
     "register_note": "Nebraska publishes no register; hearing notices are posted on the Secretary of State's rules site."},
    {"state": "NV", "code": "Nevada Administrative Code", "cite": "Nev. Admin. Code", "publisher": "Nevada Legislative Counsel Bureau",
     "code_url": "https://www.leg.state.nv.us/nac/", "access": "html", "status": "official_free",
     "register": "Nevada Register of Administrative Regulations", "register_url": "https://www.leg.state.nv.us/Register/", "register_freq": "continuous"},
    {"state": "NH", "code": "New Hampshire Code of Administrative Rules", "cite": "N.H. Code Admin. R.", "publisher": "New Hampshire Office of Legislative Services, Administrative Rules",
     "code_url": "https://gc.nh.gov/rules/about_rules/listagencies.aspx", "access": "html", "status": "official_free",
     "register": "New Hampshire Rulemaking Register", "register_url": "https://gc.nh.gov/rules/register/availability.aspx", "register_freq": "weekly"},
    {"state": "NJ", "code": "New Jersey Administrative Code", "cite": "N.J. Admin. Code", "publisher": "New Jersey Office of Administrative Law",
     "code_url": "https://www.nj.gov/oal/rules/accessp", "access": "none", "status": "commercial_only",
     "blocked": "The official N.J.A.C. and New Jersey Register are published by a commercial vendor (LexisNexis); not fetched. Index metadata only from nj.gov/oal.",
     "register": "New Jersey Register", "register_url": "https://www.nj.gov/oal/rules/proposals", "register_freq": "semi-monthly"},
    {"state": "NM", "code": "New Mexico Administrative Code", "cite": "N.M. Admin. Code", "publisher": "New Mexico State Records Center and Archives",
     "code_url": "https://www.srca.nm.gov/nmac-home/", "access": "pdf", "status": "official_free",
     "register": "New Mexico Register", "register_url": "https://www.srca.nm.gov/new-mexico-register/", "register_freq": "semi-monthly"},
    {"state": "NY", "code": "Official Compilation of Codes, Rules and Regulations of the State of New York", "cite": "N.Y. Comp. Codes R. & Regs. tit.", "publisher": "New York Department of State, Division of Administrative Rules",
     "code_url": "https://dos.ny.gov/state-register", "access": "none", "status": "commercial_only",
     "blocked": "The online NYCRR is hosted on a commercial vendor's site (Westlaw); not fetched. The State Register is the Department of State's own publication.",
     "register": "New York State Register", "register_url": "https://dos.ny.gov/state-register", "register_freq": "weekly"},
    {"state": "NC", "code": "North Carolina Administrative Code", "cite": "N.C. Admin. Code tit.", "publisher": "North Carolina Office of Administrative Hearings, Rules Division",
     "code_url": "http://reports.oah.state.nc.us/ncac.asp", "access": "pdf", "status": "official_free",
     "register": "North Carolina Register", "register_url": "https://www.oah.nc.gov/rules-division/north-carolina-register", "register_freq": "semi-monthly"},
    {"state": "ND", "code": "North Dakota Administrative Code", "cite": "N.D. Admin. Code", "publisher": "North Dakota Legislative Council",
     "code_url": "https://www.ndlegis.gov/agency-rules/north-dakota-administrative-code", "access": "pdf", "status": "official_free",
     "register": None, "register_url": None, "register_freq": None,
     "register_note": "North Dakota publishes no register; the Legislative Council issues code supplements."},
    {"state": "OH", "code": "Ohio Administrative Code", "cite": "Ohio Admin. Code", "publisher": "Ohio Legislative Service Commission (codes.ohio.gov)",
     "code_url": "https://codes.ohio.gov/ohio-administrative-code", "access": "html", "status": "official_free",
     "register": "Register of Ohio", "register_url": "https://www.registerofohio.state.oh.us/", "register_freq": "continuous"},
    {"state": "OK", "code": "Oklahoma Administrative Code", "cite": "Okla. Admin. Code", "publisher": "Oklahoma Secretary of State, Office of Administrative Rules",
     "code_url": "https://rules.ok.gov/code", "access": "api", "status": "official_free",
     "register": "Oklahoma Register", "register_url": "https://rules.ok.gov/registers", "register_freq": "semi-monthly"},
    {"state": "OR", "code": "Oregon Administrative Rules", "cite": "Or. Admin. R.", "publisher": "Oregon Secretary of State, Archives Division",
     "code_url": "https://secure.sos.state.or.us/oard/ruleSearch.action", "access": "html", "status": "official_free",
     "register": "Oregon Bulletin", "register_url": "https://secure.sos.state.or.us/oard/displayBulletins.action", "register_freq": "monthly"},
    {"state": "PA", "code": "Pennsylvania Code", "cite": "Pa. Code", "publisher": "Pennsylvania Legislative Reference Bureau",
     "code_url": "https://www.pacodeandbulletin.gov/Display/pacode", "access": "html", "status": "official_free",
     "register": "Pennsylvania Bulletin", "register_url": "https://www.pacodeandbulletin.gov/Home/PaBulletin", "register_freq": "weekly"},
    {"state": "RI", "code": "Rhode Island Code of Regulations", "cite": "R.I. Code R.", "publisher": "Rhode Island Department of State, Administrative Records",
     "code_url": "https://rules.sos.ri.gov/Organizations", "access": "html", "status": "official_free",
     "register": "Rulemaking notices (Rhode Island Department of State)", "register_url": "https://sos.ri.gov/divisions/open-government-center/rules-and-regulations", "register_freq": "continuous"},
    {"state": "SC", "code": "South Carolina Code of Regulations", "cite": "S.C. Code Ann. Regs.", "publisher": "South Carolina Legislative Council",
     "code_url": "https://www.scstatehouse.gov/coderegs/statmast.php", "access": "html", "status": "official_free",
     "register": "South Carolina State Register", "register_url": "https://www.scstatehouse.gov/state_register.php", "register_freq": "monthly"},
    {"state": "SD", "code": "Administrative Rules of South Dakota", "cite": "S.D. Admin. R.", "publisher": "South Dakota Legislative Research Council",
     "code_url": "https://sdlegislature.gov/Rules/Administrative", "access": "api", "status": "official_free",
     "register": "South Dakota Register", "register_url": "https://sdlegislature.gov/Rules/Register", "register_freq": "weekly"},
    {"state": "TN", "code": "Official Compilation Rules and Regulations of the State of Tennessee", "cite": "Tenn. Comp. R. & Regs.", "publisher": "Tennessee Secretary of State, Publications Division",
     "code_url": "https://publications.tnsosfiles.com/rules/0800/0800.htm", "access": "pdf", "status": "official_free",
     "register": "Tennessee Administrative Register", "register_url": "https://sos.tn.gov/publications/services/tennessee-administrative-register", "register_freq": "monthly"},
    {"state": "TX", "code": "Texas Administrative Code", "cite": "Tex. Admin. Code", "publisher": "Texas Secretary of State, Texas Register Section",
     "code_url": "https://texas-sos.appianportalsgov.com/rules-and-meetings?interface=VIEW_TAC", "access": "portal", "status": "official_free",
     "access_note": "Since 2025 the TAC is served only by the Secretary of State's Rules and Meetings portal (an interactive application whose pages are built by a stateful UI protocol); the former readtac pages redirect there. No bulk file or documented API.",
     "register": "Texas Register", "register_url": "https://www.sos.texas.gov/texreg/index.shtml", "register_freq": "weekly"},
    {"state": "UT", "code": "Utah Administrative Code", "cite": "Utah Admin. Code r.", "publisher": "Utah Office of Administrative Rules",
     "code_url": "https://adminrules.utah.gov/public/search/Current%20Rules", "access": "api", "status": "official_free",
     "register": "Utah State Bulletin", "register_url": "https://adminrules.utah.gov/public/bulletins", "register_freq": "semi-monthly"},
    {"state": "VT", "code": "Code of Vermont Rules", "cite": "Vt. Code R.", "publisher": "Vermont Secretary of State",
     "code_url": "https://sos.vermont.gov/secretary-of-state-services/apa-rules", "access": "none", "status": "commercial_only",
     "blocked": "The compiled Code of Vermont Rules is published by a commercial vendor (LexisNexis); not fetched. The Secretary of State's rule database lists rules (index metadata).",
     "register": "Rulemaking notices (Vermont Secretary of State)", "register_url": "https://secure.vermont.gov/SOS/rules/", "register_freq": "weekly"},
    {"state": "VA", "code": "Virginia Administrative Code", "cite": "Va. Admin. Code", "publisher": "Virginia Division of Legislative Automated Systems (law.lis.virginia.gov)",
     "code_url": "https://law.lis.virginia.gov/admincode/", "access": "api", "status": "official_free",
     "register": "Virginia Register of Regulations", "register_url": "https://register.dls.virginia.gov/", "register_freq": "biweekly"},
    {"state": "WA", "code": "Washington Administrative Code", "cite": "Wash. Admin. Code", "publisher": "Washington Office of the Code Reviser",
     "code_url": "https://app.leg.wa.gov/wac/", "access": "html", "status": "official_free",
     "register": "Washington State Register", "register_url": "https://lawfilesext.leg.wa.gov/law/wsr/", "register_freq": "semi-monthly"},
    {"state": "WV", "code": "West Virginia Code of State Rules", "cite": "W. Va. Code R.", "publisher": "West Virginia Secretary of State, Administrative Law Division",
     "code_url": "https://apps.sos.wv.gov/adlaw/csr/", "access": "pdf", "status": "official_free",
     "register": "West Virginia State Register", "register_url": "https://apps.sos.wv.gov/adlaw/registers", "register_freq": "weekly"},
    {"state": "WI", "code": "Wisconsin Administrative Code", "cite": "Wis. Admin. Code", "publisher": "Wisconsin Legislative Reference Bureau",
     "code_url": "https://docs.legis.wisconsin.gov/code/admin_code", "access": "html", "status": "official_free",
     "register": "Wisconsin Administrative Register", "register_url": "https://docs.legis.wisconsin.gov/code/register", "register_freq": "weekly"},
    {"state": "WY", "code": "Wyoming Administrative Rules", "cite": "Wyo. Admin. Code", "publisher": "Wyoming Secretary of State, Administrative Rules",
     "code_url": "https://rules.wyo.gov/", "access": "html", "status": "official_free",
     "register": None, "register_url": None, "register_freq": None,
     "register_note": "Wyoming publishes no register; proposed rules are posted on the Secretary of State's rules system."},
]

PRIORITY = ["TX", "FL", "IL", "PA", "OH", "WA", "OR", "MI", "MN", "NC", "GA", "AZ", "CO"]

BY_STATE = {s["state"]: s for s in SOURCES}


def check() -> None:
    states = [s["state"] for s in SOURCES]
    assert len(states) == 51 and len(set(states)) == 51, "51 jurisdictions, each once"
    for s in SOURCES:
        assert s["status"] in {"official_free", "official_partial", "commercial_only", "vendor_operated", "paid_official", "no_compiled_code"}
        assert s["code_url"].startswith(("https://", "http://"))
        if s["status"] in {"commercial_only", "vendor_operated", "paid_official"}:
            assert s.get("blocked"), s["state"]
        if s["register"] is None:
            assert s.get("register_note"), s["state"]


if __name__ == "__main__":
    check()
    print(len(SOURCES))
