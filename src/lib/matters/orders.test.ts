import { describe, expect, it } from "vitest";
import {
  DATE_PREFILTER_PATTERN,
  NOT_IN_COLLECTED_TEXT,
  ORDER_PREFILTER_PATTERNS,
  ORDERS_RULE_VERSION,
  classifyDocketText,
  countKinds,
  joinCourtPageOrders,
  numberedOrder,
  orderLabel,
  orderLedger,
  printedTitle,
  type ClassifiedEntry,
} from "./orders";

// Docket text below is copied from sw_docket_entries_v1 (read-only survey, 2026-10-27), MDLs as noted.
const T = {
  cmo1_3047:
    "CASE MANAGEMENT ORDER NO. 1. Signed by Judge Yvonne Gonzalez Rogers on 11/10/2022. (amg, COURT STAFF) (Filed on 11/10/2022) (Entered: 11/10/2022)",
  cmo2_3047:
    "CASE MANAGEMENT ORDER NO. 2 PLAINTIFFS' LEADERSHIP STRUCTURE AND RESPONSIBILITIES. Signed by Judge Yvonne Gonzalez Rogers on 11/15/2022. (amg, COURT STAFF) (Filed on 11/15/2022) (Entered: 11/15/2022)",
  cmo35_3047:
    "CASE MANAGEMENT ORDER NO. 35: (Trial Plan, Prefiling Conference, et al) Jury Selection set for 2/3/2027, at 08:00 AM in Oakland, Courtroom 1, 4th Floor before Judge Yvonne Gonzalez Rogers. Jury Trial set for 2/8/2027, at 08:00 AM in Oakland, Courtroom 1, 4th Floor before Judge Yvonne Gonzalez Rogers. Signed by Judge Yvonne Gonzalez Rogers on 5/21/2026. (eac, COURT STAFF) (Filed on 5/21/2026)",
  cmo143_2789:
    "MDL ORDER - CASE MANAGEMENT ORDER NO. 143 (Order for Counsel to Certify Contact with Non-Responsive Plaintiffs - GSK Consumer Healthcare Defendants). Signed by Judge Claire C. Cecchi on 1/26/2026.",
  cmo9a_2846:
    "CASE MANAGEMENT ORDER NO. 9-A (Adoption of Master Answer in Cases with Amended Short Form Complaints) Signed by Judge Edmund A. Sargus on 3/3/2026. (cmw) (Entered: 03/03/2026)",
  cmo3b_2846:
    "CASE MANAGEMENT ORDER NO 3-B. Signed by Judge Edmund A. Sargus on 2/23/2026. (cmw) (Entered: 02/23/2026)",
  cmo25_2846:
    "CASE MANAGEMENT ORDER NO 25 Selection of Initial Bellwether Trial Cases. Signed by Judge Edmund A. Sargus",
  cmo58_2846:
    "CASE MANAGEMENT ORDER NO. 58 (Mechanism and Timing of Payments into MDL Common Benefit Accounts). Signed by Judge Edmund A. Sargus on 10/31/2025. (cmw) (Entered: 10/31/2025)",
  cmo33f_2873:
    "CASE MANAGEMENT ORDER NO. 33.F. This Order Relates to All Actions. Please see Order for all Details regarding a revised briefing schedule for the Rule 702 motions as to e",
  pto31_3014:
    "PRETRIAL ORDER #31 (Procedures for Filing of Master Third-Party Complaint and Related Proceedings) granting 2740 MOTION to Enter Proposed PTO 31. Signed by Judge Joy Flow",
  pto28b_3014:
    "PRETRIAL ORDER # 28(b) (Procedures Regarding Second Amended Master Personal Injury Complaint And Filing Individual Short Form Personal Injury Complaints) granting 2524 Jo",
  pto12_3014:
    "SECOND AMENDED PRETRIAL ORDER #12 SCHEDULING MONTHLY STATUS CONFERENCES as set forth more fully in the Order. The foregoing schedule is subject to change at the discretio",
  pto26b_3014:
    "PRETRIAL ORDER NO. 26(b) MODIFYING FACT SHEET IMPLEMENTATION ORDER. Details more fully stated in Order. Signed by Judge Joy Flowers Conti on 10/3/2023. (Attachments: # 1 ",
  pto37_3108:
    "MDL PRETRIAL ORDER NO. 37 (Protective Order Re: Impacted Data Files). The Parties' Stipulation for Protective Order Re: Impacted Data Files 702 is APPROVED. See ORDER for",
  pto31_2741:
    "PRETRIAL ORDER NO. 31: NOTICE TO STATE COURT JUDGES. Signed by Judge Vince Chhabria on 9/20/2017. (knm, COURT STAFF) (Filed on 9/20/2017) (Entered: 09/20/2017)",
  cmo50a_3081:
    "FIRST AMENDED CASE MANAGEMENT ORDER NO. 50 (Order Setting Final Pretrial Conference for Hicks Bellwether Trial) - See Order for Complete Details. Signed by Judge Jennifer",
  cmo18_3140:
    "CASE MANAGEMENT ORDER NO. 18 (Establishment of Administrative Docket in Connection with Settlement). Signed by JUDGE M CASEY RODGERS on 9/15/2026. (djb) (Entered: 09/15/2026)",
  r702_denied_3047:
    "ORDER DENYING RULE 702 MOTION TO EXCLUDE SCHOOL DISTRICT EXPERTS by Judge Yvonne Gonzalez Rogers Denying 2291 Motion. (eac, COURT STAFF) (Filed on 2/17/2026) Any non-CM/ECF Participants have been served by First Class Mail",
  r702_partial_3047:
    "ORDER GRANTING IN PART AND DENYING IN PART RULE 702 MOTIONS TO EXCLUDE PLAINTIFFS' EXPERTS' GENERAL CAUSATION OPINIONS by Judge Yvonne Gonzalez Rogers Granting in Part and Denying in Part 2292 Motion; Granting in Part and Denying in Part 2295 Motion.",
  r702_partial_3081:
    "ORDER granting in part and denying in part 4833 Rule 702 Motion to Exclude Opinions of Bernard C. Camins, M.D. and William R. Jarvis, M.D. See Order for Complete Details. Signed by",
  r702_schedule_3047:
    "Order by Judge Yvonne Gonzalez Rogers Granting 2142 Stipulation to Modify Pretrial Schedule. Close of Expert Discovery due by 9/17/2025. Defendant's Rule 702 Motion due by 9/30/2025. Plaintiff's Oppos",
  r702_extension_2913:
    "ORDER REGARDING EXTENSION OF TIME FOR FILING DAUBERT MOTIONS, OPPOSITIONS, AND REPLIES by Judge William H. Orrick granting 2675 Stipulation. (jmd, COURT STAFF) (Filed on 12/23/2021",
  r702_opposition_2913:
    "ORDER REGARDING PLAINTIFFS' CLASS CERTIFICATION REPLY AND DAUBERT MOTION OPPOSITION by Judge William H. Orrick granting 2429 Stipulation. (jmdS, COURT STAFF) (Filed on 10/7/2021) (",
  r702_minute_3094:
    "Minute Entry for proceedings held before DISTRICT JUDGE KAREN S. MARSTONin Courtroom 16B STATUS CONFERENCE AND Motion Hearing held on 5/19/25 re 359 MOTION to Exclude OPINIONS OF L",
  cto52: "CONDITIONAL TRANSFER ORDER No. 52. (daf) (Entered: 05/07/2020)",
  cto71: "CONDITIONAL TRANSFER ORDER 71. (er) (Entered: 06/16/2021)",
  cto16: "CONDITIONAL TRANSFER ORDER No.16. (er) (Entered: 12/04/2018)",
  verdict_3081: "JURY VERDICT. (Divelbliss, CV23-1627-PHX-DGC.) (KMB) (Entered: 09/08/2026)",
  verdict_proposed_2592:
    "Proposed Jury Verdict Form by Plaintiff. (Reference: 15-03469)(Meunier, Gerald) (Entered: 08/17/2017)",
  verdict_court_proposed_3081:
    "COURT'S PROPOSED VERDICT FORMS. Signed by Senior Judge David G. Campbell on 5/1/2026. (CV-23-1975)(CLB) (Entered: 05/01/2026)",
  verdict_amended_forms_3081:
    "*AMENDED Verdict Forms by Bard Access Systems Incorporated, Bard Peripheral Vascular Incorporated, Becton Dickinson and Company, C R Bard Incorporated. (Attachments: # 1 ",
  bk_2873:
    "SUGGESTION OF BANKRUPTCY Upon the Record as to Ascend Performance Materials Holdings, Inc. by Ascend Performance Materials Operations, LLC, Ascend Performance Materials, ",
  bk_3043:
    "NOTICE of Suggestion of Bankruptcy/Stay. Document filed by Rite Aid Corporation. (Attachments: # 1 Exhibit A - Bankruptcy Petition).(Katz, David) (Entered: 10/16/2023)",
  bk_2804_pendency:
    "Notice of Suggestion of Pendency of Bankruptcy filed by Akorn, Inc. (Attachments: # 1 Exhibit Ex. A - Akorn - Notice of Commencement Draft)(Reppeto, Lisa) (Entered: 08/14",
  bk_2804_stay:
    "Notice of Filing Bankruptcy (Suggestion of Pendency) and Automatic Stay of Proceedings filed by Mallinckrodt LLC, SpecGX LLC. (O'Connor, Brien) (Entered: 10/12/2020)",
  bk_letter_3043:
    "LETTER addressed to Judge Denise L. Cote from David M. Katz dated October 16, 2023 re: Notice of Bankruptcy Filing and Stay. Document filed by Rite Aid Corporation..(Katz",
  death_3060: "SUGGESTION of Death (DeFrance-Poindexter, Syreeta) (Entered: 06/18/2025)",
  remand_2804:
    "Order denying Albertsons Defendants' Motion for Suggestion of Remand (Related Doc # 5588 ). Signed by Judge Dan Aaron Polster on 9/3/2024. (M,CE) (Entered: 09/03/2024)",
  trial_vacated_3047:
    "CLERK'S NOTICE. You are hereby notified that Jury Trial set for 8/20/2026, is vacated and continued to 8/24/2026, at 8:00 AM in Oakland, Courtroom 1, 4th Floor. (This is a text-only entry generated by the court. There is no document associated with this entry.) (eac, COURT STAFF) (Filed on 8/20/2026)",
  trial_held_2804:
    "Minutes of proceedings before Judge Dan Aaron Polster. Jury Trial held 10/12/21. Trial to resume 10/13/21 at 9:00 AM (Court Reporter: Sue Trischan.)Time: 7.5 hrs. (P,R) (Entered: 10/13/2021)",
  leadership_3060:
    "ORDER REAPPOINTING PLAINTIFFS' CO-LEAD COUNSEL, EXECUTIVE COMMITTEE, STEERING COMMITTEE, AND LEADERSHIP DEVELOPMENT COMMITTEE Signed by the Honorable Mary M. Rowland on 4/22/2024. Mailed not",
  pfs_2804:
    "Order Regarding Hospital Plaintiff Fact Sheets. Signed by Judge Dan Aaron Polster on 11/29/2023. (M,CE) (Entered: 11/29/2023)",
  pfs_extension_2804:
    "Order [non-document] granting 6479 Motion for Extension of Time until 04/08/2026 to Comply with Order No. 6417 regarding NAS Plaintiff Fact Sheets. Approved Judge Dan Aaron Polster on 3/10/2",
  cb_2804:
    "Order Establishing Application Protocols for Reimbursement of Common Benefit Attorneys' Fees Under the Janssen and Distributors Settlement Agreements. Judge Dan Aaron Polster on 4/1/22. (P,R)",
  sm_2804:
    "Order regarding payments to Special Masters. Judge Dan Aaron Polster (MDL 2804) on 4/10/18. (P,R) (Entered: 04/10/2018)",
  settlement_2804:
    "Order Regarding Settlement Negotiating Teams. Judge Dan Aaron Polster (MDL 2804) on 4/9/18. (P,R) (Entered: 04/09/2018)",
  bw_2804:
    "Order granting 6498 Joint Motion to Modify Case Management Order for Third Party Payor Bellwether Cases. Signed by Judge Dan Aaron Polster on 3/17/2026. Associated Cases: 1:17-md-02804-DAP, ",
  // Negatives: entries that name a CMO / PTO without being the order.
  neg_motion_relief_3047:
    "MOTION for Relief from Nondispositive Pretrial Order of Magistrate Judge re 2197 Order on Discovery Letter Brief, filed by Facebook Holdings, LLC, Facebook Operations, LLC",
  neg_stip_2873:
    "STIPULATION re (6983 in 2:18-mn-02873-RMG) MOTION to Dismiss Particular Personal Injury Claims of Listed Plaintiffs for Failure to Comply with Second Amended Case Management Order No. 28 (filed by 4.2",
  neg_joint_motion_2873:
    "Joint MOTION for Extension of Time To Submit a Proposed CMO to Address Personal Injury Cases that Do Not Fall within CMO 26 by 3M Company. Response to Motion due by 3/5/2025.",
  neg_stip_dismissal_2873:
    "STIPULATION of Dismissal With Prejudice as to CMO 32 Site Richard Flynn Fire Academy by New Hampshire, State of. Associated Cases: 2:18-mn-02873-RMG",
  neg_set_deadlines_3140:
    "Set Deadlines - Re: 497 CASE MANAGEMENT ORDER NO. 9. Parties' Joint Agenda Letter 1/20/2026. MDL CMC is scheduled to be held on Friday, January 23, 2026, at 9:00 a.m. CT.",
  neg_stip_proposed_3047:
    "STIPULATION WITH PROPOSED CASE MANAGEMENT ORDER NO. 4 - DIRECT FILING ORDER, filed by All Plaintiffs, Meta Platforms, Inc., Facebook Technologies, LLC.",
  neg_motion_dismiss_2873:
    "MOTION to Dismiss Without Prejudice for Failure to Comply with Case Management Order No. 37 by Defendants. Response to Motion due by 10/5/2026.",
  neg_proposed: "[PROPOSED] CASE MANAGEMENT ORDER NO. 12 by Plaintiffs. (Attachments: # 1 Exhibit)",
};

const tags = (text: string) => classifyDocketText(text).tags;
const kinds = (text: string) => tags(text).map((t) => t.kind);

describe("classifyDocketText: numbered orders", () => {
  it("reads issued CMOs at the start of the text, with number, suffix and printed subject", () => {
    expect(numberedOrder(T.cmo1_3047)).toMatchObject({
      kind: "cmo",
      number: 1,
      suffix: null,
      subject: null,
    });
    expect(numberedOrder(T.cmo2_3047)).toMatchObject({
      kind: "cmo",
      number: 2,
      subject: "PLAINTIFFS' LEADERSHIP STRUCTURE AND RESPONSIBILITIES",
    });
    expect(numberedOrder(T.cmo143_2789)).toMatchObject({
      kind: "cmo",
      number: 143,
      amended: null,
      subject:
        "Order for Counsel to Certify Contact with Non-Responsive Plaintiffs - GSK Consumer Healthcare Defendants",
    });
    expect(numberedOrder(T.cmo25_2846)).toMatchObject({
      number: 25,
      subject: "Selection of Initial Bellwether Trial Cases",
    });
  });

  it("keeps amendment suffixes as printed (9-A, 3-B, 33.F, 28(b), 26(b))", () => {
    expect(numberedOrder(T.cmo9a_2846)).toMatchObject({ number: 9, suffix: "A" });
    expect(numberedOrder(T.cmo3b_2846)).toMatchObject({ number: 3, suffix: "B", subject: null });
    expect(numberedOrder(T.cmo33f_2873)).toMatchObject({ number: 33, suffix: "F" });
    expect(numberedOrder(T.pto28b_3014)).toMatchObject({ kind: "pto", number: 28, suffix: "b" });
    expect(numberedOrder(T.pto26b_3014)).toMatchObject({ kind: "pto", number: 26, suffix: "b" });
  });

  it("reads court-specific PTO wording and amendment prefixes", () => {
    expect(numberedOrder(T.pto31_3014)).toMatchObject({ kind: "pto", number: 31, suffix: null });
    expect(numberedOrder(T.pto12_3014)).toMatchObject({
      kind: "pto",
      number: 12,
      amended: "SECOND AMENDED",
    });
    expect(numberedOrder(T.pto37_3108)).toMatchObject({ kind: "pto", number: 37, amended: null });
    expect(numberedOrder(T.pto31_2741)).toMatchObject({
      number: 31,
      subject: "NOTICE TO STATE COURT JUDGES",
    });
    expect(numberedOrder(T.cmo50a_3081)).toMatchObject({
      kind: "cmo",
      number: 50,
      amended: "FIRST AMENDED",
      subject: "Order Setting Final Pretrial Conference for Hicks Bellwether Trial",
    });
  });

  it.each([
    "neg_motion_relief_3047",
    "neg_stip_2873",
    "neg_joint_motion_2873",
    "neg_stip_dismissal_2873",
    "neg_set_deadlines_3140",
    "neg_stip_proposed_3047",
    "neg_motion_dismiss_2873",
    "neg_proposed",
  ] as const)("never counts %s as an issued numbered order", (key) => {
    expect(numberedOrder(T[key]) === null || PROPOSED(T[key])).toBe(true);
    const c = classifyDocketText(T[key]);
    expect(c.tags.filter((t) => t.kind === "cmo" || t.kind === "pto")).toEqual([]);
  });

  it("labels roles: proposed and stipulations are filings, Set Deadlines is a clerk setting", () => {
    expect(classifyDocketText(T.neg_proposed).role).toBe("filing");
    expect(classifyDocketText(T.neg_stip_2873).role).toBe("filing");
    expect(classifyDocketText(T.neg_set_deadlines_3140).role).toBe("clerk_setting");
    expect(classifyDocketText(T.cmo1_3047).role).toBe("order");
    expect(classifyDocketText(T.cmo1_3047).rule).toBe(ORDERS_RULE_VERSION);
  });
});

const PROPOSED = (s: string) => /^\s*\[?PROPOSED/i.test(s);

describe("classifyDocketText: Rule 702 / Daubert", () => {
  it("takes the outcome only from the order verb printed in the title", () => {
    expect(tags(T.r702_denied_3047)).toContainEqual(
      expect.objectContaining({ kind: "rule702", outcome: "denied" }),
    );
    expect(tags(T.r702_partial_3047)).toContainEqual(
      expect.objectContaining({ kind: "rule702", outcome: "granted_in_part" }),
    );
    expect(tags(T.r702_partial_3081)).toContainEqual(
      expect.objectContaining({ kind: "rule702", outcome: "granted_in_part" }),
    );
  });

  it("does not treat schedules, extensions, briefing orders or minute entries as rulings", () => {
    for (const k of [
      "r702_schedule_3047",
      "r702_extension_2913",
      "r702_opposition_2913",
      "r702_minute_3094",
    ] as const)
      expect(kinds(T[k])).not.toContain("rule702");
    expect(classifyDocketText(T.r702_minute_3094).role).toBe("clerk_setting");
  });

  it("counts motions apart from rulings", () => {
    const motion =
      "MOTION to Exclude the Opinions of Dr. Jane Roe Pursuant to Rule 702 filed by Defendants. (Attachments: # 1 Exhibit)";
    expect(kinds(motion)).toEqual(["rule702_motion"]);
    expect(
      kinds("Joint MOTION for Extension of Time to file Daubert briefs by Plaintiffs."),
    ).toEqual([]);
  });

  it("states no outcome when the first verb rules on other motions (compound order, MDL 2885)", () => {
    const t = tags(
      "ORDER granting the parties' preservation motions 3320 & 3321, and granting in part, denying in part, and deferring in part on Plaintiffs' omnibus motion to exclude expert testimony and opinions under Rule 702 and Daubert in the Wave 1 cases 3319. Signed by JUDGE M CASEY RODGERS on 10/24/2022. (tvj)",
    );
    expect(t).toContainEqual(expect.objectContaining({ kind: "rule702", outcome: null }));
  });

  it("states no outcome when the order title has no ruling verb", () => {
    const t = tags("ORDER RE DAUBERT MOTIONS ON GENERAL CAUSATION. Signed by Judge A on 1/2/2025.");
    expect(t).toContainEqual(expect.objectContaining({ kind: "rule702", outcome: null }));
  });
});

describe("classifyDocketText: other key orders", () => {
  it("reads conditional transfer orders and their numbers", () => {
    expect(tags(T.cto52)).toEqual([expect.objectContaining({ kind: "cto", number: 52 })]);
    expect(tags(T.cto71)[0]).toMatchObject({ kind: "cto", number: 71 });
    expect(tags(T.cto16)[0]).toMatchObject({ kind: "cto", number: 16 });
  });

  it("reads jury verdicts but never proposed or party verdict forms", () => {
    expect(tags(T.verdict_3081)).toEqual([
      expect.objectContaining({ kind: "verdict", outcome: null }),
    ]);
    expect(
      tags(
        "JUDGMENT ON JURY VERDICT in favor of Defendants and against Plaintiff. Signed by Judge E on 8/31/2017.",
      ),
    ).toContainEqual(expect.objectContaining({ kind: "verdict", outcome: "for_defendant" }));
    for (const k of [
      "verdict_proposed_2592",
      "verdict_court_proposed_3081",
      "verdict_amended_forms_3081",
    ] as const)
      expect(kinds(T[k])).not.toContain("verdict");
  });

  it("reads explicit bankruptcy and stay notices only", () => {
    for (const k of ["bk_2873", "bk_3043", "bk_2804_pendency", "bk_2804_stay"] as const)
      expect(kinds(T[k])).toContain("bankruptcy_stay");
    for (const k of ["bk_letter_3043", "death_3060", "remand_2804"] as const)
      expect(kinds(T[k])).not.toContain("bankruptcy_stay");
    expect(kinds("NOTICE OF STAY pending appeal by Defendant.")).not.toContain("bankruptcy_stay");
    expect(kinds("NOTICE OF AUTOMATIC STAY under 11 U.S.C. § 362 by Debtor Co.")).toContain(
      "bankruptcy_stay",
    );
  });

  it("reads trial settings, vacated and continued settings, but not trial-day minutes", () => {
    const set = tags(T.cmo35_3047).find((t) => t.kind === "trial_setting");
    expect(set).toMatchObject({ outcome: "set" });
    expect(set?.subject).toMatch(/^Jury Selection set for 2\/3\/2027/);
    expect(tags(T.trial_vacated_3047)).toContainEqual(
      expect.objectContaining({ kind: "trial_setting", outcome: "continued" }),
    );
    expect(kinds(T.trial_held_2804)).not.toContain("trial_setting");
  });

  it("tags subject kinds from the printed title of an order", () => {
    expect(kinds(T.cmo2_3047)).toEqual(["cmo", "leadership"]);
    expect(kinds(T.leadership_3060)).toContain("leadership");
    expect(kinds(T.pfs_2804)).toContain("pfs");
    expect(kinds(T.pto26b_3014)).toEqual(["pto", "pfs"]);
    expect(kinds(T.cmo58_2846)).toEqual(["cmo", "common_benefit"]);
    expect(kinds(T.cb_2804)).toEqual(expect.arrayContaining(["common_benefit", "settlement"]));
    expect(kinds(T.sm_2804)).toContain("special_master");
    expect(kinds(T.settlement_2804)).toContain("settlement");
    expect(kinds(T.cmo18_3140)).toEqual(["cmo", "settlement"]);
    expect(kinds(T.cmo25_2846)).toEqual(["cmo", "bellwether"]);
    expect(kinds(T.bw_2804)).toContain("bellwether");
  });

  it("leaves procedure around a subject untagged (extension of time on fact sheets)", () => {
    expect(kinds(T.pfs_extension_2804)).not.toContain("pfs");
  });

  // Rule orders/2: subject kinds are read only in the order's own head clause. Text copied from
  // sw_docket_entries_v1 (read-only, 2026-10-27), MDLs as noted.
  const SUBJECT_NEGATIVES: Record<string, string> = {
    psc_discovery_2846:
      "ORDER - The parties have indicated that they need more time to find necessary data to resolve the PSCs discovery requests. The Court GRANTS the parties an additional SEVEN DAYS (7) to resolve this issue.",
    psc_exhibits_2846:
      "ORDER: The PSC is ORDERED to inform the Court whether it will withdraw or otherwise modify the exhibits submitted in support of its Motion to Enforce Subpoenas and Compel the Production of Documents by 1/29/2020.",
    zoom_lead_2804:
      "Order [non-document]: The Court will conduct a Zoom Status Conference on Wednesday, May 22, 2024 at 2:00 p.m. Required to attend are lead Plaintiff's counsel for all four PBM cases and general PEC representation; lead counsel and general counsel for Express Scripts and Optum Rx; and the Law Directors for the four bellwether citi",
    reconsideration_pec_2804:
      "Order [non-document] regarding 5322 Motion for reconsideration or, Alternatively, for Leave to File a Response to Plaintiffs and PEC's Sur-Reply re Motion to Disqualify filed by Defendant OptumRX, Inc. Motion for reconsideration is denied.",
    zoom_pec_2804:
      "Order - The Court will hold a Zoom status conference on June 22, 2022 at noon with the PEC and defense counsel from the remaining ten Distributor and Manufacturer Defendant Families most frequently named in MDL cases. Judge Dan Aaron Polster on 4/21/22. (P,R) (Entered: 04/21/2022)",
    substitute_liaison_2804:
      "Order [non-document] granting Defendant McKesson's Motion to Substitute Co-Liaison Counsel (Related Doc # 93). Judge Dan Aaron Polster (MDL 2804) on 1/26/18.(P,R)",
    resign_psc_2846:
      "ORDER - This matter is before the Court on attorney Nicholas R. Farnolos Motion to Resign from the Plaintiffs Steering Committee. (ECF No. 839 .) Attorney Farnolo is hereby ORDERED to file an amended motion clarifying his position.",
    withdraw_liaison_3014:
      "ORDER granting 345 Motion to Withdraw Documents from 166 MOTION to Appoint Counsel as Liaison Counsel; The Clerk is to remove documents at ECF 166-1 and 166-2 from public view.",
    liaison_confer_3014:
      "ORDER: Counsel for defendants and plaintiffs' liaison counsel shall meet and confer and file at least two business days prior to each status conference a joint notice.",
    synthetic_settlement_conference:
      "ORDER setting Settlement Conference for 3/3/2026. Signed by Judge X on 1/1/2026.",
    settlement_hearing_3014:
      "ORDER Setting Hearing on Motion re 2212 Unopposed MOTION for Settlement Preliminary Approval and Release of Economic Loss Claims: Motion Hearing set for 9/18/2023 at 3:00 PM in Courtroom 5A before Judge Joy Flowers Conti.",
    settlement_pages_3014:
      "ORDER granting 2411 Motion for Leave to File Excess Pages. The page limit for Settlement Class Counsels Motion for an Award of Attorneys' Fees and Costs is extended to 50 pages.",
    appoint_counsel_settlement_3014:
      "ORDER denying 2887 Motion to Appoint Counsel. As referenced in Co-lead Plaintiffs' Counsel response (ECF No. 2943 ), Fatir is receiving assistance from the settlement administrator.",
    sm_objection_2804:
      "Order Re Discovery Ruling No. 14, Part 5 overruling Cardinal's objection and affirming Special Master's ruling. Judge Dan Aaron Polster on 4/16/19. (P,R) (Entered: 04/16/2019)",
    sm_extension_3014:
      "ORDER granting 2210 Motion to Extend Time to September 28, 2023. Special Master Vanaskie's Reports and Recommendations due on or before September 28, 2023. Signed by Judge Joy Flowers Conti on 9/7/2023.",
    bellwether_memo_2846:
      "ORDER - This order memorializes developments in the first two bellwether cases, Johns v. C.R. Bard et al., and Milanesi, et al. v. C.R. Bard, Inc. et al. Signed by Judge Edmund A. Sargus",
  };

  it.each(Object.keys(SUBJECT_NEGATIVES))(
    "does not read a subject kind from words past the order's head (%s)",
    (key) => {
      const k = kinds(SUBJECT_NEGATIVES[key]!);
      for (const kind of [
        "leadership",
        "settlement",
        "special_master",
        "bellwether",
        "pfs",
        "common_benefit",
      ] as const)
        expect(k).not.toContain(kind);
    },
  );

  it("reads subject kinds from the head clause after ORDER <verb>", () => {
    expect(
      kinds(
        "Order [non-document] granting Physician Defendants' and Manufacturer and Distributor Defendants' Motions to Approve Liaison Counsel and Steering Committee (Related Doc # 23, 24). The Court Orders the addition of two representatives.",
      ),
    ).toEqual(["leadership"]);
    expect(
      kinds(
        "Order re: Plaintiffs' Amended Motion to Approve Co-Leads, Co-Liaisons and Executive Committee 17, and objections thereto 18 19 20, directing Plaintiffs to apply the Court's principles",
      ),
    ).toEqual(["leadership"]);
    expect(
      kinds(
        "ORDER PRELIMINARILY APPROVING PROPOSED CLASS SETTLEMENT AGREEMENT AND RELEASE OF MEDICAL MONITORING CLAIMS granting 2766, 2783 Motion for Settlement Preliminary Approval. Signed by Judge Joy Flowers Conti",
      ),
    ).toEqual(["settlement"]);
    expect(
      kinds(
        "ORDER AMENDING THE ALLOCATION OF THE COMMON BENEFIT ASSESSMENT AS BETWEEN COMMON BENEFIT FEES AND COMMON BENEFIT EXPENSES SET FORTH IN PRETRIAL ORDER #24 granting 3195 Motion to Amend 717 Order. Signed by Judge Joy Flowers Conti",
      ),
    ).toEqual(["common_benefit"]);
    expect(
      kinds(
        "Order Re: Reallocation of the Special Masters' Costs. Judge Dan Aaron Polster (MDL 2804) on 2/23/18. (P,R) (Entered: 02/23/2018)",
      ),
    ).toEqual(["special_master"]);
  });

  it("never classifies a withheld entry and marks empty text unknown", () => {
    expect(classifyDocketText(T.cmo1_3047, { withheld: true })).toEqual({
      rule: ORDERS_RULE_VERSION,
      role: "withheld",
      title: null,
      tags: [],
    });
    expect(classifyDocketText(null).role).toBe("unknown");
    expect(classifyDocketText("   ").tags).toEqual([]);
  });
});

describe("printedTitle", () => {
  it("cuts at the judge, the signature or the clerk stamps", () => {
    expect(printedTitle(T.r702_denied_3047)).toBe(
      "ORDER DENYING RULE 702 MOTION TO EXCLUDE SCHOOL DISTRICT EXPERTS",
    );
    expect(printedTitle(T.settlement_2804)).toBe("Order Regarding Settlement Negotiating Teams");
    expect(printedTitle(T.r702_schedule_3047)).toBe("Order");
    expect(printedTitle(T.cto52)).toBe("CONDITIONAL TRANSFER ORDER No. 52");
  });
});

describe("server prefilter", () => {
  it("selects every fixture the classifier tags (prefilter is a superset)", () => {
    const res = ORDER_PREFILTER_PATTERNS.map((p) => new RegExp(p, "i"));
    for (const [key, text] of Object.entries(T)) {
      if (!classifyDocketText(text).tags.length) continue;
      expect(
        res.some((r) => r.test(text)),
        key,
      ).toBe(true);
    }
  });

  it("contains no backslash or double quote (PostgREST quoting) and compiles in JavaScript", () => {
    for (const p of [...ORDER_PREFILTER_PATTERNS, DATE_PREFILTER_PATTERN]) {
      expect(p).not.toMatch(/[\\"]/);
      expect(() => new RegExp(p, "i")).not.toThrow();
    }
  });
});

const entry = (id: string, n: number, date: string, text: string): ClassifiedEntry => {
  const c = classifyDocketText(text);
  return {
    id,
    entryNumber: n,
    date,
    docketKey: "cand:4:2022-md-03047",
    sourceUrl: `https://www.courtlistener.com/docket/65407433/${n}/x/`,
    documentIds: [],
    role: c.role,
    title: c.title,
    tags: c.tags,
  };
};

describe("orderLedger", () => {
  const entries = [
    entry("e1", 75, "2022-11-10", T.cmo1_3047),
    entry("e2", 82, "2022-11-15", T.cmo2_3047),
    entry("e3", 3062, "2026-05-21", "CASE MANAGEMENT ORDER NO. 5. Signed by Judge Y on 5/21/2026."),
    entry(
      "e4",
      3100,
      "2026-06-01",
      "AMENDED CASE MANAGEMENT ORDER NO. 5. Signed by Judge Y on 6/1/2026.",
    ),
    entry("e5", 3200, "2026-06-02", T.pto37_3108),
    entry("e6", 3300, "2026-06-03", T.neg_motion_dismiss_2873),
  ];

  it("keys rows on number + suffix + entry and lists missing numbers", () => {
    const l = orderLedger(entries);
    expect(l.cmo.rows.map((r) => [r.number, r.entry.id])).toEqual([
      [1, "e1"],
      [2, "e2"],
      [5, "e3"],
      [5, "e4"],
    ]);
    expect(l.cmo).toMatchObject({
      issuedEntries: 4,
      distinctNumbers: 3,
      highest: 5,
      missing: [3, 4],
    });
    expect(l.cmo.latest?.entry.id).toBe("e4");
    expect(l.pto).toMatchObject({ highest: 37, distinctNumbers: 1 });
    expect(l.pto.missing).toHaveLength(36);
    expect(NOT_IN_COLLECTED_TEXT).toBe("Not in collected docket text");
  });

  it("counts kinds once per entry", () => {
    const counts = countKinds(entries);
    expect(counts.find((c) => c.kind === "cmo")).toEqual({
      kind: "cmo",
      entries: 4,
      latest: "2026-06-01",
    });
    expect(counts.find((c) => c.kind === "leadership")?.entries).toBe(1);
  });

  it("joins court-page orders on exact (kind, number, suffix) only", () => {
    const l = orderLedger(entries);
    const joined = joinCourtPageOrders(l, [
      {
        title: "CASE MANAGEMENT ORDER NO. 5. Signed by",
        url: "https://ecf/1",
        date: "2026-05-21",
        vacated: false,
      },
      {
        title:
          "CASE MANAGEMENT ORDER NO. 38 (Appointing a Special Master to Oversee Meta's Privilege Re-Review)",
        url: "https://ecf/2",
        date: "2026-10-16",
        vacated: false,
      },
      { title: "CASE MANAGEMENT ORDER NO. 5-A", url: "https://ecf/3", date: null, vacated: false },
      {
        title: "Transcript of Proceedings ... Per General Order No. 59",
        url: "https://ecf/4",
        date: null,
        vacated: false,
      },
    ]);
    expect(joined.map((j) => [j.number, j.suffix, j.docketEntryIds])).toEqual([
      [5, null, ["e3", "e4"]],
      [38, null, []],
      [5, "A", []],
    ]);
  });
});

describe("orderLabel", () => {
  it("prints the suffix the way the court wrote it", () => {
    expect(orderLabel("cmo", 36, null)).toBe("CMO No. 36");
    expect(orderLabel("cmo", 9, "A")).toBe("CMO No. 9-A");
    expect(orderLabel("pto", 28, "b")).toBe("PTO No. 28(b)");
  });
});

describe("prefilter patterns sent to Postgres", () => {
  // PostgreSQL regular expressions reject a bounded repetition above 255 (RE_DUP_MAX) with
  // "invalid repetition count(s)", which failed every orders and dates read on the live database.
  it("never use a repetition bound above 255", () => {
    for (const pattern of [...ORDER_PREFILTER_PATTERNS, DATE_PREFILTER_PATTERN]) {
      for (const [, lo, hi] of pattern.matchAll(/\{(\d+)(?:,(\d*))?\}/g)) {
        expect(Number(lo)).toBeLessThanOrEqual(255);
        if (hi) expect(Number(hi)).toBeLessThanOrEqual(255);
      }
    }
  });
});
