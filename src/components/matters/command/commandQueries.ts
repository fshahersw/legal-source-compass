/** Query objects of the MDL command page; each section loads on its own (server reads are cached 10 minutes). */
import { queryOptions } from "@tanstack/react-query";
import {
  getMdlCommand,
  getMdlDefendants,
  getMdlOrderDocuments,
  getMdlRegulatoryLinks,
  getMdlSecDefendants,
  getMdlTypedEvents,
} from "@/lib/matters/command.functions";

const STALE = 5 * 60_000;

export const mdlCommandQuery = (id: string) =>
  queryOptions({
    queryKey: ["mdl-command", id],
    queryFn: () => getMdlCommand({ data: { id } }),
    staleTime: STALE,
  });

export const mdlRegulatoryLinksQuery = (id: string) =>
  queryOptions({
    queryKey: ["mdl-command", id, "regulatory-links"],
    queryFn: () => getMdlRegulatoryLinks({ data: { id } }),
    staleTime: STALE,
  });

export const mdlDefendantsQuery = (id: string) =>
  queryOptions({
    queryKey: ["mdl-command", id, "defendants"],
    queryFn: () => getMdlDefendants({ data: { id } }),
    staleTime: STALE,
  });

export const mdlTypedEventsQuery = (id: string) =>
  queryOptions({
    queryKey: ["mdl-command", id, "typed-events"],
    queryFn: () => getMdlTypedEvents({ data: { id } }),
    staleTime: STALE,
  });

export const mdlSecDefendantsQuery = (id: string) =>
  queryOptions({
    queryKey: ["mdl-command", id, "sec-defendants"],
    queryFn: () => getMdlSecDefendants({ data: { id } }),
    staleTime: STALE,
  });

export const mdlOrderDocumentsQuery = (id: string) =>
  queryOptions({
    queryKey: ["mdl-command", id, "order-documents"],
    queryFn: () => getMdlOrderDocuments({ data: { id } }),
    staleTime: STALE,
  });
