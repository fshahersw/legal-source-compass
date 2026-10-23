import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Freshness } from "@/lib/insights/contract";
import {
  describeFreshness,
  formatUtcDate,
  formatUtcDateTime,
  parseFreshness,
  SOURCE_LABELS,
  sourceForDataset,
  withLabels,
} from "./freshness";
import { SOURCES } from "./registry.ts";

const sql = readFileSync(
  new URL("../../../database/contracts/ingest-v1.sql", import.meta.url),
  "utf8",
);
/** (id, dataset, label, publisher) of every ingest.sources seed row. */
const seeded = [
  ...sql.matchAll(/\(\s*'([a-z_]+)',\s*'([a-z0-9_]+)',\s*'([^']*)',\s*'([^']*)',\s*'https:/g),
].map((m) => ({ source: m[1]!, dataset: m[2]!, label: m[3]!, publisher: m[4]! }));

const row = (patch: Partial<Freshness> = {}): Freshness => ({
  source: "federal_register",
  dataset: "federal_register_history",
  lastRunAt: "2026-10-23T09:41:05Z",
  lastSuccessAt: "2026-10-23T09:42:10Z",
  newRecords: 82,
  status: "ok",
  message: null,
  ...patch,
});

describe("source names", () => {
  it("match the ingest.sources seed rows and the adapters", () => {
    expect(seeded.length).toBe(SOURCES.length);
    expect(Object.keys(SOURCE_LABELS).sort()).toEqual(seeded.map((s) => s.source).sort());
    for (const s of seeded)
      expect(SOURCE_LABELS[s.source]).toEqual({
        dataset: s.dataset,
        label: s.label,
        publisher: s.publisher,
      });
    for (const a of SOURCES) expect(SOURCE_LABELS[a.source]?.dataset).toBe(a.dataset);
  });

  it("find the source of a dataset, and none for other datasets", () => {
    expect(sourceForDataset("agency_safety_cpsc_recalls_api")).toBe("cpsc_recalls");
    expect(sourceForDataset("congress_bills")).toBeNull();
  });

  it("label rows, falling back to the dataset id for an unknown source", () => {
    const [a, b] = withLabels([row(), row({ source: "later_source", dataset: "later_dataset" })]);
    expect(a).toMatchObject({
      label: "Federal Register documents",
      publisher: "Office of the Federal Register (NARA) and GPO",
    });
    expect(b).toMatchObject({ label: "later_dataset", publisher: null });
  });
});

describe("contract validation", () => {
  it("accepts the RPC's rows", () => {
    expect(
      parseFreshness([
        row(),
        row({
          status: "never_run",
          lastRunAt: null,
          lastSuccessAt: null,
          newRecords: null,
          message: "Not scheduled yet",
        }),
      ]),
    ).toHaveLength(2);
    expect(parseFreshness([])).toEqual([]);
  });

  it("rejects anything else", () => {
    expect(() => parseFreshness([row({ status: "done" as never })])).toThrow();
    expect(() => parseFreshness([row({ lastSuccessAt: "yesterday" })])).toThrow();
    expect(() => parseFreshness([row({ newRecords: -1 })])).toThrow();
    expect(() => parseFreshness({ rows: [] })).toThrow();
  });
});

describe("wording", () => {
  it("dates are UTC with a fixed locale", () => {
    expect(formatUtcDate("2026-10-23T23:59:59Z")).toBe("Oct 23, 2026");
    expect(formatUtcDateTime("2026-10-23T09:41:05Z")).toBe("Oct 23, 2026, 09:41 UTC");
  });

  it("each status says what is known, never more", () => {
    expect(describeFreshness(row())).toMatchObject({ text: "Updated Oct 23, 2026", tone: "ok" });
    expect(
      describeFreshness(
        row({
          status: "stale",
          lastSuccessAt: "2026-10-12T10:00:00Z",
          message: "No successful run since 2026-10-12",
        }),
      ),
    ).toEqual({
      text: "Updated Oct 12, 2026",
      tone: "warning",
      note: "No successful update since Oct 12, 2026.",
    });
    expect(
      describeFreshness(
        row({ status: "failed", message: "Last run failed: SourceError: HTTP 503" }),
      ),
    ).toMatchObject({
      text: "Updated Oct 23, 2026",
      tone: "error",
      note: "Last run failed: SourceError: HTTP 503",
    });
    expect(describeFreshness(row({ status: "failed", lastSuccessAt: null }))).toMatchObject({
      text: "Update failed",
      tone: "error",
    });
    expect(
      describeFreshness(
        row({
          status: "never_run",
          lastRunAt: null,
          lastSuccessAt: null,
          newRecords: null,
          message: "Not scheduled yet",
        }),
      ),
    ).toEqual({ text: "Not updated yet", tone: "muted", note: "Not scheduled yet" });
  });
});
