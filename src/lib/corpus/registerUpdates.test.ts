import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  filterRegisterDocuments,
  publicationLabel,
  reconcileRegisterPages,
  type RegisterDocument,
  type RegisterManifest,
} from "./registerUpdates";

const root = "private/data/quality/reference/";
const manifest: RegisterManifest = JSON.parse(
  readFileSync(`${root}federal-register-gap/manifest.json`, "utf8"),
);
const pages = manifest.pages.map(
  (page) =>
    JSON.parse(readFileSync(`${root}federal-register-gap/${page.name}`, "utf8")) as {
      count: number;
      results: RegisterDocument[];
    },
);
const records = reconcileRegisterPages(manifest, pages);
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

describe("publisher reference provenance and reconciliation", () => {
  it("preserves every original API page and reconciles the complete bounded index", () => {
    for (const page of manifest.pages) {
      const bytes = readFileSync(`${root}federal-register-gap/${page.name}`);
      expect(bytes.byteLength).toBe(page.bytes);
      expect(sha256(bytes)).toBe(page.sha256);
      expect(new URL(page.url).hostname).toBe("www.federalregister.gov");
    }
    expect(records).toHaveLength(3045);
    expect(manifest.typeCounts.reduce((n, r) => n + r.count, 0)).toBe(records.length);
    for (const r of manifest.typeCounts)
      expect(records.filter((d) => d.type === r.label)).toHaveLength(r.count);
    expect(records.filter((r) => r.effective_on)).toHaveLength(manifest.effectiveDateRecords);
    expect(records.filter((r) => r.cfr_references?.length)).toHaveLength(
      manifest.cfrReferenceRecords,
    );
    expect(records.filter((r) => r.correction_of)).toHaveLength(manifest.correctionRecords);
    expect(records.every((r) => new URL(r.pdf_url).hostname === "www.govinfo.gov")).toBe(true);
  });
  it("retains correction identities and unknown effective dates without inferring legal effect", () => {
    expect(records.some((r) => r.document_number === "C1-2026-04516")).toBe(true);
    expect(records.filter((r) => r.effective_on === null)).toHaveLength(
      records.length - manifest.effectiveDateRecords,
    );
    expect(publicationLabel("Proposed Rule")).toBe("Proposed Rule");
    expect(publicationLabel("Rule")).toBe("Final rule");
    expect(filterRegisterDocuments(records, " C1-2026-04516 ", "")).toHaveLength(1);
    expect(filterRegisterDocuments(records, "", "Proposed Rule")).toHaveLength(188);
  });
  it("rejects duplicate pages or mismatched publisher counts", () => {
    expect(() =>
      reconcileRegisterPages(manifest, [pages[0]!, pages[0]!, ...pages.slice(2)]),
    ).toThrow("identities");
    expect(() =>
      reconcileRegisterPages(manifest, [{ ...pages[0]!, count: 3046 }, ...pages.slice(1)]),
    ).toThrow("counts");
  });
  it("reconciles all 94 court districts and 55 native jurisdictions to all six national totals", () => {
    const benchmark = JSON.parse(readFileSync(`${root}uscourts-table-c-2025.json`, "utf8"));
    const bytes = readFileSync(`${root}${benchmark.sourceFile.path}`);
    expect(sha256(bytes)).toBe(benchmark.sourceFile.sha256);
    expect(bytes.byteLength).toBe(benchmark.sourceFile.bytes);
    expect(benchmark.districts).toHaveLength(94);
    expect(benchmark.jurisdictions).toHaveLength(55);
    for (const [key, value] of Object.entries(benchmark.totals)) {
      expect(
        benchmark.districts.reduce(
          (n: number, r: Record<string, number>) => n + (r[key] ?? NaN),
          0,
        ),
      ).toBe(value);
      expect(
        benchmark.jurisdictions.reduce(
          (n: number, r: Record<string, number>) => n + (r[key] ?? NaN),
          0,
        ),
      ).toBe(value);
    }
    expect(benchmark.totals.filed2025).toBe(303563);
    expect(benchmark.jurisdictions.some((r: { code: string }) => r.code === "NMI")).toBe(true);
  });
});
