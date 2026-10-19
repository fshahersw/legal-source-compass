import {
  getClbAppealEdges,
  getClbCiteEdges,
  getClbCitingCourts,
  getClbCitingDetail,
  getClbCorrelations,
  getClbDisclosures,
  getClbDocketBreakdown,
  getClbDocketCauses,
  getClbDocketDetail,
  getClbDocketNos,
  getClbDocketOverview,
  getClbDocketYears,
  getClbFlowsMap,
  getClbFlowYears,
  getClbNotes,
  getClbSchemaTable,
  getClbSchemaTables,
  getClbTopCited,
  getClbTopCitedDetail,
} from "@/lib/external/clbCollection.functions";

const staleTime = 10 * 60 * 1000;

export const notesQuery = { queryKey: ["clb", "notes"], queryFn: () => getClbNotes(), staleTime };

// Docket collection
export const docketOverviewQuery = {
  queryKey: ["clb", "docket", "overview"],
  queryFn: () => getClbDocketOverview(),
  staleTime,
};
export const docketYearsQuery = {
  queryKey: ["clb", "docket", "years"],
  queryFn: () => getClbDocketYears(),
  staleTime,
};
export const docketBreakdownQuery = {
  queryKey: ["clb", "docket", "breakdown"],
  queryFn: () => getClbDocketBreakdown(),
  staleTime,
};
export const docketNosQuery = {
  queryKey: ["clb", "docket", "nos"],
  queryFn: () => getClbDocketNos(),
  staleTime,
};
export const docketCausesQuery = {
  queryKey: ["clb", "docket", "causes"],
  queryFn: () => getClbDocketCauses(),
  staleTime,
};
export const docketDetailQuery = (id: string) => ({
  queryKey: ["clb", "docket", "detail", id],
  queryFn: () => getClbDocketDetail({ data: { id } }),
  staleTime,
});
export const correlationsQuery = {
  queryKey: ["clb", "crossview", "correlations"],
  queryFn: () => getClbCorrelations(),
  staleTime,
};

// Citation and appeal flows
export const flowsMapQuery = {
  queryKey: ["clb", "flows", "map"],
  queryFn: () => getClbFlowsMap(),
  staleTime,
};
export const citingCourtsQuery = {
  queryKey: ["clb", "flows", "citing"],
  queryFn: () => getClbCitingCourts(),
  staleTime,
};
export const citingDetailQuery = (court: string) => ({
  queryKey: ["clb", "flows", "citing", court],
  queryFn: () => getClbCitingDetail({ data: { court } }),
  staleTime,
});
export const citeEdgesQuery = {
  queryKey: ["clb", "flows", "cite"],
  queryFn: () => getClbCiteEdges(),
  staleTime,
};
export const appealEdgesQuery = {
  queryKey: ["clb", "flows", "appeal"],
  queryFn: () => getClbAppealEdges(),
  staleTime,
};
export const flowYearsQuery = {
  queryKey: ["clb", "flows", "years"],
  queryFn: () => getClbFlowYears(),
  staleTime,
};

// Most cited
export const topCitedQuery = {
  queryKey: ["clb", "cited", "list"],
  queryFn: () => getClbTopCited(),
  staleTime,
};
export const topCitedDetailQuery = (clusterId: number) => ({
  queryKey: ["clb", "cited", "detail", clusterId],
  queryFn: () => getClbTopCitedDetail({ data: { clusterId } }),
  staleTime,
});

// Disclosures
export const disclosuresQuery = {
  queryKey: ["clb", "disclosures"],
  queryFn: () => getClbDisclosures(),
  staleTime,
};

// Data coverage
export const schemaTablesQuery = {
  queryKey: ["clb", "schema", "tables"],
  queryFn: () => getClbSchemaTables(),
  staleTime,
};
export const schemaTableQuery = (table: string) => ({
  queryKey: ["clb", "schema", "table", table],
  queryFn: () => getClbSchemaTable({ data: { table } }),
  staleTime,
});
