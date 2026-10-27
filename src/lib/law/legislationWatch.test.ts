import { describe, expect, it } from "vitest";
import {
  ALL_STATE_TOPICS_QUERY,
  EXCLUDED_STATE_BILLS,
  EXCLUSION_RULE,
  attentionMatrix,
  landingFigures,
  byState,
  byTopic,
  congressOn,
  latestHeld,
  mergeBills,
  sortByLatestAction,
  toFederalBill,
  toHearing,
  toWatchBill,
} from "./legislationWatch";

const TODAY = "2026-10-27";

// Shaped like state_bills rows read as select=id,title,source_url,filters,cells:item->cells (sampled 2026-10-27).
const bill = (
  id: string,
  o: {
    role?: string;
    outcome?: string;
    latest?: string;
    first?: string;
    ident?: string;
    title?: string;
  } = {},
) => ({
  id,
  title: `${o.ident ?? "HB 1"} (Somewhere): ${o.title ?? "Litigation financing"}`,
  source_url: `https://legislature.example.gov/${id}`,
  filters: {
    state: [id.slice(0, 2).toUpperCase()],
    session_role: [o.role ?? "current"],
    outcome: [o.outcome ?? "none"],
  },
  cells: {
    identifier: o.ident ?? "HB 1",
    title: o.title ?? "Litigation financing",
    session_name: "2026 Regular Session",
    status_label: "Introduced",
    latest_action: "Referred",
    latest_action_date: o.latest ?? "2026-03-01",
    first_action_date: o.first ?? "2025-02-03",
    sponsor: "Harris",
  },
});

describe("toWatchBill", () => {
  it("derives the stage, skips reviewed exclusions and flags a future-dated action", () => {
    expect(
      toWatchBill(bill("ok-2026-hb2619", { outcome: "enacted" }), "funding", TODAY)?.stage,
    ).toBe("enacted");
    expect(toWatchBill(bill("fl-2026-hb1"), "funding", TODAY)?.stage).toBe("no_final_action");
    expect(toWatchBill(bill("fl-2025-hb1", { role: "preceding" }), "funding", TODAY)?.stage).toBe(
      "not_passed",
    );
    expect(toWatchBill(bill("wi-2023-sb613", { outcome: "vetoed" }), "damages", TODAY)?.stage).toBe(
      "vetoed",
    );
    expect(toWatchBill(bill("ks-2025-2026-hb2378"), "product", TODAY)).toBeNull();
    const ga = toWatchBill(bill("ga-2025-26-hb1", { latest: "2028-07-01" }), "damages", TODAY)!;
    expect(ga.scheduled).toBe(true);
  });
});

describe("mergeBills", () => {
  it("joins topics, keeps one record of a carried-over bill (current session) and sorts scheduled actions last", () => {
    const a = toWatchBill(
      bill("ok-2025-hb2619", {
        role: "preceding",
        outcome: "enacted",
        ident: "HB 2619",
        latest: "2025-05-15",
      }),
      "funding",
      TODAY,
    )!;
    const b = toWatchBill(
      bill("ok-2026-hb2619", { outcome: "enacted", ident: "HB 2619", latest: "2025-05-15" }),
      "funding",
      TODAY,
    )!;
    const c = toWatchBill(
      bill("ny-2025-2026-a804", { ident: "A 804", latest: "2026-06-01" }),
      "funding",
      TODAY,
    )!;
    const c2 = toWatchBill(
      bill("ny-2025-2026-a804", { ident: "A 804", latest: "2026-06-01" }),
      "damages",
      TODAY,
    )!;
    const d = toWatchBill(
      bill("ga-2025-26-hb9", { ident: "HB 9", latest: "2028-07-01" }),
      "damages",
      TODAY,
    )!;
    const out = mergeBills([
      [a, c, d],
      [b, c2],
    ]);
    expect(out.map((x) => x.id)).toEqual(["ny-2025-2026-a804", "ok-2026-hb2619", "ga-2025-26-hb9"]);
    expect(out[0]!.topics).toEqual(["funding", "damages"]);
    expect(byState(out)[0]).toMatchObject({ total: 1 });
    expect(byTopic(out).find((t) => t.topic.id === "funding")?.counts).toEqual({
      enacted: 1,
      vetoed: 0,
      no_final_action: 1,
      not_passed: 0,
    });
  });
  it("sortByLatestAction puts undated rows after scheduled ones", () => {
    const rows = [
      { id: "a", latestActionDate: null, scheduled: false },
      { id: "b", latestActionDate: "2027-01-01", scheduled: true },
      { id: "c", latestActionDate: "2026-01-01", scheduled: false },
    ];
    expect(sortByLatestAction(rows).map((r) => r.id)).toEqual(["c", "b", "a"]);
  });
});

describe("federal and Congress", () => {
  it("reads sponsor and bioguide as published", () => {
    const f = toFederalBill({
      id: "119-hr-3512",
      title: "H.R. 3512, 119th Congress: Tackling Predatory Litigation Funding Act",
      source_url: "https://www.congress.gov/bill/119th-congress/house-bill/3512",
      filters: { sponsor: ["H001082"], has_law: ["no"] },
      cells: {
        citation: "H.R. 3512, 119th Congress",
        title: "Tackling Predatory Litigation Funding Act",
        sponsor: "Rep. Hern, Kevin [R-OK-1]",
        cosponsors: 39,
        status_label: "Introduced",
        introduced: "2025-05-20",
      },
    })!;
    expect(f).toMatchObject({
      bioguide: "H001082",
      cosponsors: 39,
      becameLaw: false,
      sponsor: "Rep. Hern, Kevin [R-OK-1]",
    });
  });
  it("finds the Congress in session", () => {
    expect(congressOn("2026-10-27")).toBe(119);
    expect(congressOn("2025-01-05")).toBe(119);
    expect(congressOn("2025-01-02")).toBe(118);
    expect(congressOn("2003-06-01")).toBe(108);
  });
  it("treats the publisher's 'Not stated' as a missing date", () => {
    const hs = [
      toHearing({ id: "CHRG-1", title: "A", congress: "118", held: "2023-09-13" })!,
      toHearing({ id: "CHRG-2", title: "B", congress: "118", held: "Not stated" })!,
    ];
    expect(hs[1]!.held).toBeNull();
    expect(latestHeld(hs)).toBe("2023-09-13");
    const m = attentionMatrix(
      { id: "funding", label: "Litigation funding", query: "x" },
      [
        { congress: 118, becameLaw: false },
        { congress: 119, becameLaw: true },
        { congress: 100, becameLaw: false },
      ],
      hs,
      119,
    );
    expect(m.cells.find((c) => c.congress === 118)).toEqual({
      congress: 118,
      bills: 1,
      hearings: 2,
    });
    expect(m.cells.find((c) => c.congress === 110)).toEqual({
      congress: 110,
      bills: 0,
      hearings: 0,
    });
    expect(m.bills).toBe(2);
    expect(m.billsBecameLaw).toBe(1);
    expect(m.hearings[0]!.id).toBe("CHRG-1");
  });
});

describe("exclusion rule", () => {
  it("applies the same rule to statutory-right remedies whatever the outcome", () => {
    // Maine Human Rights Act damages caps (enacted) are excluded like the Minnesota Human Rights Act bill.
    for (const id of ["me-131-ld1423", "mn-2023-2024-hf4021", "va-2026-hb581", "nj-222-a5120"])
      expect(toWatchBill(bill(id, { outcome: "enacted" }), "damages", TODAY)).toBeNull();
    // A damages rule for a class of personal-injury claims is kept.
    expect(
      toWatchBill(bill("va-2026-hb1479", { outcome: "enacted" }), "damages", TODAY),
    ).not.toBeNull();
    expect(EXCLUSION_RULE).toMatch(/named statutory or constitutional right/);
    expect(Object.values(EXCLUDED_STATE_BILLS).every((r) => r.trim().length > 0)).toBe(true);
  });
});

describe("landing figures", () => {
  it("counts the same enacted bills as the watch from an any-topic read plus the funding read", () => {
    const w = (id: string, topic: string, o: Parameters<typeof bill>[1] = {}) =>
      toWatchBill(bill(id, o), topic, TODAY)!;
    const hb2619 = { outcome: "enacted", ident: "HB 2619" };
    const any = [
      w("ut-2026-hb280", "any", { outcome: "enacted", ident: "HB 280" }),
      w("ut-2026-sb227", "any", { outcome: "enacted", ident: "SB 227" }),
      w("ok-2025-hb2619", "any", { ...hb2619, role: "preceding" }),
      w("ok-2026-hb2619", "any", hb2619),
      w("fl-2026-hb1", "any"),
    ];
    const funding = [
      w("ut-2026-hb280", "funding", { outcome: "enacted", ident: "HB 280" }),
      w("ok-2026-hb2619", "funding", hb2619),
    ];
    const federal = [
      toFederalBill({ id: "119-hr-1", filters: { has_law: ["no"] }, cells: {} })!,
      toFederalBill({ id: "119-hr-2", filters: { has_law: ["yes"] }, cells: {} })!,
    ];
    // The carried-over HB 2619 pair counts once.
    expect(landingFigures(mergeBills([any, funding]), federal)).toEqual({
      stateEnacted: 3,
      fundingEnacted: 2,
      federalNotLaw: 1,
    });
    expect(ALL_STATE_TOPICS_QUERY).toContain('"asbestos trust"');
    expect(ALL_STATE_TOPICS_QUERY).toContain('"litigation funding"');
  });
});
