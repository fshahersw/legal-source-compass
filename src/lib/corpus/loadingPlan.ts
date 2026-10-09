/** Load legacy litigation data only when a preserved direct route needs it. */
export function needsCaseCatalog(pathname: string): boolean {
  const path = pathname.split("?")[0]?.split("#")[0] ?? "/";
  return ["/matters", "/insights", "/overview", "/courts", "/judges", "/people"].some(
    (base) => path === base || path.startsWith(base + "/"),
  );
}
