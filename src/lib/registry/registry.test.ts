import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildRegistry,
  formatBytes,
  parseJsonl,
  searchMatters,
  type RegistryAttorney,
  type RegistryCourt,
  type RegistryDoc,
  type RegistryMatter,
  type RegistryOutcome,
  type RegistryParty,
} from "./registry";

const dir = "private/data/matter-registry";
const matters = parseJsonl<RegistryMatter>(readFileSync(`${dir}/matters.jsonl`, "utf8"));
const parties = parseJsonl<RegistryParty>(readFileSync(`${dir}/parties.jsonl`, "utf8"));
const attorneys = parseJsonl<RegistryAttorney>(readFileSync(`${dir}/attorneys.jsonl`, "utf8"));
const outcomes = parseJsonl<RegistryOutcome>(readFileSync(`${dir}/outcomes.jsonl`, "utf8"));
const courts = parseJsonl<RegistryCourt>(readFileSync(`${dir}/courts.jsonl`, "utf8"));
const docs: RegistryDoc[] = readdirSync(`${dir}/docs`).flatMap((f) => JSON.parse(readFileSync(`${dir}/docs/${f}`, "utf8")) as RegistryDoc[]);

describe("matter registry (real uploaded data)", () => {
  it("contains every uploaded row exactly once", () => {
    expect(matters.length).toBe(73);
    expect(parties.length).toBe(325);
    expect(attorneys.length).toBe(130);
    expect(outcomes.length).toBe(25);
    expect(courts.length).toBe(13);
    expect(docs.length).toBe(13971);
    expect(new Set(matters.map((m) => m.matter_id)).size).toBe(73);
  });

  it("indexes parties and outcomes by matter without inventing rows", () => {
    const r = buildRegistry(matters, parties, attorneys, outcomes, courts);
    expect([...r.partiesByMatter.values()].reduce((n, l) => n + l.length, 0)).toBe(325);
    expect([...r.outcomesByMatter.values()].reduce((n, l) => n + l.length, 0)).toBe(25);
    for (const p of parties) expect(matters.some((m) => m.matter_id === p.matter_id)).toBe(true);
  });

  it("indexes matters by exact court id only", () => {
    const r = buildRegistry(matters, parties, attorneys, outcomes, courts);
    expect([...r.mattersByCourt.values()].reduce((n, l) => n + l.length, 0)).toBe(73);
    expect(r.mattersByCourt.get("ilnd")!.length).toBe(matters.filter((m) => m.court_id === "ilnd").length);
    expect(r.mattersByCourt.get("ILND")).toBeUndefined();
  });

  it("searches case name, docket and status", () => {
    expect(searchMatters(matters, "").length).toBe(73);
    const hits = searchMatters(matters, "abbvie");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((m) => m.case_name.toLowerCase().includes("abbvie"))).toBe(true);
    expect(searchMatters(matters, "zzz-no-such-case").length).toBe(0);
  });

  it("formats document sizes honestly", () => {
    expect(formatBytes(null)).toBe("Not recorded");
    expect(formatBytes(27505)).toBe("26.9 KB");
    expect(formatBytes(2 * 1024 * 1024)).toBe("2.0 MB");
  });
});
