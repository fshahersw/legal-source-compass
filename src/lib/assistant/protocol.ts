/** Request and stream-event contract between the assistant panel and /api/assistant. Shared by client and server. */
import { z } from "zod";
import { sectionContextSchema } from "./sectionContext";

export const MEMORY_MESSAGES = 8;
export const MAX_ROUNDS = 23;
export const MAX_MESSAGE_CHARS = 8000;
export const MAX_PAGE_TEXT = 14000;
export const MAX_ATTACHMENTS = 3;
export const MAX_ATTACHMENT_BYTES = 6 * 1024 * 1024;

export const ATTACHMENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "text/csv",
  "text/markdown",
  "application/json",
] as const;

const message = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string().min(1).max(MAX_MESSAGE_CHARS),
  })
  .strict();

const attachment = z
  .object({
    name: z.string().min(1).max(200),
    type: z.enum(ATTACHMENT_TYPES),
    /** Base64 without a data: prefix. */
    data: z
      .string()
      .min(1)
      .max(Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3) + 8)
      .regex(/^[A-Za-z0-9+/=]+$/),
  })
  .strict();

export const pageContextSchema = z
  .object({
    path: z.string().max(600),
    title: z.string().max(300),
    headings: z.array(z.string().max(200)).max(40),
    text: z.string().max(MAX_PAGE_TEXT),
    selection: z.string().max(3000),
    focus: z.string().max(300),
    dialog: z.string().max(3000),
    viewport: z.string().max(40),
  })
  .strict();

export const assistantRequestSchema = z
  .object({
    messages: z
      .array(message)
      .min(1)
      .max(MEMORY_MESSAGES)
      .refine((m) => m[m.length - 1]!.role === "user", "The last message must be the user's."),
    page: pageContextSchema.nullable(),
    /** The section the user attached with "Ask AI" (its figures, period and source); absent for an ordinary question. */
    section: sectionContextSchema.nullish(),
    attachments: z.array(attachment).max(MAX_ATTACHMENTS),
  })
  .strict();

export type AssistantMessage = z.infer<typeof message>;
export type AssistantAttachment = z.infer<typeof attachment>;
export type PageContext = z.infer<typeof pageContextSchema>;
export type AssistantRequest = z.infer<typeof assistantRequestSchema>;

/** A step the agent took, phrased for people; tool and vendor names never appear. */
export type AssistantStep = {
  id: string;
  label: string;
  detail: string;
  state: "running" | "done" | "failed";
};
export type AssistantSource = { title: string; url: string; internal: boolean };

/** What kind of legal citation was checked. */
export type CitationKind = "case" | "usc" | "cfr" | "statute" | "public_law" | "federal_register";
/**
 * found: resolves to a real decision or provision (it does not show that the source supports the statement);
 * ambiguous: matches more than one decision; not_found: no match at the source checked; unverified: could not be checked.
 */
export type CitationStatus = "found" | "ambiguous" | "not_found" | "unverified";
export type CitationMatch = {
  title: string | null;
  court: string | null;
  date: string | null;
  clusterId: number | null;
  url: string | null;
};
export type CheckedCitation = {
  /** The citation as written in the checked text (whitespace collapsed). */
  citation: string;
  /** The form that was looked up, e.g. "576 U.S. 644" or "21 C.F.R. § 101.9". */
  normalized: string;
  kind: CitationKind;
  status: CitationStatus;
  /** Plain-language reason for the status, naming the source that was checked. */
  reason: string;
  /** Case name or the official heading, exactly as the source returned it. */
  title: string | null;
  court: string | null;
  date: string | null;
  clusterId: number | null;
  /** The decision page or the official document the citation resolved to (or the lookup address when it did not). */
  url: string | null;
  /** Every link checked, labelled ("Decision", "eCFR (current)", "2025 annual edition", "Lookup"). */
  links: { label: string; url: string }[];
  /**
   * Status the source returned for this citation: the case-law lookup's per-citation code (200 found, 300 several,
   * 404 not found, 400 unknown reporter) or the official link service's HTTP status (302 resolved, 400 no match).
   */
  httpStatus: number | null;
  /** Candidate decisions for an ambiguous case citation. */
  matches: CitationMatch[];
};
/** The citation check attached to an answer: every citation found in the answer text, none dropped. */
export type CitationCheck = {
  total: number;
  counts: Record<CitationStatus, number>;
  items: CheckedCitation[];
  /** Citations beyond the per-answer limit, counted but not listed or checked. */
  more: number;
  checkedAt: string;
};

export type AssistantEvent =
  | { type: "round"; round: number }
  | { type: "step"; step: AssistantStep }
  | { type: "delta"; round: number; text: string }
  | {
      type: "done";
      text: string;
      sources: AssistantSource[];
      rounds: number;
      /** Present when the answer cites cases, statutes or regulations. */
      citation_check?: CitationCheck | null;
    }
  | { type: "error"; message: string };

const CITATION_STATUSES: CitationStatus[] = ["found", "ambiguous", "not_found", "unverified"];
const CITATION_KINDS: CitationKind[] = [
  "case",
  "usc",
  "cfr",
  "statute",
  "public_law",
  "federal_register",
];
const shortText = (v: unknown, n: number): string | null =>
  typeof v === "string" && v.trim() ? v.slice(0, n) : null;
const safeUrl = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
};
/** A page of this site ("/law/uscode/42/1983"); never protocol-relative. */
const appPath = (v: unknown): string | null =>
  typeof v === "string" && /^\/(?!\/)[A-Za-z0-9/_.~%-]{1,300}$/.test(v) ? v : null;
const intOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;

function sanitizeMatch(raw: unknown): CitationMatch | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  return {
    title: shortText(m["title"], 300),
    court: shortText(m["court"], 200),
    date: shortText(m["date"], 40),
    clusterId: intOrNull(m["clusterId"]),
    url: safeUrl(m["url"]),
  };
}

/**
 * A citation check read back from the stream or from browser storage: unknown shapes are dropped, text is bounded and only
 * http(s) links survive. Counts are recomputed from the items so the summary always matches the list.
 */
export function sanitizeCitationCheck(raw: unknown): CitationCheck | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r["items"])) return null;
  const items: CheckedCitation[] = [];
  for (const x of r["items"].slice(0, 120)) {
    if (!x || typeof x !== "object") continue;
    const c = x as Record<string, unknown>;
    const citation = shortText(c["citation"], 400);
    const status = CITATION_STATUSES.find((s) => s === c["status"]);
    const kind = CITATION_KINDS.find((k) => k === c["kind"]);
    if (!citation || !status || !kind) continue;
    items.push({
      citation,
      normalized: shortText(c["normalized"], 400) ?? citation,
      kind,
      status,
      reason: shortText(c["reason"], 400) ?? "",
      title: shortText(c["title"], 300),
      court: shortText(c["court"], 200),
      date: shortText(c["date"], 40),
      clusterId: intOrNull(c["clusterId"]),
      url: safeUrl(c["url"]),
      links: Array.isArray(c["links"])
        ? c["links"]
            .slice(0, 6)
            .map((l) => {
              const o = (l ?? {}) as Record<string, unknown>;
              const url = safeUrl(o["url"]) ?? appPath(o["url"]);
              const label = shortText(o["label"], 60);
              return url && label ? { label, url } : null;
            })
            .filter((l): l is { label: string; url: string } => !!l)
        : [],
      httpStatus: intOrNull(c["httpStatus"]),
      matches: Array.isArray(c["matches"])
        ? c["matches"]
            .slice(0, 10)
            .map(sanitizeMatch)
            .filter((m): m is CitationMatch => !!m)
        : [],
    });
  }
  const counts = { found: 0, ambiguous: 0, not_found: 0, unverified: 0 };
  for (const i of items) counts[i.status] += 1;
  const more = intOrNull(r["more"]) ?? 0;
  if (!items.length && !more) return null;
  return {
    total: items.length,
    counts,
    items,
    more,
    checkedAt: shortText(r["checkedAt"], 40) ?? "",
  };
}

/** "4 citations checked · 1 not found" — the one-line summary shown under an answer and in the step list. */
export function citationSummary(check: Pick<CitationCheck, "total" | "counts" | "more">): string {
  const { total, counts, more } = check;
  const parts = [`${total} citation${total === 1 ? "" : "s"} checked`];
  if (counts.not_found) parts.push(`${counts.not_found} not found`);
  if (counts.ambiguous) parts.push(`${counts.ambiguous} ambiguous`);
  if (counts.unverified) parts.push(`${counts.unverified} could not be checked`);
  if (parts.length === 1 && total) parts.push(total === 1 ? "found" : "all found");
  if (more) parts.push(`${more} more not checked`);
  return parts.join(" · ");
}

export function encodeEvent(event: AssistantEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/** Keep only the rolling memory the server accepts: the last eight messages, ending with the user's. */
export function rollingMemory(messages: AssistantMessage[]): AssistantMessage[] {
  const trimmed = messages
    .filter((m) => m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) }));
  let tail = trimmed.slice(-MEMORY_MESSAGES);
  while (tail.length && tail[0]!.role !== "user") tail = tail.slice(1);
  return tail;
}
