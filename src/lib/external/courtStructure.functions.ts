/**
 * A court's metadata and place in the court structure (dataset courts_db, from Free Law Project's Courts-DB): level, type, dates,
 * divisions, other names, the grouping it belongs to, the courts grouped under it and the appeal route where one is recorded.
 * Read-only; references to other courts are kept only with a valid id, and a court page link only where the record says one exists.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { restGet } from "./rest.server";

export type CourtRef = {
  id: string;
  name: string;
  page: boolean;
  level: string;
  active: boolean | null;
};
export type CourtPeriod = { start: string | null; end: string | null; reorganizations: string[] };
export type CourtStructure = {
  courtId: string;
  name: string;
  system: string;
  level: string;
  type: string;
  location: string | null;
  citationString: string | null;
  abbreviation: string | null;
  active: boolean | null;
  notes: string | null;
  website: string | null;
  periods: CourtPeriod[];
  divisions: string[];
  divisionType: string | null;
  otherNames: string[];
  parentChain: CourtRef[];
  children: CourtRef[];
  siblings: number;
  appealTo: CourtRef | null;
  circuit: CourtRef | null;
  appealedFrom: CourtRef[];
  credit: string;
};

/** Courts-DB ids are CourtListener ids: letters and digits (one, mtjdctFergus, has capitals). */
export const COURT_ID = /^[A-Za-z0-9]{1,40}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const NOT_RECORDED = "Not recorded";

const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const date = (v: unknown) => (typeof v === "string" && DATE.test(v) ? v : null);
const strings = (v: unknown, limit: number) =>
  (Array.isArray(v) ? v : [])
    .map(str)
    .filter((s): s is string => !!s)
    .slice(0, limit);
const website = (v: unknown) => {
  const s = str(v);
  if (!s) return null;
  try {
    const u = new URL(s);
    return (u.protocol === "https:" || u.protocol === "http:") && !u.username && !u.password
      ? u.toString()
      : null;
  } catch {
    return null;
  }
};

export function parseRef(raw: unknown): CourtRef | null {
  const o = obj(raw);
  const id = str(o?.["id"]);
  if (!o || !id || !COURT_ID.test(id)) return null;
  return {
    id,
    name: str(o["name"]) ?? id,
    page: o["page"] === true,
    level: str(o["level"]) ?? NOT_RECORDED,
    active: typeof o["active"] === "boolean" ? o["active"] : null,
  };
}

const refs = (v: unknown, limit = 400) =>
  (Array.isArray(v) ? v : [])
    .map(parseRef)
    .filter((r): r is CourtRef => !!r)
    .slice(0, limit);

export function parseCourtStructure(raw: unknown, courtId: string): CourtStructure | null {
  const p = obj(raw);
  if (!p || p["court_id"] !== courtId) return null;
  const periods = (Array.isArray(p["periods"]) ? p["periods"] : [])
    .map((x) => {
      const o = obj(x);
      if (!o) return null;
      const period = {
        start: date(o["start"]),
        end: date(o["end"]),
        reorganizations: (Array.isArray(o["reorganizations"]) ? o["reorganizations"] : [])
          .map(date)
          .filter((d): d is string => !!d),
      };
      return period.start || period.end || period.reorganizations.length ? period : null;
    })
    .filter((x): x is CourtPeriod => !!x);
  return {
    courtId,
    name: str(p["name"]) ?? courtId,
    system: str(p["system"]) ?? NOT_RECORDED,
    level: str(p["level"]) ?? NOT_RECORDED,
    type: str(p["type"]) ?? NOT_RECORDED,
    location: str(p["location"]),
    citationString: str(p["citation_string"]),
    abbreviation: str(p["name_abbreviation"]),
    active: typeof p["active"] === "boolean" ? p["active"] : null,
    notes: str(p["notes"]),
    website: website(p["court_url"]),
    periods,
    divisions: strings(p["divisions"], 40),
    divisionType: str(p["division_type"]),
    otherNames: strings(p["sub_names"], 20),
    parentChain: refs(p["parent_chain"], 6),
    children: refs(p["children"]),
    siblings:
      typeof p["siblings"] === "number" && Number.isInteger(p["siblings"]) && p["siblings"] >= 0
        ? p["siblings"]
        : 0,
    appealTo: parseRef(p["appeal_to"]),
    circuit: parseRef(p["circuit"]),
    appealedFrom: refs(p["appealed_from"]),
    credit: str(p["credit"]) ?? "Courts-DB, compiled by Free Law Project",
  };
}

export const getCourtStructure = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: z.string().regex(COURT_ID) }).parse(d))
  .handler(async ({ data }): Promise<CourtStructure | null> => {
    const r = await restGet<{ p: unknown }[]>(
      `corpus_records?select=p:item->profile&dataset=eq.courts_db&id=eq.${data.id}&limit=1`,
    );
    return r.rows.length === 1 ? parseCourtStructure(r.rows[0]!.p, data.id) : null;
  });
