import { API_LAW_DATASETS } from "@/lib/external/apiLaw";

export type BrowserSearch = {
  q?: string | undefined;
  page?: number | undefined;
  /** filter name → value (only the dataset's registry filters are sent) */
  f?: Record<string, string> | undefined;
};

/** Validate a route's search for a browser: q, page, and f.<name> values the dataset's registry accepts. */
export function validateBrowserSearch(dataset: string, s: Record<string, unknown>): BrowserSearch {
  const ds = API_LAW_DATASETS[dataset];
  const f: Record<string, string> = {};
  const raw = s["f"] && typeof s["f"] === "object" ? (s["f"] as Record<string, unknown>) : {};
  for (const def of ds?.filters ?? []) {
    const v = raw[def.name];
    if (typeof v === "string" && def.pattern.test(v)) f[def.name] = v;
  }
  const page = s["page"];
  return {
    q: typeof s["q"] === "string" && s["q"].trim() ? s["q"].slice(0, 200) : undefined,
    page:
      typeof page === "number" && Number.isInteger(page) && page >= 1 && page <= 200
        ? page
        : undefined,
    f: Object.keys(f).length ? f : undefined,
  };
}
