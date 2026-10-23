import { queryOptions } from "@tanstack/react-query";
import {
  getCaselawAuthorities,
  getCaselawCase,
  getCaselawCitator,
  getCaselawCourt,
  getCaselawCourts,
  getCaselawTextCoverage,
  listCourtCases,
  searchCaselaw,
  searchCaselawFulltext,
  searchCaselawLive,
} from "@/lib/external/caselaw.functions";
import { liveTier, type CaseSearchState } from "./caseSearch";

const staleTime = 10 * 60 * 1000;

export const caseQuery = (id: number) =>
  queryOptions({
    queryKey: ["caselaw", "case", id],
    queryFn: () => getCaselawCase({ data: { id } }),
    staleTime: Infinity,
  });

export const citatorQuery = (id: number) =>
  queryOptions({
    queryKey: ["caselaw", "citator", id],
    queryFn: () => getCaselawCitator({ data: { id } }),
    staleTime: Infinity,
  });

export const authoritiesQuery = (id: number) =>
  queryOptions({
    queryKey: ["caselaw", "authorities", id],
    queryFn: () => getCaselawAuthorities({ data: { id } }),
    staleTime: Infinity,
  });

export const courtsQuery = queryOptions({
  queryKey: ["caselaw", "courts"],
  queryFn: () => getCaselawCourts(),
  staleTime,
});

export const casesSearchQuery = (s: CaseSearchState) =>
  queryOptions({
    queryKey: [
      "caselaw",
      "search",
      s.q ?? "",
      s.tier ?? null,
      s.jur ?? null,
      s.court ?? null,
      s.from ?? null,
      s.to ?? null,
      s.status ?? null,
      s.sort ?? "relevance",
      s.page ?? 1,
    ],
    queryFn: () =>
      searchCaselaw({
        data: {
          q: s.q ?? "",
          tier: s.tier ?? null,
          jurisdiction: s.jur ?? null,
          court: s.court ?? null,
          from: s.from ?? null,
          to: s.to ?? null,
          status: (s.status as "Published" | undefined) ?? null,
          sort: s.sort ?? (s.q ? "relevance" : "cited"),
          page: s.page ?? 1,
        },
      }),
    staleTime,
  });

export const fulltextQuery = (s: CaseSearchState) =>
  queryOptions({
    queryKey: [
      "caselaw",
      "fulltext",
      s.q ?? "",
      s.tier ?? null,
      s.jur ?? null,
      s.court ?? null,
      s.from ?? null,
      s.to ?? null,
      s.sort ?? "relevance",
      s.page ?? 1,
    ],
    queryFn: () =>
      searchCaselawFulltext({
        data: {
          q: s.q ?? "",
          tier: s.tier ?? null,
          jurisdiction: s.jur ?? null,
          court: s.court ?? null,
          from: s.from ?? null,
          to: s.to ?? null,
          type: null,
          sort: s.sort ?? "relevance",
          page: s.page ?? 1,
        },
      }),
    staleTime,
    enabled: !!s.q,
  });

export const liveQuery = (s: CaseSearchState) =>
  queryOptions({
    queryKey: [
      "caselaw",
      "live",
      s.q ?? "",
      liveTier(s.tier),
      s.jur ?? null,
      s.court ?? null,
      s.from ?? null,
      s.to ?? null,
      s.status ?? null,
      !!s.semantic,
      s.sort ?? "relevance",
      s.cursor ?? null,
    ],
    queryFn: () =>
      searchCaselawLive({
        data: {
          q: s.q ?? "",
          tier: liveTier(s.tier),
          jurisdiction: s.jur ?? null,
          court: s.court ?? null,
          from: s.from ?? null,
          to: s.to ?? null,
          allStatuses: !!s.status && s.status !== "Published",
          semantic: !!s.semantic,
          sort: s.sort ?? "relevance",
          cursor: s.cursor ?? null,
        },
      }),
    staleTime: 30 * 60 * 1000,
    enabled: !!s.q,
    retry: false,
  });

export const coverageQuery = queryOptions({
  queryKey: ["caselaw", "coverage"],
  queryFn: () => getCaselawTextCoverage(),
  staleTime: 60 * 60 * 1000,
});

export const courtYearsQuery = (court: string) =>
  queryOptions({
    queryKey: ["caselaw", "court", court],
    queryFn: () => getCaselawCourt({ data: { court } }),
    staleTime,
  });

export const courtCasesQuery = (
  court: string,
  year: number | null,
  sort: "newest" | "oldest" | "cited",
  page: number,
) =>
  queryOptions({
    queryKey: ["caselaw", "court-cases", court, year, sort, page],
    queryFn: () => listCourtCases({ data: { court, year, sort, page } }),
    staleTime,
  });
