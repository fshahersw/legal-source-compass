"""Synthetic texts of the shared golden fixture (src/lib/citations/fixtures/golden.json).

make_golden.py runs the Python engine over these texts and writes the expected output after review; the Python and the
TypeScript test suites both check their engine against that file. Texts are written for this fixture (no corpus text).
"""

TEXTS: list[tuple[str, str]] = [
    ("cases-parallel", "See Obergefell v. Hodges, 576 U.S. 644, 651-52, 135 S. Ct. 2584 (2015); Ashcroft v. Iqbal, 556 U.S. 662 (2009)."),
    ("cases-reporters", "Smith v. Jones, 123 F.3d 456, 460 (9th Cir. 1997); Doe v. Roe, 45 F. Supp. 3d 789 (S.D.N.Y. 2014); "
                        "Kim v. Lee, 12 F.Supp.2d 34 (D. Mass. 1998); Ruiz v. City, 598 F. App’x 123 (5th Cir. 2015); "
                        "People v. X, 51 Cal. 4th 1 (2010); Hansen v. Y, 210 A.3d 55 (Pa. 2019); In re Q, 145 S.Ct. 1 (2024)."),
    ("cases-wl-lexis", "Compare In re Zantac, 2021 WL 1234567, at *3 (S.D. Fla. Mar. 3, 2021), with Doe v. Roe, 2019 U.S. Dist. "
                       "LEXIS 12345, at *4-5 (D.N.J. 2019), and Kumho Tire Co. v. Carmichael, 526 U.S. 137, 119 S. Ct. 1167, "
                       "143 L. Ed. 2d 238 (1999)."),
    ("cases-neutral", "See State v. Doe, 2017-Ohio-5699, ¶ 12; Smith v. Roe, 2019 ND 12; People v. Q, 2014 IL App (1st) 120583; "
                      "and Estate of R, T.C. Memo. 2019-12."),
    ("cases-names", "The Court in Bell Atl. Corp. v. Twombly, 550 U.S. 544, 555 (2007), set the standard. Plaintiffs rely on "
                    "Erie R.R. Co. v. Tompkins, 304 U.S. 64 (1938). Accord United States ex rel. Polansky v. Exec. Health Res., "
                    "Inc., 599 U.S. 419 (2023); Ex parte Young, 209 U.S. 123 (1908)."),
    ("short-forms", "Bell Atl. Corp. v. Twombly, 550 U.S. 544, 555 (2007). Id. at 556. The Court later said so. "
                    "Twombly, 550 U.S. at 570. Iqbal followed. Ashcroft v. Iqbal, 556 U.S. 662 (2009). Twombly, supra, at 558. "
                    "See id. at 678."),
    ("short-ambiguous", "See Smith v. Jones, 1 F.3d 2 (1st Cir. 1993); Doe v. Roe, 3 F.3d 4 (2d Cir. 1993). Id. at 5. "
                        "Brown, 9 F.3d at 12."),
    ("usc-lists", "Plaintiffs sue under 42 U.S.C. §§ 1981, 1983 and 1985(3), and under 28 U.S.C. § 1332(d)(2); see 15 U.S.C. "
                  "§ 78u-4 et seq. and 50 U.S.C. app. § 4305."),
    ("usc-forms", "Jurisdiction lies under 28 U.S.C. §§ 1331–1332 and 15 USC 78j(b); see also 42 U.S.C.A. § 2000e-2(a)(1), "
                  "26 U.S.C. sec. 501(c)(3), 29 U.S.C. section 1132(a)(1)(B) and 42 U.S.C. § 1395w–26(b)(3)."),
    ("usc-split", "(citing 21 C.F.R. 1301.7 l(a)); 15 U.S.C. § 1681 e(a); 28 U.S.C. § 1332 (a); 21 C.F.R. § 1301.74(b)."),
    ("cfr", "FDA regulations at 21 C.F.R. § 314.50(d)(5) and 21 CFR Part 11, as well as 21 C.F.R. parts 210-211, "
            "40 C.F.R. §§ 63.10–63.15, 12 C.F.R. 1026.18, 16 CFR §§ 433.1, 433.2 and 433.3, and 40 C.F.R. § 86.1845–04."),
    ("treasury", "Treas. Reg. § 1.501(c)(3)-1(d) and 26 C.F.R. § 1.1313(c)-1 govern."),
    ("register-statutes", "The rule was published at 85 Fed. Reg. 12,345, 12,350 (Mar. 2, 2020) and 91 FR 67000 under Pub. L. "
                          "No. 111-148, § 1501, 124 Stat. 119, 242 (2010); see also Public Law 119–99 and P.L. 94-142."),
    ("constitutions", "U.S. Const. art. I, § 8, cl. 3; U.S. CONST. amend. XIV, § 1; United States Constitution, Article III; "
                      "Cal. Const. art. I, § 7; Mass. Const. pt. 1, art. 12; N.J. Const. art. I, ¶ 1; Tex. Const. art. 1, § 13."),
    ("federal-rules", "Under Fed. R. Civ. P. 12(b)(6) and Rule 9(b), see also Fed. R. Evid. 702, FRCP 23(b)(3), Fed.R.App.P. "
                      "4(a)(1), Fed. R. Crim. P. 11, Bankruptcy Rule 9019 and Rule 26(b)(1) of the Federal Rules of Civil "
                      "Procedure. Rule 56 applies."),
    ("local-rules", "Local Rule 7.1; L.R. 56.1(a); N.D. Cal. Civ. L.R. 7-3; D.N.J. L. Civ. R. 7.1(d); LCvR 7(m); Local Civil Rule 6.3."),
    ("rule-short-none", "Rule 12(b)(6) is cited without a federal-rule citation before it; Rule 4:6-2 is a state rule."),
    ("state-statutes", "Cal. Bus. & Prof. Code § 17200; Cal. Civ. Proc. Code § 340.8; 735 ILCS 5/13-202; N.J.S.A. 2A:58C-2; "
                       "N.J. Stat. Ann. § 2A:58C–5c; 42 Pa. Cons. Stat. § 5524; 42 Pa. C.S. § 5524; Tex. Civ. Prac. & Rem. "
                       "Code Ann. § 16.003; Fla. Stat. § 95.11(3); Mass. Gen. Laws ch. 93A, § 9; RCW 4.16.080; O.C.G.A. § 9-3-33."),
    ("state-statutes-2", "N.Y. Gen. Bus. Law § 349; N.Y. C.P.L.R. 214-c; Md. Code Ann., Cts. & Jud. Proc. § 5-101; "
                         "La. Civ. Code Ann. art. 3492; La. R.S. 9:5628; Del. Code Ann. tit. 10, § 8119; 10 Del. C. § 8106; "
                         "Okla. Stat. tit. 12, § 95; Vt. Stat. Ann. tit. 12, § 512; 14 M.R.S. § 752; K.S.A. 2019 Supp. 60-513; "
                         "Ohio Rev. Code Ann. § 2305.10; Minn. Stat. § 604.01.4; Neb. Rev. Stat. § 25-21, 187.12."),
    ("state-regs", "Cal. Code Regs. tit. 22, § 66262.11; 10 NYCRR 405.1; 310 CMR 7.00; COMAR 26.11.01.01; WAC 173-303-040; "
                   "30 Tex. Admin. Code § 335.1; 25 Pa. Code § 109.1; N.J.A.C. 7:26-1.4; 401 KAR 51:010; OAR 340-012-0140; "
                   "Fla. Admin. Code Ann. r. 62-296.320; 15A NCAC 2D .0101; 35 Ill. Adm. Code 721.103; 9VAC5-20-10."),
    ("mdl-docket", "IN RE: TALC PRODUCTS LIABILITY LITIGATION, MDL No. 2738; MDL 2804; MDL-3092; Multidistrict Litigation No. "
                   "2846; the MDL Court; MDL 3:17-md-2804; No. 3:16-md-2738 and 1:23-cv-818-ABC."),
    ("ecf-header", "Case 3:16-md-02738-MAS-RLS Document 33091 Filed 06/26/24 Page 1 of 3 PageID: 12345\nThe docket "
                   "3:16-md-02738 is cited in the text."),
    ("section-short", "42 U.S.C. § 1983 claims fail. Plaintiff's § 1983 claim, and § 1985 too. Cal. Civ. Code § 1714 governs; "
                      "under § 1714(a) the duty is general."),
    ("id-statute", "See 42 U.S.C. § 2000e-2(a). Id. § 2000e-3(a). Id. § 2000e-5."),
    ("no-citations", "No citation here: the court set the trial for June 5, 2024 and awarded $1,250,000.00 in damages under "
                     "section 5 of the contract. Mass. Gen. Laws were cited without a chapter."),
    ("nbsp", "Mass. Gen. Laws ch. 93A, § 2 and 42 U.S.C. § 1983 with no-break spaces."),
    ("astral", "\U0001F4C4 Exhibit: see 42 U.S.C. § 1983 and Doe v. Roe, 1 F.4th 2 (1st Cir. 2021) \U0001F4C4 then 21 CFR 11."),
    ("not-cases", "On 5 May 2020 the 3 Defendants paid 12 dollars; 100 NE 2nd Ave; 25 Black 3 sold; page 4 Exhibit 5."),
]

# A document given page by page (short forms resolve across pages).
PAGES: list[tuple[str, list[str]]] = [
    ("pages", [
        "Bell Atl. Corp. v. Twombly, 550 U.S. 544 (2007), and 42 U.S.C. § 1983.",
        "Id. at 570. Twombly, 550 U.S. at 556. Section 1983 is cited as § 1983.",
    ]),
]
