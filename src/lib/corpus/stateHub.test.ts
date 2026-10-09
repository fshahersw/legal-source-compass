import { describe, expect, it } from "vitest";
import { STATES } from "./geo";
import {
  canonicalState,
  countyInState,
  filterStateCourts,
  filterStateJudges,
  parseStateHubSearch,
  stateFromGeometry,
} from "./stateHub";
import type { CourtRow, JudgeRow } from "@/lib/external/directoryTree";
const courts: CourtRow[] = [
  {
    id: "ned",
    title: "District of Nebraska",
    state: "NE",
    system: "Federal",
    type: "Federal district",
  },
  {
    id: "neb",
    title: "Nebraska Supreme Court",
    state: "Nebraska",
    system: "State",
    type: "State supreme",
  },
  {
    id: "nvd",
    title: "District of Nevada",
    state: "NV",
    system: "Federal",
    type: "Federal district",
  },
  {
    id: "unknown",
    title: "Nebraska Court (unlocated source)",
    state: "",
    system: "State",
    type: "Unknown",
  },
];
const judge = (id: string, states: string[], courtNames: string[]): JudgeRow => ({
  id,
  name: id,
  states,
  state: states[0] ?? "",
  courts: courtNames,
  systems: ["Federal"],
  system: "Federal",
  profileLayer: "official_source",
  photo: null,
});
const judges = [
  judge("NE profile", ["Nebraska"], ["District of Nebraska"]),
  judge("NV profile", ["NV"], ["District of Nevada"]),
  judge("Unlocated Nebraska name", [], []),
  judge(
    "Historical two-state profile",
    ["NE", "NV"],
    ["District of Nebraska", "District of Nevada"],
  ),
];
describe("state-first identity and directory boundaries", () => {
  it.each(STATES)("round-trips $name through USPS, FIPS and exact name", (state) => {
    for (const input of [
      state.usps,
      state.usps.toLowerCase(),
      state.fips,
      state.name,
      state.name.toUpperCase(),
      ` ${state.name} `,
    ])
      expect(canonicalState(input)?.usps).toBe(state.usps);
    expect(canonicalState(Number(state.fips))?.usps).toBe(state.usps);
  });
  it("never guesses a state from a partial or descriptive string", () => {
    for (const s of [
      "Nebr",
      "N",
      "New",
      "NE District",
      "United States",
      "US",
      "99",
      "3.1",
      null,
      {},
      "",
    ])
      expect(canonicalState(s)).toBeNull();
  });
  it("uses canonical FIPS, not a mislabeled geometry name", () => {
    expect(stateFromGeometry({ id: "31", name: "Nevada" })?.name).toBe("Nebraska");
    expect(stateFromGeometry({ id: 32, name: "Nebraska" })?.usps).toBe("NV");
    expect(stateFromGeometry({ id: "99", name: "Nebraska" })).toBeNull();
  });
  it("does not let a county URL masquerade as a county in another state", () => {
    expect(countyInState("31055", "NE")).toBe(true);
    expect(countyInState("32003", "NE")).toBe(false);
    expect(countyInState("31055", "NV")).toBe(false);
    expect(countyInState("31", "NE")).toBe(false);
  });
  it("filters courts using recorded geography rather than court title", () => {
    expect(filterStateCourts(courts, "NE").map((c) => c.id)).toEqual(["ned", "neb"]);
    expect(filterStateCourts(courts, "Nebraska", { system: "Federal" }).map((c) => c.id)).toEqual([
      "ned",
    ]);
    expect(filterStateCourts(courts, "NE", { q: "Nevada" })).toEqual([]);
    expect(filterStateCourts(courts, "missing")).toEqual([]);
  });
  it("uses explicit judge state associations and does not infer them from names", () => {
    expect(filterStateJudges(judges, "NE").map((j) => j.id)).toEqual([
      "NE profile",
      "Historical two-state profile",
    ]);
    expect(
      filterStateJudges(judges, "NE", { court: "District of Nevada" }).map((j) => j.id),
    ).toEqual(["Historical two-state profile"]);
    expect(filterStateJudges(judges, "unknown")).toEqual([]);
  });
  it("bounds and normalizes URL-backed filters without inventing a selection", () => {
    expect(parseStateHubSearch({ tab: "judges", q: "  Alex  ", system: "Federal" })).toEqual({
      tab: "judges",
      q: "Alex",
      system: "Federal",
    });
    expect(
      parseStateHubSearch({ tab: "not-real", q: [], system: "unspecified", court: 42 }),
    ).toEqual({ tab: "overview" });
    expect(parseStateHubSearch({ q: "a".repeat(300) }).q?.length).toBe(160);
  });
});
