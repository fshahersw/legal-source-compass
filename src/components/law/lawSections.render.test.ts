import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (h: unknown) => h,
    inputValidator: () => ({ handler: (h: unknown) => h }),
  }),
  useServerFn: (f: unknown) => f,
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: ReactNode }) => createElement("a", null, children),
  useRouterState: () => ({ location: { pathname: "/law" } }),
  useNavigate: () => () => undefined,
}));

import { MassTortRulemaking } from "@/components/rulemaking/MassTortRulemaking";
import { rulemakingTrackerQuery } from "@/components/rulemaking/rulemakingQueries";
import { CfrChangeRadar, cfrRadarQuery } from "./CfrChangeRadar";
import { CivilJusticeWatch } from "@/components/legislation/CivilJusticeWatch";
import { CongressAttention } from "@/components/legislation/CongressAttention";
import { legislationWatchQuery } from "@/components/legislation/legislationWatchQuery";
import { buildRadar } from "@/lib/law/cfrRadar";
import { TRACKED_AGENCIES, frAgencyYears, toAgendaItem, toDeadline } from "@/lib/law/rulemakingTracker";
import { attentionMatrix, mergeBills, toFederalBill, toWatchBill } from "@/lib/law/legislationWatch";

const TODAY = "2026-10-27";

function render(node: ReactNode, seed: (qc: QueryClient) => void) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  seed(qc);
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, node));
}

const tracker = {
  today: TODAY,
  agencies: TRACKED_AGENCIES,
  deadlines: [
    toDeadline(
      {
        id: "FDA-2026-N-1-0001",
        title: "Placeholder",
        source_url: null,
        filters: { agency: ["FDA"], type: ["notice"], docket: ["FDA-2026-N-1"] },
        item: { dates_et: { comment_end: "2026-11-10" } },
      },
      TODAY,
    )!,
    toDeadline(
      {
        id: "FDA-2015-N-3534-0001",
        title: "Open-ended",
        source_url: null,
        filters: { agency: ["FDA"], type: ["notice"] },
        item: { dates_et: { comment_end: "2050-02-21" } },
      },
      TODAY,
    )!,
  ],
  fr: TRACKED_AGENCIES.map((a) =>
    frAgencyYears(
      a.code,
      { item: { trends: { asOf: "2026-10-19", partialYear: "2026", yearly: { RULE: { "2025": 5, "2026": 4 }, PRORULE: { "2025": 3 } } } } },
      2025,
    ),
  ),
  agenda: [toAgendaItem("NHTSA", { id: "2127-AK17", title: "FMVSS", source_url: "https://www.reginfo.gov/public/do/eAgendaViewRule?pubId=202510&RIN=2127-AK17", item: { cells: { stage: "Final Rule Stage", next_action: "Final Rule · 07/00/2026" } } })!],
  agendaEdition: "202510",
  readAt: "2026-10-27T12:00:00Z",
};

describe("law lead sections render", () => {
  it("rulemaking tracker: counts, open-ended placeholder kept out of the window, edition label", () => {
    const html = render(createElement(MassTortRulemaking), (qc) =>
      qc.setQueryData(rulemakingTrackerQuery.queryKey, tracker),
    );
    expect(html).toContain("Mass-tort agency rulemaking");
    expect(html).toContain("1 of 1 open comment periods close within 30 days");
    expect(html).toContain("no fixed close date");
    expect(html).toContain("October 2025");
    expect(html).not.toContain("2050-02-21 days");
  });

  it("CFR radar: heatmap card and KPIs", () => {
    const radar = buildRadar(
      new Map([
        [
          "49:571",
          [{ id: "cfr:49:571.208", title: "x", versions: [{ date: "2016-12-27", substantive: true }, { date: "2026-10-09", substantive: true }] }],
        ],
      ]),
      TODAY,
    );
    const html = render(createElement(CfrChangeRadar), (qc) => qc.setQueryData(cfrRadarQuery.queryKey, radar));
    expect(html).toContain("Changes to mass-tort regulations since 2017");
    expect(html).toContain("1 sections of these parts changed in the last 12 months");
  });

  it("legislation watch and congressional attention", () => {
    const bill = toWatchBill(
      {
        id: "ut-2026-hb280",
        title: "HB 280",
        source_url: null,
        filters: { state: ["UT"], session_role: ["current"], outcome: ["enacted"] },
        cells: { identifier: "HB 280", title: "Third Party Litigation Funding Amendments", latest_action_date: "2026-03-20", first_action_date: "2026-01-20" },
      },
      "funding",
      TODAY,
    )!;
    const watch = {
      today: TODAY,
      congress: 119,
      stateBills: mergeBills([[bill]]),
      federal: [toFederalBill({ id: "119-hr-3512", filters: { sponsor: ["H001082"] }, cells: { citation: "H.R. 3512, 119th Congress", title: "Tackling Predatory Litigation Funding Act", sponsor: "Rep. Hern, Kevin [R-OK-1]", cosponsors: 39 } })!],
      attention: [
        attentionMatrix({ id: "pfas", label: "PFAS", query: "PFAS" }, [{ congress: 118, becameLaw: false }], [], 119),
      ],
      readAt: "2026-10-27T12:00:00Z",
    };
    const html = render(
      createElement("div", null, createElement(CivilJusticeWatch), createElement(CongressAttention)),
      (qc) => qc.setQueryData(legislationWatchQuery.queryKey, watch),
    );
    expect(html).toContain("1 bills mention litigation funding; 1 became law");
    expect(html).toContain("119th Congress");
    expect(html).toContain("Rep. Hern, Kevin [R-OK-1]");
    expect(html).toContain("Congressional attention to mass torts");
  });
});
