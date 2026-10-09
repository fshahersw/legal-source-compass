import { fetchBundleSnapshot } from "@/lib/private-data/client";
import { createContext, useContext, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { decodeTopology, type GeoData } from "./geo";
import { parseInsights, type Insights } from "./insights";
import { deriveCourtLocationInsights, type CourtLocation } from "./courtLocations";
import { needsCaseCatalog } from "./loadingPlan";

type CorpusState = {
  status: "loading" | "ready" | "error";
  error: string | null;
  geo: GeoData | null;
  insights: Insights | null;
  retry: () => void;
};
const Ctx = createContext<CorpusState | null>(null);

/** Independent caches: a case-catalog failure must never disable the state atlas. */
export function CorpusProvider({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const needsCatalog = needsCaseCatalog(pathname);
  const geometry = useQuery({
    queryKey: ["corpus-geography"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const response = await fetchBundleSnapshot("/data/corpus/us-counties-albers-10m.json");
      if (!response.ok) throw new Error(`Map file: HTTP ${response.status}`);
      return decodeTopology(await response.json());
    },
  });
  const catalog = useQuery({
    queryKey: ["corpus-case-insights"],
    enabled: needsCatalog,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const [insights, locations] = await Promise.all([
        fetchBundleSnapshot("/data/corpus/insights.json"),
        fetchBundleSnapshot("/data/research/court-crosswalk.json"),
      ]);
      if (!insights.ok) throw new Error(`Insights file: HTTP ${insights.status}`);
      if (!locations.ok) throw new Error(`Court locations: HTTP ${locations.status}`);
      const records = (await locations.json()) as { records: CourtLocation[] };
      return deriveCourtLocationInsights(parseInsights(await insights.json()), records.records);
    },
  });
  const error = geometry.error ?? (needsCatalog ? catalog.error : null);
  const status = error
    ? "error"
    : geometry.isPending || (needsCatalog && catalog.isPending)
      ? "loading"
      : "ready";
  const retry = () => {
    void geometry.refetch();
    if (needsCatalog) void catalog.refetch();
  };
  return (
    <Ctx.Provider
      value={{
        status,
        error: error?.message ?? null,
        geo: geometry.data ?? null,
        insights: needsCatalog ? (catalog.data ?? null) : null,
        retry,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useCorpus(): CorpusState {
  const value = useContext(Ctx);
  if (!value) throw new Error("useCorpus must be used inside CorpusProvider");
  return value;
}
