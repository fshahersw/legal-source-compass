import { describe, it, expect } from "vitest";
import { filterResources, resourceCategories, safeResourceHref } from "./resourcePresentation";
import type { MergedStateSource } from "@/lib/atlas/stateSources";
const row = (id: string, title: string, category: string, url = "https://example.gov/" + id) =>
  ({
    id,
    title,
    category,
    url,
    domain: "example.gov",
    collections: ["original"],
  }) as MergedStateSource;
const rows = [
  row("a", "Civil Procedure Rules", "Court rules"),
  row("b", "Nebraska Revised Statutes", "Statutes"),
  row("c", "Rules of Evidence", "Court rules"),
  row("d", "Court directory", ""),
];
describe("resource-focused presentation", () => {
  it("filters by actual category and title without changing records", () => {
    const before = JSON.stringify(rows);
    expect(filterResources(rows, "civil rules", "Court rules").map((r) => r.id)).toEqual(["a"]);
    expect(filterResources(rows, "", "Statutes").map((r) => r.id)).toEqual(["b"]);
    expect(JSON.stringify(rows)).toBe(before);
  });
  it("matches words across titles and domains, case-insensitively", () => {
    expect(filterResources(rows, "NEBRASKA example.gov", "").map((r) => r.id)).toEqual(["b"]);
    expect(filterResources(rows, "not-in-the-registry", "")).toEqual([]);
  });
  it("counts the loaded entries, never inventing jurisdiction or coverage", () => {
    expect(resourceCategories(rows)).toEqual([
      { value: "Court rules", label: "Court rules", count: 2 },
      { value: "Statutes", label: "Statutes", count: 1 },
      { value: "", label: "Uncategorized", count: 1 },
    ]);
    expect(resourceCategories([])).toEqual([]);
  });
  it("preserves valid source URLs including section fragments", () => {
    const url = "https://example.gov/laws?section=12#subsection-a";
    expect(safeResourceHref(url)).toBe(url);
    expect(safeResourceHref("http://example.gov/statutes")).toBe("http://example.gov/statutes");
  });
  it.each([
    "javascript:alert(1)",
    "data:text/html,unsafe",
    "//evil.example",
    "https://user:password@example.gov/",
    "https://",
    "file:///tmp/laws",
    "https://example.gov/\nunsafe",
  ])("rejects unsafe or misleading source destinations: %s", (url) => {
    expect(safeResourceHref(url)).toBeNull();
  });
});
