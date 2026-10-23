/**
 * Judges as their court's own website lists them, and the individual rules, practices, procedures, standing orders and forms linked from
 * each judge's page (datasets judge_court_pages, judge_practice_documents, judge_court_coverage). Names, titles, document titles and dates
 * are shown as the court prints them; a title class is a reading of those words. A judge is linked to an existing profile only where the
 * build found a unique exact match of normalised name plus court. Read-only; malformed values are dropped, never repaired.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { restGet } from "./rest.server";

export const TITLE_ORDER = [
  "chief_district_judge",
  "district_judge",
  "senior_district_judge",
  "chief_magistrate_judge",
  "magistrate_judge",
  "senior_magistrate_judge",
  "chief_bankruptcy_judge",
  "bankruptcy_judge",
  "other",
  "unclassified",
] as const;
export type TitleClass = (typeof TITLE_ORDER)[number];
export const TITLE_LABEL: Record<TitleClass, string> = {
  chief_district_judge: "Chief district judges",
  district_judge: "District judges",
  senior_district_judge: "Senior district judges",
  chief_magistrate_judge: "Chief magistrate judges",
  magistrate_judge: "Magistrate judges",
  senior_magistrate_judge: "Recalled magistrate judges",
  chief_bankruptcy_judge: "Chief bankruptcy judges",
  bankruptcy_judge: "Bankruptcy judges",
  other: "Other judicial officers listed",
  unclassified: "Title not stated",
};
export const isTitleClass = (v: unknown): v is TitleClass =>
  typeof v === "string" && (TITLE_ORDER as readonly string[]).includes(v);

export type ProfileStatus = "linked" | "unmatched" | "ambiguous";
export type PracticeDoc = {
  id: string;
  title: string;
  url: string;
  dateText: string | null;
  date: string | null;
  fileType: string | null;
  retrieved: boolean;
  attachedVia: string | null;
};
export type JudgeCourtPage = {
  id: string;
  courtId: string;
  court: string;
  level: "district" | "bankruptcy";
  name: string;
  nameAsPublished: string;
  titleAsPublished: string | null;
  titleClass: TitleClass;
  titleBasis: string | null;
  /** Where the title words were read: the judge's own page, a link text, or the heading the court lists the judge under. */
  titleSource: string | null;
  pageUrl: string;
  pageKind: "judge_page" | "listing_entry";
  retrievedAt: string | null;
  profileId: string | null;
  profileStatus: ProfileStatus;
  documents: PracticeDoc[];
};
export type RosterJudge = {
  id: string;
  name: string;
  nameAsPublished: string;
  title: string | null;
  titleSource: string | null;
  titleClass: TitleClass;
  documents: number;
  documentsRetrieved: number;
  profileId: string | null;
  profileStatus: ProfileStatus;
  pageUrl: string;
  pageKind: "judge_page" | "listing_entry";
};
export type CourtCoverage = {
  courtId: string;
  court: string;
  level: "district" | "bankruptcy";
  site: string;
  status: string;
  note: string | null;
  judges: number;
  judgePages: number;
  listingEntries: number;
  documents: number;
  profilesLinked: number;
  profilesNotLinked: number;
  listingPages: { url: string; status: number | null; judgesFound: number | null }[];
};
export type CourtRoster = {
  coverage: CourtCoverage | null;
  judges: RosterJudge[];
  dropped: number;
};
export type DocumentHit = {
  id: string;
  title: string;
  url: string;
  fileType: string | null;
  snippet: string;
  judgePageIds: string[];
  dateText: string | null;
};
export type DocumentHits = { hits: DocumentHit[]; total: number | null };

const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const str = (v: unknown, max = 600) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
const int = (v: unknown) =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 1e7 ? v : null;

export const COURT_ID = /^[a-z0-9]{2,24}$/;
export const JUDGE_ID = /^[0-9a-f]{32}$/;
export const PAGE_ID = /^[a-z0-9]{2,24}-[a-z0-9][a-z0-9-]{1,120}$/;
export const DOC_ID = /^jpd-[0-9a-f]{16}$/;
const OFFICIAL = /^https?:\/\/([a-z0-9-]+\.)*uscourts\.gov(:\d+)?(\/|$)/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** An address on a federal court's own site (uscourts.gov), http(s) only; anything else is dropped. */
export function courtUrl(v: unknown): string | null {
  const s = str(v, 1200);
  if (!s || !OFFICIAL.test(s)) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function parseDoc(raw: unknown): PracticeDoc | null {
  const d = obj(raw);
  const id = str(d?.["id"], 40);
  const title = str(d?.["title"], 400);
  const url = courtUrl(d?.["url"]);
  if (!d || !id || !DOC_ID.test(id) || !title || !url) return null;
  const date = str(d["date"], 12);
  return {
    id,
    title,
    url,
    dateText: str(d["date_text"], 60),
    date: date && ISO_DATE.test(date) ? date : null,
    fileType: str(d["file_type"], 8),
    retrieved: d["retrieved"] === true,
    attachedVia: str(d["attached_via"], 300),
  };
}

const profileStatus = (v: unknown): ProfileStatus =>
  v === "linked" || v === "ambiguous" ? v : "unmatched";

export function parseJudgePage(raw: unknown): JudgeCourtPage | null {
  const p = obj(raw);
  const id = str(p?.["id"], 160);
  const courtId = str(p?.["court_id"], 24);
  const name = str(p?.["name"], 200);
  const pageUrl = courtUrl(p?.["page_url"]);
  const level = p?.["level"];
  if (!p || !id || !PAGE_ID.test(id) || !courtId || !COURT_ID.test(courtId) || !name || !pageUrl)
    return null;
  if (level !== "district" && level !== "bankruptcy") return null;
  const profile = obj(p["profile"]);
  const status = profileStatus(profile?.["status"]);
  const profileId = str(profile?.["judge_id"], 40);
  const documents = (Array.isArray(p["documents"]) ? p["documents"] : [])
    .map(parseDoc)
    .filter((d): d is PracticeDoc => !!d);
  const titleClass = p["title_class"];
  return {
    id,
    courtId,
    court: str(p["court"], 200) ?? courtId,
    level,
    name,
    nameAsPublished: str(p["name_as_published"], 240) ?? name,
    titleAsPublished: str(p["title_as_published"], 160),
    titleClass: isTitleClass(titleClass) ? titleClass : "unclassified",
    titleBasis: str(p["title_basis"], 40),
    titleSource: str(p["title_source"], 80),
    pageUrl,
    pageKind: p["page_kind"] === "listing_entry" ? "listing_entry" : "judge_page",
    retrievedAt: str(p["retrieved_at"], 40),
    profileId: status === "linked" && profileId && JUDGE_ID.test(profileId) ? profileId : null,
    profileStatus:
      status === "linked" && !(profileId && JUDGE_ID.test(profileId)) ? "unmatched" : status,
    documents,
  };
}

export function parseRosterJudge(raw: unknown): RosterJudge | null {
  const r = obj(raw);
  const id = str(r?.["id"], 160);
  const name = str(r?.["name"], 200);
  const pageUrl = courtUrl(r?.["page_url"]);
  if (!r || !id || !PAGE_ID.test(id) || !name || !pageUrl) return null;
  const status = profileStatus(r["profile_status"]);
  const profileId = str(r["profile_id"], 40);
  const ok = status === "linked" && !!profileId && JUDGE_ID.test(profileId);
  const titleClass = r["title_class"];
  return {
    id,
    name,
    nameAsPublished: str(r["name_as_published"], 240) ?? name,
    title: str(r["title"], 160),
    titleSource: str(r["title_source"], 80),
    titleClass: isTitleClass(titleClass) ? titleClass : "unclassified",
    documents: int(r["documents"]) ?? 0,
    documentsRetrieved: int(r["documents_retrieved"]) ?? 0,
    profileId: ok ? profileId : null,
    profileStatus: status === "linked" && !ok ? "unmatched" : status,
    pageUrl,
    pageKind: r["page_kind"] === "listing_entry" ? "listing_entry" : "judge_page",
  };
}

export function parseCoverage(raw: unknown, courtId: string): CourtCoverage | null {
  const c = obj(raw);
  const site = courtUrl(c?.["site"]);
  const level = c?.["level"];
  if (!c || c["court_id"] !== courtId || !site || (level !== "district" && level !== "bankruptcy"))
    return null;
  const pages = (Array.isArray(c["listing_pages"]) ? c["listing_pages"] : [])
    .map((x) => {
      const o = obj(x);
      const url = courtUrl(o?.["url"]);
      if (!o || !url) return null;
      const status = o["status"];
      return {
        url,
        status: typeof status === "number" && Number.isInteger(status) ? status : null,
        judgesFound: int(o["judges_found"]),
      };
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .slice(0, 12);
  return {
    courtId,
    court: str(c["court"], 200) ?? courtId,
    level,
    site,
    status: str(c["status"], 40) ?? "not_checked",
    note: str(c["note"], 500),
    judges: int(c["judges"]) ?? 0,
    judgePages: int(c["judge_pages"]) ?? 0,
    listingEntries: int(c["listing_entries"]) ?? 0,
    documents: int(c["documents"]) ?? 0,
    profilesLinked: int(c["profiles_linked"]) ?? 0,
    profilesNotLinked: int(c["profiles_not_linked"]) ?? 0,
    listingPages: pages,
  };
}

const enc = encodeURIComponent;
const cs = (v: Record<string, string[]>) => enc(JSON.stringify(v));

/** Court pages of the judge profile `id` (a judge may have been listed by more than one court). */
export function judgePagesPath(judgeId: string): string {
  return `corpus_records?${[
    "select=id,p:item->judge_page",
    "dataset=eq.judge_court_pages",
    `filters=cs.${cs({ judge: [judgeId] })}`,
    "order=ordinal.asc",
    "limit=6",
  ].join("&")}`;
}

export function rosterPath(courtId: string): string {
  return `corpus_records?${[
    "select=id,r:item->roster",
    "dataset=eq.judge_court_pages",
    `filters=cs.${cs({ court: [courtId] })}`,
    "order=ordinal.asc",
    "limit=400",
  ].join("&")}`;
}

export function coveragePath(courtId: string): string {
  return `corpus_records?select=id,c:item->coverage&dataset=eq.judge_court_coverage&id=eq.${enc(courtId)}&limit=1`;
}

/** Prefix terms for the simple full-text configuration: letters and digits only, at most 8 terms. */
export function ftsQuery(q: string): string | null {
  const words = q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const terms = words.slice(0, 8).map((w) => w.slice(0, 40));
  return terms.length ? terms.map((t) => `${t}:*`).join("&") : null;
}

/** Documents of the given judge pages (ids already validated) whose text contains every word of the query. */
export function documentSearchPath(pageIds: string[], q: string): string | null {
  const fts = ftsQuery(q);
  if (!fts || !pageIds.length) return null;
  const or = pageIds.map((p) => `filters.cs.${cs({ judge_page: [p] })}`).join(",");
  return `corpus_records?${[
    "select=id,title,text,sub:detail->>subtitle,d:item->practice_document",
    "dataset=eq.judge_practice_documents",
    `or=(${or})`,
    `search_vector=fts(simple).${enc(fts)}`,
    "order=ordinal.asc",
  ].join("&")}`;
}

/** The stored row text starts with the record's id, title and subtitle (the corpus writer adds them for search); the document's own text follows. */
export function bodyOf(text: string, id: string, title: string, subtitle: string | null): string {
  const head = [id, title, subtitle].filter(Boolean).join(" ");
  return text.startsWith(head) ? text.slice(head.length).trim() : text;
}

/** A short passage around the first word of the query (or the start), on one line. */
export function snippet(text: string, q: string, width = 260): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const terms = (q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => t.length > 1);
  const lower = flat.toLowerCase();
  let at = -1;
  for (const t of terms) {
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "u");
    const m = re.exec(lower);
    if (m && (at < 0 || m.index < at)) at = m.index + m[1]!.length;
  }
  if (at < 0) return flat.slice(0, width) + (flat.length > width ? "…" : "");
  const start = Math.max(0, at - 80);
  const end = Math.min(flat.length, start + width);
  return (start > 0 ? "…" : "") + flat.slice(start, end) + (end < flat.length ? "…" : "");
}

export function parseHit(row: unknown, q: string): DocumentHit | null {
  const r = obj(row);
  const d = obj(r?.["d"]);
  const id = str(r?.["id"], 40);
  const title = str(r?.["title"], 400);
  const text = typeof r?.["text"] === "string" ? (r["text"] as string) : null;
  const url = courtUrl(d?.["url"]);
  if (!r || !d || !id || !DOC_ID.test(id) || !title || !text || !url) return null;
  const judges = (Array.isArray(d["judges"]) ? d["judges"] : [])
    .map((x) => str(obj(x)?.["id"], 160))
    .filter((x): x is string => !!x && PAGE_ID.test(x));
  const dated = (Array.isArray(d["judges"]) ? d["judges"] : [])
    .map((x) => str(obj(x)?.["date_text"], 60))
    .find((x): x is string => !!x);
  return {
    id,
    title,
    url,
    fileType: str(d["file_type"], 8),
    snippet: snippet(bodyOf(text, id, title, str(r["sub"], 400)), q),
    judgePageIds: judges,
    dateText: dated ?? null,
  };
}

export const getJudgePractices = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: z.string().regex(JUDGE_ID) }).parse(d))
  .handler(async ({ data }): Promise<{ pages: JudgeCourtPage[]; dropped: number }> => {
    const r = await restGet<{ id: unknown; p: unknown }[]>(judgePagesPath(data.id));
    const pages = r.rows
      .map((row) => parseJudgePage(row.p))
      .filter((p): p is JudgeCourtPage => !!p);
    // the build links a page to a profile only on a unique exact match; a stored row that names another profile is not shown
    const ok = pages.filter((p) => p.profileId === data.id);
    return { pages: ok, dropped: r.rows.length - ok.length };
  });

export const getCourtJudgeRoster = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: z.string().regex(COURT_ID) }).parse(d))
  .handler(async ({ data }): Promise<CourtRoster> => {
    const [roster, cover] = await Promise.all([
      restGet<{ id: unknown; r: unknown }[]>(rosterPath(data.id)),
      restGet<{ id: unknown; c: unknown }[]>(coveragePath(data.id)),
    ]);
    const judges = roster.rows
      .map((row) => parseRosterJudge(row.r))
      .filter((j): j is RosterJudge => !!j);
    const coverage = cover.rows.length === 1 ? parseCoverage(cover.rows[0]!.c, data.id) : null;
    return { coverage, judges, dropped: roster.rows.length - judges.length };
  });

export const searchJudgePracticeDocuments = createServerFn({ method: "GET" })
  .inputValidator((d) =>
    z
      .object({
        pages: z.array(z.string().regex(PAGE_ID)).min(1).max(12),
        q: z.string().min(2).max(200),
        offset: z.number().int().min(0).max(2000),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<DocumentHits> => {
    const path = documentSearchPath(data.pages, data.q);
    if (!path) return { hits: [], total: 0 };
    const limit = 10;
    const r = await restGet<unknown[]>(path, {
      count: true,
      range: [data.offset, data.offset + limit - 1],
    });
    const hits = r.rows.map((row) => parseHit(row, data.q)).filter((h): h is DocumentHit => !!h);
    return { hits, total: r.total };
  });
