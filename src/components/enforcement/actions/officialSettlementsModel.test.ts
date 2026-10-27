import { describe, expect, it } from "vitest";
import type { OfficialSettlement } from "@/lib/external/enforcementActions.functions";
import {
  deadlineState,
  deadlinesByMonth,
  fundTotal,
  largestOpenFunds,
  mdlFromCaseNumber,
  roleLabel,
  roleMix,
  summarize,
  viewRows,
} from "./officialSettlementsModel";

type Amount = OfficialSettlement["amounts"][number];
const amt = (asWritten: string, valueUsd: number, role: Amount["role"], detail: string | null = null): Amount => ({
  asWritten,
  valueUsd,
  sentence: null,
  status: "confirmed",
  role,
  detail,
  roleBasis: null,
});

function row(id: string, over: Partial<OfficialSettlement> = {}): OfficialSettlement {
  return {
    id: `settle:${id}`,
    name: id,
    nameCheck: "exact phrase",
    pageTitle: null,
    officialUrl: `https://${id}.example.com/`,
    officialHost: `${id}.example.com`,
    retrievedAt: "2026-10-22T10:00:00Z",
    deadline: null,
    deadlineAsWritten: null,
    deadlineSentence: null,
    amounts: [],
    courts: [],
    caseNumbers: [],
    claimUrl: null,
    confirmed: ["deadline"],
    leadUrl: null,
    ...over,
  };
}

const TODAY = "2026-10-27";
// Shapes of real rows: the ACU airbag settlement states only per-claimant caps ($350 / $150) and MDL 2905's docket.
const ACU = row("acu", {
  deadline: "2027-04-08",
  amounts: [amt("$350", 350, "per_claimant"), amt("$150", 150, "per_claimant")],
  caseNumbers: ["2:19-ml-02905-JAK-JPR"],
});
const REALPAGE = row("realpage", {
  deadline: "2027-01-29",
  amounts: [amt("$359,925,000", 359925000, "fund_total")],
  caseNumbers: ["3:23-md-03071"],
});
const SOON = row("soon", { deadline: "2026-11-05", amounts: [amt("$4.7 million", 4.7e6, "fund_total"), amt("$100", 100, "per_claimant")] });
const PAST = row("past", { deadline: "2026-06-04", amounts: [amt("$100.00", 100, "per_claimant")], caseNumbers: ["1:23-md-03083-ADB-PGL"] });
const NONE = row("none", { amounts: [amt("$409,000", 409000, "other", "distribution")], caseNumbers: ["1:24-cv-00001"] });

describe("officialSettlementsModel", () => {
  it("never makes a per-claimant amount the headline", () => {
    expect(fundTotal(ACU)).toBeNull();
    expect(fundTotal(REALPAGE)?.asWritten).toBe("$359,925,000");
    expect(fundTotal(row("x", { amounts: [amt("$2,500", 2500, "fund_total"), amt("$6,100,000", 6.1e6, "fund_total")] }))?.valueUsd).toBe(6.1e6);
  });

  it("links an MDL only from a case number in MDL docket form", () => {
    expect(mdlFromCaseNumber("2:19-ml-02905-JAK-JPR")).toBe(2905);
    expect(mdlFromCaseNumber("2:18-mn-2873-RMG")).toBe(2873);
    for (const s of ["1:24-cv-00001", "MDL No. 2905", "", null, undefined]) expect(mdlFromCaseNumber(s)).toBeNull();
  });

  it("marks past deadlines as past and sorts open ones first, soonest first", () => {
    expect(deadlineState("2026-10-26", TODAY)).toBe("past");
    expect(deadlineState("2026-10-27", TODAY)).toBe("within_30_days");
    expect(deadlineState("2026-11-27", TODAY)).toBe("upcoming");
    expect(deadlineState(null, TODAY)).toBe("none");
    const rows = viewRows([NONE, PAST, ACU, REALPAGE, SOON], TODAY);
    expect(rows.map((r) => r.name)).toEqual(["soon", "realpage", "acu", "past", "none"]);
    expect(rows.find((r) => r.name === "acu")!.mdls).toEqual([{ mdl: 2905, caseNumber: "2:19-ml-02905-JAK-JPR" }]);
  });

  it("summarizes without inventing zeros before the amounts are typed", () => {
    const s = summarize(viewRows([NONE, PAST, ACU, REALPAGE, SOON], TODAY));
    expect(s).toMatchObject({ total: 5, open: 3, within30: 1, past: 1, noDeadline: 1, withFund: 2, perClaimantOnly: 2, withMdl: 3, typed: true });
    const untyped = summarize(viewRows([row("a", { amounts: [amt("$5", 5, null)] })], TODAY));
    expect(untyped.withFund).toBeNull();
    expect(untyped.perClaimantOnly).toBeNull();
    expect(roleLabel(amt("$5", 5, null))).toBe("Not typed yet");
    expect(roleLabel(amt("$409,000", 409000, "other", "distribution"))).toBe("Other figure: Agency distribution round");
  });

  it("counts open deadlines by month and ranks open funds one by one", () => {
    const rows = viewRows([NONE, PAST, ACU, REALPAGE, SOON], TODAY);
    const months = deadlinesByMonth(rows, TODAY, 6);
    expect(months.map((m) => m.month)).toEqual(["2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03"]);
    expect(months.map((m) => m.count)).toEqual([0, 1, 0, 1, 0, 0]); // April 2027 (ACU) is outside the window
    expect(months[0]!.partial).toBe(true);
    expect(largestOpenFunds(rows).map((r) => r.name)).toEqual(["realpage", "soon"]);
    const mix = roleMix(rows);
    expect(mix[0]).toEqual({ id: "per_claimant", label: "Per claimant", count: 4 });
    expect(mix.reduce((a, m) => a + m.count, 0)).toBe(7);
  });
});
