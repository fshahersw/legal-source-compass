import {
  getSafetyCompany,
  getSafetyRecords,
  getSafetySubject,
  getSafetySubjects,
  getSafetyTermPeriods,
} from "@/lib/external/safetySignals.functions";

const STALE = 10 * 60 * 1000;
// A missing RPC (contract not applied) resolves to null; react-query rejects undefined, so null is kept explicit and the
// views show their "not loaded yet" state rather than a load error.

export type IndexView = "mdl" | "drugs" | "devices";
export const INDEX_TYPES: Record<IndexView, "mdl_group" | "product" | "device_code"> = {
  mdl: "mdl_group",
  drugs: "product",
  devices: "device_code",
};
export const PAGE_SIZE = 50;

export const subjectsQuery = (view: IndexView, q: string, page: number) => ({
  queryKey: ["safety-subjects", view, q, page],
  queryFn: async () =>
    (await getSafetySubjects({
      data: {
        type: INDEX_TYPES[view],
        kind: null,
        q: q || null,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      },
    })) ?? null,
  staleTime: STALE,
});

export const subjectQuery = (id: string) => ({
  queryKey: ["safety-subject", id],
  queryFn: async () => (await getSafetySubject({ data: { id } })) ?? null,
  staleTime: STALE,
});

export const termPeriodsQuery = (
  id: string,
  dim: "meddra_pt" | "device_problem",
  from: string | null,
) => ({
  queryKey: ["safety-term-periods", id, dim, from],
  queryFn: async () => (await getSafetyTermPeriods({ data: { id, dim, top: 12, from } })) ?? null,
  staleTime: STALE,
});

export const recordsQuery = (
  source: "maude" | "nhtsa",
  subject: string,
  q: string,
  page: number,
  limit = 25,
) => ({
  queryKey: ["safety-records", source, subject, q, page],
  queryFn: async () =>
    (await getSafetyRecords({
      data: {
        source,
        subject,
        q: q || null,
        from: null,
        to: null,
        filter: {},
        limit,
        offset: (page - 1) * limit,
      },
    })) ?? null,
  staleTime: STALE,
});

export const companyQuery = (name: string) => ({
  queryKey: ["safety-company", name],
  queryFn: async () => (await getSafetyCompany({ data: { name } })) ?? null,
  staleTime: STALE,
});
