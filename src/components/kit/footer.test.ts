import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SourceFooter, type SourceFooterProps } from "./Card";

const render = (props: SourceFooterProps) =>
  renderToStaticMarkup(createElement(SourceFooter, props));

const LONG =
  "Judicial Panel on Multidistrict Litigation, Statistical Analysis of Multidistrict Litigation, fiscal-year-end pending actions (all pending MDLs)";

/** The text of one data-item span, tags removed. */
function item(html: string, key: string): string | null {
  const m = new RegExp(`data-item="${key}"[^>]*>(.*?)</span>(?=<span data-item|</p>)`, "s").exec(
    html,
  );
  return m
    ? m[1]!
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim()
    : null;
}

describe("SourceFooter with a long source", () => {
  const html = render({
    source: { label: LONG, href: "https://www.jpml.uscourts.gov/statistics" },
    period: "FY1992–FY2025",
    asOf: "Oct 1, 2026",
    about: createElement("p", null, "Method and caveats."),
  });

  it("keeps the whole source name in the page and in its title, never cut in the markup", () => {
    expect(html).toContain(`title="${LONG}"`);
    expect(item(html, "source")).toContain(LONG);
  });

  it("puts source, period and as-of in separate wrapping items, in that order", () => {
    expect(html).toMatch(/flex flex-wrap/);
    const order = ["source", "period", "asof"].map((k) => html.indexOf(`data-item="${k}"`));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(item(html, "period")).toBe("FY1992–FY2025");
    expect(item(html, "asof")).toBe("as of Oct 1, 2026");
  });

  it("lets every item shrink and wrap, and clamps only the source (two lines)", () => {
    for (const key of ["source", "period", "asof"])
      expect(html).toMatch(new RegExp(`data-item="${key}"[^>]*class="[^"]*max-w-full`));
    expect(html).toMatch(/data-item="source"[^>]*class="[^"]*line-clamp-2/);
    expect(html).not.toMatch(/data-item="period"[^>]*class="[^"]*(truncate|line-clamp)/);
  });

  it("clips the separator dot of an item that starts a line instead of drawing it at the line start", () => {
    // the row is shifted left by the dot's width inside an overflow-hidden block, and every item pads it back
    expect(html).toMatch(/data-slot="source-text"[^>]*class="[^"]*overflow-hidden/);
    expect(html).toMatch(/<p class="[^"]*-ml-3/);
    expect(html).toMatch(/data-item="period"[^>]*class="[^"]*pl-3/);
  });

  it("keeps the About button reachable outside the clipped text block", () => {
    const text = html.indexOf('data-slot="source-text"');
    const actions = html.indexOf('data-slot="source-actions"');
    const about = html.indexOf('aria-label="About this data"');
    expect(actions).toBeGreaterThan(text);
    expect(about).toBeGreaterThan(actions);
    expect(html).toMatch(/data-slot="source-actions"[^>]*class="[^"]*shrink-0/);
    // the clipped block closes before the actions open
    expect(html.slice(text, actions)).not.toContain('aria-label="About this data"');
  });

  it("opens an external source in a new tab, and an in-app one in place", () => {
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
    const inApp = render({ source: { label: "Corpus catalog", href: "/sources" } });
    expect(inApp).not.toContain("target=");
  });
});

describe("SourceFooter shapes", () => {
  it("joins several sources with semicolons inside one source item", () => {
    const html = render({
      source: [
        { label: "Census Bureau", href: "https://census.gov" },
        { label: "FJC Integrated Database" },
      ],
    });
    expect(item(html, "source")).toBe("Source: Census Bureau; FJC Integrated Database");
    expect(html.match(/data-item="/g)).toHaveLength(1);
  });

  it("renders a source that is any node (a router link) after the label", () => {
    const html = render({ source: createElement("a", { href: "/data/x" }, "Dataset x") });
    expect(item(html, "source")).toBe("Source: Dataset x");
  });

  it("lets a custom source node written for the old one-line footer wrap (links inline, truncation lifted)", () => {
    const html = render({
      source: createElement(
        "a",
        { href: "/data/x", className: "inline-flex min-w-0 items-center" },
        createElement("span", { className: "truncate" }, "A long dataset name"),
      ),
    });
    expect(html).toMatch(/data-item="source"[^>]*class="[^"]*\[&amp;_a\]:inline/);
    expect(html).toMatch(
      /data-item="source"[^>]*class="[^"]*\[&amp;_\.truncate\]:whitespace-normal/,
    );
    expect(html).toMatch(
      /data-item="source"[^>]*class="[^"]*\[&amp;_\.truncate\]:overflow-visible/,
    );
  });

  it("omits what it does not have: no period item, no actions block, no About button", () => {
    const html = render({ source: { label: "Corpus catalog" } });
    expect(html).not.toContain('data-item="period"');
    expect(html).not.toContain('data-item="asof"');
    expect(html).not.toContain("source-actions");
    expect(html).not.toContain("About this data");
  });

  it("shows the Partial pill and the About button together, pinned in the actions block", () => {
    const html = render({
      source: { label: "S" },
      partial: "The latest period is partial.",
      about: createElement("p", null, "x"),
    });
    const actions = html.slice(html.indexOf('data-slot="source-actions"'));
    expect(actions).toContain("Partial");
    expect(actions).toContain('aria-label="About this data"');
  });

  it("renders the period alone when there is no source", () => {
    const html = render({ period: "FY2025" });
    expect(item(html, "period")).toBe("FY2025");
    expect(html).not.toContain('data-item="source"');
  });
});
