import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { bulletLayout } from "./axis";
import { BulletBand, RankBars, SmallMultiplesGrid, TimelineStrip } from "./context";
import { benchmark } from "./theme";

const html = (node: ReactNode) => renderToStaticMarkup(node as never);
const fmt = (v: number) => v.toLocaleString("en-US");

describe("context primitives", () => {
  it("labels a benchmark with its value, and gives none when not recorded", () => {
    expect(benchmark("Median district", 7.9, (v) => v.toFixed(1))).toEqual([
      { value: 7.9, label: "Median district 7.9" },
    ]);
    expect(benchmark("Median", null, fmt)).toEqual([]);
  });

  it("ranked bars list unrecorded items apart and say when nothing is recorded", () => {
    const out = html(
      createElement(RankBars, {
        items: [
          { id: "a", label: "Alpha", value: 3 },
          { id: "b", label: "Beta", value: null },
        ],
        format: fmt,
        ariaLabel: "Ranked",
      }),
    );
    expect(out).toContain("Not recorded (1): Beta.");
    expect(out).toContain('aria-label="Ranked"');
    const none = html(
      createElement(RankBars, {
        items: [{ id: "b", label: "Beta", value: null }],
        format: fmt,
        ariaLabel: "Ranked",
      }),
    );
    expect(none).toContain("no item carries a value");
  });

  it("small multiples show each panel's latest value and change", () => {
    const out = html(
      createElement(SmallMultiplesGrid, {
        rows: [
          { y: "2024", ca: 10, tx: 4 },
          { y: "2025", ca: 12, tx: null },
        ],
        xKey: "y",
        panels: [
          { key: "ca", label: "California" },
          { key: "tx", label: "Texas" },
        ],
        format: fmt,
        ariaLabel: "States",
      }),
    );
    expect(out).toContain("California");
    expect(out).toContain("+2 vs 2024");
    expect(out).toContain("Shared scale");
  });

  it("timeline strips mark the latest complete period, hatch partial ones and never draw a gap as zero", () => {
    const out = html(
      createElement(TimelineStrip, {
        points: [
          { label: "2022", value: 4 },
          { label: "2023", value: null },
          { label: "2024", value: 8 },
          { label: "2025", value: 2, partial: true },
        ],
        format: fmt,
        what: "Recalls per year",
      }),
    );
    expect(out).toContain("Recalls per year, 2022 to 2025: latest 8 (2024), highest 8 (2024).");
    expect(out).toContain("2023: Not recorded");
    expect(out).toContain("2025: 2 (partial period)");
    expect(
      html(
        createElement(TimelineStrip, {
          points: [{ label: "x", value: 1 }],
          format: fmt,
          what: "w",
        }),
      ),
    ).toBe("");
  });
});

describe("bullet band", () => {
  it("places value, band and median on one track that includes zero", () => {
    expect(bulletLayout(50, 0, 25, 100)).toEqual({ value: 50, min: 0, median: 25, max: 100 });
    const p = bulletLayout(150, 20, 60, 100, false)!;
    expect(p.value).toBe(100);
    expect(p.min).toBe(0);
    expect(bulletLayout(null, null, null, null)).toBeNull();
  });

  it("writes every number in text and marks a missing value Not recorded", () => {
    const out = html(
      createElement(BulletBand, {
        rows: [
          {
            id: "a",
            label: "Weighted filings per judgeship",
            value: 612,
            min: 120,
            median: 495,
            max: 1100,
          },
          { id: "b", label: "Months to disposition", value: null, min: 4, median: 8, max: 48 },
        ],
        format: fmt,
        focusLabel: "N.D. Ill.",
        ariaLabel: "Court against national",
      }),
    );
    expect(out).toContain(
      "Weighted filings per judgeship: 612; national median 495, range 120 to 1,100.",
    );
    expect(out).toContain("min 120 · median 495 · max 1,100");
    expect(out).toContain("Months to disposition: Not recorded");
    expect(out).toContain("N.D. Ill.");
  });
});
