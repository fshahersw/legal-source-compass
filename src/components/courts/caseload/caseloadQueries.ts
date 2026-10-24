import {
  getCaseloadDistrict,
  getCaseloadDistricts,
  getCaseloadMdl,
  getCaseloadMdls,
  getCaseloadMethod,
  getCaseloadNational,
  getCaseloadNos,
  getCaseloadNosDetail,
  getCaseloadStates,
} from "@/lib/external/courtCaseload.functions";
import {
  getCoverageSummary,
  getHeldTables,
  getPublicationCoverage,
  getSeriesCourtNames,
  getSeriesCourts,
  getSeriesDetail,
  getSeriesLatest,
  getSeriesList,
  getSeriesTable,
} from "./seriesData.functions";
import type { SeriesDataset } from "./seriesModel";

const staleTime = 10 * 60 * 1000;

export const districtsQuery = {
  queryKey: ["caseload", "districts"],
  queryFn: () => getCaseloadDistricts(),
  staleTime,
};
export const nationalQuery = {
  queryKey: ["caseload", "national"],
  queryFn: () => getCaseloadNational(),
  staleTime,
};
export const statesQuery = {
  queryKey: ["caseload", "states"],
  queryFn: () => getCaseloadStates(),
  staleTime,
};
export const nosQuery = {
  queryKey: ["caseload", "nos"],
  queryFn: () => getCaseloadNos(),
  staleTime,
};
export const mdlsQuery = {
  queryKey: ["caseload", "mdls"],
  queryFn: () => getCaseloadMdls(),
  staleTime,
};
export const methodQuery = {
  queryKey: ["caseload", "method"],
  queryFn: () => getCaseloadMethod(),
  staleTime,
};
export const districtDetailQuery = (id: string) => ({
  queryKey: ["caseload", "district", id],
  queryFn: () => getCaseloadDistrict({ data: { id } }),
  staleTime,
});
export const nosDetailQuery = (id: string) => ({
  queryKey: ["caseload", "nos", id],
  queryFn: () => getCaseloadNosDetail({ data: { id } }),
  staleTime,
});
export const mdlDetailQuery = (mdl: number) => ({
  queryKey: ["caseload", "mdl", mdl],
  queryFn: () => getCaseloadMdl({ data: { mdl } }),
  staleTime,
});

// ------------------------------------------------------------------------------------------------ published tables

export const seriesListQuery = {
  queryKey: ["caseload", "series", "list"],
  queryFn: () => getSeriesList(),
  staleTime,
};
export const seriesDetailQuery = (tableKey: string) => ({
  queryKey: ["caseload", "series", "detail", tableKey],
  queryFn: () => getSeriesDetail({ data: { tableKey } }),
  staleTime,
});
export const seriesTableQuery = (dataset: SeriesDataset, id: string) => ({
  queryKey: ["caseload", "series", "table", dataset, id],
  queryFn: () => getSeriesTable({ data: { dataset, id } }),
  staleTime,
});
export const seriesCourtsQuery = (dataset: SeriesDataset, tableKey: string, courts: string[]) => ({
  queryKey: ["caseload", "series", "courts", dataset, tableKey, courts.join(",")],
  queryFn: () => getSeriesCourts({ data: { dataset, tableKey, courts } }),
  staleTime,
});
export const seriesLatestQuery = (dataset: SeriesDataset, tableKey: string) => ({
  queryKey: ["caseload", "series", "latest", dataset, tableKey],
  queryFn: () => getSeriesLatest({ data: { dataset, tableKey } }),
  staleTime,
});
export const seriesNamesQuery = (dataset: SeriesDataset, tableKey: string) => ({
  queryKey: ["caseload", "series", "names", dataset, tableKey],
  queryFn: () => getSeriesCourtNames({ data: { dataset, tableKey } }),
  staleTime,
});
export const coverageQuery = {
  queryKey: ["caseload", "series", "coverage"],
  queryFn: () => getCoverageSummary(),
  staleTime,
};
export const heldQuery = {
  queryKey: ["caseload", "series", "held"],
  queryFn: () => getHeldTables(),
  staleTime,
};
export const publicationCoverageQuery = (code: string) => ({
  queryKey: ["caseload", "series", "pub", code],
  queryFn: () => getPublicationCoverage({ data: { code } }),
  staleTime,
});
