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
export function navigationSection(path: string): NavigationSection | null {
  if (at(path, "/limitations")) return "time-limits";
  if (["/law", "/laws", "/safety", "/agencies", "/companies"].some((x) => at(path, x)))
    return "law";
  if (
    path === "/" ||
    ["/places", "/courts", "/judges", "/search", "/overview"].some((x) => at(path, x))
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
