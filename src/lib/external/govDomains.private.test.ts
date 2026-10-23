/**
 * The built gov_domains rows against the TypeScript model (protected suite: reads private/build and fails when it is missing).
 * Every stored row must parse; every listed entry must look itself up; a subdomain finds its parent and nothing else does;
 * the county rule only ever returns rows of the area's own state whose organization or note equals the Census name.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildLookupResult,
  matchCountyRows,
  matchRegistry,
  parseCensusArea,
  parseGovFacts,
  parseGovRow,
  parseHostInput,
  type GovFacts,
  type GovRow,
} from "./govDomainsModel";

const BUILD = "private/build/gov_domains/gov_domains.json";
const COUNTIES = "private/build/gov_domains/lookups/census_counties.json";

type Stored = { id: string; item: { gov: unknown; row: unknown } };

describe("gov_domains build against the model", () => {
  const rows = (JSON.parse(readFileSync(BUILD, "utf8")) as { rows: Stored[] }).rows;
  const counties = JSON.parse(readFileSync(COUNTIES, "utf8")) as {
    id: string;
    name: string;
    usps: string;
  }[];
  const facts = rows.map((r) => parseGovFacts(r.id, r.item.gov));
  const lists = rows.map((r) => parseGovRow(r.id, r.item.row));

  it("parses every stored row and record", () => {
    expect(rows.length).toBeGreaterThan(26000);
    expect(facts.filter((f) => !f).length).toBe(0);
    expect(lists.filter((r) => !r).length).toBe(0);
  });

  const all = facts.filter((f): f is GovFacts => !!f);
  const byId = new Map(all.filter((f) => !f.path).map((f) => [f.id, f] as const));
  const paths = all.filter((f) => f.path);

  it("looks every listed entry up to itself", () => {
    let wrong = 0;
    for (const f of all) {
      const input = f.path ? `https://${f.host}/${f.path}` : f.host;
      const parsed = parseHostInput(input);
      if (!parsed.ok) {
        wrong++;
        continue;
      }
      const r = buildLookupResult(input, parsed, matchRegistry(parsed, byId, paths), null);
      if (r.status !== "registered" || r.facts?.host !== f.host) wrong++;
    }
    expect(wrong).toBe(0);
  });

  it("finds the parent for a subdomain and lists nothing for an unlisted look-alike", () => {
    let wrong = 0;
    const sample = all.filter((f) => !f.path && f.host.endsWith(".gov")).slice(0, 4000);
    for (const f of sample) {
      const sub = parseHostInput(`www.portal.${f.host}`);
      const lookalike = parseHostInput(`${f.host.replace(/\.gov$/, "")}-zz.gov`);
      if (!sub.ok || !lookalike.ok) {
        wrong++;
        continue;
      }
      const hit = matchRegistry(sub, byId, paths).hit;
      if (hit?.scope !== "parent_domain" || hit.facts.id !== f.id) wrong++;
      const miss = matchRegistry(lookalike, byId, paths).hit;
      if (miss && miss.facts.id === f.id) wrong++;
    }
    expect(wrong).toBe(0);
  });

  it("matches a county only on its own state's rows and an exact Census name", () => {
    const rowsByState = new Map<string, GovRow[]>();
    for (const r of lists)
      if (r)
        for (const s of r.states) (rowsByState.get(s) ?? rowsByState.set(s, []).get(s)!).push(r);
    let withMatch = 0;
    let bad = 0;
    for (const c of counties) {
      const area = parseCensusArea(c.name);
      expect(area).not.toBeNull();
      const m = matchCountyRows(rowsByState.get(c.usps) ?? [], area!, c.usps);
      if (m.length) withMatch++;
      for (const x of m) {
        if (!x.row.states.includes(c.usps)) bad++;
        const equal = (s: string | null) => !!s && s.replace(/\s+/g, " ").trim().toLowerCase();
        const full = equal(area!.full);
        const forms = [equal(`${area!.suffix} of ${area!.base}`), equal(`City of ${area!.base}`)];
        const okOrg = x.row.organization
          ? [full, ...forms].includes(equal(x.row.organization))
          : false;
        const okNote = x.row.note
          ? [full, ...forms].some((f) => equal(x.row.note) === `${f}, ${c.usps.toLowerCase()}`)
          : false;
        if (!okOrg && !okNote) bad++;
      }
    }
    console.log(`county areas with at least one exact match: ${withMatch} of ${counties.length}`);
    expect(bad).toBe(0);
    expect(withMatch).toBeGreaterThan(1000);
  });
});
