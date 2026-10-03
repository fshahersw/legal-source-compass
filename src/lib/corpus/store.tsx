import { fetchBundleSnapshot } from "@/lib/private-data/client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { decodeTopology, type GeoData } from "./geo";
import { parseInsights, type Insights } from "./insights";
import { deriveCourtLocationInsights, type CourtLocation } from "./courtLocations";

type Status = "loading" | "ready" | "error";
type CorpusState = { status: Status; error: string | null; geo: GeoData | null; insights: Insights | null; retry: () => void };

const Ctx = createContext<CorpusState | null>(null);

/** Loads the two bundled corpussite files (map geometry + saved case catalog). Read-only. */
export function CorpusProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Omit<CorpusState, "retry">>({ status: "loading", error: null, geo: null, insights: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, status: "loading", error: null }));
    Promise.all([
      fetchBundleSnapshot("/data/corpus/us-counties-albers-10m.json").then((r) => { if (!r.ok) throw new Error(`Map file: HTTP ${r.status}`); return r.json(); }),
      fetchBundleSnapshot("/data/corpus/insights.json").then((r) => { if (!r.ok) throw new Error(`Insights file: HTTP ${r.status}`); return r.json(); }),
      fetchBundleSnapshot("/data/research/court-crosswalk.json").then((r) => { if (!r.ok) throw new Error(`Court locations: HTTP ${r.status}`); return r.json() as Promise<{ records: CourtLocation[] }>; }),
    ])
      .then(([topo, ins, courts]) => { if (live) setState({ status: "ready", error: null, geo: decodeTopology(topo), insights: deriveCourtLocationInsights(parseInsights(ins), courts.records) }); })
      .catch((e: unknown) => { if (live) setState({ status: "error", error: e instanceof Error ? e.message : String(e), geo: null, insights: null }); });
    return () => { live = false; };
  }, [attempt]);
  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  return <Ctx.Provider value={{ ...state, retry }}>{children}</Ctx.Provider>;
}

export function useCorpus(): CorpusState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCorpus must be used inside CorpusProvider");
  return v;
}
