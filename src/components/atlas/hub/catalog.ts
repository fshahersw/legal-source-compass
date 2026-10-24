/**
 * The corpus catalog for the section hubs (same query and cache as useDatasets): record counts as the catalog stores
 * them, optionally read only after the first paint so a hub never holds up the page above it.
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listDatasets, type DatasetInfo } from "@/lib/external/catalog.functions";

/** A dataset's record count as the catalog stores it; null when the catalog does not record one. */
export function recordCount(dataset: DatasetInfo | undefined) {
  if (!dataset) return undefined;
  return dataset.records != null && Number.isSafeInteger(dataset.records) && dataset.records >= 0
    ? dataset.records
    : null;
}

/**
 * Starts the catalog query after the first paint (and an idle moment), so a hub's counts never hold up the page
 * above them, such as the map on the overview.
 */
function useAfterFirstPaint() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number };
    if (w.requestIdleCallback) {
      w.requestIdleCallback(() => setReady(true));
      return;
    }
    const t = window.setTimeout(() => setReady(true), 200);
    return () => window.clearTimeout(t);
  }, []);
  return ready;
}

/** The corpus catalog (same query and cache as useDatasets), optionally started only after the first paint. */
export function useCatalog(deferred: boolean) {
  const afterPaint = useAfterFirstPaint();
  const fn = useServerFn(listDatasets);
  const enabled = !deferred || afterPaint;
  const datasets = useQuery({
    queryKey: ["corpus-datasets"],
    queryFn: () => fn(),
    staleTime: 10 * 60_000,
    enabled,
  });
  const byId = new Map((datasets.data ?? []).map((d) => [d.id, d]));
  return {
    byId,
    loading: !datasets.data && !datasets.error,
    error: datasets.error,
    retry: () => void datasets.refetch(),
  };
}
