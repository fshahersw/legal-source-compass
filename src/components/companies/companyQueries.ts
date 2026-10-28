import {
  getCompanyDocuments,
  getCompanySegments,
  getCompanyStatements,
  getDocumentText,
} from "@/lib/external/companyStatements.functions";
import { getCompanyCoverFacts, getCompanyIrFigures } from "@/lib/external/companyIr.functions";

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

export const companyCoverFactsQuery = (cik: string) => ({
  queryKey: ["company-sec-cover-facts", cik],
  queryFn: () => getCompanyCoverFacts({ data: { cik } }),
  staleTime: STALE,
});

export const companyIrFiguresQuery = (cik: string) => ({
  queryKey: ["company-ir-figures", cik],
  queryFn: () => getCompanyIrFigures({ data: { cik } }),
  staleTime: STALE,
});
