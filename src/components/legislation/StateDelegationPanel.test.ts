import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
    search,
    ...rest
  }: {
    children: ReactNode;
    to: string;
    params?: Record<string, string>;
    search?: Record<string, string>;
  }) =>
    createElement(
      "a",
      {
        href:
          to.replace(/\$(\w+)/g, (_m, k: string) => params?.[k] ?? "") +
          (search ? `?${new URLSearchParams(search)}` : ""),
        ...rest,
      },
      children,
    ),
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (f: unknown) => f }));
vi.mock("@/lib/external/congressMembers.functions", () => ({ getStateDelegation: vi.fn() }));

import { useQuery } from "@tanstack/react-query";
import { StateDelegationPanel } from "./StateDelegationPanel";

const html = (node: ReactNode) => renderToStaticMarkup(node as never);
const row = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id,
  name,
  displayName: null,
  party: "Democratic",
  partyAbbreviation: "D",
  state: "California",
  stateCode: "CA",
  district: null,
  chamber: "Senate",
  memberType: "Senator",
  years: null,
  current: true,
  congresses: null,
  sponsoredReported: null,
  cosponsoredReported: null,
  ...over,
});

beforeEach(() => vi.mocked(useQuery).mockReset());

describe("StateDelegationPanel", () => {
  it("lists senators and representatives with district, party and member links", () => {
    vi.mocked(useQuery).mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        state: "CA",
        total: 3,
        senators: [row("P000145", "Padilla, Alex")],
        representatives: [
          row("P000197", "Pelosi, Nancy", {
            chamber: "House of Representatives",
            memberType: "Representative",
            district: "11",
          }),
          row("D000000", "At, Large", {
            chamber: "House of Representatives",
            memberType: "Representative",
            district: "At large",
          }),
          row("N000001", "No, District", {
            chamber: "House of Representatives",
            memberType: "Representative",
            district: null,
          }),
        ],
        delegates: [],
      },
    } as never);
    const out = html(createElement(StateDelegationPanel, { usps: "CA" }));
    expect(out).toContain("Senators");
    expect(out).toContain("Representatives");
    expect(out).not.toContain("Delegates and resident commissioners");
    expect(out).toContain('href="/law/legislation/members/P000145"');
    expect(out).toContain("Pelosi, Nancy");
    expect(out).toContain("District 11");
    expect(out).toContain("At large");
    expect(out).toContain("District not recorded"); // the API gave no district: nothing is guessed
    expect(out).toContain('title="Democratic"');
    expect(out).toContain('href="/law/legislation/members?state=CA"');
  });

  it("shows loading, error and empty states", () => {
    vi.mocked(useQuery).mockReturnValue({ isPending: true } as never);
    expect(html(createElement(StateDelegationPanel, { usps: "CA" }))).toContain("Loading");
    vi.mocked(useQuery).mockReturnValue({
      isPending: false,
      isError: true,
      refetch: vi.fn(),
    } as never);
    const err = html(createElement(StateDelegationPanel, { usps: "CA" }));
    expect(err).toContain("could not load");
    expect(err).toContain("Retry");
    vi.mocked(useQuery).mockReturnValue({
      isPending: false,
      isError: false,
      data: { state: "ZZ", total: 0, senators: [], representatives: [], delegates: [] },
    } as never);
    expect(html(createElement(StateDelegationPanel, { usps: "ZZ" }))).toContain(
      "No current member is recorded",
    );
  });
});
