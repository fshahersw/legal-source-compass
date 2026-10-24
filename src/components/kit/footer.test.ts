import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SourceFooter } from "./Card";

describe("SourceFooter keeps the source behind the info icon", () => {
  it("does not print the source name on the card, only an info button", () => {
    const html = renderToStaticMarkup(
      createElement(SourceFooter, {
        source: { label: "Some Publisher Dataset", href: "https://example.gov" },
        period: "FY2025",
      }),
    );
    expect(html).not.toContain("Some Publisher Dataset");
    expect(html).toContain('aria-label="Source and notes"');
    expect(html).toContain("FY2025");
  });

  it("shows no info button when there is no source and no notes", () => {
    const html = renderToStaticMarkup(createElement(SourceFooter, { period: "2024" }));
    expect(html).not.toContain("aria-label");
  });
});
