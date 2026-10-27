import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (h: unknown) => h,
    inputValidator: () => ({ handler: (h: unknown) => h }),
  }),
  useServerFn: (fn: unknown) => fn,
}));
vi.mock("@/lib/matters/source.server", () => ({}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Link: (p: { to: string; children?: ReactNode }) => createElement("a", { href: p.to }, p.children),
}));

import type { HubRow, MdlVelocityPayload } from "@/lib/matters/types";
import { PortfolioSection } from "./PortfolioSection";
import { VelocityLeaderboard } from "./VelocityLeaderboard";
import { buildVelocity, shiftMonth } from "./velocity";
import { matterHubPdfQuery, mdlVelocityQuery } from "./hubQueries";

const hub = (mdl: string, over: Partial<HubRow> = {}): HubRow => ({
  mdl,
  tier: 1,
  shortName: `Matter ${mdl}`,
  inCorpus: true,
  title: null,
  status: "pending",
  courtName: null,
  masterDocket: null,
  judgePrinted: null,
  judgeProfileId: null,
  totalActions: 6524,
  pendingActions: 6412,
  asOf: "2026-10-01",
  casesInSample: null,
  docketEntriesInSample: null,
  savedDocuments: null,
  swAppearances: null,
  registry: null,
  registryDockets: 35,
  metrics: null,
  ...over,
});

const pts = (totals: number[]) =>
  totals.map((total, i) => ({ date: `${shiftMonth("2025-10", i)}-01`, total, pending: total - 50 }));

const velocity: MdlVelocityPayload = {
  published: true,
  reportUrl: "https://www.jpml.uscourts.gov/sites/jpml/files/report.pdf",
  datasetUpdatedAt: "2026-10-18",
  registryRead: true,
  ...buildVelocity(
    [
      {
        mdl: "3140",
        title: "IN RE: Depo-Provera Products Liability Litigation",
        type: "Products Liability",
        points: pts(Array.from({ length: 13 }, (_, i) => 1000 + i * 400)),
      },
      {
        mdl: "3084",
        title: "IN RE: Uber Technologies, Inc., Passenger Sexual Assault Litigation",
        type: "Products Liability",
        points: pts(Array.from({ length: 13 }, (_, i) => 500 + i * 200)),
      },
    ],
    { portfolio: new Set(["3140"]), registry: new Set(["3140"]) },
  ),
};

function render(node: ReactNode, data: { pdf?: unknown; velocity?: unknown }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (data.velocity) client.setQueryData(mdlVelocityQuery.queryKey, data.velocity);
  if (data.pdf) client.setQueryData(matterHubPdfQuery.queryKey, data.pdf);
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client }, node) as never,
  );
}

describe("PortfolioSection", () => {
  it("opens with KPIs computed from the hub rows and the JPML series", () => {
    const html = render(createElement(PortfolioSection, { rows: [hub("3140")], rowsReady: true }), {
      velocity,
      pdf: { "3140": { open: 9542, held: 152, total: 9694 } },
    });
    expect(html).toContain("6,412"); // pending actions in hub matters
    expect(html).toContain("9,694"); // verified PDF records, the matter header's count
    expect(html).toContain("4,800"); // actions added in 12 months: 5,800 - 1,000
    expect(html).toContain("1 of 1"); // registry coverage under 10%
    expect(html).toContain("Hub matters held");
  });

  it("shows PDF records as loading, never as 0, while they are counted", () => {
    const html = render(createElement(PortfolioSection, { rows: [hub("3140")], rowsReady: true }), {
      velocity,
    });
    expect(html).toContain("Counting verified PDF records");
    expect(html).not.toMatch(/Verified PDF records[^<]*<[^>]*>[^<]*\b0\b/);
  });
});

describe("VelocityLeaderboard", () => {
  it("ranks MDLs by actions added and flags the one outside the registry", () => {
    const html = render(createElement(VelocityLeaderboard), { velocity });
    expect(html).toContain("Depo-Provera (MDL 3140) added 4,800 actions in the 12 months to Oct 2026");
    expect(html).toContain("not in registry");
    expect(html).toContain("1 of 2"); // top growers outside our registry
  });
});
