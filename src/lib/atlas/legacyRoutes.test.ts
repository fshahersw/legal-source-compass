import { describe, expect, it } from "vitest";
import {
  ENFORCEMENT_AGENCIES,
  ENFORCEMENT_TABS,
  MDLS_REDIRECT_SEARCH,
  isCanonicalEnforcementQuery,
  lawsRedirectSearch,
  normalizeSettlementsSearch,
  resolveEnforcementLocation,
} from "./legacyRoutes";

describe("former /law/enforcement queries", () => {
  it.each([
    [{}, "/enforcement", {}],
    [{ state: "CA" }, "/enforcement", { tab: "actions", agency: "epa", state: "CA" }],
    [{ state: "ca" }, "/enforcement", {}],
    [{ tab: "rulemaking" }, "/law/rulemaking", {}],
    [{ tab: "cpsc" }, "/enforcement", { tab: "actions", agency: "cpsc" }],
    [{ tab: "cfpb" }, "/enforcement", { tab: "actions", agency: "cfpb" }],
    [{ tab: "osha" }, "/enforcement", { tab: "actions", agency: "osha" }],
    [{ tab: "osha", state: "CA" }, "/enforcement", { tab: "actions", agency: "osha" }],
    [{ tab: "settlements" }, "/litigation/settlements", { view: "notices" }],
    [{ tab: "exclusions" }, "/enforcement", { tab: "exclusions" }],
    [{ tab: "oversight" }, "/enforcement", { tab: "oversight" }],
    [{ tab: "merger" }, "/enforcement", { tab: "merger" }],
    [{ tab: "sources" }, "/enforcement", { tab: "sources" }],
    [{ tab: "nonsense" }, "/enforcement", {}],
    [{ actions: "doj" }, "/enforcement", { tab: "actions", agency: "doj" }],
    [{ actions: "ftc" }, "/enforcement", { tab: "actions", agency: "ftc" }],
    [{ actions: "sec" }, "/enforcement", { tab: "actions", agency: "sec" }],
    [{ actions: "frb" }, "/enforcement", { tab: "actions", agency: "frb" }],
    [{ actions: "settlements" }, "/litigation/settlements", {}],
    // The former page let `actions` win over `tab`.
    [{ actions: "sec", tab: "cpsc" }, "/enforcement", { tab: "actions", agency: "sec" }],
  ])("%j → %s %j", (raw, to, search) => {
    expect(resolveEnforcementLocation(raw)).toEqual({ to, search });
  });
});

describe("/enforcement queries", () => {
  it("keeps the new layout as it is", () => {
    for (const tab of ENFORCEMENT_TABS) {
      expect(isCanonicalEnforcementQuery({ tab })).toBe(true);
      expect(resolveEnforcementLocation({ tab })).toEqual({ to: "/enforcement", search: { tab } });
    }
    for (const { id } of ENFORCEMENT_AGENCIES)
      expect(isCanonicalEnforcementQuery({ tab: "actions", agency: id })).toBe(true);
    expect(isCanonicalEnforcementQuery({})).toBe(true);
    expect(isCanonicalEnforcementQuery({ tab: "actions", agency: "epa", state: "NY" })).toBe(true);
    // Unknown keys are ignored rather than redirected.
    expect(isCanonicalEnforcementQuery({ foo: "1" })).toBe(true);
  });
  it("rewrites former values used on the new address", () => {
    expect(isCanonicalEnforcementQuery({ tab: "cpsc" })).toBe(false);
    expect(isCanonicalEnforcementQuery({ actions: "doj" })).toBe(false);
    expect(isCanonicalEnforcementQuery({ state: "CA" })).toBe(false);
    expect(isCanonicalEnforcementQuery({ tab: "actions", agency: "doj", state: "CA" })).toBe(false);
    expect(isCanonicalEnforcementQuery({ agency: "sec" })).toBe(false);
    expect(isCanonicalEnforcementQuery({ tab: "rulemaking" })).toBe(false);
  });
  it("never redirects in a loop: every target is canonical", () => {
    const inputs = [
      {},
      { state: "CA" },
      { tab: "cpsc" },
      { tab: "osha", state: "TX" },
      { actions: "frb" },
      { agency: "epa", state: "NY" },
      { tab: "actions", agency: "nope" },
      ...ENFORCEMENT_TABS.map((tab) => ({ tab })),
    ];
    for (const raw of inputs) {
      const target = resolveEnforcementLocation(raw);
      if (target.to === "/enforcement") {
        expect(isCanonicalEnforcementQuery(target.search), JSON.stringify(raw)).toBe(true);
        expect(resolveEnforcementLocation(target.search)).toEqual(target);
      }
    }
  });
});

describe("other former addresses", () => {
  it("/laws opens Federal law and keeps a recognised /law query", () => {
    expect(lawsRedirectSearch({})).toEqual({ scope: "federal" });
    expect(lawsRedirectSearch({ ds: "public_laws", junk: "<x>" })).toEqual({
      scope: "federal",
      ds: "public_laws",
    });
    expect(lawsRedirectSearch({ scope: "states", state: "NY" })).toEqual({
      scope: "states",
      state: "NY",
    });
  });
  it("/mdls opens the JPML MDL collection", () => {
    expect(MDLS_REDIRECT_SEARCH).toEqual({ ds: "mdls" });
  });
  it("settlement views", () => {
    expect(normalizeSettlementsSearch({ view: "notices" })).toEqual({ view: "notices" });
    expect(normalizeSettlementsSearch({ view: "x" })).toEqual({});
    expect(normalizeSettlementsSearch({})).toEqual({});
  });
});
