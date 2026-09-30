import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { mergeStateSources } from "./stateSources";
import type { Source } from "./types";
import type { CatalogEntry } from "./catalog";
import type { RegistryV22Record } from "./registryV22";

const dir = JSON.parse(readFileSync("public/data/atlas-import-bundle.json", "utf8")) as { sources: Source[] };
const catalogTx = JSON.parse(readFileSync("public/data/catalog/tx.json", "utf8")) as CatalogEntry[];
const registryTx = JSON.parse(readFileSync("public/data/registry-v22/MS.json", "utf8")) as RegistryV22Record[];

describe("mergeStateSources", () => {
  it("dedupes only on exact URLs and records every collection", () => {
    const rows = mergeStateSources(
      [
        { id: "a", url: "https://x.gov/a", title: "A", domain: "x.gov", jurisdiction: "Texas", heading_category: "Statutes", source_family: "", occurrences: 1 } as Source,
        { id: "b", url: "https://x.gov/b", title: "B", domain: "x.gov", jurisdiction: "Texas", heading_category: "", source_family: "", occurrences: 1 } as Source,
      ],
      [
        { id: "c1", url: "https://x.gov/a", title: "A catalog", jurisdiction: "tx" },
        { id: "c2", url: "https://x.gov/a/", title: "trailing slash is a different URL", jurisdiction: "tx" },
      ],
      [{ id: "r1", url: "https://x.gov/a", title: "A registry" } as RegistryV22Record],
    );
    expect(rows).toHaveLength(3);
    const a = rows.find((r) => r.url === "https://x.gov/a")!;
    expect(a.collections).toEqual(["Directory", "Source catalog", "Registry V2.2"]);
    expect(a.title).toBe("A"); // directory title wins, never overwritten
    expect(a.source?.id).toBe("a");
  });

  it("handles real Texas data without inventing rows", () => {
    const txSources = dir.sources.filter((s) => s.jurisdiction === "Texas");
    const rows = mergeStateSources(txSources, catalogTx, []);
    const urls = new Set(rows.map((r) => r.url));
    expect(rows.length).toBe(urls.size);
    expect(rows.length).toBeGreaterThanOrEqual(Math.max(txSources.length, catalogTx.length));
    for (const s of txSources) expect(urls.has(s.url)).toBe(true);
    for (const c of catalogTx) expect(urls.has(c.url)).toBe(true);
  });

  it("accepts an empty registry file (states without one)", () => {
    const rows = mergeStateSources([], [], registryTx);
    expect(rows.length).toBe(new Set(registryTx.map((r) => r.url)).size);
    expect(rows.every((r) => r.collections.join() === "Registry V2.2")).toBe(true);
  });
});
