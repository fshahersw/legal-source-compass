import {
  getNeissInjuries,
  getNeissNational,
  getNeissProducts,
  getNeissThemes,
} from "@/lib/external/neiss.functions";

const STALE = 10 * 60 * 1000;
// A server function that finds nothing returns null; react-query rejects undefined, so null is kept explicit and
// the views show their "not published yet" state rather than a load error.

export const neissNationalQuery = {
  queryKey: ["neiss-national"],
  queryFn: async () => (await getNeissNational()) ?? null,
  staleTime: STALE,
};

export const neissProductsQuery = {
  queryKey: ["neiss-products"],
  queryFn: async () => (await getNeissProducts()) ?? null,
  staleTime: STALE,
};

export const neissThemesQuery = {
  queryKey: ["neiss-themes"],
  queryFn: async () => (await getNeissThemes()) ?? null,
  staleTime: STALE,
};

export const neissInjuriesQuery = {
  queryKey: ["neiss-injuries"],
  queryFn: async () => (await getNeissInjuries()) ?? null,
  staleTime: STALE,
};
