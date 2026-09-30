import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { loadAllCatalog, mergeCatalog } from "@/lib/atlas/catalog";
import { useAtlas } from "@/lib/atlas/store";

/**
 * Bundle sources merged with the source catalog (exact-URL dedupe).
 * Used by Saved Sources and the Review Queue so browser-local bookmarks and
 * review decisions recorded against catalog-only rows still resolve.
 */
export function useMergedSources() {
  const { bundle } = useAtlas();
  const base = useMemo(() => bundle?.sources ?? [], [bundle]);
  const cat = useQuery({ queryKey: ["catalog-all"], queryFn: loadAllCatalog, staleTime: Infinity, enabled: base.length > 0 });
  const sources = useMemo(() => (cat.data && base.length ? mergeCatalog(base, cat.data).rows : base), [base, cat.data]);
  return { sources, base, catalogLoading: cat.isLoading };
}
