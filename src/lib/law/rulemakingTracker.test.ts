import { describe, expect, it } from "vitest";
import {
  agencySummaries,
  agendaEdition,
  agendaSummaries,
  classifyDeadline,
  easternToday,
  editionLabel,
  frAgencyYears,
  projectedMonth,
  sortDeadlines,
  toAgendaItem,
  toDeadline,
  windowRows,
} from "./rulemakingTracker";

const TODAY = "2026-10-27";

// Shaped like corpus_records rows of regulations_gov_documents (sampled 2026-10-27).
const doc = (id: string, agency: string, type: string, end: string, posted: unknown = null) => ({
  id,
  title: `Title of\n${id}`,
  source_url: `https://www.regulations.gov/document/${id}`,
  filters: { type: [type], agency: [agency], docket: [id.replace(/-\d{4}$/, "")] },
  item: {
    dates_et: { posted: "2026-10-01", comment_end: end, comment_start: "2026-10-01" },
    comments: posted === null ? null : { posted },
  },
});

describe("classifyDeadline", () => {
  it("windows by days left and treats far-future placeholders as open-ended, never open for decades", () => {
    expect(classifyDeadline("2026-10-27", TODAY)).toEqual({ daysLeft: 0, window: "30" });
    expect(classifyDeadline("2026-11-26", TODAY)?.window).toBe("30");
    expect(classifyDeadline("2026-11-27", TODAY)?.window).toBe("60");
    expect(classifyDeadline("2027-01-21", TODAY)?.window).toBe("90");
    expect(classifyDeadline("2027-07-31", TODAY)?.window).toBe("later");
    expect(classifyDeadline("2050-02-21", TODAY)).toEqual({ daysLeft: null, window: "open_ended" });
    expect(classifyDeadline("2032-10-10", TODAY)?.window).toBe("open_ended");
    expect(classifyDeadline("2026-10-26", TODAY)).toBeNull();
    expect(classifyDeadline("not a date", TODAY)).toBeNull();
  });
});

describe("toDeadline", () => {
  it("reads the document, keeps a missing comment count null and collapses title whitespace", () => {
    const d = toDeadline(doc("FDA-2026-N-5347-0001", "FDA", "notice", "2026-12-07"), TODAY);
    expect(d).toMatchObject({
      agency: "FDA",
      type: "notice",
      docket: "FDA-2026-N-5347",
      comments: null,
      daysLeft: 41,
      window: "60",
      title: "Title of FDA-2026-N-5347-0001",
    });
    expect(toDeadline(doc("X-1", "EPA", "rule", "2026-10-01"), TODAY)).toBeNull();
    expect(toDeadline(doc("X-2", "EPA", "proposed_rule", "2026-11-02", 12), TODAY)?.comments).toBe(
      12,
    );
  });
});

describe("summaries", () => {
  const rows = sortDeadlines(
    [
      doc("FDA-1-0001", "FDA", "notice", "2050-02-21"),
      doc("FDA-2-0001", "FDA", "proposed_rule", "2026-11-23"),
      doc("FDA-3-0001", "FDA", "notice", "2026-10-28"),
      doc("CPSC-1-0001", "CPSC", "proposed_rule", "2027-01-10"),
    ].flatMap((r) => toDeadline(r, TODAY) ?? []),
  );
  it("sorts soonest first with open-ended last", () => {
    expect(rows.map((r) => r.id)).toEqual([
      "FDA-3-0001",
      "FDA-2-0001",
      "CPSC-1-0001",
      "FDA-1-0001",
    ]);
  });
  it("counts open periods without placeholders and keeps a real zero", () => {
    const s = agencySummaries(rows, ["FDA", "CPSC", "FTC"]);
    expect(s[0]).toEqual({
      agency: "FDA",
      open: 2,
      within30: 2,
      proposedRules: 1,
      openEnded: 1,
      nextClose: "2026-10-28",
    });
    expect(s[2]).toMatchObject({ agency: "FTC", open: 0, nextClose: null });
    const w = windowRows(rows, ["FDA", "CPSC"]);
    expect(w.map((r) => r.values)).toEqual([
      { FDA: 2, CPSC: 0 },
      { FDA: 0, CPSC: 0 },
      { FDA: 0, CPSC: 1 },
    ]);
  });
});

describe("frAgencyYears", () => {
  it("keeps a year the row does not list null and flags the partial year", () => {
    const raw = {
      item: {
        trends: {
          asOf: "2026-10-19",
          partialYear: "2026",
          yearly: {
            RULE: { "2024": 70, "2026": 95 },
            PRORULE: { "2024": 30, "2025": 20, "2026": 27 },
          },
        },
      },
    };
    const out = frAgencyYears("FDA", raw, 2024);
    expect(out.asOf).toBe("2026-10-19");
    expect(out.years).toEqual([
      { year: "2024", rules: 70, proposed: 30, partial: false },
      { year: "2025", rules: null, proposed: 20, partial: false },
      { year: "2026", rules: 95, proposed: 27, partial: true },
    ]);
  });
});

describe("agenda", () => {
  const row = (rin: string, stage: string, next: string) => ({
    id: rin,
    title: rin,
    source_url: `https://www.reginfo.gov/public/do/eAgendaViewRule?pubId=202510&RIN=${rin}`,
    item: { cells: { stage, next_action: next } },
  });
  it("parses the projected month and edition", () => {
    expect(projectedMonth("Final Rule · 07/00/2026 (projected month passed)")).toBe("2026-07");
    expect(projectedMonth("Next Action Undetermined · To Be Determined")).toBeNull();
    expect(agendaEdition(row("2127-AK17", "x", "y").source_url)).toBe("202510");
    expect(editionLabel("202510")).toBe("Fall 2025 (202510)");
    expect(editionLabel("202604")).toBe("Spring 2026 (202604)");
    expect(editionLabel("202507")).toBe("Edition 202507");
    expect(editionLabel(null)).toBeNull();
  });
  it("counts active items past their projected month against the current month only", () => {
    const items = [
      row("2127-A", "Final Rule Stage", "Final Rule · 07/00/2026"),
      row("2127-B", "Proposed Rule Stage", "NPRM · 10/00/2026"),
      row("2127-C", "Proposed Rule Stage", "NPRM · To Be Determined"),
      row("2127-D", "Long-Term Actions", "NPRM · 01/00/2020"),
      row("2127-E", "Completed Actions", "Not recorded"),
    ].flatMap((r) => toAgendaItem("NHTSA", r) ?? []);
    expect(agendaSummaries(items, ["NHTSA"], TODAY)).toEqual([
      { agency: "NHTSA", active: 3, dated: 2, passed: 1, ahead: 1, undated: 1 },
    ]);
  });
});

describe("easternToday", () => {
  it("uses the Eastern-time calendar", () => {
    expect(easternToday(new Date("2026-10-28T02:00:00Z"))).toBe("2026-10-27");
    expect(easternToday(new Date("2026-10-28T05:00:00Z"))).toBe("2026-10-28");
  });
});
