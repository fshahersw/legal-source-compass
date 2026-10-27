import { describe, expect, it } from "vitest";
import {
  anchorOf,
  classifyRule,
  measureOf,
  parseRuleInsight,
  practiceMatrix,
  practiceRows,
  stripExceptions,
  type PracticeMeasure,
  type RuleInsight,
} from "./venuePractice";

let seq = 0;
/** A rule as court_rule_insights stores it; applies_to and quotes below are copied from the federal_local rows. */
const R = (
  courtId: string,
  doc: string,
  category: string,
  appliesTo: string,
  number: number | null,
  unit: string | null,
  quote: string,
): RuleInsight => ({
  id: `${doc}:t${String(++seq).padStart(3, "0")}`,
  courtId,
  doc,
  docTitle: null,
  category,
  appliesTo,
  number,
  unit,
  quote,
  page: 1,
  docUrl: null,
  sourceUrl: null,
});
const RD = "response_deadline";
const RP = "reply_deadline";
const PL = "page_limit";

// Rows of the districts with the most pending MDL actions (njd, ohsd, scd, cand, mnd, ilsd, insd) plus nyed and flsd.
const RULES: RuleInsight[] = [
  R("njd", "njd-combined", RD, "Opposition brief and papers to a motion", 14, "days",
    "The brief and papers in opposition to a motion, specifying the motion day on the cover page,\nwith proof or acknowledgment of service thereof on all other parties, must be filed with the Clerk at least 14\ndays prior to the original motion day, unless the Court otherwise orders, or an automatic extension is obtained\npursuant to L.Civ.R. 7.1(d)(5)."),
  R("njd", "njd-combined", RP, "Reply papers after an automatic adjournment of a dispositive motion", 7, "days",
    "and the moving party shall file its reply papers, if any, at least seven days prior to the new motion day."),
  R("njd", "njd-combined", PL, "Brief (opening or opposition)", 40, "pages",
    "Any brief shall include a table of contents and a table of authorities and shall not exceed 40\nordinary typed or printed pages"),
  R("ohsd", "ohsd-combined", RD, "Memorandum in opposition to a motion", 21, "days",
    "Any memorandum in opposition shall be filed\nwithin twenty-one days after the date of service of the motion."),
  R("ohsd", "ohsd-combined", RP, "Reply memorandum in support of a motion", 14, "days",
    "Any reply\nmemorandum shall be filed within fourteen days after the date of service of the\nmemorandum in opposition."),
  R("ohsd", "ohsd-combined", PL, "Memoranda supporting or opposing a motion", 20, "pages",
    "The Court prefers that memoranda in\nsupport of or in opposition to any motion or application to the Court not exceed\ntwenty pages."),
  R("scd", "scd-civil", RD, "Response or opposition to a motion", 14, "days",
    "Any memorandum or response of an opposing party must\nbe filed with the court within fourteen (14) days of the service of the motion unless the court\nimposes a different deadline."),
  R("scd", "scd-civil", RP, "Reply in support of a motion", 7, "days",
    "However, a party desiring to reply\nto matters raised initially in a response to a motion or in accompanying supporting documents\nshall file the reply within seven (7) days after service of the response, unless otherwise ordered\nby the court."),
  R("scd", "scd-civil", PL, "Initial brief or memorandum", 35, "pages",
    "(1) Thirty-five (35) double-spaced pages, in the case of an initial brief of"),
  R("scd", "scd-civil", PL, "Mediation memoranda", 5, "pages",
    "Each memorandum should be no more than five (5) pages in\nlength unless permitted by the mediator."),
  R("cand", "cand-civil", RD, "Opposition to a motion", 14, "days",
    "The opposition must be filed and served not more than 14 days after the motion was filed."),
  R("cand", "cand-civil", RD, "Opposition to motion for administrative relief", 4, "days",
    "must be accompanied by a proposed order, and must be filed no later than 4\ndays after the motion has been filed."),
  R("cand", "cand-civil", RP, "Reply in support of a motion", 7, "days",
    "The reply to an opposition must be filed and served not more than 7 days after the opposition was due."),
  R("cand", "cand-civil", PL, "Opposition brief or memorandum", 25, "pages",
    "Pursuant to Civil L.R. 7-4(b), such brief or memorandum may not\nexceed 25 pages of text."),
  R("cand", "cand-civil", PL, "Motion for administrative relief", 5, "pages",
    "A motion for an order concerning a miscellaneous\nadministrative matter may not exceed 5 pages"),
  R("mnd", "mnd-combined", RD, "Opposition to a dispositive motion", 21, "days",
    "Within 21\ndays after filing of a dispositive motion and its supporting documents under\nLR 7.1(c)(1), the responding party must file and serve the following\ndocuments:"),
  R("mnd", "mnd-combined", RD, "Opposition to a nondispositive motion", 7, "days",
    "Within 7\ndays after filing of a nondispositive motion and its supporting documents\nunder LR 7.1(b)(1), the responding party must file and serve the following\ndocuments:"),
  R("mnd", "mnd-combined", RD, "Response to a motion to extend time", 3, "days",
    "A party wishing to respond to a motion to extend time should\ndo so promptly, and in no event later than three days after the motion is\nfiled."),
  R("mnd", "mnd-combined", RD, "Response to Rule 54(d)(2) attorney's fees motion", 14, "days",
    "When a party timely files and serves a motion for\nattorney’s fees and related nontaxable expenses under Fed. R. Civ. P. 54(d)(2), a party\nmay file a response within 14 days"),
  R("mnd", "mnd-combined", RD, "Opposition to motion to withdraw money from court registry", 7, "days",
    "A party opposing the motion must file a response within 7 days after\nthe motion is filed."),
  R("mnd", "mnd-combined", RP, "Reply in support of a dispositive motion", 14, "days",
    "Within 14 days after filing of a response to a dispositive\nmotion, the moving party must either:"),
  R("mnd", "mnd-combined", RP, "Reply in support of a nondispositive motion", null, null,
    "Except with the court’s prior permission, a\nparty must not file a reply memorandum in support of a nondispositive\nmotion."),
  R("ilsd", "ilsd-combined", RD,
    "Response to civil motion to remand, dismiss, for judgment on the pleadings, summary judgment, to exclude expert testimony, or post-trial motion",
    30, "days", "An adverse party shall have 30 days after service of a motion\nlisted above to file a response."),
  R("ilsd", "ilsd-combined", RD, "Response to other civil motions not requiring a brief", 14, "days",
    "A party opposing a motion not listed in subsection (b)(1)\nshall have 14 days after service of the motion to file a written\nresponse."),
  R("ilsd", "ilsd-combined", RP, "Reply brief on motions requiring a supporting brief", 14, "days",
    "Reply briefs, if any, shall be filed within 14 days of the\nservice of a response."),
  R("ilsd", "ilsd-combined", RP, "Reply on other civil motions not requiring a brief", 7, "days",
    "A reply, if any, shall be filed within 7 days of the\nservice of the response."),
  R("ilsd", "ilsd-combined", PL, "Briefs generally (except response to habeas petition)", 20, "pages",
    "no brief shall be submitted\nwhich is longer than 20 double-spaced typewritten pages in 12-\npoint font."),
  R("ilsd", "ilsd-combined", PL, "Reply briefs", 5, "pages",
    "Reply briefs are not favored, shall not exceed five pages, and\nshould be filed only in exceptional circumstances."),
  R("ilsd", "ilsd-combined", PL, "Summary judgment briefs", 20, "pages",
    "Briefs in support of or in opposition to a Motion for Summary Judgment\nshall not exceed 20 pages"),
  R("insd", "insd-combined", RD, "Response to a motion (other than Rule 12 or summary judgment motions)", 14, "days",
    "Any response is due within 14 days after service of the\nmotion."),
  R("insd", "insd-combined", RD, "Opposition to Motion to Maintain Document(s) Under Seal (civil)", 14, "days",
    "Any opposition to a Motion to\nMaintain Document(s) Under Seal must be filed within 14 days of service of the Brief\nin Support."),
  R("insd", "insd-combined", RD, "Response to a summary judgment motion", 28, "days",
    "A party opposing a summary judgment motion\nmust, within 28 days after the movant serves the motion, file and serve a response\nbrief"),
  R("insd", "insd-combined", RP, "Reply in support of a motion (other than summary judgment)", 7, "days",
    "Any reply is due within 7 days after service of the response."),
  R("insd", "insd-combined", PL, "Brief in Support of sealing (civil)", 10, "pages",
    "A Brief in Support must not exceed 10 pages in length,\nwithout prior leave of court, and must include:"),
  R("insd", "insd-combined", PL, "Supporting and response briefs", 30, "pages",
    "Supporting and response briefs (excluding tables of contents,\ntables of authorities, appendices, and certificates of service) may not exceed 30\npages."),
  R("insd", "insd-combined", PL, "Reply briefs", 15, "pages", "Reply briefs may not exceed 15 pages."),
  R("nyed", "nyed-combined", RD, "Opposition to civil motions other than discovery motions and habeas petitions", 14, "days",
    "(2) any opposing or response papers must be served within 14 days after\nservice of the moving papers,"),
  R("nyed", "nyed-combined", RD, "Opposition to discovery motions (Fed. R. Civ. P. 26-37, 45(d)(3))", 7, "days",
    "(2) any opposing or response papers must be served\nwithin seven days after service of the moving papers,"),
  R("nyed", "nyed-combined", PL, "Opening and opposition briefs by unrepresented parties (handwritten or typewritten)", 25, "pages",
    "If filed by a party who is not represented by an attorney and handwritten or\nprepared with a typewriter, briefs in support of and in response to a motion may\nnot"),
  R("flsd", "flsd-combined", PL, "Memorandum supporting bill of costs", 10, "pages",
    "The bill of costs shall attach copies of any documentation showing the amount of costs and\nshall be supported by a memorandum not exceeding ten (10) pages."),
  R("flsd", "flsd-combined", PL, "Motion with incorporated memorandum and opposing memorandum", 20, "pages",
    "Absent prior permission of the Court, neither a motion and its incorporated\nmemorandum of law nor the opposing memorandum of law shall exceed twenty\n(20) pages;"),
];

const COURTS = ["njd", "ohsd", "scd", "cand", "mnd", "ilsd", "insd", "nyed", "flsd"];
const m = practiceMatrix(RULES, COURTS);
const cell = (c: string, k: PracticeMeasure) => m.cells[c]![k];

describe("venuePractice: parsing", () => {
  it("parses a stored rule insight", () => {
    const r = parseRuleInsight({
      id: "ohsd-combined:i002",
      court: "ohsd",
      source_url: "https://www.ohsd.uscourts.gov/local-rules",
      ri: {
        doc: "ohsd-combined",
        category: "response_deadline",
        applies_to: "Memorandum in opposition to a motion",
        number: 21,
        unit: "days",
        quote: "Any memorandum in opposition shall be filed within twenty-one days",
        page: 15,
        doc_url: "https://www.ohsd.uscourts.gov/sites/ohsd/files/rules.pdf",
      },
    });
    expect(r).toMatchObject({ courtId: "ohsd", number: 21, page: 15 });
    expect(measureOf(r!)).toBe("opposition_days");
  });
  it("strips exception clauses before testing for special proceedings", () => {
    expect(stripExceptions("Response to a motion (other than Rule 12 or summary judgment motions)")).toBe(
      "response to a motion",
    );
    expect(
      stripExceptions("Opposition to civil motions other than discovery motions and habeas petitions"),
    ).toBe("opposition to civil motions");
  });
  it("reads the start point a deadline is counted from", () => {
    expect(anchorOf(RULES[0]!.quote)).toBe("before_hearing"); // njd: before the motion day
    expect(anchorOf("within twenty-one days after the date of service of the motion.")).toBe(
      "after_service",
    );
    expect(anchorOf("not more than 14 days after the motion was filed.")).toBe("after_filing");
    expect(anchorOf("not more than 7 days after the opposition was due.")).toBe("after_due");
    expect(anchorOf("Within 14 days after filing of a response to a dispositive motion")).toBe(
      "after_filing",
    );
  });
});

describe("venuePractice: matrix on the real rows", () => {
  it("never pools a deadline counted back from the motion day with one counted from service or filing", () => {
    expect(cell("njd", "opposition_days")).toMatchObject({ value: 14, anchor: "before_hearing" });
    expect(cell("scd", "opposition_days")).toMatchObject({ value: 14, anchor: "after_service" });
    expect(cell("cand", "opposition_days")).toMatchObject({ value: 14, anchor: "after_filing" });
    const rows = practiceRows(m).filter((r) => r.measure === "opposition_days");
    expect(rows.map((r) => r.anchor)).toEqual(["after_service", "after_filing", "before_hearing"]);
    const fromService = rows.find((r) => r.anchor === "after_service")!.values;
    expect(fromService[COURTS.indexOf("njd")]).toBeNull();
    expect(fromService[COURTS.indexOf("ohsd")]).toBe(21);
  });
  it("leaves out a limit the court only prefers (ohsd 20 pages)", () => {
    expect(cell("ohsd", "brief_pages")).toMatchObject({ value: null, several: false, rules: [] });
  });
  it("does not fill a general cell from a sealing, registry, fee, extension or administrative rule", () => {
    expect(cell("insd", "brief_pages")).toMatchObject({ value: 30, several: false });
    expect(cell("insd", "opposition_days")).toMatchObject({ value: 14, several: false });
    expect(cell("cand", "opposition_days").several).toBe(false);
    expect(cell("cand", "brief_pages").value).toBe(25);
    expect(cell("flsd", "brief_pages")).toMatchObject({ value: 20, several: false });
  });
  it("keeps a general rule that only lists exceptions (insd, nyed)", () => {
    expect(cell("insd", "reply_days")).toMatchObject({ value: 7, anchor: "after_service" });
    expect(cell("nyed", "opposition_days")).toMatchObject({ value: 14, anchor: "after_service" });
    expect(cell("insd", "reply_pages").value).toBe(15);
  });
  it("reads a rule split by motion type as several, never as the general value (ilsd, mnd)", () => {
    expect(cell("ilsd", "opposition_days")).toMatchObject({ value: null, several: true, split: true });
    expect(cell("ilsd", "reply_days")).toMatchObject({ value: null, several: true, split: true });
    expect(cell("mnd", "opposition_days")).toMatchObject({ value: null, several: true, split: true });
    expect(cell("mnd", "reply_days")).toMatchObject({ value: null, several: true, split: true });
    const mndReply = m.matched.filter((r) => r.courtId === "mnd" && r.measure === "reply_days");
    expect(mndReply.map((r) => r.reading)).toEqual([
      "Dispositive motions: 14 days after the opposition is filed",
      "Nondispositive motions: No reply without the court's permission",
    ]);
    // mnd's extension, fee and registry responses never enter the matrix
    expect(m.matched.filter((r) => r.courtId === "mnd").map((r) => r.appliesTo)).not.toContain(
      "Response to a motion to extend time",
    );
    const ilsd30 = m.matched.find((r) => r.courtId === "ilsd" && r.number === 30)!;
    expect(ilsd30.branch).toMatch(/^Listed motions/);
  });
  it("reads the next districts in the MDL ranking (flnd, ohnd, paed, gand) the same way", () => {
    const more = practiceMatrix(
      [
        R("flnd", "flnd-combined", RD, "Memorandum opposing a motion (other than summary judgment)", 14, "days",
          "Unless otherwise ordered, the deadline for a memorandum opposing a motion (other than a summary-judgment motion) is 14\ndays after service of the motion, without a 3-day extension based on electronic service of the motion."),
        R("flnd", "flnd-combined", RD, "Memorandum opposing a bill of costs", 14, "days",
          "Any other party may file a memorandum in opposition within 14\ndays after the bill of costs is filed."),
        R("flnd", "flnd-combined", RP, "Reply memorandum in support of a motion (other than summary judgment)", null, null,
          "A party ordinarily may not file a reply memorandum in support\nof a motion."),
        R("ohnd", "ohnd-civil", RD, "Opposition to a dispositive motion", 30, "days",
          "each party opposing a motion must serve and file a memorandum in opposition\nwithin thirty (30) days after service of any dispositive motion"),
        R("ohnd", "ohnd-civil", RD, "Opposition to a non-dispositive motion", 14, "days",
          "within fourteen (14)\ndays after service of any non-dispositive motion."),
        R("paed", "paed-civil", RD, "Brief in opposition to a motion", 14, "days",
          "any party opposing the motion shall\nserve a brief in opposition together with such answer or other response that\nmay be appropriate, within fourteen (14) days after service of the motion\nand supporting brief."),
        R("gand", "gand-civil", RD, "Opposition to a motion", 14, "days",
          "not\nlater than fourteen (14) days after service of the motion, except that in cases of motion\nfor summary judgment the time shall be twenty-one (21) days after the service of the\nmotion."),
        R("gand", "gand-civil", PL, "Briefs supporting or opposing a motion", 25, "pages",
          "Absent prior permission of the Court, briefs filed\nin support of a motion or in response to a motion are limited in length to twenty-five\n(25) pages."),
        R("gand", "gand-civil", PL, "Reply brief", 15, "pages", "If the movant files a reply, the reply brief may not exceed fifteen (15)\npages."),
      ],
      ["flnd", "ohnd", "paed", "gand"],
    );
    expect(more.cells["flnd"]!.opposition_days).toMatchObject({ value: 14, anchor: "after_service", several: false });
    expect(more.cells["flnd"]!.reply_days).toMatchObject({ value: null, several: false });
    expect(more.cells["ohnd"]!.opposition_days).toMatchObject({ value: null, split: true });
    expect(more.cells["paed"]!.opposition_days).toMatchObject({ value: 14, anchor: "after_service" });
    expect(more.cells["gand"]!.opposition_days.value).toBe(14);
    expect(more.cells["gand"]!.brief_pages.value).toBe(25);
    expect(more.cells["gand"]!.reply_pages.value).toBe(15);
  });
  it("keeps special proceedings and unrepresented-party limits out", () => {
    expect(cell("nyed", "brief_pages")).toMatchObject({ value: null, rules: [] });
    expect(cell("scd", "brief_pages").value).toBe(35);
    expect(cell("ilsd", "brief_pages").value).toBe(20);
    expect(cell("ilsd", "reply_pages").value).toBe(5);
    expect(
      classifyRule(
        R("njd", "njd-combined", RD, "Respondent's response in capital habeas case", 60, "days", "Within 60 days after being served"),
      ),
    ).toBeNull();
    expect(
      classifyRule(
        R("scd", "scd-criminal", RP, "Reply in support of a motion", 7, "days", "within seven days after service"),
      ),
    ).toBeNull();
  });
});
