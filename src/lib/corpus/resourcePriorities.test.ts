import { describe, it, expect } from "vitest";
import { resourceGroup, prioritizeResources, resourceGroups } from "./resourcePriorities";
import type { MergedStateSource } from "@/lib/atlas/stateSources";
const row = (
  id: string,
  title: string,
  category = "Mixed legal resources; Other / not matched by rule",
) =>
  ({
    id,
    title,
    category,
    domain: "example.gov",
    url: `https://example.gov/${id}`,
    collections: ["retained"],
  }) as MergedStateSource;
describe("useful resource ordering without rewriting source metadata", () => {
  it("puts express statutory and court-rule resources ahead of unrelated reference material", () => {
    const input = [
      row("report", "Annual comprehensive health report"),
      row("rules", "Rules of Civil Procedure"),
      row("laws", "Revised Statutes"),
      row("forms", "Court Forms"),
    ];
    const before = JSON.stringify(input);
    expect(prioritizeResources(input).map((x) => x.id)).toEqual([
      "laws",
      "rules",
      "forms",
      "report",
    ]);
    expect(JSON.stringify(input)).toBe(before);
  });
  it.each([
    ["Revised Statutes", "Legislation & codes"],
    ["Bills and Laws Search", "Legislation & codes"],
    ["Rules of Evidence", "Court rules"],
    ["Court Forms", "Court services"],
    ["Supreme Court Opinions", "Opinions"],
    ["Agency Regulations", "Regulations"],
    ["Annual health report", "Other resources"],
  ])("uses explicit title signals for %s", (title, group) => {
    expect(resourceGroup(row("x", title))).toBe(group);
  });
  it("does not print an import classifier as a user-facing category", () => {
    const groups = resourceGroups([row("a", "Annual report"), row("b", "Revised Statutes")]);
    expect(groups).toEqual([
      { value: "Legislation & codes", label: "Legislation & codes", count: 1 },
      { value: "Other resources", label: "Other resources", count: 1 },
    ]);
    expect(JSON.stringify(groups)).not.toContain("not matched");
  });
  it("does not infer that an unknown link is an official statute from its URL", () => {
    expect(resourceGroup({ ...row("a", "Document"), url: "https://example.gov/statute/1" })).toBe(
      "Other resources",
    );
  });
});
