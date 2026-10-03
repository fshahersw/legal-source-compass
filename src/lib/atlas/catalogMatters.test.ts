import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { filterMatters, mdlForMatter, summarizeMatters, type CatalogMatter } from "./catalogMatters";
import { filterRegistry, type RegistryV22Record } from "./registryV22";

const rows = JSON.parse(readFileSync("private/data/catalog-matters.json", "utf8")) as CatalogMatter[];
const map = JSON.parse(readFileSync("private/data/mdl-documents/master-dockets.json", "utf8")) as Record<string, string>;

describe("case catalog (real uploaded data)", () => {
  it("has all rows and honest counts", () => {
    const s = summarizeMatters(rows);
    expect(s.total).toBe(2122);
    expect(s.active).toBe(1032);
    expect(s.byFirm[0]).toEqual({ label: "Seeger Weiss", count: 1654 });
    expect(s.byCourt.length).toBe(79);
  });
  it("links to MDLs only through real master-docket ids", () => {
    const linked = rows.filter((m) => mdlForMatter(m, map));
    expect(linked.length).toBeGreaterThan(0);
    expect(linked.length).toBeLessThanOrEqual(977);
    expect(filterMatters(rows, { court: "almb" }, map).every((m) => m.court === "almb")).toBe(true);
  });
});

describe("registry V2.2 split", () => {
  it("keeps all 4,846 records once", () => {
    const dir = "private/data/registry-v22";
    const all = readdirSync(dir).filter((f) => f !== "index.json").flatMap((f) => JSON.parse(readFileSync(`${dir}/${f}`, "utf8")) as RegistryV22Record[]);
    expect(all.length).toBe(4846);
    expect(new Set(all.map((r) => r.id)).size).toBe(4846);
    expect(filterRegistry(all, { officialOnly: true }).every((r) => r.official)).toBe(true);
  });
});

import { taskCounts, taskLabel } from "./registryV22";
describe("registry task folders", () => {
  it("counts Texas sources per task from real data", () => {
    const tx = JSON.parse(readFileSync("private/data/registry-v22/TX.json", "utf8")) as RegistryV22Record[];
    expect(tx.length).toBe(104);
    const c = taskCounts(tx);
    expect(c[0]).toEqual({ task: "courts-procedure", count: 70 });
    expect(taskLabel("courts-procedure")).toBe("Courts & procedure");
  });
});
