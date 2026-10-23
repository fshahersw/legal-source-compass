import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { FreshnessRow } from "@/lib/ingest/freshness";
import { FreshnessBadgeView, type FreshnessBadgeState } from "./FreshnessBadge";
import { FreshnessTableView, type FreshnessTableState } from "./FreshnessTable";

const ok: FreshnessRow = {
  source: "federal_register",
  dataset: "federal_register_history",
  lastRunAt: "2026-10-23T09:41:05Z",
  lastSuccessAt: "2026-10-23T09:42:10Z",
  newRecords: 82,
  status: "ok",
  message: null,
  label: "Federal Register documents",
  publisher: "Office of the Federal Register (NARA) and GPO",
};
const failed: FreshnessRow = {
  ...ok,
  source: "cpsc_recalls",
  dataset: "agency_safety_cpsc_recalls_api",
  status: "failed",
  lastSuccessAt: "2026-10-20T11:02:00Z",
  newRecords: 5,
  message: "Last run failed: SourceError: HTTP 503",
  label: "CPSC recalls",
  publisher: "U.S. Consumer Product Safety Commission",
};
const never: FreshnessRow = {
  ...ok,
  source: "ftc_hsr",
  dataset: "ftc_hsr_early_terminations",
  status: "never_run",
  lastRunAt: null,
  lastSuccessAt: null,
  newRecords: null,
  message: "Not scheduled yet",
  label: "FTC HSR early termination notices",
  publisher: "U.S. Federal Trade Commission",
};
const stale: FreshnessRow = {
  ...ok,
  status: "stale",
  lastSuccessAt: "2026-10-12T09:42:10Z",
  message: "No successful run since 2026-10-12",
};

const badge = (state: FreshnessBadgeState) =>
  renderToStaticMarkup(createElement(FreshnessBadgeView, { state }));
const table = (state: FreshnessTableState) =>
  renderToStaticMarkup(createElement(FreshnessTableView, { state, onRetry: () => {} }));
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

describe("FreshnessBadgeView", () => {
  it("names the date and the source", () => {
    const html = badge({ kind: "row", row: ok });
    expect(text(html)).toContain("Updated Oct 23, 2026 · Federal Register documents");
    expect(html).toContain("Last successful update: Oct 23, 2026, 09:42 UTC.");
    expect(html).toContain("New records in that update: 82.");
  });

  it("keeps the last good date visible when the last update failed or is overdue", () => {
    expect(text(badge({ kind: "row", row: failed }))).toContain(
      "Updated Oct 20, 2026 · CPSC recalls · last update failed",
    );
    expect(badge({ kind: "row", row: failed })).toContain("text-destructive");
    expect(text(badge({ kind: "row", row: stale }))).toContain(
      "Updated Oct 12, 2026 · Federal Register documents · overdue",
    );
  });

  it("never-run, not-recorded, loading and error states claim no date", () => {
    expect(text(badge({ kind: "row", row: never }))).toContain(
      "Not updated yet · FTC HSR early termination notices",
    );
    expect(text(badge({ kind: "not_recorded", label: "CPSC recalls" }))).toBe(
      "Updates not recorded · CPSC recalls",
    );
    expect(badge({ kind: "loading" })).toContain('aria-label="Loading update status"');
    expect(text(badge({ kind: "error" }))).toBe("Update status unavailable");
    for (const s of [
      { kind: "loading" },
      { kind: "error" },
      { kind: "not_recorded", label: "x" },
    ] as FreshnessBadgeState[])
      expect(text(badge(s))).not.toMatch(/Updated \w{3} \d/);
  });
});

describe("FreshnessTableView", () => {
  it("lists every source with status, last update, new records and note", () => {
    const t = text(
      table({ kind: "ready", result: { ledger: "installed", rows: [ok, failed, never] } }),
    );
    expect(t).toContain(
      "Federal Register documents Office of the Federal Register (NARA) and GPO Up to date Oct 23, 2026, 09:42 UTC 82",
    );
    expect(t).toContain(
      "CPSC recalls U.S. Consumer Product Safety Commission Last update failed Oct 20, 2026, 11:02 UTC 5 Last run failed: SourceError: HTTP 503",
    );
    expect(t).toContain(
      "FTC HSR early termination notices U.S. Federal Trade Commission Not updated yet Not recorded Not recorded Not scheduled yet",
    );
  });

  it("ledger not installed: says nothing is recorded and lists the scheduled datasets", () => {
    const t = text(table({ kind: "ready", result: { ledger: "not_installed", rows: [] } }));
    expect(t).toContain("Scheduled updates are not recorded yet.");
    expect(t).toContain(
      "FDA device enforcement reports · U.S. Food and Drug Administration (openFDA)",
    );
    expect(t).not.toMatch(/Up to date|Updated/);
  });

  it("loading, error with retry, and empty states", () => {
    expect(table({ kind: "loading" })).toContain('aria-label="Loading update status"');
    const err = table({ kind: "error" });
    expect(err).toContain('role="alert"');
    expect(text(err)).toContain("Try again");
    expect(text(table({ kind: "ready", result: { ledger: "installed", rows: [] } }))).toContain(
      "No datasets are set to update on a schedule.",
    );
  });
});
