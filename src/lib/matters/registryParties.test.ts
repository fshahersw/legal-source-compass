import { describe, expect, it } from "vitest";
import {
  buildPartiesModel,
  groupParties,
  isSeegerWeissFirm,
  isSeegerWeissNearMiss,
  parseRegistryPartyRow,
  pickFirms,
  pickParties,
  type ParsedPartyRow,
} from "./registryParties";

/** Shaped like the live sw_matter_parties_v1 rows of MDL 3166 and 3140 (party names are fictional placeholders). */
const counsel = (
  id: string,
  name: string | null,
  firm: string | null,
  roles: string[] = ["Attorney to be noticed"],
  terminated = false,
) => ({
  native_attorney_id: id,
  name,
  firm,
  roles,
  role_codes: [1],
  terminated,
});
const partyRow = (
  n: number,
  over: Record<string, unknown> = {},
  counselList: unknown[] = [],
): { id: string; cells: Record<string, unknown>; counsel: unknown[] } => ({
  id: `sw-party:courtlistener:72030009:${n}`,
  cells: {
    mdl: "3166",
    docket_key: "cand:3:2025-md-03166",
    docket_number: "3:25-md-03166",
    party_name: `Placeholder Party ${n}`,
    party_types: "Plaintiff",
    extra_info: "3:26-cv-03513-JD TERMINATED: 07/30/2026",
    date_terminated: "2026-07-30",
    name_withheld: false,
    native_party_id: String(n),
    counsel_count: counselList.length,
    lead_counsel_count: 1,
    counsel_sealed_omitted: 0,
    ...over,
  },
  counsel: counselList,
});

describe("party rows", () => {
  it("reads the party name and note exactly as published and splits the printed types", () => {
    const p = parseRegistryPartyRow(
      partyRow(1, {
        party_types: "Plaintiff / Third Party Defendant",
        party_name: "  ACME   HOLDINGS,  INC. ",
      }),
    )!;
    expect(p).toMatchObject({
      id: "sw-party:courtlistener:72030009:1",
      nativePartyId: "1",
      name: "ACME HOLDINGS, INC.",
      nameWithheld: false,
      types: ["Plaintiff", "Third Party Defendant"],
      note: "3:26-cv-03513-JD TERMINATED: 07/30/2026",
      dateTerminated: "2026-07-30",
      sealedOmitted: 0,
    });
  });

  it("counts a withheld name without showing one, and never shows contact details", () => {
    const withheld = parseRegistryPartyRow(
      partyRow(2, { name_withheld: true, party_name: "Should Not Show" }),
    )!;
    expect(withheld).toMatchObject({ name: null, nameWithheld: true });
    const emailName = parseRegistryPartyRow(partyRow(3, { party_name: "jane@example.com" }))!;
    expect(emailName.name).toBeNull();
    const phoneNote = parseRegistryPartyRow(
      partyRow(4, { extra_info: "call 212-555-0187 for details" }),
    )!;
    expect(phoneNote.note).toBeNull();
    const contactCounsel = parseRegistryPartyRow(
      partyRow(5, {}, [
        counsel("9", "A. Lawyer", "Firm, tel 415.555.0100"),
        counsel("10", "x@y.org", "Real Firm LLP"),
      ]),
    )!;
    expect(contactCounsel.counsel.map((c) => [c.name, c.firm])).toEqual([
      ["A. Lawyer", null],
      [null, "Real Firm LLP"],
    ]);
  });

  it("rejects a row that is not a party row", () => {
    expect(parseRegistryPartyRow({ ...partyRow(1), id: "sw-entry:courtlistener:1" })).toBeNull();
    expect(parseRegistryPartyRow({ ...partyRow(1), cells: null })).toBeNull();
  });

  it("keeps an attorney whose record is not collected as an unresolved entry", () => {
    const p = parseRegistryPartyRow(partyRow(6, {}, [counsel("77", null, null)]))!;
    expect(p.counsel).toEqual([
      {
        attorneyId: "77",
        name: null,
        firm: null,
        roles: ["Attorney to be noticed"],
        terminated: false,
      },
    ]);
  });
});

describe("exact firm matching", () => {
  it("matches the whole printed line, ignoring only case and spacing", () => {
    expect(isSeegerWeissFirm("Seeger Weiss LLP")).toBe(true);
    expect(isSeegerWeissFirm("SEEGER WEISS LLP")).toBe(true);
    expect(isSeegerWeissFirm("  Seeger   Weiss  LLP ")).toBe(true);
    // Commas and periods in the printed line do not make it another firm.
    expect(isSeegerWeissFirm("SEEGER WEISS, LLP")).toBe(true);
    expect(isSeegerWeissFirm("Seeger Weiss, LLP")).toBe(true);
    expect(isSeegerWeissFirm("Seeger Weiss L.L.P.")).toBe(false);
    expect(isSeegerWeissFirm("SEEGER WEISS LLP - Ridgefield Park")).toBe(false);
    expect(isSeegerWeissFirm("Seeger Weiss - Newark")).toBe(false);
    expect(isSeegerWeissFirm("Seeger Weiss LLP (Newark)")).toBe(false);
    expect(isSeegerWeissFirm("Weiss Seeger LLP")).toBe(false);
    expect(isSeegerWeissFirm("Anapol Weiss")).toBe(false);
    expect(isSeegerWeissFirm(null)).toBe(false);
  });

  it("recognises a near miss without ever treating it as the firm", () => {
    expect(isSeegerWeissNearMiss("Seeger Weiss - Newark")).toBe(true);
    expect(isSeegerWeissNearMiss("SEEGER WEISS LLP - Ridgefield Park")).toBe(true);
    expect(isSeegerWeissNearMiss("Seeger Weiss, LLP")).toBe(false);
    expect(isSeegerWeissNearMiss("Seeger Weiss LLP")).toBe(false);
    expect(isSeegerWeissNearMiss("Anapol Weiss")).toBe(false);
  });
});

function model(): ReturnType<typeof buildPartiesModel> {
  const rows: ParsedPartyRow[] = [
    partyRow(1, { party_types: "Plaintiff" }, [
      counsel("101", "Alice Adams", "Weitz & Luxenberg, P.C.", [
        "Attorney to be noticed",
        "Lead attorney",
      ]),
      counsel("102", "Chris Seeger", "Seeger Weiss LLP", ["Lead attorney"]),
      counsel("103", "Bob Brown", "Weitz and Luxenberg, P.C."),
    ]),
    partyRow(2, { party_types: "Plaintiff" }, [
      counsel("102", "Chris Seeger", "Seeger Weiss LLP", ["Lead attorney", "Pro hac vice"]),
      counsel("104", "Dee Davis", "SEEGER WEISS LLP", ["Attorney to be noticed"], true),
      counsel("105", "Eve Evans", "Seeger Weiss - Newark"),
    ]),
    partyRow(
      3,
      { party_types: "Defendant", party_name: "BIG COMPANY INC.", name_withheld: false },
      [counsel("201", "Fay Fox", "Defense Firm LLP"), counsel("202", null, null)],
    ),
    partyRow(
      4,
      {
        party_types: "Defendant / Counter-Claimant",
        party_name: "OTHER CO",
        counsel_sealed_omitted: 2,
      },
      [],
    ),
    partyRow(5, { party_types: "Plaintiff", name_withheld: true }, []),
  ].map((r) => parseRegistryPartyRow(r)!);
  return buildPartiesModel(rows);
}

describe("parties and counsel grouped", () => {
  it("counts the parties by printed type, defendants first, a party with two types under each", () => {
    const m = model();
    expect(m.types).toEqual([
      { value: "Defendant", count: 2 },
      { value: "Plaintiff", count: 3 },
      { value: "Counter-Claimant", count: 1 },
    ]);
    expect(m.counts).toMatchObject({
      parties: 5,
      namesWithheld: 1,
      counselEntries: 8,
      unresolved: 1,
      sealedOmitted: 2,
    });
  });

  it("groups counsel by the firm line exactly as printed, never merging spellings", () => {
    const m = model();
    const lines = m.firms.map((g) => g.firm);
    expect(lines).toContain("Weitz & Luxenberg, P.C.");
    expect(lines).toContain("Weitz and Luxenberg, P.C.");
    expect(lines).toContain("Seeger Weiss LLP");
    expect(lines).toContain("SEEGER WEISS LLP");
    expect(lines).toContain("Seeger Weiss - Newark");
    expect(m.counts.attorneys).toBe(6);
    expect(m.counts.firms).toBe(6);
  });

  it("puts the exact firm lines first and highlights only them", () => {
    const m = model();
    expect(m.firms.slice(0, 2).map((g) => g.firm)).toEqual([
      "Seeger Weiss LLP",
      "SEEGER WEISS LLP",
    ]);
    expect(m.firms.filter((g) => g.seegerWeiss).map((g) => g.firm)).toEqual([
      "Seeger Weiss LLP",
      "SEEGER WEISS LLP",
    ]);
    expect(m.firms.find((g) => g.firm === "Seeger Weiss - Newark")!.seegerWeiss).toBe(false);
  });

  it("summarises the firm's attorneys, the parties they appear for, and lists near misses apart", () => {
    const sw = model().seegerWeiss;
    expect(sw.firmLines).toEqual(["Seeger Weiss LLP", "SEEGER WEISS LLP"]);
    expect(sw.attorneys.map((a) => a.name)).toEqual(["Chris Seeger", "Dee Davis"]);
    // Chris Seeger appears on parties 1 and 2; Dee Davis on party 2 only: two distinct parties.
    expect(sw.parties).toBe(2);
    expect(sw.nearMisses).toEqual([{ firm: "Seeger Weiss - Newark", attorneys: 1 }]);
  });

  it("merges one attorney's roles across parties and marks terminated only when terminated everywhere", () => {
    const m = model();
    const chris = m.firms.find((g) => g.firm === "Seeger Weiss LLP")!.attorneys[0]!;
    expect(chris).toMatchObject({ name: "Chris Seeger", parties: 2, terminated: false });
    expect(chris.roles).toEqual(["Lead attorney", "Pro hac vice"]);
    const dee = m.firms.find((g) => g.firm === "SEEGER WEISS LLP")!.attorneys[0]!;
    expect(dee.terminated).toBe(true);
    const firm = m.firms.find((g) => g.firm === "Seeger Weiss LLP")!;
    expect(firm.parties).toBe(2);
  });

  it("filters parties by type and by the name of a party, its note or any of its counsel", () => {
    const m = model();
    expect(pickParties(m, { type: "Defendant", q: "" }).map((p) => p.name)).toEqual([
      "BIG COMPANY INC.",
      "OTHER CO",
    ]);
    expect(
      pickParties(m, { type: "", q: "chris seeger" }).map((p) => p.id.split(":").pop()),
    ).toEqual(["1", "2"]);
    expect(pickParties(m, { type: "Plaintiff", q: "defense firm" })).toEqual([]);
    expect(pickParties(m, { type: "", q: "terminated: 07/30/2026" })).toHaveLength(5);
    // The client never receives the internal search text.
    expect(Object.keys(pickParties(m, { type: "", q: "" })[0]!)).not.toContain("search");
  });

  it("groups the overview by type with the first rows of each", () => {
    const g = groupParties(model(), 1);
    expect(g.map((x) => [x.type, x.count, x.rows.length])).toEqual([
      ["Defendant", 2, 1],
      ["Plaintiff", 3, 1],
      ["Counter-Claimant", 1, 1],
    ]);
  });

  it("searches firms by firm name or attorney name", () => {
    const m = model();
    expect(pickFirms(m, "luxenberg").map((g) => g.firm)).toEqual([
      "Weitz & Luxenberg, P.C.",
      "Weitz and Luxenberg, P.C.",
    ]);
    expect(pickFirms(m, "fay fox").map((g) => g.firm)).toEqual(["Defense Firm LLP"]);
    expect(pickFirms(m, "")).toHaveLength(6);
    expect(pickFirms(m, "no such lawyer")).toEqual([]);
  });

  it("shows a counsel preview with the lead attorney flagged", () => {
    const p = pickParties(model(), { type: "", q: "" })[0]!;
    expect(p.counselPreview[0]).toEqual({
      name: "Alice Adams",
      firm: "Weitz & Luxenberg, P.C.",
      lead: true,
    });
    expect(p.counselCount).toBe(3);
  });
});
