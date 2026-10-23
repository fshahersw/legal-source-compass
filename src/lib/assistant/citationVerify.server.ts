/**
 * Citation verification for the assistant. Case citations are looked up in the free case-law archive's citation-lookup API
 * (one batched request, at most 60 citations a minute) with the court added from one batched search; U.S.C., C.F.R., Statutes
 * at Large, public law and Federal Register citations are resolved at the official publishers (GovInfo link service, eCFR),
 * which need no key, and U.S.C. sections first against the stored current Code from the Law Revision Counsel. Every citation gets a status and a reason; nothing is guessed, and a citation that could not be checked
 * says so. Results are cached in this server process for a few hours so a conversation does not look the same cite up twice.
 */
import { restGet } from "@/lib/external/rest.server";
import { extractCitations, uniqueCitations, type ExtractedCitation } from "./citations";
import {
  citationSummary,
  type CheckedCitation,
  type CitationCheck,
  type CitationMatch,
  type CitationStatus,
} from "./protocol";
import { pageWindow } from "./textWindow";
import type { ToolDefinition, ToolOutcome } from "./tools.server";

const CL_SITE = "https://www.courtlistener.com";
const CL_API = `${CL_SITE}/api/rest/v4`;
const GOVINFO = "https://www.govinfo.gov";
const ECFR = "https://www.ecfr.gov";
const USER_AGENT = "LegalSourceAtlas/1.0 (research)";

/** The case-law lookup validates at most 60 citations a minute (and 250 per request). */
const LOOKUPS_PER_MINUTE = 60;
/** Headroom under the account's general limit (25 requests a minute, shared with other uses). */
const CASE_LAW_CALLS_PER_MINUTE = 15;
/** At most this many distinct citations are looked up per check. */
export const MAX_CHECKED = 40;
/** At most this many distinct citations are listed per answer. */
export const MAX_LISTED = 60;
const CACHE_TTL = 6 * 60 * 60 * 1000;
const CACHE_MAX = 1500;
const PROBE_TIMEOUT = 12000;

type CachedResult = Omit<CheckedCitation, "citation">;

const state = {
  lookups: [] as { at: number; n: number }[],
  calls: [] as number[],
  blockedUntil: 0,
  hostSpacingMs: 500,
  hostNext: new Map<string, number>(),
  cache: new Map<string, { at: number; value: CachedResult }>(),
  opinions: new Map<string, { at: number; doc: OpinionDoc }>(),
};

/** Test hook: forget limits, caches and spacing state; optionally change the per-host spacing. */
export function __resetCitationState(hostSpacingMs = 500) {
  state.lookups = [];
  state.calls = [];
  state.blockedUntil = 0;
  state.hostSpacingMs = hostSpacingMs;
  state.hostNext.clear();
  state.cache.clear();
  state.opinions.clear();
}

function caseLawKey(): string | null {
  const v = process.env["COURTLISTENER_API_KEY"];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
export const caseLawConfigured = () => !!caseLawKey();

class LookupUnavailable extends Error {}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("aborted"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new Error("aborted"));
      },
      { once: true },
    );
  });

/** A signal that aborts with `signal` or after `ms`, without relying on AbortSignal.any (not in every edge runtime). */
function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, ms);
  controller.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  return controller.signal;
}

/** Official hosts get at most two requests a second from this process. */
async function politeFetch(url: string, init: RequestInit, signal?: AbortSignal) {
  const host = new URL(url).host;
  const now = Date.now();
  const at = Math.max(now, state.hostNext.get(host) ?? 0);
  state.hostNext.set(host, at + state.hostSpacingMs);
  if (at > now) await sleep(at - now, signal);
  return fetch(url, {
    ...init,
    headers: { "user-agent": USER_AGENT, ...(init.headers as Record<string, string>) },
    signal: withTimeout(signal, PROBE_TIMEOUT),
  });
}

function pruneWindows(now: number) {
  state.lookups = state.lookups.filter((l) => now - l.at < 60_000);
  state.calls = state.calls.filter((t) => now - t < 60_000);
}

const timeOf = (ms: number) => new Date(ms).toISOString().slice(11, 16);

/** One request to the case-law archive, inside the per-minute budget; a 429 pauses all lookups until its wait time. */
async function caseLawFetch(path: string, init: RequestInit, signal?: AbortSignal) {
  const key = caseLawKey();
  if (!key) throw new LookupUnavailable("Case-law lookup is not configured on this server.");
  const now = Date.now();
  pruneWindows(now);
  if (now < state.blockedUntil)
    throw new LookupUnavailable(
      `Not checked: the case-law lookup asked to wait until ${timeOf(state.blockedUntil)} UTC.`,
    );
  if (state.calls.length >= CASE_LAW_CALLS_PER_MINUTE)
    throw new LookupUnavailable(
      "Not checked: too many case-law lookups this minute. Ask again shortly.",
    );
  state.calls.push(now);
  const res = await fetch(`${CL_API}${path}`, {
    ...init,
    headers: {
      authorization: `Token ${key}`,
      "user-agent": USER_AGENT,
      accept: "application/json",
      ...(init.headers as Record<string, string>),
    },
    signal: withTimeout(signal, 25000),
  });
  if (res.status === 429) {
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    const until = Date.parse(String(body?.["wait_until"] ?? body?.["wait_util"] ?? ""));
    state.blockedUntil = Number.isFinite(until) ? until : now + 60_000;
    throw new LookupUnavailable(
      `Not checked: the case-law lookup asked to wait until ${timeOf(state.blockedUntil)} UTC.`,
    );
  }
  return res;
}

function reasonOf(error: unknown, fallback: string): string {
  if (error instanceof LookupUnavailable) return error.message;
  if (error instanceof Error && /abort|timeout/i.test(`${error.name} ${error.message}`))
    return "Not checked: the source did not answer in time.";
  return fallback;
}

function base(c: ExtractedCitation): CheckedCitation {
  return {
    citation: c.text,
    normalized: c.normalized,
    kind: c.kind,
    status: "unverified",
    reason: "",
    title: null,
    court: null,
    date: null,
    clusterId: null,
    url: null,
    links: [],
    httpStatus: null,
    matches: [],
  };
}
const unverified = (c: ExtractedCitation, reason: string): CheckedCitation => ({
  ...base(c),
  reason,
});

// ---------------------------------------------------------------------------------------------------------------------
// Case citations

type Cluster = {
  id?: unknown;
  absolute_url?: unknown;
  case_name?: unknown;
  date_filed?: unknown;
  date_filed_is_approximate?: unknown;
  blocked?: unknown;
  citations?: unknown;
};
type LookupRow = {
  citation?: unknown;
  normalized_citations?: unknown;
  start_index?: unknown;
  status?: unknown;
  error_message?: unknown;
  clusters?: unknown;
};

const clusterUrl = (path: unknown) =>
  typeof path === "string" && /^\/opinion\/\d+\/[\w-]*\/?$/.test(path) ? `${CL_SITE}${path}` : null;

function clusterMatch(cl: Cluster): CitationMatch {
  const id = typeof cl.id === "number" && Number.isInteger(cl.id) ? cl.id : null;
  // Decisions the archive withholds from public listings keep their link but not their name here.
  const hidden = cl.blocked === true;
  return {
    title: !hidden && typeof cl.case_name === "string" ? cl.case_name.slice(0, 300) : null,
    court: null,
    date:
      typeof cl.date_filed === "string" && /^\d{4}-\d{2}-\d{2}$/.test(cl.date_filed)
        ? cl.date_filed
        : null,
    clusterId: id,
    url: clusterUrl(cl.absolute_url) ?? (id ? `${CL_SITE}/opinion/${id}/` : null),
  };
}

/** Parse the citation-lookup response for the citations sent; each is matched by where it sat in the request text. */
export function parseCaseLookup(
  sent: { c: ExtractedCitation; start: number; end: number }[],
  rows: unknown,
): Map<string, CheckedCitation> {
  const out = new Map<string, CheckedCitation>();
  const list = Array.isArray(rows) ? (rows as LookupRow[]) : [];
  for (const s of sent) {
    const row = list.find(
      (r) => typeof r.start_index === "number" && r.start_index >= s.start && r.start_index < s.end,
    );
    const item = base(s.c);
    if (!row) {
      out.set(s.c.key, {
        ...item,
        status: "not_found",
        reason: "The case-law database did not recognize this as a case citation.",
      });
      continue;
    }
    const code = typeof row.status === "number" ? row.status : null;
    const normalized =
      Array.isArray(row.normalized_citations) && typeof row.normalized_citations[0] === "string"
        ? row.normalized_citations.slice(0, 3).join(" / ")
        : s.c.normalized;
    const clusters = Array.isArray(row.clusters) ? (row.clusters as Cluster[]) : [];
    const matches = clusters.slice(0, 10).map(clusterMatch);
    const common = { ...item, normalized, httpStatus: code };
    if (code === 200 && matches[0]) {
      const m = matches[0];
      const approximate = clusters[0]?.date_filed_is_approximate === true;
      out.set(s.c.key, {
        ...common,
        status: "found",
        reason: `Found in the case-law database${approximate ? " (filing date approximate)" : ""}.${
          m.title ? "" : " The archive withholds the case name from public listings."
        }`,
        title: m.title,
        date: m.date,
        clusterId: m.clusterId,
        url: m.url,
        links: m.url ? [{ label: "Decision", url: m.url }] : [],
        matches: [m],
      });
    } else if (code === 300 && matches.length) {
      out.set(s.c.key, {
        ...common,
        status: "ambiguous",
        reason: `Matches ${matches.length} decisions in the case-law database; the citation alone does not say which.`,
        matches,
        links: matches
          .filter((m) => m.url)
          .slice(0, 5)
          .map((m) => ({ label: m.title ?? "Decision", url: m.url! })),
      });
    } else if (code === 404 || (code === 200 && !matches.length)) {
      out.set(s.c.key, {
        ...common,
        status: "not_found",
        reason: "No decision with this citation in the case-law database.",
      });
    } else if (code === 400) {
      out.set(s.c.key, {
        ...common,
        status: "not_found",
        reason: "The case-law database does not recognize this reporter abbreviation.",
      });
    } else {
      out.set(s.c.key, {
        ...common,
        status: "unverified",
        reason: "Not checked: the case-law lookup skipped this citation.",
      });
    }
  }
  return out;
}

/** Court names for decisions, from one search request over their ids. */
async function courtsFor(ids: number[], signal?: AbortSignal): Promise<Map<number, string>> {
  const courts = new Map<number, string>();
  if (!ids.length) return courts;
  const q = `cluster_id:(${ids.slice(0, 20).join(" OR ")})`;
  const res = await caseLawFetch(
    `/search/?${new URLSearchParams({ type: "o", q })}`,
    { method: "GET" },
    signal,
  );
  if (!res.ok) return courts;
  const body = (await res.json().catch(() => null)) as {
    results?: Record<string, unknown>[];
  } | null;
  for (const r of body?.results ?? []) {
    const id = r["cluster_id"];
    const court = r["court"];
    if (typeof id === "number" && typeof court === "string" && court.trim())
      courts.set(id, court.slice(0, 200));
  }
  return courts;
}

async function lookupCases(
  cites: ExtractedCitation[],
  signal?: AbortSignal,
): Promise<Map<string, CheckedCitation>> {
  const out = new Map<string, CheckedCitation>();
  if (!cites.length) return out;
  if (!caseLawKey()) {
    for (const c of cites)
      out.set(
        c.key,
        unverified(c, "Not checked: case-law lookup is not configured on this server."),
      );
    return out;
  }
  const now = Date.now();
  pruneWindows(now);
  const used = state.lookups.reduce((n, l) => n + l.n, 0);
  const room = Math.max(0, Math.min(LOOKUPS_PER_MINUTE - used, 250));
  const send = cites.slice(0, room);
  for (const c of cites.slice(room))
    out.set(
      c.key,
      unverified(
        c,
        "Not checked: the case-law lookup takes 60 citations a minute. Ask again in a minute.",
      ),
    );
  if (!send.length) return out;
  let text = "";
  const sent = send.map((c) => {
    const start = text.length;
    text += c.normalized;
    const item = { c, start, end: text.length };
    text += "\n\n";
    return item;
  });
  // Counted before the request so two checks running at once cannot both spend the same minute's allowance.
  state.lookups.push({ at: now, n: send.length });
  try {
    const res = await caseLawFetch(
      "/citation-lookup/",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ text }).toString(),
      },
      signal,
    );
    if (!res.ok) {
      for (const s of sent)
        out.set(
          s.c.key,
          unverified(s.c, `Not checked: the case-law lookup returned HTTP ${res.status}.`),
        );
      return out;
    }
    const parsed = parseCaseLookup(sent, await res.json());
    const ids = [...parsed.values()].flatMap((r) =>
      r.matches.map((m) => m.clusterId).filter((id): id is number => id !== null),
    );
    const courts = await courtsFor([...new Set(ids)], signal).catch(
      () => new Map<number, string>(),
    );
    for (const [key, r] of parsed) {
      const matches = r.matches.map((m) => ({
        ...m,
        court: m.clusterId !== null ? (courts.get(m.clusterId) ?? null) : null,
      }));
      out.set(key, {
        ...r,
        matches,
        court: r.status === "found" ? (matches[0]?.court ?? null) : null,
      });
    }
  } catch (error) {
    for (const s of sent)
      if (!out.has(s.c.key))
        out.set(
          s.c.key,
          unverified(s.c, reasonOf(error, "Not checked: the case-law lookup failed.")),
        );
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Statutes and regulations

type Probe = {
  state: "resolved" | "missing" | "unknown";
  status: number | null;
  location: string | null;
};

/** Ask the link service where a citation lives without downloading it: 302 to a GovInfo document, or 400/404. */
async function probeLink(url: string, signal?: AbortSignal): Promise<Probe> {
  try {
    const res = await politeFetch(url, { redirect: "manual" }, signal);
    await res.body?.cancel().catch(() => undefined);
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location?.startsWith(`${GOVINFO}/`))
      return { state: "resolved", status: res.status, location };
    if (res.status === 400 || res.status === 404)
      return { state: "missing", status: res.status, location: null };
    return { state: "unknown", status: res.status, location: null };
  } catch {
    return { state: "unknown", status: null, location: null };
  }
}

type EcfrNode = {
  state: "present" | "absent" | "unknown";
  label: string | null;
  reserved: boolean;
};

async function ecfrNode(
  title: number,
  query: { part?: number; section?: string },
  signal?: AbortSignal,
): Promise<EcfrNode> {
  const params = query.section
    ? `section=${encodeURIComponent(query.section)}`
    : `part=${query.part}`;
  try {
    const res = await politeFetch(
      `${ECFR}/api/versioner/v1/ancestry/current/title-${title}.json?${params}`,
      { headers: { accept: "application/json" } },
      signal,
    );
    if (res.status === 404) {
      await res.body?.cancel().catch(() => undefined);
      return { state: "absent", label: null, reserved: false };
    }
    if (!res.ok) return { state: "unknown", label: null, reserved: false };
    const body = (await res.json().catch(() => null)) as {
      ancestors?: { label?: string; reserved?: boolean; type?: string }[];
    } | null;
    const node = body?.ancestors?.at(-1);
    if (!node) return { state: "unknown", label: null, reserved: false };
    return {
      state: "present",
      label: typeof node.label === "string" ? node.label.trim().slice(0, 300) : null,
      reserved: node.reserved === true,
    };
  } catch {
    return { state: "unknown", label: null, reserved: false };
  }
}

const editionOf = (location: string | null, prefix: string) =>
  location?.match(new RegExp(`${prefix}-(\\d{4})-`))?.[1] ?? null;

/** Link-service and eCFR addresses for one statutory citation (start, and the end of a range). Pure; exported for tests. */
export function officialLookups(
  c: ExtractedCitation,
): { link: string; ecfr?: string; ecfrPage?: string }[] {
  const enc = encodeURIComponent;
  switch (c.kind) {
    case "usc":
      return [c.section!, ...(c.sectionEnd ? [c.sectionEnd] : [])].map((s) => ({
        link: `${GOVINFO}/link/uscode/${c.title}/${enc(s)}?year=mostrecent&link-type=html`,
      }));
    case "cfr": {
      if (c.section) {
        const ends = [`${c.part}.${c.section}`, ...(c.sectionEnd ? [c.sectionEnd] : [])];
        return ends.map((full) => {
          const [part, ...rest] = full.split(".");
          const sec = rest.join(".");
          return {
            link: `${GOVINFO}/link/cfr/${c.title}/${part}?sectionnum=${enc(sec)}&year=mostrecent&link-type=pdf`,
            ecfr: full,
            ecfrPage: `${ECFR}/current/title-${c.title}/section-${full}`,
          };
        });
      }
      return [String(c.part), ...(c.sectionEnd ? [c.sectionEnd] : [])].map((p) => ({
        link: `${GOVINFO}/link/cfr/${c.title}/${p}?year=mostrecent&link-type=pdf`,
        ecfr: `part:${p}`,
        ecfrPage: `${ECFR}/current/title-${c.title}/part-${p}`,
      }));
    }
    case "statute":
      return [{ link: `${GOVINFO}/link/statute/${c.volume}/${c.page}?link-type=pdf` }];
    case "public_law":
      return [{ link: `${GOVINFO}/link/plaw/${c.congress}/public/${c.law}?link-type=pdf` }];
    case "federal_register":
      return [{ link: `${GOVINFO}/link/fr/${c.volume}/${c.page}?link-type=pdf` }];
    default:
      return [];
  }
}

const COLLECTION: Record<string, string> = {
  usc: "U.S. Code",
  statute: "Statutes at Large",
  public_law: "public laws",
  federal_register: "Federal Register",
};

async function resolveLinkOnly(
  c: ExtractedCitation,
  signal?: AbortSignal,
): Promise<CheckedCitation> {
  const item = base(c);
  const lookups = officialLookups(c);
  const probes = await Promise.all(lookups.map((l) => probeLink(l.link, signal)));
  const where = COLLECTION[c.kind] ?? "official sources";
  const first = probes[0]!;
  const links = probes.flatMap((p, i) =>
    p.location
      ? [
          {
            label: lookups.length > 1 ? (i ? "Range end" : "Range start") : "Official text",
            url: p.location,
          },
        ]
      : [{ label: "Lookup", url: lookups[i]!.link }],
  );
  const edition = c.kind === "usc" ? editionOf(first.location, "USCODE") : null;
  if (probes.every((p) => p.state === "resolved"))
    return {
      ...item,
      status: "found",
      reason: `Resolved by the official GovInfo link service${edition ? ` to the ${edition} edition of the U.S. Code` : ` (${where})`}.`,
      url: first.location,
      links,
      httpStatus: first.status,
    };
  const missing = probes.findIndex((p) => p.state === "missing");
  if (missing >= 0)
    return {
      ...item,
      status: "not_found",
      reason: `No match in the ${where} at the official GovInfo link service${
        lookups.length > 1 ? ` (${missing ? "range end" : "range start"})` : ""
      }${c.kind === "usc" ? " (latest edition; sections enacted since may be missing)" : ""}.`,
      url: lookups[missing]!.link,
      links,
      httpStatus: probes[missing]!.status,
    };
  const unknown = probes.find((p) => p.state === "unknown")!;
  return {
    ...item,
    status: "unverified",
    reason: `Not checked: the official GovInfo link service did not answer${unknown.status ? ` (HTTP ${unknown.status})` : ""}.`,
    url: lookups[0]!.link,
    links,
    httpStatus: unknown.status,
  };
}

/** One stored section of the current U.S. Code (us_code_sections), as the Law Revision Counsel publishes it. */
type StoredUsc = {
  citation: string;
  heading: string | null;
  status: string | null;
  url: string | null;
  release: string | null;
  lawDate: string | null;
};
const USC_STATUS = new Set([
  "repealed",
  "omitted",
  "transferred",
  "renumbered",
  "reserved",
  "vacant",
]);
const OLRC_URL = /^https:\/\/uscode\.house\.gov\/[^\s"<>]{1,500}$/;

/** The cited sections found in the stored current Code, by section number; null when the corpus cannot be read. */
async function storedUscSections(
  title: number,
  sections: string[],
): Promise<Map<string, StoredUsc> | null> {
  const s = (v: unknown, n: number) =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null;
  try {
    const ids = sections.map((sec) => `${title}:${sec}`);
    const r = await restGet<Record<string, unknown>[]>(
      `corpus_records?select=id,citation:detail->usc->>citation,heading:detail->usc->>heading,status:detail->usc->>status,url:detail->usc->>url,release:detail->usc->>release,law_date:detail->usc->>law_date&dataset=eq.us_code_sections&id=in.(${ids
        .map((id) => encodeURIComponent(`"${id}"`))
        .join(",")})`,
    );
    const out = new Map<string, StoredUsc>();
    for (const row of r.rows) {
      const id = s(row["id"], 200);
      const citation = s(row["citation"], 300);
      const sec = id && ids.includes(id) ? id.slice(id.indexOf(":") + 1) : null;
      if (!sec || !citation) continue;
      const status = s(row["status"], 20);
      const url = s(row["url"], 600);
      out.set(sec, {
        citation,
        heading: s(row["heading"], 600),
        status: status && USC_STATUS.has(status) ? status : null,
        url: url && OLRC_URL.test(url) ? url : null,
        release: s(row["release"], 20),
        lawDate: s(row["law_date"], 10),
      });
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * U.S.C. citations are checked against the stored current Code first (it runs ahead of GovInfo's latest annual edition), then
 * at the GovInfo link service. A section the current Code marks repealed or transferred is found, with that status stated.
 */
async function resolveUsc(c: ExtractedCitation, signal?: AbortSignal): Promise<CheckedCitation> {
  const sections = [c.section!, ...(c.sectionEnd ? [c.sectionEnd] : [])];
  const stored = await storedUscSections(c.title!, sections);
  const units = stored ? sections.map((sec) => stored.get(sec) ?? null) : [];
  if (stored && units.every((u) => u !== null)) {
    const found = units as StoredUsc[];
    const first = found[0]!;
    const marked = found.filter((u) => u.status).map((u) => `${u.citation} is marked ${u.status}`);
    return {
      ...base(c),
      status: "found",
      reason: `Found in the current U.S. Code as the Office of the Law Revision Counsel publishes it (release point ${
        first.release ?? "not recorded"
      }${first.lawDate ? `, current through ${first.lawDate}` : ""})${marked.length ? `; ${marked.join("; ")}` : ""}.`,
      title: first.heading,
      url: first.url,
      links: found.flatMap((u, i) => {
        const label =
          found.length > 1 ? (i ? "Range end" : "Range start") : "Official text (current)";
        const page = `/law/uscode/${c.title}/${encodeURIComponent(sections[i]!)}`;
        return [
          ...(u.url ? [{ label, url: u.url }] : []),
          { label: found.length > 1 ? `${label}: section page` : "Section page", url: page },
        ];
      }),
    };
  }
  const official = await resolveLinkOnly(c, signal);
  if (!stored) return official;
  const absent = sections.filter((_, i) => !units[i]).map((sec) => `${c.title} U.S.C. § ${sec}`);
  return {
    ...official,
    reason: `${official.reason} Not in the current U.S. Code text stored in this workspace: ${absent.join(", ")}${
      official.status === "found"
        ? " (it may have been repealed or renumbered since that edition)"
        : ""
    }.`,
  };
}

async function resolveCfr(c: ExtractedCitation, signal?: AbortSignal): Promise<CheckedCitation> {
  const item = base(c);
  const lookups = officialLookups(c);
  const parts = await Promise.all(
    lookups.map(async (l) => {
      const [probe, node] = await Promise.all([
        probeLink(l.link, signal),
        ecfrNode(
          c.title!,
          l.ecfr!.startsWith("part:") ? { part: Number(l.ecfr!.slice(5)) } : { section: l.ecfr! },
          signal,
        ),
      ]);
      return { l, probe, node };
    }),
  );
  // Unresolved lookups keep their address so the "no results" answer can be seen at the source.
  const links = parts.flatMap(({ l, probe, node }) => [
    ...(node.state === "present" ? [{ label: "eCFR (current)", url: l.ecfrPage! }] : []),
    probe.location
      ? {
          label: `${editionOf(probe.location, "CFR") ?? "Latest"} annual edition`,
          url: probe.location,
        }
      : { label: "Lookup", url: l.link },
  ]);
  const verdicts = parts.map(({ probe, node }) => {
    const edition = editionOf(probe.location, "CFR");
    if (node.state === "present")
      return {
        status: "found" as CitationStatus,
        reason: node.reserved
          ? "In the current eCFR, but marked [Reserved]: there is no rule text at this number."
          : `In the current eCFR${edition ? ` and the ${edition} annual edition` : ""}.`,
      };
    if (node.state === "absent")
      return {
        status: "not_found" as CitationStatus,
        reason:
          probe.state === "resolved"
            ? `Not in the current eCFR; the ${edition ?? "latest"} annual edition has it, so it may have been removed or renumbered since.`
            : "Not in the current eCFR or the latest annual edition.",
      };
    if (probe.state === "resolved")
      return {
        status: "found" as CitationStatus,
        reason: `In the ${edition ?? "latest"} annual edition; the current eCFR could not be checked.`,
      };
    return {
      status: "unverified" as CitationStatus,
      reason:
        probe.state === "missing"
          ? "Not in the latest annual edition, and the current eCFR could not be checked (newer rules are not covered)."
          : "Not checked: the eCFR and the GovInfo link service did not answer.",
    };
  });
  const order: CitationStatus[] = ["not_found", "unverified", "ambiguous", "found"];
  const worst = verdicts.reduce((a, b) =>
    order.indexOf(b.status) < order.indexOf(a.status) ? b : a,
  );
  const first = parts[0]!;
  const heading = first.node.state === "present" ? first.node.label : null;
  return {
    ...item,
    status: worst.status,
    reason:
      verdicts.length > 1 && worst !== verdicts[0] ? `${worst.reason} (range end)` : worst.reason,
    title: heading,
    url:
      first.node.state === "present" ? first.l.ecfrPage! : (first.probe.location ?? first.l.link),
    links,
    httpStatus: first.probe.status,
  };
}

async function resolveOfficial(
  c: ExtractedCitation,
  signal?: AbortSignal,
): Promise<CheckedCitation> {
  if (c.kind === "usc" && (c.title! < 1 || c.title! > 54))
    return {
      ...base(c),
      status: "not_found",
      reason: "The U.S. Code has titles 1 to 54; there is no title by this number.",
    };
  if (c.kind === "cfr" && (c.title! < 1 || c.title! > 50))
    return {
      ...base(c),
      status: "not_found",
      reason:
        "The Code of Federal Regulations has titles 1 to 50; there is no title by this number.",
    };
  if (c.kind === "public_law" && c.congress! < 104)
    return {
      ...base(c),
      status: "unverified",
      reason:
        "Not checked: the official link service covers public laws from the 104th Congress (1995) on. Check the Statutes at Large citation instead.",
    };
  if (c.kind === "cfr") return resolveCfr(c, signal);
  if (c.kind === "usc") return resolveUsc(c, signal);
  return resolveLinkOnly(c, signal);
}

// ---------------------------------------------------------------------------------------------------------------------
// Checking

function cached(key: string, now: number): CachedResult | null {
  const hit = state.cache.get(key);
  if (!hit || now - hit.at > CACHE_TTL) return null;
  return hit.value;
}
function remember(key: string, value: CheckedCitation, now: number) {
  if (value.status === "unverified") return;
  const { citation: _citation, ...rest } = value;
  state.cache.delete(key);
  state.cache.set(key, { at: now, value: rest });
  while (state.cache.size > CACHE_MAX) state.cache.delete(state.cache.keys().next().value!);
}

/**
 * Check citations (de-duplicated, in order). The first `max` are looked up; the rest come back as not checked. Never
 * throws: a failure or the time limit turns the affected citations into "unverified" with the reason.
 */
export async function checkCitations(
  list: ExtractedCitation[],
  opts: { signal?: AbortSignal; timeoutMs?: number; max?: number } = {},
): Promise<CheckedCitation[]> {
  const unique = uniqueCitations(list);
  const max = opts.max ?? MAX_CHECKED;
  const signal = withTimeout(opts.signal, opts.timeoutMs ?? 30000);
  const now = Date.now();
  const results = new Map<string, CheckedCitation>();
  const toCheck: ExtractedCitation[] = [];
  unique.forEach((c, i) => {
    if (i >= max) {
      results.set(
        c.key,
        unverified(c, `Not checked: only the first ${max} citations are checked at once.`),
      );
      return;
    }
    const hit = cached(c.key, now);
    if (hit) results.set(c.key, { ...hit, citation: c.text });
    else toCheck.push(c);
  });
  const cases = toCheck.filter((c) => c.kind === "case");
  const official = toCheck.filter((c) => c.kind !== "case");
  await Promise.all([
    lookupCases(cases, signal)
      .then((found) => found.forEach((v, k) => results.set(k, v)))
      .catch((error) => {
        for (const c of cases)
          results.set(
            c.key,
            unverified(c, reasonOf(error, "Not checked: the case-law lookup failed.")),
          );
      }),
    ...official.map((c) =>
      resolveOfficial(c, signal)
        .then((v) => results.set(c.key, v))
        .catch((error) =>
          results.set(
            c.key,
            unverified(c, reasonOf(error, "Not checked: the official source failed.")),
          ),
        ),
    ),
  ]);
  const done = Date.now();
  return unique.map((c) => {
    const r =
      results.get(c.key) ?? unverified(c, "Not checked: the source did not answer in time.");
    if (toCheck.includes(c)) remember(c.key, r, done);
    return { ...r, citation: c.text };
  });
}

function countsOf(items: CheckedCitation[]): Record<CitationStatus, number> {
  const counts = { found: 0, ambiguous: 0, not_found: 0, unverified: 0 };
  for (const i of items) counts[i.status] += 1;
  return counts;
}

/** The structured check attached to an answer: every distinct citation in it (up to MAX_LISTED), none dropped. */
export async function checkAnswerCitations(
  text: string,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<CitationCheck | null> {
  const unique = uniqueCitations(extractCitations(text, 400));
  if (!unique.length) return null;
  const listed = unique.slice(0, MAX_LISTED);
  const items = await checkCitations(listed, { ...opts, max: MAX_CHECKED });
  return {
    total: items.length,
    counts: countsOf(items),
    items,
    more: unique.length - listed.length,
    checkedAt: new Date().toISOString(),
  };
}

/** Used when the check itself could not run: the citations are still listed, each marked as not checked. */
export function uncheckedAnswer(text: string, reason: string): CitationCheck | null {
  const unique = uniqueCitations(extractCitations(text, 400));
  if (!unique.length) return null;
  const items = unique.slice(0, MAX_LISTED).map((c) => unverified(c, reason));
  return {
    total: items.length,
    counts: countsOf(items),
    items,
    more: unique.length - items.length,
    checkedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Opinion text

type OpinionDoc = {
  title: string | null;
  court: string | null;
  date: string | null;
  citations: string[];
  docket: string | null;
  url: string | null;
  opinions: { id: number; type: string; author: string | null; chars: number }[];
  text: string;
};

const OPINION_TYPES: Record<string, string> = {
  "010combined": "Combined opinion",
  "015unamimous": "Unanimous opinion",
  "020lead": "Lead opinion",
  "025plurality": "Plurality opinion",
  "030concurrence": "Concurrence",
  "035concurrenceinpart": "Concurrence in part",
  "040dissent": "Dissent",
  "050addendum": "Addendum",
  "060remittitur": "Remittitur",
  "070rehearing": "Rehearing",
  "080onthemerits": "On the merits",
  "090onmotiontostrike": "On motion to strike",
  "100trialcourt": "Trial court document",
};
const OPINION_FIELDS =
  "id,absolute_url,cluster_id,type,author_str,per_curiam,ordering_key,html_with_citations,plain_text,html";
const OPINION_TTL = 10 * 60 * 1000;
const OPINION_MAX = 1_500_000;

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  sect: "§",
  para: "¶",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
};

/** Opinion HTML/XML to readable text: block ends become line breaks, tags go, entities are decoded. Exported for tests. */
export function opinionText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(
      /<\/(p|div|h[1-6]|li|blockquote|tr|opinion|author|parties|docketnumber|court|decisiondate|attorneys|headnotes|summary|syllabus|footnote|footnotemark|pre)>/gi,
      "\n\n",
    )
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d{1,6});/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n: string) => NAMED[n.toLowerCase()] ?? m)
    .replace(/[ \t\f\v\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type OpinionRow = {
  id?: unknown;
  absolute_url?: unknown;
  cluster_id?: unknown;
  type?: unknown;
  author_str?: unknown;
  per_curiam?: unknown;
  ordering_key?: unknown;
  html_with_citations?: unknown;
  plain_text?: unknown;
  html?: unknown;
};

const textOf = (o: OpinionRow) => {
  for (const field of [o.html_with_citations, o.html]) {
    if (typeof field === "string" && field.trim()) {
      const t = opinionText(field);
      if (t) return t;
    }
  }
  return typeof o.plain_text === "string" ? o.plain_text.trim() : "";
};

/** Assemble the readable document from the archive's opinion rows and the decision's search metadata. Exported for tests. */
export function buildOpinionDoc(
  rows: OpinionRow[],
  meta: Record<string, unknown> | null,
): OpinionDoc {
  const sorted = [...rows].sort(
    (a, b) =>
      (typeof a.ordering_key === "number" ? a.ordering_key : 999) -
        (typeof b.ordering_key === "number" ? b.ordering_key : 999) ||
      String(a.type ?? "").localeCompare(String(b.type ?? "")),
  );
  const parts: string[] = [];
  const opinions: OpinionDoc["opinions"] = [];
  for (const o of sorted) {
    if (typeof o.id !== "number") continue;
    const type = OPINION_TYPES[String(o.type)] ?? "Opinion";
    const author =
      o.per_curiam === true
        ? "Per curiam"
        : typeof o.author_str === "string" && o.author_str.trim()
          ? o.author_str.trim().slice(0, 120)
          : null;
    const body =
      textOf(o).slice(0, 600_000) || "(No text for this opinion is available in the archive.)";
    parts.push(`[${type}${author ? ` · ${author}` : ""} · opinion ${o.id}]\n\n${body}`);
    opinions.push({ id: o.id, type, author, chars: body.length });
  }
  const firstUrl = sorted.map((o) => clusterUrl(o.absolute_url)).find(Boolean) ?? null;
  const m = meta ?? {};
  return {
    title: typeof m["caseName"] === "string" ? m["caseName"].slice(0, 300) : null,
    court: typeof m["court"] === "string" ? m["court"].slice(0, 200) : null,
    date: typeof m["dateFiled"] === "string" ? m["dateFiled"].slice(0, 10) : null,
    citations: Array.isArray(m["citation"])
      ? (m["citation"] as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 8)
      : [],
    docket: typeof m["docketNumber"] === "string" && m["docketNumber"] ? m["docketNumber"] : null,
    url: clusterUrl(m["absolute_url"]) ?? firstUrl,
    opinions,
    text: parts.join("\n\n").slice(0, OPINION_MAX),
  };
}

async function decisionMeta(clusterId: number, signal?: AbortSignal) {
  const res = await caseLawFetch(
    `/search/?${new URLSearchParams({ type: "o", q: `cluster_id:${clusterId}` })}`,
    { method: "GET" },
    signal,
  );
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as {
    results?: Record<string, unknown>[];
  } | null;
  return body?.results?.find((r) => r["cluster_id"] === clusterId) ?? null;
}

async function loadOpinion(
  ids: { opinion: number | null; cluster: number | null },
  signal?: AbortSignal,
): Promise<OpinionDoc> {
  if (ids.cluster) {
    const [res, meta] = await Promise.all([
      caseLawFetch(
        `/opinions/?${new URLSearchParams({ cluster: String(ids.cluster), fields: OPINION_FIELDS })}`,
        { method: "GET" },
        signal,
      ),
      decisionMeta(ids.cluster, signal).catch(() => null),
    ]);
    if (!res.ok) throw new Error(`the case-law archive returned HTTP ${res.status}`);
    const body = (await res.json()) as { results?: OpinionRow[] };
    const rows = body.results ?? [];
    if (!rows.length) throw new Error(`no opinions found for decision ${ids.cluster}`);
    return buildOpinionDoc(rows, meta);
  }
  const res = await caseLawFetch(
    `/opinions/${ids.opinion}/?${new URLSearchParams({ fields: OPINION_FIELDS })}`,
    { method: "GET" },
    signal,
  );
  if (res.status === 404) throw new Error(`no opinion with id ${ids.opinion}`);
  if (!res.ok) throw new Error(`the case-law archive returned HTTP ${res.status}`);
  const row = (await res.json()) as OpinionRow;
  const cluster = typeof row.cluster_id === "number" ? row.cluster_id : null;
  const meta = cluster ? await decisionMeta(cluster, signal).catch(() => null) : null;
  return buildOpinionDoc([row], meta);
}

// ---------------------------------------------------------------------------------------------------------------------
// Tools

const str = (v: unknown, n = 300) => (typeof v === "string" ? v.slice(0, n) : "");
const posInt = (v: unknown) =>
  typeof v === "number" && Number.isInteger(v) && v > 0 && v < 1e10
    ? v
    : typeof v === "string" && /^\d{1,10}$/.test(v.trim())
      ? Number(v.trim())
      : null;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n…[truncated]` : s);

export const CITATION_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "verify_citations",
    description:
      "Check legal citations before relying on them. Pass the text you plan to cite from, or a list of citations (up to 40 are checked per call). Case citations (U.S., S. Ct., F.3d, F. Supp., F. App'x, regional and state reporters, WL numbers) are looked up in the free case-law archive and come back found, not found or ambiguous, with case name, court, filing date, cluster id and link. U.S.C., C.F.R., Stat., Pub. L. and Fed. Reg. citations are resolved at the official publishers (the GovInfo link service; the current eCFR for C.F.R. sections and parts) and come back resolved or not, with the official URL and HTTP status. Short forms (Id., supra, 576 U.S. at 650) are skipped. A found citation exists; it does not show that the source supports your statement, so read it before relying on it.",
    input_schema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Text containing full citations (up to 20,000 characters).",
        },
        citations: {
          type: "array",
          items: { type: "string" },
          maxItems: 40,
          description: 'Citations, one per item, e.g. "576 U.S. 644" or "21 C.F.R. § 101.9".',
        },
      },
    },
  },
  {
    name: "get_opinion",
    description:
      "Read a court decision's text from the free case-law archive by cluster id (the number in /opinion/<id>/ links and in verify_citations or case-law search results) or by opinion id. Returns case name, court, filing date, citations and every opinion in the decision (lead, concurrences, dissents) as text in windows of about 14,000 characters: the result gives total_chars and next_start; call again with start to continue, or with find to get the passages around each mention of a word or phrase. Read the passage before quoting or characterizing a decision.",
    input_schema: {
      type: "object",
      properties: {
        cluster_id: { type: "integer", minimum: 1 },
        opinion_id: { type: "integer", minimum: 1 },
        start: { type: "integer", minimum: 0, description: "Character offset to read from." },
        find: { type: "string", description: "Word or phrase to locate in the opinion text." },
      },
    },
  },
];

const KIND_LABEL: Record<string, string> = {
  case: "case",
  usc: "U.S.C.",
  cfr: "C.F.R.",
  statute: "Stat.",
  public_law: "Pub. L.",
  federal_register: "Fed. Reg.",
};

async function verifyCitationsTool(input: Record<string, unknown>): Promise<ToolOutcome> {
  const text = str(input["text"], 20000);
  const list = Array.isArray(input["citations"])
    ? (input["citations"] as unknown[]).slice(0, 40).map((c) => str(c, 300))
    : [];
  const source = [text, ...list].filter((s) => s.trim()).join("\n");
  if (!source.trim()) throw new Error("text or citations required");
  const found = uniqueCitations(extractCitations(source, 400));
  if (!found.length)
    return {
      content: JSON.stringify({
        checked: 0,
        citations: [],
        note: "No full citations found. Short forms (Id., supra, 576 U.S. at 650) are not checked; pass the full citation, e.g. 576 U.S. 644 or 42 U.S.C. § 1983.",
      }),
      sources: [],
      label: "Checked citations",
      detail: "no full citations found",
    };
  const items = await checkCitations(found, { timeoutMs: 40000, max: MAX_CHECKED });
  const counts = countsOf(items);
  return {
    content: clip(
      JSON.stringify({
        checked: items.length,
        counts,
        note: "found = the citation resolves to a real decision or provision; it does not show that it supports a statement.",
        citations: items.map((i) => ({
          citation: i.normalized,
          as_written: i.citation,
          type: KIND_LABEL[i.kind],
          status: i.status,
          reason: i.reason,
          ...(i.title ? { name: i.title } : {}),
          ...(i.court ? { court: i.court } : {}),
          ...(i.date ? { date_filed: i.date } : {}),
          ...(i.clusterId !== null ? { cluster_id: i.clusterId } : {}),
          url: i.url,
          ...(i.httpStatus !== null ? { source_status: i.httpStatus } : {}),
          ...(i.status === "ambiguous"
            ? {
                candidates: i.matches.map((m) => ({
                  name: m.title,
                  court: m.court,
                  date_filed: m.date,
                  cluster_id: m.clusterId,
                  url: m.url,
                })),
              }
            : {}),
        })),
      }),
      14000,
    ),
    sources: items
      .filter((i) => i.status === "found" && i.url)
      .slice(0, 8)
      .map((i) => ({
        title: i.title ? `${i.title} (${i.normalized})` : i.normalized,
        url: i.url!,
        internal: false,
      })),
    label: "Checked citations",
    detail: citationSummary({ total: items.length, counts, more: 0 }),
  };
}

async function getOpinionTool(input: Record<string, unknown>): Promise<ToolOutcome> {
  const cluster = posInt(input["cluster_id"]);
  const opinion = cluster ? null : posInt(input["opinion_id"]);
  if (!cluster && !opinion) throw new Error("cluster_id or opinion_id required");
  if (!caseLawKey()) throw new Error("case-law reading is not configured");
  const key = cluster ? `c${cluster}` : `o${opinion}`;
  const now = Date.now();
  let doc = state.opinions.get(key);
  if (!doc || now - doc.at > OPINION_TTL) {
    try {
      doc = { at: now, doc: await loadOpinion({ cluster, opinion }) };
    } catch (error) {
      throw new Error(
        reasonOf(error, error instanceof Error ? error.message : "opinion could not be read"),
      );
    }
    state.opinions.delete(key);
    state.opinions.set(key, doc);
    while (state.opinions.size > 12) state.opinions.delete(state.opinions.keys().next().value!);
  }
  const d = doc.doc;
  const start =
    typeof input["start"] === "number" && Number.isInteger(input["start"])
      ? Math.max(0, input["start"])
      : 0;
  const find = str(input["find"], 200);
  const window = pageWindow(d.text, start, find);
  return {
    content: clip(
      JSON.stringify({
        case_name: d.title,
        court: d.court,
        date_filed: d.date,
        citations: d.citations,
        docket: d.docket,
        url: d.url,
        opinions: d.opinions,
        ...window,
      }),
      16000,
    ),
    sources: d.url ? [{ title: d.title ?? "Court opinion", url: d.url, internal: false }] : [],
    label: find.trim() ? "Searched within an opinion" : "Read an opinion",
    detail: `${(d.title ?? `decision ${cluster ?? opinion}`).slice(0, 70)}${
      find.trim()
        ? ` · “${find.trim()}”`
        : start
          ? ` · from character ${start.toLocaleString("en-US")}`
          : ""
    }`,
  };
}

export const CITATION_EXECUTORS: Record<
  string,
  (input: Record<string, unknown>) => Promise<ToolOutcome>
> = {
  verify_citations: verifyCitationsTool,
  get_opinion: getOpinionTool,
};
