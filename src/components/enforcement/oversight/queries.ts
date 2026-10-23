/** React Query descriptors for the oversight views. */
import { keepPreviousData } from "@tanstack/react-query";
import {
  getAgencyOversight,
  getCompanyCepResolutions,
  getDojOversight,
  getOversightMeta,
  getOversightOverview,
  searchOscFiles,
  searchOscPublications,
  searchOversightReports,
  type OscSearchInput,
  type OversightSearchInput,
} from "@/lib/external/oversight.functions";

const STALE = 10 * 60 * 1000;

export const oversightMetaQuery = {
  queryKey: ["oversight-meta"],
  queryFn: () => getOversightMeta(),
  staleTime: STALE,
};

export const oversightOverviewQuery = {
  queryKey: ["oversight-overview"],
  queryFn: () => getOversightOverview(),
  staleTime: STALE,
};

export const oversightSearchQuery = (input: OversightSearchInput) => ({
  queryKey: ["oversight-search", input],
  queryFn: () => searchOversightReports({ data: input }),
  staleTime: 5 * 60 * 1000,
  placeholderData: keepPreviousData,
});

export const agencyOversightQuery = (agencyId: string) => ({
  queryKey: ["agency-oversight", agencyId],
  queryFn: () => getAgencyOversight({ data: { agencyId } }),
  staleTime: STALE,
});

export const oscFilesQuery = (input: OscSearchInput) => ({
  queryKey: ["osc-files", input],
  queryFn: () => searchOscFiles({ data: input }),
  staleTime: 5 * 60 * 1000,
  placeholderData: keepPreviousData,
});

export const oscPublicationsQuery = (input: OscSearchInput & { kind?: string; tag?: string }) => ({
  queryKey: ["osc-publications", input],
  queryFn: () => searchOscPublications({ data: input }),
  staleTime: 5 * 60 * 1000,
  placeholderData: keepPreviousData,
});

export const dojOversightQuery = {
  queryKey: ["doj-oversight"],
  queryFn: () => getDojOversight(),
  staleTime: STALE,
};

export const companyCepQuery = (cik: string) => ({
  queryKey: ["company-cep", cik],
  queryFn: () => getCompanyCepResolutions({ data: { cik } }),
  staleTime: STALE,
});
