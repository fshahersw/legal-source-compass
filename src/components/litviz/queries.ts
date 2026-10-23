/** React Query options for the litviz server functions. The lanes come over the wire positionally and are expanded
 * here, in the browser, by the same pure code the server used. */
import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import type { CourtLevelType } from "@/lib/litviz/courtTree";
import { fromWire } from "@/lib/litviz/lanes";
import { fromSignalWire } from "@/lib/litviz/signals";
import {
  getCitationGrid,
  getCitationMap,
  getCourtLevel,
  getFilingCitations,
  getMdlLane,
  getMdlLanes,
  getProductSignals,
} from "@/lib/litviz/litviz.functions";

const staleTime = 10 * 60 * 1000;

export const lanesQuery = (scope: "reported" | "historical", decade: number | null) =>
  queryOptions({
    queryKey: ["litviz", "lanes", scope, scope === "historical" ? decade : null],
    queryFn: async () => {
      const w = await getMdlLanes({
        data: { scope, decade: scope === "historical" ? decade : null },
      });
      return { ...fromWire(w), decades: w.decades, decade: w.decade };
    },
    staleTime,
    placeholderData: keepPreviousData,
  });

export const mdlLaneQuery = (mdl: string) =>
  queryOptions({
    queryKey: ["litviz", "lane", mdl],
    queryFn: () => getMdlLane({ data: { mdl } }),
    staleTime,
  });

export const productSignalsQuery = (mdl: string) =>
  queryOptions({
    queryKey: ["litviz", "signals", mdl],
    queryFn: async () => {
      const w = await getProductSignals({ data: { mdl } });
      return w ? fromSignalWire(w) : null;
    },
    staleTime,
  });

export const citationMapQuery = (mdl: string, limit = 30) =>
  queryOptions({
    queryKey: ["litviz", "citations", mdl, limit],
    queryFn: () => getCitationMap({ data: { mdl, limit } }),
    staleTime,
  });

export const citationGridQuery = (mdls: string[] | null, limit = 30) =>
  queryOptions({
    queryKey: ["litviz", "grid", mdls?.join(",") ?? "", limit],
    queryFn: () => getCitationGrid({ data: { mdls, limit } }),
    staleTime,
    placeholderData: keepPreviousData,
  });

export const filingCitationsQuery = (document: string) =>
  queryOptions({
    queryKey: ["litviz", "filing", document],
    queryFn: () => getFilingCitations({ data: { document } }),
    staleTime,
  });

export const courtLevelQuery = (type: CourtLevelType, id: string | null) =>
  queryOptions({
    queryKey: ["litviz", "courts", type, id],
    queryFn: () => getCourtLevel({ data: { type, id } }),
    staleTime,
  });
