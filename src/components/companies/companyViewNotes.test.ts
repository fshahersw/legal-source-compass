import { describe, expect, it } from "vitest";
import type { CompanyMdl } from "./companyData";
import {
  dateSpan,
  describeUncounted,
  kpiTooltip,
  linkedMdlNote,
  paymentsNoMatchText,
  pendingActionsValue,
  pendingTrendFootnote,
  pendingTrendMessage,
  pendingTrendView,
  uncountedReasons,
  usdTick,
} from "./companyViewNotes";

type Mdl = Parameters<typeof pendingTrendView>[0][number];
const mdl = (over: Partial<CompanyMdl> & { mdl: number }): Mdl => ({
  status: "pending",
  pending: 100,
  role: "defendant",
  dismissed: false,
  review: false,
  countsTowardExposure: true,
  ...over,
});
const series = (k: number) =>
  Array.from({ length: k }, (_, i) => ({
    date: `2026-0${i + 1}-01`,
    pending: 10 + i,
    mdls: 1,
  }));

describe("pendingTrendView", () => {
  it("names the pending MDL and the real reason when its role is not stated (Meta, MDL 3047 shape)", () => {
    const v = pendingTrendView(
      [mdl({ mdl: 3047, pending: 3824, role: "unclear", countsTowardExposure: false })],
      [],
    );
    expect(v.kind).toBe("none_counted");
    const msg = pendingTrendMessage(v)!;
    expect(msg).toContain("MDL 3047 is pending with 3,824 actions");
    expect(msg).toContain("do not state its role");
    expect(msg).not.toMatch(/no linked MDL is pending|is not pending/i);
  });

  it("says no linked MDL is pending only when that is literally true", () => {
    const v = pendingTrendView(
      [
        mdl({ mdl: 1, status: "terminated", pending: null }),
        mdl({ mdl: 2, status: "no_longer_listed", pending: null }),
      ],
      [],
    );
    expect(v).toEqual({ kind: "none_pending", linked: 2 });
    expect(pendingTrendMessage(v)).toBe(
      "None of this company's 2 linked MDLs is pending in the JPML monthly reports.",
    );
    expect(pendingTrendMessage({ kind: "none_pending", linked: 1 })).toBe(
      "This company's linked MDL is not pending in the JPML monthly reports.",
    );
  });

  it("lists every uncounted pending MDL with all its reasons, largest first", () => {
    const v = pendingTrendView(
      [
        mdl({ mdl: 10, pending: 5, role: "not_named", countsTowardExposure: false }),
        mdl({ mdl: 20, pending: 50, dismissed: true, countsTowardExposure: false }),
        mdl({
          mdl: 30,
          pending: null,
          role: "plaintiff",
          review: true,
          countsTowardExposure: false,
        }),
      ],
      [],
    );
    expect(v.kind).toBe("none_counted");
    const msg = pendingTrendMessage(v)!;
    expect(
      msg.startsWith("3 linked MDLs are pending but none is charted: MDL 20 (50 pending actions)"),
    ).toBe(true);
    expect(msg).toContain(
      "MDL 10 (5 pending actions): the evidence excerpt says the company is not named",
    );
    expect(msg).toContain(
      "MDL 30 (pending actions not recorded): the evidence excerpt describes the company as a claimant and the link is flagged for review",
    );
  });

  it("draws the chart with a footnote naming pending MDLs left out", () => {
    const v = pendingTrendView(
      [mdl({ mdl: 1 }), mdl({ mdl: 2, pending: 7, role: "unclear", countsTowardExposure: false })],
      series(3),
    );
    expect(v.kind).toBe("chart");
    expect(pendingTrendMessage(v)).toBeNull();
    expect(pendingTrendFootnote(v)).toBe(
      "Not charted: MDL 2 (7 pending actions): the evidence excerpts from the company's filings do not state its role.",
    );
    expect(pendingTrendFootnote(pendingTrendView([mdl({ mdl: 1 })], series(2)))).toBeNull();
  });

  it("explains a single monthly report instead of claiming nothing is pending", () => {
    const v = pendingTrendView([mdl({ mdl: 1 })], series(1));
    expect(v).toMatchObject({ kind: "single_report", mdls: 1, counted: 1 });
    expect(pendingTrendMessage(v)).toBe(
      "Only one JPML monthly report (2026-01-01) covers the 1 MDL counted as defendant: 10 pending actions. A trend needs two or more reports.",
    );
  });

  it("says how many counted MDLs the single report covers when it is fewer than all", () => {
    const v = pendingTrendView([mdl({ mdl: 1 }), mdl({ mdl: 2 }), mdl({ mdl: 3 })], series(1));
    expect(v).toMatchObject({ kind: "single_report", mdls: 1, counted: 3 });
    expect(pendingTrendMessage(v)).toBe(
      "Only one JPML monthly report (2026-01-01) covers 1 of the 3 MDLs counted as defendant: 10 pending actions. A trend needs two or more reports.",
    );
    const all = pendingTrendView(
      [mdl({ mdl: 1 }), mdl({ mdl: 2 })],
      [{ date: "2026-01-01", pending: 40, mdls: 2 }],
    );
    expect(pendingTrendMessage(all)).toContain("covers the 2 MDLs counted as defendant: 40");
    const unknown = pendingTrendView(
      [mdl({ mdl: 1 }), mdl({ mdl: 2 })],
      [{ date: "2026-01-01", pending: 40 }],
    );
    expect(pendingTrendMessage(unknown)).toContain(
      "covers some or all of the 2 MDLs counted as defendant: 40 pending actions",
    );
  });

  it("says each shared reason once for several uncounted MDLs (Novartis shape)", () => {
    const unclear = { role: "unclear" as const, countsTowardExposure: false };
    const v = pendingTrendView(
      [
        mdl({ mdl: 3023, pending: 500, ...unclear }),
        mdl({ mdl: 2740, pending: 10_000, ...unclear }),
        mdl({ mdl: 3006, pending: 40, ...unclear }),
        mdl({ mdl: 2924, pending: 2_000, ...unclear }),
      ],
      [],
    );
    const msg = pendingTrendMessage(v)!;
    expect(msg).toBe(
      "MDL 2740, 2924, 3006 and 3023 are pending (12,540 pending actions in total) but are not charted because the evidence excerpts from the company's filings do not state its role. This chart counts only MDLs whose evidence excerpt reads the company as a defendant.",
    );
    expect(msg.match(/do not state its role/g)).toHaveLength(1);
  });

  it("groups same-reason MDLs and keeps a different reason separate", () => {
    const unclear = { role: "unclear" as const, countsTowardExposure: false };
    const v = pendingTrendView(
      [
        mdl({ mdl: 3023, pending: 500, ...unclear }),
        mdl({ mdl: 2740, pending: 10_000, ...unclear }),
        mdl({ mdl: 3006, pending: null, ...unclear }),
        mdl({ mdl: 2924, pending: 2_000, ...unclear }),
        mdl({ mdl: 3100, pending: 900, role: "not_named", countsTowardExposure: false }),
      ],
      [],
    );
    const msg = pendingTrendMessage(v)!;
    expect(msg).toBe(
      "5 linked MDLs are pending but none is charted: MDL 2740, 2924, 3006 and 3023 (12,500 pending actions in total; not recorded for MDL 3006): the evidence excerpts from the company's filings do not state its role; MDL 3100 (900 pending actions): the evidence excerpt says the company is not named. This chart counts only MDLs whose evidence excerpt reads the company as a defendant.",
    );
    expect(msg.match(/do not state its role/g)).toHaveLength(1);
    // The chart footnote uses the same grouping.
    const drawn = pendingTrendView(
      [mdl({ mdl: 1 }), ...[5, 6].map((k) => mdl({ mdl: k, pending: null, ...unclear }))],
      series(2),
    );
    expect(pendingTrendFootnote(drawn)).toBe(
      "Not charted: MDL 5 and 6 (pending actions not recorded): the evidence excerpts from the company's filings do not state its role.",
    );
  });

  it("explains counted MDLs without monthly counts", () => {
    const v = pendingTrendView([mdl({ mdl: 9 }), mdl({ mdl: 4 })], []);
    expect(v).toMatchObject({ kind: "no_series", counted: [4, 9] });
    expect(pendingTrendMessage(v)).toBe(
      "No JPML monthly pending counts are recorded for MDL 4 and MDL 9, counted as defendant, so no trend can be drawn.",
    );
  });

  it("falls back to the dataset flag when no rule explains an exclusion", () => {
    expect(uncountedReasons({ role: "defendant", dismissed: false, review: false })).toEqual([
      "the published dataset does not count it toward the company's exposure",
    ]);
    expect(describeUncounted([])).toBe("");
  });
});

describe("dateSpan", () => {
  it("never prints a bare arrow or null", () => {
    expect(dateSpan("2025-07-31", "2026-07-30")).toBe("2025-07-31 → 2026-07-30");
    expect(dateSpan("2026-07-30", "2026-07-30")).toBe("2026-07-30");
    expect(dateSpan(null, "2026-07-30")).toBe("Not recorded → 2026-07-30");
    expect(dateSpan(null, null)).toBe("Not recorded");
  });
});

describe("pendingActionsValue", () => {
  it("distinguishes nothing counted from a missing count", () => {
    expect(pendingActionsValue({ pendingMdls: 0, pendingActions: null })).toBe("None counted");
    expect(pendingActionsValue({ pendingMdls: 2, pendingActions: null })).toBe("Not recorded");
    expect(pendingActionsValue({ pendingMdls: 1, pendingActions: 23690 })).toBe("23,690");
  });
});

describe("linkedMdlNote", () => {
  it("ties the counted number to the pending links, not to all links", () => {
    expect(linkedMdlNote([{ status: "pending" }, { status: "terminated" }], 0)).toBe(
      "1 pending · 0 of them counted as defendant",
    );
    expect(
      linkedMdlNote([{ status: "pending" }, { status: "terminated" }, { status: "terminated" }], 1),
    ).toBe("1 pending · 1 of them counted as defendant");
    expect(linkedMdlNote([{ status: "terminated" }], 0)).toBe("none pending");
  });
});

describe("kpiTooltip", () => {
  it("carries every line plus the explanation", () => {
    expect(kpiTooltip({ label: "Revenue", value: "$1B", note: "FY2025", detail: undefined })).toBe(
      "Revenue: $1B · FY2025",
    );
    expect(kpiTooltip({ label: "A", value: "1", note: "n", detail: "d", title: "Why" })).toBe(
      "A: 1 · n · d\nWhy",
    );
  });
});

describe("paymentsNoMatchText", () => {
  it("quotes the query and the device filter", () => {
    expect(paymentsNoMatchText(" zzzz ", false)).toBe(
      "No top-300 reporting entity has a name containing “zzzz”.",
    );
    expect(paymentsNoMatchText("zzzz", true)).toContain(
      "“zzzz” among device-linked entities (device or supply share of 10% or more)",
    );
    expect(paymentsNoMatchText("", true)).toBe(
      "No top-300 reporting entity has a device or supply share of 10% or more.",
    );
  });
});

describe("usdTick", () => {
  it("formats axis ticks compactly without raw digits", () => {
    expect(usdTick(0)).toBe("$0");
    expect(usdTick(940)).toBe("$940");
    expect(usdTick(40_000)).toBe("$40K");
    expect(usdTick(2_500_000)).toBe("$2.5M");
    expect(usdTick(1_000_000_000)).toBe("$1B");
    expect(usdTick(1_200_000_000)).toBe("$1.2B");
    expect(usdTick(12_000_000_000)).toBe("$12B");
    expect(usdTick(999_960)).toBe("$1M");
    expect(usdTick(-3_000_000)).toBe("-$3M");
    expect(usdTick(Number.NaN)).toBe("");
  });
});
