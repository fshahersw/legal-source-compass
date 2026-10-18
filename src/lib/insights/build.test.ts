import { describe, expect, it } from "vitest";
import { finishPool, makeInsight, type InsightDraft } from "./build";

const draft = (over: Partial<InsightDraft> = {}): InsightDraft => ({
  section: "state",
  slug: "overdose-rate",
  kind: "leader",
  headline: "Overdose death rates ran from 7.2 to 51.0 per 100,000",
  summary: ["First sentence.", "Second sentence."],
  points: [
    { label: "Highest", value: "51.0" },
    { label: "Lowest", value: "7.2" },
    { label: "National", value: "20.7" },
  ],
  sources: [{ label: "CDC", href: "https://www.cdc.gov/" }],
  score: 70,
  ...over,
});

describe("makeInsight", () => {
  it("builds a valid insight with a namespaced id", () => {
    const i = makeInsight(draft({ dataThrough: "2025", caveat: "Provisional." }))!;
    expect(i.id).toBe("state.overdose-rate");
    expect(i.section).toBe("state");
    expect(i.summary).toHaveLength(2);
    expect(i.points).toHaveLength(3);
    expect(i.caveat).toBe("Provisional.");
    expect(i.dataThrough).toBe("2025");
  });

  it("skips falsy sentences and points so generators can write conditions inline", () => {
    const i = makeInsight(
      draft({
        summary: ["One.", false, null, undefined, "Two.", "Three."],
        points: [
          { label: "a", value: "1" },
          null,
          false,
          { label: "b", value: "2" },
          { label: "c", value: "3" },
        ],
      }),
    )!;
    expect(i.summary).toEqual(["One.", "Two.", "Three."]);
    expect(i.points.map((p) => p.label)).toEqual(["a", "b", "c"]);
  });

  it("drops the candidate when it has too few sentences or points", () => {
    expect(makeInsight(draft({ summary: ["Only one."] }))).toBeNull();
    expect(makeInsight(draft({ summary: ["a.", "b.", "c.", "d.", "e."] }))).toBeNull();
    expect(
      makeInsight(
        draft({
          points: [
            { label: "a", value: "1" },
            { label: "b", value: "2" },
          ],
        }),
      ),
    ).toBeNull();
  });

  it("keeps at most five points", () => {
    const points = Array.from({ length: 7 }, (_, i) => ({ label: `p${i}`, value: String(i) }));
    expect(makeInsight(draft({ points }))!.points).toHaveLength(5);
  });

  it("never lets a placeholder or failed computation reach the page", () => {
    for (const bad of ["NaN%", "undefined", "Infinity", "value is null", "[object Object]"]) {
      expect(makeInsight(draft({ headline: `Rate was ${bad}` }))).toBeNull();
      expect(makeInsight(draft({ summary: ["Fine.", `Bad ${bad}.`] }))).toBeNull();
      expect(
        makeInsight(
          draft({
            points: [
              { label: "a", value: bad },
              { label: "b", value: "2" },
              { label: "c", value: "3" },
            ],
          }),
        ),
      ).toBeNull();
      expect(makeInsight(draft({ caveat: bad }))).toBeNull();
    }
  });

  it("drops points with an empty label or value rather than printing blanks", () => {
    const i = makeInsight(
      draft({
        points: [
          { label: "", value: "1" },
          { label: "a", value: " " },
          { label: "b", value: "2" },
          { label: "c", value: "3" },
          { label: "d", value: "4" },
        ],
      }),
    )!;
    expect(i.points.map((p) => p.label)).toEqual(["b", "c", "d"]);
  });

  it("keeps only site-relative or https links", () => {
    const i = makeInsight(
      draft({
        points: [
          { label: "a", value: "1", href: "/places/TX" },
          { label: "b", value: "2", href: "javascript:alert(1)" },
          { label: "c", value: "3", href: "//evil.example/x" },
          { label: "d", value: "4", href: "http://insecure.example" },
        ],
        sources: [
          { label: "ok", href: "https://www.cdc.gov/" },
          { label: "bad", href: "http://example.com" },
        ],
      }),
    )!;
    expect(i.points.map((p) => p.href)).toEqual(["/places/TX", undefined, undefined, undefined]);
    expect(i.sources).toEqual([{ label: "ok", href: "https://www.cdc.gov/" }]);
  });

  it("needs at least one valid source and a valid slug", () => {
    expect(
      makeInsight(draft({ sources: [{ label: "x", href: "http://example.com" }] })),
    ).toBeNull();
    expect(makeInsight(draft({ slug: "Bad Slug" }))).toBeNull();
    expect(makeInsight(draft({ slug: "" }))).toBeNull();
    expect(makeInsight(draft({ headline: "   " }))).toBeNull();
  });

  it("collapses whitespace and clamps the score", () => {
    const i = makeInsight(draft({ headline: "A  \n  B", score: 250 }))!;
    expect(i.headline).toBe("A B");
    expect(i.score).toBe(100);
    expect(makeInsight(draft({ score: -5 }))!.score).toBe(0);
  });
});

describe("finishPool", () => {
  const make = (slug: string, score: number) => makeInsight(draft({ slug, score }));
  it("drops nulls and repeated ids, orders by score then id, and caps the size", () => {
    const pool = finishPool(
      [make("b", 50), null, make("a", 50), make("c", 90), make("a", 10), make("d", 5)],
      3,
    );
    expect(pool.map((i) => i.id)).toEqual(["state.c", "state.a", "state.b"]);
  });
});
