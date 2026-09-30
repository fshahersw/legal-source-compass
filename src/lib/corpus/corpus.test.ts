import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decodeTopology, STATES } from "./geo";
import { parseInsights, firmCounts, mattersByYear, countBy, aliasResolver } from "./insights";
import { classify, classifySource } from "./taxonomy";
import { joinByState, statesOfSource } from "./join";
import { parseBundle } from "@/lib/atlas/bundle";

const read = (p: string) => readFileSync(`public/data/corpus/${p}`);
const prov = JSON.parse(read("PROVENANCE.json").toString());
const topo = JSON.parse(read("us-counties-albers-10m.json").toString());
const ins = parseInsights(JSON.parse(read("insights.json").toString()));

describe("bundled corpussite files", () => {
  it("match recorded sha256", () => {
    for (const [name, meta] of Object.entries<{ sha256: string }>(prov.files))
      expect(createHash("sha256").update(read(name)).digest("hex")).toBe(meta.sha256);
  });
  it("decode 51 states and all county shapes", () => {
    const g = decodeTopology(topo);
    const fips = new Set(g.states.map((s) => s.id));
    for (const s of STATES) expect(fips.has(s.fips)).toBe(true);
    expect(g.counties.length).toBeGreaterThan(3000);
    expect(g.counties.every((c) => c.d.length > 0)).toBe(true);
  });
  it("insights catalog counts computed from rows", () => {
    expect(ins.matters.length).toBe(2122);
    expect(ins.masters.length).toBe(131);
    expect(countBy(ins.matters, (m) => m.state).reduce((a, c) => a + c.count, 0)).toBe(2122);
    expect(mattersByYear(ins).map((c) => c.label)).toEqual([...mattersByYear(ins).map((c) => c.label)].sort());
  });
  it("firm aliases only merge listed spellings", () => {
    const canon = aliasResolver(ins.firm_aliases);
    expect(canon("SHOOK HARDY & BACON LLP")).toBe("Shook Hardy & Bacon LLP");
    expect(canon("Some Unlisted Firm")).toBe("Some Unlisted Firm");
    expect(firmCounts(ins).length).toBeGreaterThan(0);
  });
});

describe("taxonomy (port of categories.py)", () => {
  it("classifies like the Python rule", () => {
    expect(classify("statutory_provision")).toBe("statutes");
    expect(classify("state_constitution")).toBe("constitutions");
    expect(classify("REGULATIONS & RULEMAKING")).toBe("regulations");
    expect(classify("court_rules")).toBe("rules");
    expect(classify("faq")).toBe("guidance");
    expect(classify("court website")).toBe("directories");
    expect(classify("")).toBe("other");
    expect(classifySource([])).toEqual(["other"]);
  });
});

describe("V2.2A join by exact state name", () => {
  const raw = JSON.parse(readFileSync("public/data/atlas-import-bundle.json", "utf8"));
  const res = parseBundle(raw);
  if (!res.ok) throw new Error("bundle failed to parse");
  const sources = res.bundle.sources;
  it("maps every state-named source and reports the rest", () => {
    const r = joinByState(sources, ins);
    const mapped = sources.filter((s) => statesOfSource(s).usps.length > 0).length;
    expect(mapped + r.sourcesWithoutState).toBe(sources.length);
    expect(r.byState.get("CA")!.sources).toBeGreaterThan(0);
    expect([...r.byState.values()].reduce((a, s) => a + s.matters, 0) + r.mattersWithoutState).toBe(ins.matters.length);
  });
});
