/**
 * Walks every route file and pins where its page sits: a page in a section (with the section named here), a redirect
 * to an existing route, or an explicitly unsectioned utility. A new route file fails this test until it is placed.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PRIMARY_NAVIGATION,
  UNSECTIONED_UTILITIES,
  UTILITY_NAVIGATION,
  contextualNavigation,
  navigationSection,
  type NavigationSection,
} from "./navigation";
import { HUBS } from "@/components/atlas/hub/hubs";

const ROUTES = join(process.cwd(), "src/routes");

/** Sample values for path parameters. */
const SAMPLE: Record<string, string> = {
  $id: "sample-id",
  $cik: "0001326801",
  $state: "NY",
  $county: "36061",
  $dataset: "sec_enforcement_actions",
  $table: "sample_table",
  $title: "42",
  $section: "1983",
  $part: "314",
  $code: "hsju00",
  $bioguide: "A000001",
  $congress: "118",
  $type: "hr",
  $number: "1",
  $mdl: "2873",
};

/** TanStack file route name → URL pattern (`law_.cfr.$title.index` → `/law/cfr/$title`). */
function patternOf(file: string): string {
  const parts = file
    .replace(/\.tsx?$/, "")
    .split(".")
    .filter((p) => p !== "index")
    .map((p) => p.replace(/_$/, ""));
  return "/" + parts.join("/");
}
const sampleOf = (pattern: string) =>
  pattern
    .split("/")
    .map((seg) => SAMPLE[seg] ?? seg)
    .join("/") || "/";

const files = readdirSync(ROUTES).filter(
  (f) => /\.tsx$/.test(f) && !f.startsWith("-") && f !== "__root.tsx",
);
const routes = files.map((file) => {
  const source = readFileSync(join(ROUTES, file), "utf8");
  const pattern = patternOf(file);
  return {
    file,
    pattern,
    path: sampleOf(pattern) === "" ? "/" : sampleOf(pattern),
    redirectOnly: /throw redirect\(/.test(source) && !/component:/.test(source),
    layout: /component: \(\) => <Outlet \/>/.test(source),
    source,
  };
});
const patterns = routes.map((r) => r.pattern);
const exists = (path: string) =>
  patterns.some((p) => {
    const a = p.split("/");
    const b = path.split("?")[0]!.split("/");
    return a.length === b.length && a.every((seg, i) => seg.startsWith("$") || seg === b[i]);
  });

/** Every page route and the section it belongs to (null: an unsectioned utility). */
const EXPECTED: Record<string, NavigationSection | null> = {
  "/": "overview",
  "/places": "places",
  "/places/analytics": "places",
  "/places/$state": "places",
  "/places/$state/$county": "places",
  "/courts": "courts",
  "/courts/$id": "courts",
  "/courts/analytics": "courts",
  "/courts/caseload": "courts",
  "/courts/vacancies": "courts",
  "/judges": "courts",
  "/judges/$id": "courts",
  "/judges/analytics": "courts",
  "/people": "courts",
  "/prototypes/court/$id": "courts",
  "/prototypes/judge/$id": "courts",
  "/litigation": "litigation",
  "/litigation/settlements": "litigation",
  "/litigation/documents": "litigation",
  "/cases": "litigation",
  "/cases/$id": "litigation",
  "/cases/courts": "litigation",
  "/cases/courts/$courtId": "litigation",
  "/matters": "litigation",
  "/matters/$id": "litigation",
  "/matters/analytics": "litigation",
  "/matters/cases": "litigation",
  "/matters/intel": "litigation",
  "/matters/lens/$mdl": "litigation",
  "/matters/seeger-weiss": "litigation",
  "/courts/collection": "litigation",
  "/courts/securities": "litigation",
  "/courts/firms": "litigation",
  "/registry": "litigation",
  "/registry/$id": "litigation",
  "/sources/analysis": "litigation",
  "/sources/docket-documents": "litigation",
  "/prototypes/mdl/$id": "litigation",
  "/law": "law",
  "/law/calculators": "law",
  "/law/legislation/amendments": "law",
  "/law/legislation/reports": "law",
  "/law/legislation/nominations": "law",
  "/law/legislation/gao": "law",
  "/law/rulemaking/documents": "law",
  "/law/rulemaking/dockets": "law",
  "/law/rulemaking/dockets/$docketId": "law",
  "/law/cfr": "law",
  "/law/cfr/$title": "law",
  "/law/cfr/$title/$section": "law",
  "/law/cfr/$title/part/$part": "law",
  "/law/codes": "law",
  "/law/codes/$state": "law",
  "/law/constitutions": "law",
  "/law/constitutions/$state": "law",
  "/law/legislation": "law",
  "/law/legislation/committees": "law",
  "/law/legislation/committees/$code": "law",
  "/law/legislation/federal/$congress/$type/$number": "law",
  "/law/legislation/members": "law",
  "/law/legislation/members/$bioguide": "law",
  "/law/legislation/state/$id": "law",
  "/law/provision/$id": "law",
  "/law/regulations": "law",
  "/law/regulations/$state": "law",
  "/law/rulemaking": "law",
  "/law/uscode": "law",
  "/law/uscode/$title": "law",
  "/law/uscode/$title/$section": "law",
  "/limitations": "law",
  "/limitations/statutory": "law",
  "/agencies": "law",
  "/agencies/$id": "law",
  "/enforcement": "enforcement",
  "/safety": "safety",
  "/safety/signals": "safety",
  "/safety/products": "safety",
  "/safety/products/$id": "safety",
  "/safety/companies": "safety",
  "/law/monitoring": "safety",
  "/companies": "companies",
  "/companies/$cik": "companies",
  "/companies/payments": "companies",
  "/companies/legal-proceedings": "companies",
  "/insights": "insights",
  "/insights/explore": "insights",
  "/insights/trends": "insights",
  "/insights/rankings": "insights",
  "/insights/signals": "insights",
  "/insights/today": "insights",
  "/insights/research": "insights",
  "/analytics": "insights",
  "/analytics/enforcement": "insights",
  "/analytics/insights": "insights",
  "/analytics/safety": "insights",
  "/sources": "sources",
  "/sources/catalog": "sources",
  "/sources/coverage": "sources",
  "/sources/detail": "sources",
  "/sources/library": "sources",
  "/sources/registry": "sources",
  "/sources/registry-v22": "sources",
  "/source-datasets": "sources",
  "/data": "sources",
  "/data/$dataset": "enforcement", // sample dataset sec_enforcement_actions: its section
  "/data/tables/$table": "sources",
  "/records/$dataset/$id": "enforcement", // idem
  "/saved-sources": "saved",
  "/data-exports": "saved",
  "/search": null,
  "/auth": null,
  "/reset-password": null,
  "/prototypes": null,
  "/prototypes/kit": null, // the design-kit gallery, a prototype that belongs to no section
};

describe("every route file has a place", () => {
  it("found the route files", () => {
    expect(routes.length).toBeGreaterThan(100);
  });

  it.each(routes.filter((r) => !r.redirectOnly).map((r) => [r.pattern, r.path] as const))(
    "page %s sits in its section",
    (pattern, path) => {
      expect(Object.hasOwn(EXPECTED, pattern), `${pattern} is not placed in EXPECTED`).toBe(true);
      const expected = EXPECTED[pattern]!;
      expect(navigationSection(path)).toBe(expected);
      if (expected === null)
        expect(
          UNSECTIONED_UTILITIES.some((u) => path === u || path.startsWith(u + "/")),
          `${path} must be a listed utility`,
        ).toBe(true);
    },
  );

  it.each(routes.filter((r) => r.redirectOnly).map((r) => [r.pattern, r.source] as const))(
    "redirect %s leads to existing routes",
    (_pattern, source) => {
      const literal = [...source.matchAll(/to: "([^"]+)"/g)].map((m) => m[1]!);
      // A computed target comes from resolveEnforcementLocation (tested in legacyRoutes.test.ts).
      const computed = /resolveEnforcementLocation/.test(source)
        ? ["/enforcement", "/law/rulemaking", "/litigation/settlements"]
        : [];
      const targets = [...literal, ...computed];
      expect(targets.length).toBeGreaterThan(0);
      for (const target of targets) expect(exists(target), target).toBe(true);
    },
  );

  it("lists exactly the former addresses that are redirects now", () => {
    expect(
      routes
        .filter((r) => r.redirectOnly)
        .map((r) => r.pattern)
        .sort(),
    ).toEqual([
      "/analytics",
      "/analytics/enforcement",
      "/analytics/insights",
      "/analytics/safety",
      "/categories",
      "/endpoint-explorer",
      "/jurisdictions",
      "/law/enforcement",
      "/laws",
      "/mdls",
      "/overview",
      "/prototypes/authorities",
      "/prototypes/legislation/$state",
      "/source-families",
    ]);
  });

  it("names no page in EXPECTED that has no route file", () => {
    for (const pattern of Object.keys(EXPECTED)) expect(patterns, pattern).toContain(pattern);
  });
});

describe("navigation targets exist", () => {
  it("every sidebar section and tab opens an existing route", () => {
    const targets = [
      ...PRIMARY_NAVIGATION.map((s) => s.to),
      ...UTILITY_NAVIGATION.map((s) => s.to),
      ...[...PRIMARY_NAVIGATION, ...UTILITY_NAVIGATION].flatMap((s) =>
        contextualNavigation(s.to).map((t) => t.to),
      ),
    ];
    for (const to of targets) expect(exists(to), to).toBe(true);
  });
  it("every hub link opens an existing route in its own section (or names the other section)", () => {
    for (const [section, hub] of Object.entries(HUBS))
      for (const link of hub.links) {
        expect(exists(link.to), link.to).toBe(true);
        expect(navigationSection(link.to, link.search), `${section}: ${link.label}`).toBe(
          link.elsewhere ?? section,
        );
      }
  });
});
