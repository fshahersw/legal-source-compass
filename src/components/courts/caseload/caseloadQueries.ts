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
