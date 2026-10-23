import { queryOptions } from "@tanstack/react-query";
import { PAGE_SIZE, type DocSearchState, type EntityType } from "@/lib/documents/documents";
import {
  documentsForEntity,
  documentsStatus,
  getDocument,
  searchDocuments,
} from "@/lib/documents/documents.functions";

const staleTime = 5 * 60 * 1000;

export const documentSearchQuery = (s: DocSearchState) =>
  queryOptions({
    queryKey: [
      "documents",
      "search",
      s.q ?? "",
      s.court ?? null,
      s.mdl ?? null,
      s.type ?? null,
      s.from ?? null,
      s.to ?? null,
      s.sort ?? null,
      s.page ?? 1,
    ],
    queryFn: () =>
      searchDocuments({
        data: {
          q: s.q ?? "",
          court: s.court ?? null,
          mdl: s.mdl ?? null,
          type: s.type ?? null,
          from: s.from ?? null,
          to: s.to ?? null,
          sort: s.sort ?? null,
          page: s.page ?? 1,
          limit: PAGE_SIZE,
        },
      }),
    staleTime,
  });

export const documentQuery = (id: string) =>
  queryOptions({
    queryKey: ["documents", "document", id],
    queryFn: () => getDocument({ data: { id } }),
    staleTime,
  });

export const entityDocumentsQuery = (type: EntityType, id: string, limit = 8) =>
  queryOptions({
    queryKey: ["documents", "entity", type, id, limit],
    queryFn: () => documentsForEntity({ data: { type, id, limit } }),
    staleTime,
  });

export const documentsStatusQuery = queryOptions({
  queryKey: ["documents", "status"],
  queryFn: () => documentsStatus(),
  staleTime: 10 * 60 * 1000,
});
