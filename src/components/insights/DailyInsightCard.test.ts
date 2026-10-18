import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Insight, SectionInsight } from "@/lib/insights/types";

const mocks = vi.hoisted(() => ({
  query: {} as { isLoading?: boolean; isError?: boolean; data?: unknown; refetch?: () => void },
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    ...rest
  }: { children: ReactNode; to: string } & Record<string, unknown>) =>
    createElement("a", { href: to, ...rest }, children),
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => mocks.query }));
vi.mock("@/lib/insights/insights.functions", () => ({ getDailyInsights: vi.fn() }));

import { DailyInsightCard, InsightPanel } from "./DailyInsightCard";
import { formatDayKey } from "./insightQueries";
import { InsightsHub } from "./InsightsHub";

const insight: Insight = {
  id: "court.pl-filings-national",
  section: "court",
  kind: "trend",
  headline: "Product liability filings were 45,713 in FY2025, down 18.2% from FY2024",
  summary: ["Courts recorded 45,713 filings in FY2025.", "That compares with 55,883 in FY2024."],
  points: [
    { label: "Filings, FY2025", value: "45,713", note: "-18.2%" },
    { label: "Filings, FY2024", value: "55,883" },
    { label: "Largest: D.S.C.", value: "7,010", href: "/courts/scd" },
  ],
  caveat: "Filings include cases transferred to MDL districts.",
  sources: [
    { label: "U.S. Courts statistics", href: "https://www.uscourts.gov/data" },
    { label: "Court analytics", href: "/courts/analytics" },
  ],
  dataThrough: "FY2025",
  score: 80,
};

const section = (over: Partial<SectionInsight> = {}): SectionInsight => ({
  section: "court",
  title: "Court analytics",
  href: "/courts/analytics",
  chartsLabel: "Open court charts",
  pick: insight,
  position: 3,
  poolSize: 8,
  headlines: ["Other headline one", "Other headline two"],
  partial: false,
  failed: false,
  ...over,
});

beforeEach(() => {
  mocks.query = {};
});

describe("formatDayKey", () => {
  it("renders a UTC day key in a fixed locale", () => {
    expect(formatDayKey("2026-10-18")).toBe("October 18, 2026");
    expect(formatDayKey("2027-01-01")).toBe("January 1, 2027");
    expect(formatDayKey("not a date")).toBe("not a date");
  });
});

describe("InsightPanel", () => {
  const html = (data: SectionInsight, variant: "section" | "compact" = "section") =>
    renderToStaticMarkup(
      createElement(InsightPanel, { data, dayKey: "2026-10-18", variant, onRetry: () => {} }),
    );

  it("shows the headline, summary, points, caveat, sources, date and place in the rotation", () => {
    const out = html(section());
    expect(out).toContain("Insight of the day");
    expect(out).toContain('<time dateTime="2026-10-18">October 18, 2026 (UTC)</time>');
    expect(out).toContain("Product liability filings were 45,713 in FY2025");
    expect(out).toContain(
      "Courts recorded 45,713 filings in FY2025. That compares with 55,883 in FY2024.",
    );
    expect(out).toContain("45,713");
    expect(out).toContain("-18.2%");
    expect(out).toContain("Note: Filings include cases transferred to MDL districts.");
    expect(out).toContain("Data through FY2025");
    expect(out).toContain("Insight 3 of 8 for Court analytics");
    expect(out).toContain("changes daily (UTC)");
  });

  it("links site routes in the app and outside sources in a new tab", () => {
    const out = html(section());
    expect(out).toContain('href="/courts/scd"');
    expect(out).toContain('href="/courts/analytics"');
    expect(out).toMatch(
      /<a href="https:\/\/www\.uscourts\.gov\/data" target="_blank" rel="noreferrer"/,
    );
  });

  it("keeps the other headlines in the page but hidden until the toggle is opened", () => {
    const out = html(section());
    expect(out).toContain("Other insights in this section (2)");
    expect(out).toContain('aria-expanded="false"');
    expect(out).toMatch(/<ul id="[^"]+" hidden=""/);
    expect(out).toContain("Other headline one");
  });

  it("uses the section title and a link to the charts in the compact (hub) variant", () => {
    const out = html(section(), "compact");
    expect(out).toContain("Court analytics");
    expect(out).toContain("Open court charts");
    expect(out).toContain('href="/courts/analytics"');
    expect(out).toContain("<h3");
    expect(html(section(), "section")).toContain("<h2");
  });

  it("says plainly when a section has no insight yet", () => {
    const out = html(section({ pick: null, position: 0, poolSize: 0, headlines: [] }));
    expect(out).toContain("No insight available for this section yet");
    expect(out).not.toContain("Other insights");
  });

  it("notes when some sources could not be read", () => {
    expect(html(section({ partial: true }))).toContain(
      "Some data sources for this section could not be read just now",
    );
    expect(html(section())).not.toContain("could not be read just now");
  });

  it("shows an error with a Retry button for a section whose whole read failed", () => {
    const out = html(section({ failed: true, pick: null }));
    expect(out).toContain('role="alert"');
    expect(out).toContain("Court analytics: the insight of the day could not be loaded.");
    expect(out).toContain("Retry");
  });

  it("omits the caveat and the single-insight toggle when there are none", () => {
    const { caveat: _caveat, ...noCaveat } = insight;
    const out = html(section({ pick: noCaveat, headlines: [] }));
    expect(out).not.toContain("Note:");
    expect(out).not.toContain("Other insights");
  });
});

describe("DailyInsightCard", () => {
  const render = (props: { section: string; variant?: "section" | "compact" }) =>
    renderToStaticMarkup(createElement(DailyInsightCard, props));

  it("shows a skeleton while loading", () => {
    mocks.query = { isLoading: true };
    const out = render({ section: "court" });
    expect(out).toContain('aria-busy="true"');
    expect(out).toContain("Loading the insight of the day");
  });

  it("shows the section the server returned for this page", () => {
    mocks.query = {
      data: {
        dayKey: "2026-10-18",
        sections: [section(), section({ section: "judge", title: "Judge analytics" })],
      },
    };
    const out = render({ section: "court" });
    expect(out).toContain("Product liability filings were 45,713");
    expect(out).not.toContain("Judge analytics");
  });

  it("shows an error with Retry when the request failed or the section is missing from the result", () => {
    mocks.query = { isError: true };
    expect(render({ section: "court" })).toContain("could not be loaded");
    mocks.query = { data: { dayKey: "2026-10-18", sections: [] } };
    const out = render({ section: "court" });
    expect(out).toContain('role="alert"');
    expect(out).toContain("Retry");
  });
});

describe("InsightsHub", () => {
  const hub = () => renderToStaticMarkup(createElement(InsightsHub));

  it("shows one card per section the server returns, with anchor links and the rotation explanation", () => {
    mocks.query = {
      data: {
        dayKey: "2026-10-18",
        sections: [
          section(),
          section({
            section: "judge",
            title: "Judge analytics",
            href: "/judges/analytics",
            chartsLabel: "Open judge charts",
          }),
        ],
      },
    };
    const out = hub();
    expect(out).toContain("October 18, 2026 (UTC)");
    expect(out).toContain("rotates once a day at 00:00 UTC");
    expect(out).toContain('href="#insight-court"');
    expect(out).toContain('id="insight-judge"');
    expect(out).toContain("Open judge charts");
    expect(out.match(/Insight of the day: /g)).toHaveLength(2);
  });

  it("keeps working when one section failed: that card errors, the others still render", () => {
    mocks.query = {
      data: {
        dayKey: "2026-10-18",
        sections: [
          section(),
          section({ section: "judge", title: "Judge analytics", pick: null, failed: true }),
        ],
      },
    };
    const out = hub();
    expect(out).toContain("Product liability filings were 45,713");
    expect(out).toContain("Judge analytics: the insight of the day could not be loaded.");
  });

  it("shows skeletons while loading and an error with Retry when the request fails", () => {
    mocks.query = { isLoading: true };
    expect(hub()).toContain("Loading the insights of the day");
    mocks.query = { isError: true };
    expect(hub()).toContain("Retry");
  });

  it("says so when no sections are registered", () => {
    mocks.query = { data: { dayKey: "2026-10-18", sections: [] } };
    expect(hub()).toContain("No analytics sections are registered yet.");
  });
});
