export type NavigationSection = "states" | "law" | "time-limits" | "sources";
export type NavigationItem = {
  id: NavigationSection;
  to: string;
  label: string;
  icon: "map" | "book" | "clock" | "library";
};
export const PRIMARY_NAVIGATION: readonly NavigationItem[] = [
  { id: "states", to: "/", label: "States & courts", icon: "map" },
  { id: "law", to: "/law", label: "Law & regulation", icon: "book" },
  { id: "time-limits", to: "/limitations", label: "Time limits", icon: "clock" },
  { id: "sources", to: "/sources/library", label: "Sources", icon: "library" },
];
const at = (path: string, base: string) => path === base || path.startsWith(base + "/");
/**
 * Federal MDL views reached from court analytics: they sit with States & courts.
 * Only these families; /matters, /matters/<id>, /matters/cases etc. stay unsectioned
 * and no /matters link is ever advertised in navigation.
 */
const isFederalMdlView = (path: string) =>
  at(path, "/matters/analytics") ||
  at(path, "/matters/intel") ||
  /^\/matters\/lens\/[^/]+/.test(path);
export function navigationSection(path: string): NavigationSection | null {
  if (at(path, "/limitations")) return "time-limits";
  if (["/law", "/laws", "/safety", "/agencies", "/companies"].some((x) => at(path, x)))
    return "law";
  if (
    path === "/" ||
    ["/places", "/courts", "/judges", "/search", "/overview", "/analytics"].some((x) =>
      at(path, x),
    ) ||
    isFederalMdlView(path)
  )
    return "states";
  if (
    ["/sources", "/source-datasets", "/data", "/saved-sources", "/data-exports"].some((x) =>
      at(path, x),
    )
  )
    return "sources";
  return null;
}
export type ContextNavigationItem = { to: string; label: string };
export function contextualNavigation(path: string): ContextNavigationItem[] {
  if (
    path === "/" ||
    (/^\/places\/[^/]+/.test(path) && !at(path, "/places/analytics")) ||
    navigationSection(path) === "time-limits"
  )
    return [];
  switch (navigationSection(path)) {
    case "states":
      return [
        { to: "/", label: "State map" },
        { to: "/places/analytics", label: "State analytics" },
        { to: "/courts", label: "All courts" },
        { to: "/courts/analytics", label: "Court analytics" },
        { to: "/judges", label: "All judges" },
        { to: "/judges/analytics", label: "Judge analytics" },
        { to: "/analytics", label: "Data visualizations" },
      ];
    case "law":
      return [
        { to: "/law", label: "Overview" },
        { to: "/law/codes", label: "State codes" },
        { to: "/law/monitoring", label: "Regulatory intelligence" },
        { to: "/law/enforcement", label: "Enforcement" },
        { to: "/agencies", label: "Agencies" },
        { to: "/safety", label: "Product safety" },
        { to: "/companies", label: "Companies" },
        { to: "/companies/payments", label: "Industry payments" },
      ];
    case "sources":
      return [
        { to: "/sources/library", label: "Library" },
        { to: "/sources/catalog", label: "Catalog" },
        { to: "/sources/coverage", label: "Coverage" },
        { to: "/saved-sources", label: "Saved" },
      ];
    default:
      return [];
  }
}
/** `path` without trailing slashes; the root (and an empty path) is "/". */
export const normalizePath = (path: string) => path.replace(/\/+$/, "") || "/";
/**
 * Other addresses of the page a tab opens. /places renders the same States & courts map as "/"
 * (and /overview redirects to it), so the "State map" tab owns it too.
 */
const TAB_ALIASES: Readonly<Record<string, readonly string[]>> = { "/": ["/places"] };
/**
 * Pages a tab owns outside its own path. The federal MDL views are opened from, and breadcrumbed
 * under, Federal court analytics, so "Court analytics" is their parent tab; the tab still links
 * to /courts/analytics, never to a /matters path.
 */
const TAB_DESCENDANTS: Readonly<Record<string, (path: string) => boolean>> = {
  "/courts/analytics": isFederalMdlView,
};
/**
 * The single contextual tab that owns `path`: the longest tab whose path equals `path` or is
 * a parent of it at a segment boundary ("/" matches only the root itself and its aliases).
 * /companies/payments therefore lights only "Industry payments" and /companies/0001326801 only
 * "Companies"; the MDL views light "Court analytics". Returns null when no tab owns the page
 * (e.g. /search).
 */
export function activeContextualPath(
  path: string,
  items: readonly ContextNavigationItem[] = contextualNavigation(path),
): string | null {
  const current = normalizePath(path);
  let best: string | null = null;
  for (const { to } of items) {
    const owns =
      TAB_ALIASES[to]?.includes(current) ||
      TAB_DESCENDANTS[to]?.(current) ||
      (to === "/" ? current === "/" : at(current, to));
    if (owns && (best === null || to.length > best.length)) best = to;
  }
  return best;
}
/**
 * aria-current for a navigation link: "page" only when the link opens the page being shown;
 * a section or parent tab lit for a sub-page (e.g. "All courts" on /courts/ned) is "true",
 * because ARIA reserves "page" for the current page itself.
 */
export function ariaCurrent(
  path: string,
  to: string,
  active: boolean,
): "page" | "true" | undefined {
  if (!active) return undefined;
  return normalizePath(path) === normalizePath(to) ? "page" : "true";
}
