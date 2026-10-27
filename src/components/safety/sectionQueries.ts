/** Query objects for the Products & safety sections (react-query; 10-minute stale time like the server memo). */
import { getFdaRecallEvents } from "@/lib/safety/fdaRecallEvents.functions";
import {
  getComplaintWindows,
  getCpscDeaths,
  getDeviceRisk,
  getNhtsaPipeline,
  getOshaSilica,
  getRecallComplaints,
  getReportingContext,
} from "@/lib/safety/safetySections.functions";

const STALE = 10 * 60 * 1000;

export const fdaRecallEventsQuery = {
  queryKey: ["safety", "fda-recall-events"],
  queryFn: () => getFdaRecallEvents(),
  staleTime: STALE,
} as const;

export const nhtsaPipelineQuery = {
  queryKey: ["safety", "nhtsa-pipeline"],
  queryFn: () => getNhtsaPipeline(),
  staleTime: STALE,
} as const;

// A missing RPC resolves to null; react-query rejects undefined, so null is kept explicit.
export const complaintWindowsQuery = {
  queryKey: ["safety", "complaint-windows"],
  queryFn: async () => (await getComplaintWindows()) ?? null,
  staleTime: STALE,
} as const;

export const oshaSilicaQuery = {
  queryKey: ["safety", "osha-silica"],
  queryFn: async () => (await getOshaSilica()) ?? null,
  staleTime: STALE,
} as const;

export const cpscDeathsQuery = {
  queryKey: ["safety", "cpsc-deaths"],
  queryFn: () => getCpscDeaths(),
  staleTime: STALE,
} as const;

export const deviceRiskQuery = {
  queryKey: ["safety", "device-risk"],
  queryFn: () => getDeviceRisk(),
  staleTime: STALE,
} as const;

export const recallComplaintsQuery = (campaign: string) => ({
  queryKey: ["safety", "recall-complaints", campaign],
  queryFn: async () => (await getRecallComplaints({ data: { campaign } })) ?? null,
  staleTime: STALE,
});

export const reportingContextQuery = (mdls: readonly number[]) => ({
  queryKey: ["safety", "reporting-context", [...mdls].sort((a, b) => a - b).join(",")],
  queryFn: () => getReportingContext({ data: { mdls: [...mdls] } }),
  staleTime: STALE,
});
