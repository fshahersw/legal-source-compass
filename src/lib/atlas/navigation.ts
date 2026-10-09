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
  if (["/law", "/laws", "/safety", "/agencies"].some((x) => at(path, x))) return "law";
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
  if (path === "/" || /^\/places\/[^/]+/.test(path) || navigationSection(path) === "time-limits")
    return [];
  switch (navigationSection(path)) {
    case "states":
      return [
        { to: "/", label: "State map" },
        { to: "/courts", label: "All courts" },
        { to: "/judges", label: "All judges" },
      ];
    case "law":
      return [
        { to: "/law", label: "Overview" },
        { to: "/law/codes", label: "State codes" },
        { to: "/agencies", label: "Agencies" },
        { to: "/safety", label: "Product safety" },
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
