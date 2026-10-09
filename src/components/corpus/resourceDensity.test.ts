import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MergedStateSource } from "@/lib/atlas/stateSources";
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: import("react").ReactNode }) =>
    createElement("a", { href: "/sources/detail" }, children),
}));
import { StateSourcePanel } from "./StateSourcePanel";
const rows = [
  {
    id: "ne-statutes",
    title: "Nebraska Revised Statutes",
    url: "https://nebraskalegislature.gov/laws/browse-statutes.php",
    domain: "nebraskalegislature.gov",
    category: "Statutes",
    collections: ["old-import", "previous-source"],
  },
] as MergedStateSource[];
const render = (overrides = {}) =>
  renderToStaticMarkup(
    createElement(StateSourcePanel, {
      rows,
      state: "NE",
      loading: false,
      error: false,
      onRetry: () => {},
      ...overrides,
    }),
  );
describe("compact resource workspace", () => {
  it("opens the recorded statute URL as its primary title action", () => {
    const html = render();
    expect(html).toMatch(
      /<a[^>]+href="https:\/\/nebraskalegislature.gov\/laws\/browse-statutes.php"[^>]*>.*?Nebraska Revised Statutes/s,
    );
    expect(html).toContain('aria-label="Resource category"');
  });
  it("does not put import collections or export clutter in the resource rows", () => {
    const html = render();
    expect(html).not.toContain("old-import");
    expect(html).not.toContain("previous-source");
    expect(html).not.toContain("2 collections");
    expect(html).not.toContain("JSON");
    expect(html).toContain("nebraskalegislature.gov");
  });
  it("keeps partial-source failure visible rather than implying complete results", () => {
    expect(render({ error: true })).toContain('role="alert"');
    expect(render({ error: true })).toContain("incomplete");
  });
  it("does not expose an executable source destination", () => {
    expect(render({ rows: [{ ...rows[0], url: "javascript:alert(1)" }] })).not.toContain(
      'href="javascript:',
    );
  });
});
