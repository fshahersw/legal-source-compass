import { describe, expect, it } from "vitest";
import { makeInsight, type InsightDraft } from "./build";
import {
  MAX_POOL,
  buildPool,
  failedSection,
  sectionForDay,
  type SectionMeta,
  type SourceOutcome,
} from "./pipeline";
import { pickDaily } from "./rotation";
import type { Insight } from "./types";

const META: SectionMeta = {
  id: "court",
  title: "Court analytics",
  href: "/courts/analytics",
  chartsLabel: "Open court charts",
};

const draft = (slug: string, score: number, section = "court"): InsightDraft => ({
  section,
  slug,
  kind: "trend",
  headline: `Headline ${slug}`,
  summary: ["One.", "Two."],
  points: [
    { label: "a", value: "1" },
    { label: "b", value: "2" },
    { label: "c", value: "3" },
  ],
  sources: [{ label: "Source", href: "https://example.gov/" }],
  score,
});
const make = (slug: string, score = 50, section = "court"): Insight =>
  makeInsight(draft(slug, score, section))!;

const ok = (id: string, insights: Insight[]): SourceOutcome => ({ id, ok: true, insights });
const bad = (id: string): SourceOutcome => ({ id, ok: false, error: "read failed" });

describe("buildPool", () => {
  it("combines sources, orders by score then id and drops candidates from another section", () => {
    const pool = buildPool("court", [
      ok("a", [make("x", 40), make("y", 90)]),
      ok("b", [make("z", 40), make("w", 10, "judge")]),
    ]);
    expect(pool.pool.map((i) => i.id)).toEqual(["court.y", "court.x", "court.z"]);
    expect(pool.partial).toBe(false);
  });

  it("keeps going when one source fails and marks the pool partial", () => {
    const pool = buildPool("court", [ok("a", [make("x")]), bad("b")]);
    expect(pool.pool.map((i) => i.id)).toEqual(["court.x"]);
    expect(pool.partial).toBe(true);
  });

  it("throws when every source fails so the page shows an error with Retry", () => {
    expect(() => buildPool("court", [bad("a"), bad("b")])).toThrow(/could not be read/);
  });

  it("returns an empty, complete pool when sources succeeded with nothing to say", () => {
    expect(buildPool("court", [ok("a", []), ok("b", [])])).toEqual({ pool: [], partial: false });
    expect(buildPool("court", [])).toEqual({ pool: [], partial: false });
  });

  it("caps the pool at MAX_POOL keeping the highest scores", () => {
    const many = Array.from({ length: MAX_POOL + 5 }, (_, i) =>
      make(`s${String(i).padStart(2, "0")}`, i),
    );
    const pool = buildPool("court", [ok("a", many)]);
    expect(pool.pool).toHaveLength(MAX_POOL);
    expect(pool.pool[0]!.score).toBe(MAX_POOL + 4);
    expect(pool.pool.at(-1)!.score).toBe(5);
  });
});

describe("sectionForDay", () => {
  const pool = buildPool("court", [
    ok(
      "a",
      Array.from({ length: 5 }, (_, i) => make(`s${i}`, 50 + i)),
    ),
  ]);

  it("picks one insight, reports its place and lists the others", () => {
    const s = sectionForDay(META, pool, "2026-10-18");
    expect(s.pick).not.toBeNull();
    expect(s.poolSize).toBe(5);
    expect(s.position).toBeGreaterThanOrEqual(1);
    expect(s.headlines).toHaveLength(4);
    expect(s.headlines).not.toContain(s.pick!.headline);
    expect(s).toMatchObject({
      section: "court",
      title: "Court analytics",
      href: "/courts/analytics",
      failed: false,
      partial: false,
    });
    expect(s.pick!.id).toBe(pickDaily(pool.pool, "2026-10-18", "court")!.item.id);
  });

  it("is stable within a day and moves to the next entry at the UTC day boundary", () => {
    const a = sectionForDay(META, pool, "2026-10-18");
    const again = sectionForDay(META, pool, "2026-10-18");
    const next = sectionForDay(META, pool, "2026-10-19");
    expect(again.pick!.id).toBe(a.pick!.id);
    expect(next.pick!.id).not.toBe(a.pick!.id);
    expect(next.position).toBe((a.position % 5) + 1);
  });

  it("reports an empty section without a pick instead of inventing one", () => {
    const s = sectionForDay(META, { pool: [], partial: false }, "2026-10-18");
    expect(s).toMatchObject({ pick: null, position: 0, poolSize: 0, headlines: [], failed: false });
  });

  it("carries the partial flag", () => {
    expect(sectionForDay(META, { pool: pool.pool, partial: true }, "2026-10-18").partial).toBe(
      true,
    );
  });
});

describe("failedSection", () => {
  it("marks a section whose whole read failed so the card offers Retry", () => {
    expect(failedSection(META)).toMatchObject({
      section: "court",
      pick: null,
      failed: true,
      partial: true,
      poolSize: 0,
    });
  });
});
