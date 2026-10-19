import {
  getCompanyDocuments,
  getCompanySegments,
  getCompanyStatements,
  getDocumentText,
} from "@/lib/external/companyStatements.functions";

const STALE = 10 * 60 * 1000;

export const companyStatementsQuery = (cik: string) => ({
  queryKey: ["company-sec-statements", cik],
  queryFn: () => getCompanyStatements({ data: { cik } }),
  staleTime: STALE,
});

export const companySegmentsQuery = (cik: string) => ({
  queryKey: ["company-sec-segments", cik],
  queryFn: () => getCompanySegments({ data: { cik } }),
  staleTime: STALE,
});

export const companyDocumentsQuery = (cik: string) => ({
  queryKey: ["company-sec-documents", cik],
  queryFn: () => getCompanyDocuments({ data: { cik } }),
  staleTime: STALE,
});

export const documentTextQuery = (id: string) => ({
  queryKey: ["company-sec-document-text", id],
  queryFn: () => getDocumentText({ data: { id } }),
  staleTime: STALE,
});
