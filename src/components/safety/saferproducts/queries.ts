import {
  getSaferProductsCompanies,
  getSaferProductsReports,
  getSaferProductsSignals,
} from "@/lib/external/saferProducts.functions";

const STALE = 10 * 60 * 1000;
// A server function that finds nothing returns null; react-query rejects undefined, so null is kept explicit and
// the views show their "not published yet" state rather than a load error.

export const saferProductsReportsQuery = {
  queryKey: ["saferproducts-reports"],
  queryFn: async () => (await getSaferProductsReports()) ?? null,
  staleTime: STALE,
};

export const saferProductsSignalsQuery = {
  queryKey: ["saferproducts-signals"],
  queryFn: async () => (await getSaferProductsSignals()) ?? null,
  staleTime: STALE,
};

export const saferProductsCompaniesQuery = {
  queryKey: ["saferproducts-companies"],
  queryFn: async () => (await getSaferProductsCompanies()) ?? null,
  staleTime: STALE,
};
