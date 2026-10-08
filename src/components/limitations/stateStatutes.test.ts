import { describe, expect, it } from "vitest";
import type { LimitationRule, LimitationsSnapshot } from "@/lib/limitations/types";
import { citedStatutes, claimMatrix, statuteSummary } from "./stateStatutes";

const rule = (over: Record<string, unknown>): LimitationRule =>
  ({
    id: "r",
    jurisdiction: "PA",
    claimType: "personal_injury",
    ruleKind: "limitations",
    computation: "baseline_only",
    period: { amount: 2, unit: "calendar_years" },
    sourceIds: ["pa-5524"],
    pinpoint: "42 Pa.C.S. § 5524(2)",
    ...over,
  }) as unknown as LimitationRule;

const snapshot = {
  rules: [
    rule({ id: "pa-pi", provenance: { citation: "42 Pa.C.S. § 5524(2)", excerpt: "within two years", flags: [], entryStatus: "verified" } }),
    rule({ id: "pa-pi-asb", subtype: "asbestos", computation: "research_only", period: null }),
    rule({
      id: "pa-wd",
      claimType: "wrongful_death",
      provenance: { citation: "42 Pa.C.S. § 5524(2)", excerpt: "an action to recover damages for ... death", flags: ["survival limb unmodelled"], entryStatus: "flagged" },
      currency: { checkedAt: "2026-10-08T01:00:00Z", status: "confirmed", detail: "ok", confirmedSourceIds: ["pa-5524"], uncheckedSourceIds: [], lostSourceIds: [] },
    }),
    rule({ id: "pa-mcare", claimType: "medical_malpractice", ruleKind: "repose", sourceIds: ["pa-mcare", "us-x"], pinpoint: "40 P.S. § 1303.513", period: { amount: 7, unit: "calendar_years" } }),
    rule({ id: "tx-pi", jurisdiction: "TX", sourceIds: ["tx-16"], pinpoint: "Tex. Civ. Prac. & Rem. Code § 16.003" }),
  ],
  sources: [
    { id: "pa-5524", state: "PA", title: "42 Pa.C.S. § 5524", url: "https://www.palegis.us/x", authorityKind: "statute", currency: { checkedAt: "2026-10-08T01:00:00Z", status: "confirmed_evidence_intact", route: "official_code_capture", detail: "found", codeCapture: { sectionNativeIds: ["PA:42:5524"] } } },
    { id: "pa-mcare", state: "PA", title: "MCARE Act § 513", url: "https://www.palegis.us/y", authorityKind: "statute" },
    { id: "pa-guide", state: "PA", title: "Publisher guidance", url: "https://www.palegis.us/z", authorityKind: "publisher_guidance", currency: { checkedAt: "2026-10-08T01:00:00Z", status: "evidence_lost", route: "direct", detail: "gone" } },
    { id: "us-x", state: "US", title: "Federal reference", url: "https://www.govinfo.gov/x", authorityKind: "statute" },
    { id: "us-unused", state: "US", title: "Unused federal", url: "https://www.govinfo.gov/y", authorityKind: "statute" },
    { id: "tx-16", state: "TX", title: "Tex. CPRC § 16.003", url: "https://statutes.capitol.texas.gov/x", authorityKind: "statute" },
  ],
  coverage: [
    {
      state: "PA",
      claimCoverage: [
        { claimType: "personal_injury", status: "baseline", ruleId: "pa-pi", grade: "official_capture_verified", variants: [{ subtype: "asbestos", ruleId: "pa-pi-asb", status: "research_only" }] },
        { claimType: "fraud", status: "not_recorded", reason: "No official-text entry yet" },
      ],
    },
  ],
  cases: [],
} as unknown as LimitationsSnapshot;

const name = (r: LimitationRule) => `variant ${r.subtype}`;

describe("claim matrix", () => {
  it("lists every claim type, reading the coverage record first and the rules otherwise", () => {
    const rows = claimMatrix(snapshot, "PA", name);
    expect(rows).toHaveLength(12);
    const pi = rows.find((r) => r.claimType === "personal_injury")!;
    expect(pi.status).toBe("baseline");
    expect(pi.statusLabel).toBe("Date computable");
    expect(pi.period).toBe("2 calendar years");
    expect(pi.citation).toBe("42 Pa.C.S. § 5524(2)");
    expect(pi.grade).toBe("Verified from official capture");
    expect(pi.variants).toEqual([{ ruleId: "pa-pi-asb", name: "variant asbestos", status: "research_only" }]);
    const wd = rows.find((r) => r.claimType === "wrongful_death")!;
    expect(wd.status).toBe("flagged");
    expect(wd.flags).toEqual(["survival limb unmodelled"]);
    expect(wd.currency?.tone).toBe("ok");
    const fraud = rows.find((r) => r.claimType === "fraud")!;
    expect(fraud.status).toBe("not_recorded");
    expect(fraud.period).toBe("Not recorded");
    expect(fraud.citation).toBeNull();
    expect(fraud.reason).toBe("No official-text entry yet");
    const defamation = rows.find((r) => r.claimType === "defamation")!;
    expect(defamation.status).toBe("not_recorded");
    expect(defamation.currency).toBeNull();
  });

  it("never borrows another state's rule", () => {
    const rows = claimMatrix(snapshot, "TX", name);
    expect(rows.find((r) => r.claimType === "personal_injury")!.citation).toContain("16.003");
    expect(rows.filter((r) => r.status !== "not_recorded")).toHaveLength(1);
  });
});

describe("cited statutes", () => {
  it("groups the state's rules under each source, statutes first, cited sources before uncited ones", () => {
    const list = citedStatutes(snapshot, "PA", name);
    expect(list.map((s) => s.source.id)).toEqual(["pa-5524", "pa-mcare", "us-x", "pa-guide"]);
    const main = list[0]!;
    expect(main.codeSections).toEqual(["PA:42:5524"]);
    expect(main.currency.tone).toBe("ok");
    expect(main.citedBy.map((c) => c.ruleId)).toEqual(["pa-pi", "pa-pi-asb", "pa-wd"]);
    expect(main.citedBy[0]!.excerpt).toBe("within two years");
    expect(main.citedBy[1]!.variant).toBe("variant asbestos");
    expect(main.citedBy[1]!.period).toBe("Not recorded");
    expect(main.citedBy[2]!.claimLabel).toBe("Wrongful death");
    expect(list.find((s) => s.source.id === "us-unused")).toBeUndefined();
    expect(list.find((s) => s.source.id === "tx-16")).toBeUndefined();
    expect(list[3]!.citedBy).toEqual([]);
    expect(list[3]!.currency.tone).toBe("lost");
  });

  it("summarises recheck outcomes as counts of records", () => {
    expect(statuteSummary(citedStatutes(snapshot, "PA", name))).toEqual({
      sources: 4,
      confirmed: 1,
      lost: 1,
      unchecked: 2,
    });
  });
});
