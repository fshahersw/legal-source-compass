import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Each component's queries are answered from `state` by query-key prefix; no server function runs.
const state = vi.hoisted(() => ({ byKey: new Map<string, unknown>() }));
vi.mock("@tanstack/react-query", () => ({
  queryOptions: (o: unknown) => o,
  keepPreviousData: (x: unknown) => x,
  useQuery: (o: { queryKey: unknown[] }) => {
    const r = state.byKey.get(String(o.queryKey[1])) ?? { isPending: true };
    return {
      isPending: false,
      isError: false,
      data: undefined,
      refetch: () => {},
      ...(r as object),
    };
  },
  useQueryClient: () => ({ fetchQuery: vi.fn() }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => createElement("a", null, children),
  useNavigate: () => () => {},
}));
vi.mock("@/lib/litviz/litviz.functions", () => ({
  getCitationGrid: vi.fn(),
  getCitationMap: vi.fn(),
  getCourtLevel: vi.fn(),
  getFilingCitations: vi.fn(),
  getMdlLane: vi.fn(),
  getMdlLanes: vi.fn(),
  getProductSignals: vi.fn(),
}));

import { parseFilingCitations, type Authority } from "@/lib/litviz/citations";
import type { SeriesRow } from "@/lib/litviz/model";
import type { ProductSignals } from "@/lib/litviz/signals";
import { authorityLine, CitationMap, FilingCitationContext, shortAuthority } from "./CitationMap";
import { hrefProps } from "./CourtHierarchy";
import { ProductSignalTimeline, signalTracks } from "./ProductSignalTimeline";
import { mdlMarkers, pendingLine, seriesBins } from "./tracks";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const row = (
  series: string,
  month: string,
  value: number | null,
  basis = "",
  extra: Partial<SeriesRow> = {},
) =>
  ({
    series,
    month,
    value,
    unit: "reports",
    source_dataset: "x",
    source_url: null,
    basis,
    ...extra,
  }) as SeriesRow;
const auth = (over: Partial<Authority>): Authority => ({
  key: "record|caselaw/1",
  toType: "record",
  toId: "caselaw/1",
  kind: "case",
  class: "scotus",
  label: "Daubert v. Merrell Dow Pharmaceuticals, Inc.",
  cite: "509 U.S. 579",
  heading: null,
  courtLabel: "Supreme Court",
  year: 1993,
  href: null,
  ...over,
});

beforeEach(() => state.byKey.clear());

describe("authority labels", () => {
  it("shortens long case names to their parties and keeps provisions whole", () => {
    expect(
      shortAuthority({ kind: "case", label: "Lawrence R. Sperberg v. Goodyear Tire & Rubber Co." }),
    ).toBe("Sperberg v. Goodyear");
    expect(shortAuthority({ kind: "case", label: "United States v. Freeman, Jr." })).toBe(
      "U.S. v. Freeman",
    );
    expect(
      shortAuthority({ kind: "case", label: "Berry v. City of Detroit, Michigan, et al." }),
    ).toBe("Berry v. Detroit");
    expect(shortAuthority({ kind: "case", label: "Luce v. United States" })).toBe(
      "Luce v. United States",
    );
    expect(shortAuthority({ kind: "usc", label: "28 U.S.C. § 1407" })).toBe("28 U.S.C. § 1407");
  });

  it("does not repeat the Supreme Court after its class label", () => {
    expect(authorityLine(auth({}))).toBe("509 U.S. 579 · 1993");
    expect(
      authorityLine(
        auth({ class: "federal_appellate", courtLabel: "Sixth Circuit", cite: "519 F.2d 708" }),
      ),
    ).toBe("519 F.2d 708 · Sixth Circuit · 1993");
  });

  it("splits an in-app href with a query into router props", () => {
    expect(hrefProps("/courts?system=Territory&state=PR")).toEqual({
      to: "/courts",
      search: { system: "Territory", state: "PR" },
    });
    expect(hrefProps("/courts/ohsd")).toEqual({ to: "/courts/ohsd" });
  });
});

describe("tracks", () => {
  it("leaves unverified fiscal-year lines and null values out and flags partial periods", () => {
    const bins = seriesBins([
      row("jpml_fy_closed", "2023-09", 10),
      row("jpml_fy_closed", "2024-09", 99, "jpml:fy:attribution_unverified"),
      row("jpml_fy_closed", "2025-09", null),
      row("docket_entries", "2026-10", 3, "sw:partial_month"),
    ]);
    expect(bins.map((b) => [b.v, b.partial])).toEqual([
      [10, false],
      [3, true],
    ]);
  });

  it("joins monthly pending points, keeps fiscal-year ends apart from the reports, and marks events", () => {
    const pts = pendingLine([
      row("jpml_pending", "2024-10", 100),
      row("jpml_pending", "2024-11", 110),
      row("jpml_pending", "2025-02", 120),
    ]);
    expect(pts.map((p) => [p.v, p.link])).toEqual([
      [100, false],
      [110, true],
      [120, false],
    ]);
    const m = mdlMarkers({
      dates: {
        motionFiled: null,
        centralized: "2018-08-02",
        closed: null,
        closedYear: 2024,
        closedSourceUrl: null,
      },
    });
    expect(m.map((x) => x.label)).toEqual(["Centralized", "Terminated in 2024"]);
  });
});

const signals = (rows: SeriesRow[], over: Partial<ProductSignals> = {}): ProductSignals => ({
  mdl: "2846",
  title: "Hernia mesh",
  centralized: "2018-08-02",
  today: "2026-10-23",
  agencySource: rows.length ? "fda_product_series" : null,
  products: [
    {
      dataset: "fda_device_event_series",
      id: "p",
      product: "Mesh",
      sourceUrl: null,
      dataThrough: null,
    },
  ],
  rows,
  notices: [],
  ...over,
});

describe("product signal tracks", () => {
  it("draws only series held for the MDL and says Not recorded for recalls and enforcement", () => {
    const t = signalTracks(
      signals([
        row("maude_reports", "2019-01", 12, "calendar_year", {
          source_dataset: "fda_device_event_series",
        }),
        row("docket_entries", "2019-03", 4),
      ]),
    );
    expect(t.map((x) => [x.id, x.kind])).toEqual([
      ["maude_reports", "bins"],
      ["enforcement", "note"],
      ["recalls", "note"],
      ["docket_entries", "bins"],
    ]);
    expect(t[0]!.label).toContain("Mesh");
  });

  it("uses SAFETY's recall and enforcement series in place of the notes when they are held", () => {
    const t = signalTracks(
      signals(
        [
          row("fda_recalls", "2019-01", 2, "month"),
          row("fda_enforcement_reports", "2019-02", 1, "month"),
        ],
        { agencySource: "product_signals_v1" },
      ),
    );
    expect(t.map((x) => x.id)).toEqual(["fda_recalls", "fda_enforcement_reports"]);
  });

  it("with nothing held, every agency band says Not recorded", () => {
    const t = signalTracks(signals([]));
    expect(t.every((x) => x.kind === "note")).toBe(true);
    expect(t.map((x) => x.id)).toEqual(["agency", "enforcement", "recalls"]);
  });
});

describe("view states", () => {
  it("product signals: loading, error and empty", () => {
    const html = () =>
      text(renderToStaticMarkup(createElement(ProductSignalTimeline, { mdl: "2846" })));
    expect(html()).toMatch(/Product signals and litigation activity/);
    state.byKey.set("signals", { isError: true });
    expect(html()).toContain("could not be read just now");
    state.byKey.set("signals", { data: signals([]) });
    expect(html()).toContain("No product series, docket entry or filing of MDL No. 2846 is held.");
  });

  it("citation map: not published yet, then no resolvable citation", () => {
    const html = () => text(renderToStaticMarkup(createElement(CitationMap, { mdl: "2846" })));
    state.byKey.set("grid", { data: { available: false, reason: "x" } });
    state.byKey.set("citations", {
      data: { available: false, reason: "The citation map is not published yet." },
    });
    expect(html()).toContain("not published yet");
    state.byKey.set("citations", {
      data: {
        available: true,
        data: { mdl: "2846", refreshed: null, meta: null, distinct: 0, authorities: [], edges: [] },
      },
    });
    expect(html()).toContain(
      "No filing of MDL No. 2846 cites an authority that could be resolved exactly.",
    );
  });

  it("filing citation context: shares of the MDL's citing filings, and Not recorded when unknown", () => {
    const f = parseFilingCitations({
      document: "d_142fe029bdcc9b326f741e12",
      mdl: "2846",
      text_status: "text_layer",
      mdl_citing: 324,
      authorities: [
        {
          key: "record|caselaw/769404",
          to_type: "record",
          to_id: "caselaw/769404",
          kind: "case",
          class: "federal_appellate",
          label: "Pride v. BIC Corp.",
          mentions: 2,
          first_page: 5,
          mdl_filings: 54,
          all_filings: 57,
        },
        {
          key: "record|caselaw/9",
          to_type: "record",
          to_id: "caselaw/9",
          kind: "case",
          class: "other_court",
          label: "Doe v. Roe",
          mentions: 1,
        },
      ],
    });
    state.byKey.set("filing", { data: { available: true, data: f } });
    const out = text(
      renderToStaticMarkup(
        createElement(FilingCitationContext, { document: "d_142fe029bdcc9b326f741e12" }),
      ),
    );
    expect(out).toContain("2 mentions, first on p. 5");
    expect(out).toContain("54 of the MDL&#x27;s 324 citing filings");
    expect(out).toContain("Not recorded");
    state.byKey.set("filing", { data: { available: false, reason: "x" } });
    expect(
      text(
        renderToStaticMarkup(
          createElement(FilingCitationContext, { document: "d_142fe029bdcc9b326f741e12" }),
        ),
      ),
    ).toContain("not published yet");
  });

  it("filing citation context for a filing with no MDL linked: its authorities with corpus counts", () => {
    const f = parseFilingCitations({
      document: "d_242fe029bdcc9b326f741e12",
      mdl: null,
      text_status: "text_layer",
      mdl_citing: null,
      authorities: [
        {
          key: "record|caselaw/769404",
          to_type: "record",
          to_id: "caselaw/769404",
          kind: "case",
          class: "federal_appellate",
          label: "Pride v. BIC Corp.",
          mentions: 3,
          first_page: 2,
          mdl_filings: null,
          all_filings: 57,
        },
      ],
    });
    expect(f).not.toBeNull();
    expect(f?.mdl).toBeNull();
    state.byKey.set("filing", { data: { available: true, data: f } });
    const out = text(
      renderToStaticMarkup(
        createElement(FilingCitationContext, { document: "d_242fe029bdcc9b326f741e12" }),
      ),
    );
    expect(out).toContain("3 mentions, first on p. 2");
    expect(out).toContain("cited in 57 MDL filings");
    expect(out).not.toContain("not published yet");
    expect(parseFilingCitations({ document: "d_242fe029bdcc9b326f741e12", mdl: 7, authorities: [] })).toBeNull();
  });
});

describe("network labels", () => {
  it("keeps every node label inside the plot, also for nodes laid out at the edge", async () => {
    const { Network } = await import("@/components/charts/Network");
    const { metricFormatter } = await import("@/components/charts/format");
    const label = "Lawrence R. Sperberg v. Goodyear Tire"; // truncated to 28 characters
    const nodes = ["a", "b", "c", "d"].map((id, i) => ({
      id,
      label: `${label} ${id}`,
      weight: 10 - i,
    }));
    const out = renderToStaticMarkup(
      createElement(Network, {
        nodes,
        edges: [
          { a: "a", b: "b", weight: 3 },
          { a: "c", b: "d", weight: 2 },
        ],
        formatter: metricFormatter("count"),
        edgeUnit: "filings citing both",
        nodeUnit: "filings citing",
        ariaLabel: "Network",
        width: 360,
      }),
    );
    const half = (28 * 5.6) / 2;
    const xs = [...out.matchAll(/<text x="([\d.]+)"[^>]*text-anchor="middle"/g)].map((m) =>
      Number(m[1]),
    );
    expect(xs.length).toBeGreaterThan(0);
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(half + 2 - 1e-9);
      expect(x).toBeLessThanOrEqual(360 - half - 2 + 1e-9);
    }
  });
});

describe("SAFETY's series on the timeline", () => {
  it("draws the main agency series, lists breakdowns and JPML action changes in the table, and states the link", async () => {
    const { signalFootnotes } = await import("./ProductSignalTimeline");
    const p = signals(
      [
        row("device_reports", "2019-01", 12, "title_names_product — JPML title names hernia mesh"),
        row(
          "device_reports_death",
          "2019-01",
          1,
          "title_names_product — JPML title names hernia mesh",
        ),
        row("recalls", "2019-02", 1, "title_names_product — JPML title names hernia mesh"),
        row("jpml_actions_added", "2025-02", -3),
        row("docket_entries", "2019-03", 4),
      ],
      { agencySource: "product_signals_v1" },
    );
    const t = signalTracks(p);
    expect(t.map((x) => [x.id, x.kind])).toEqual([
      ["device_reports", "bins"],
      ["recalls", "bins"],
      ["enforcement", "note"],
      ["docket_entries", "bins"],
    ]);
    const notes = signalFootnotes(p).join(" ");
    expect(notes).toContain("JPML title names hernia mesh");
    expect(notes).toContain("device reports of a death");
    expect(notes).toContain("can be negative");
  });
});
