/**
 * State registers (rulemaking bulletins) → state_register_issues (upsert, newest first). ingest source state_registers.
 *
 * One listing page per state, read once per weekly run: the publisher's own list of issues (date, volume/issue or pages,
 * official address). Only what the listing prints is recorded: a value the listing does not print is null ("Not
 * recorded"); issue contents are not copied. Pages were chosen and robots.txt checked by scripts/state_regs/probe.py
 * (coverage in database/contracts/state-regs-v1.sql). Row ids: `<st>-reg:<YYYY-MM-DD>` (or `<YYYY-MM>` for a monthly
 * bulletin the listing names only by month), plus `:<volume>-<issue>` when the listing prints both.
 * The first run fills the dataset (every issue the listing shows); later runs add new issues and update changed ones.
 */
import { BudgetExhausted, RateLimited } from "../http.ts";
import { corpusRecord } from "../rows.ts";
import type { CollectContext, Collected, CorpusRow, Json, JsonObject, SourceAdapter } from "../types.ts";

export const DATASET = "state_register_issues";
const NR = "Not recorded";

export type Issue = {
  state: string;
  publication: string;
  date: string | null; // YYYY-MM-DD as printed
  period: string | null; // YYYY-MM for a monthly bulletin listed by month only
  volume: string | null; // as printed (arabic or roman)
  issue: string | null;
  pages: string | null;
  label: string; // the listing's link text, whitespace collapsed
  url: string;
};

export type RegisterSource = {
  state: string;
  publication: string;
  url: string;
  parse: (html: string, base: string) => Issue[];
};

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const MONTH_RX = "(January|February|March|April|May|June|July|August|September|October|November|December)";

const ENTITIES: Record<string, string> = { amp: "&", nbsp: " ", quot: '"', apos: "'", lt: "<", gt: ">", ndash: "–", mdash: "—" };

/** Link text as printed: tags removed, entities decoded, zero-width characters dropped, whitespace collapsed. */
export function cleanLabel(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/[​‌‍﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function anchors(html: string, base: string): { href: string; text: string }[] {
  const out: { href: string; text: string }[] = [];
  const rx = /<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (let m = rx.exec(html); m; m = rx.exec(html)) {
    const raw = m[1]!.replace(/&amp;/g, "&").replace(/&#58;/g, ":").trim();
    let href: string;
    try {
      href = new URL(raw, base).href;
    } catch {
      continue;
    }
    if (!/^https?:/.test(href)) continue;
    out.push({ href: href.replace(/;JSESSIONID_[A-Z]+=[^?]*/, ""), text: cleanLabel(m[2]!) });
  }
  return out;
}

/** "October 16, 2026" → "2026-10-16"; null when the text is not such a date. */
export function longDate(s: string): string | null {
  const m = new RegExp(`${MONTH_RX}\\.?\\s+(\\d{1,2}),\\s*(\\d{4})`, "i").exec(s);
  if (!m) return null;
  const mo = MONTHS.indexOf(m[1]!.toLowerCase()) + 1;
  const d = Number(m[2]);
  if (d < 1 || d > 31) return null;
  return `${m[3]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function monthPeriod(s: string): string | null {
  const m = new RegExp(`^${MONTH_RX}\\s+(\\d{4})$`, "i").exec(s);
  if (!m) return null;
  return `${m[2]}-${String(MONTHS.indexOf(m[1]!.toLowerCase()) + 1).padStart(2, "0")}`;
}

const issue = (src: Pick<RegisterSource, "state" | "publication">, a: { href: string; text: string }, f: Partial<Issue>): Issue => ({
  state: src.state,
  publication: src.publication,
  date: null,
  period: null,
  volume: null,
  issue: null,
  pages: null,
  label: a.text,
  url: a.href,
  ...f,
});

function unique(list: Issue[]): Issue[] {
  const seen = new Set<string>();
  return list.filter((i) => (seen.has(i.url) ? false : (seen.add(i.url), true)));
}

export const REGISTERS: RegisterSource[] = [
  {
    state: "TX",
    publication: "Texas Register",
    url: "https://www.sos.texas.gov/texreg/pdf/backview/index.shtml",
    parse(html, base) {
      return unique(
        anchors(html, base)
          .filter((a) => /\/texreg\/pdf\/backview\/\d{4}\/index\.shtml$/.test(a.href))
          .flatMap((a) => {
            const date = longDate(a.text);
            const pages = /Pages\s+([\d,]+\s*-\s*[\d,]+)/i.exec(a.text)?.[1] ?? null;
            return date ? [issue(this, a, { date, pages })] : [];
          }),
      );
    },
  },
  {
    state: "CO",
    publication: "Colorado Register",
    url: "https://www.sos.state.co.us/CCR/RegisterHome.do",
    parse(html, base) {
      return unique(
        anchors(html, base).flatMap((a) => {
          const u = new URL(a.href);
          if (!u.pathname.endsWith("/CCR/RegisterContents.do")) return [];
          const day = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(u.searchParams.get("publicationDay") ?? "");
          if (!day) return [];
          const m = /-\s*(\d+)\s+CR\s+(\d+)$/.exec(a.text);
          return [
            issue(this, a, {
              date: `${day[3]}-${day[1]}-${day[2]}`,
              volume: m?.[1] ?? null,
              issue: m?.[2] ?? null,
            }),
          ];
        }),
      );
    },
  },
  {
    state: "MD",
    publication: "Maryland Register",
    url: "https://dsd.maryland.gov/Pages/MDRegister.aspx",
    parse(html, base) {
      return unique(
        anchors(html, base).flatMap((a) => {
          const m = /^Volume\s+(\d+)\s+Issue\s+(\d+)\s*[–-]\s*(.+)$/i.exec(a.text);
          const date = m ? longDate(m[3]!) : null;
          return m && date ? [issue(this, a, { date, volume: m[1]!, issue: m[2]! })] : [];
        }),
      );
    },
  },
  {
    state: "MO",
    publication: "Missouri Register",
    url: "https://www.sos.mo.gov/adrules/moreg/moreg",
    parse(html, base) {
      return unique(
        anchors(html, base).flatMap((a) => {
          const m = new RegExp(`^(${MONTH_RX}\\s+\\d{1,2},\\s*\\d{4})\\s*-\\s*Volume\\s+(\\d+),\\s*Number\\s+(\\d+)$`, "i").exec(a.text);
          const date = m ? longDate(m[1]!) : null;
          return m && date ? [issue(this, a, { date, volume: m[3]!, issue: m[4]! })] : [];
        }),
      );
    },
  },
  {
    state: "NM",
    publication: "New Mexico Register",
    url: "https://www.srca.nm.gov/new-mexico-register/",
    parse(html, base) {
      return unique(
        anchors(html, base).flatMap((a) => {
          const m = /^Volume\s+([IVXLCDM]+),\s*Issue\s+(\d+),\s*(.+)$/i.exec(a.text);
          const date = m ? longDate(m[3]!) : null;
          return m && date ? [issue(this, a, { date, volume: m[1]!, issue: m[2]! })] : [];
        }),
      );
    },
  },
  {
    state: "NY",
    publication: "New York State Register",
    url: "https://dos.ny.gov/state-register",
    parse(html, base) {
      return unique(
        anchors(html, base).flatMap((a) => {
          const m = /^(.+?)\s*\/\s*Vol\.\s*([IVXLCDM]+),\s*Issue\s+(\d+)$/i.exec(a.text);
          const date = m ? longDate(m[1]!) : null;
          return m && date ? [issue(this, a, { date, volume: m[2]!, issue: m[3]! })] : [];
        }),
      );
    },
  },
  {
    state: "MN",
    publication: "Minnesota State Register",
    url: "https://mn.gov/admin/bookstore/register.jsp",
    parse(html, base) {
      return unique(
        anchors(html, base).flatMap((a) => {
          const date = /\.pdf$/i.test(new URL(a.href).pathname) ? longDate(a.text) : null;
          return date && /^[A-Z][a-z]+day,\s/.test(a.text) ? [issue(this, a, { date })] : [];
        }),
      );
    },
  },
  {
    state: "OR",
    publication: "Oregon Bulletin",
    url: "https://secure.sos.state.or.us/oard/displayBulletins.action",
    parse(html, base) {
      return unique(
        anchors(html, base).flatMap((a) => {
          if (!/\/oard\/displayBulletin\.action\?bulltnRsn=\d+$/.test(a.href)) return [];
          const period = monthPeriod(a.text);
          return period ? [issue(this, a, { period })] : [];
        }),
      );
    },
  },
  {
    state: "KY",
    publication: "Administrative Register of Kentucky",
    url: "https://legislature.ky.gov/Law/kar/Pages/Registers.aspx",
    parse(html, base) {
      return unique(
        anchors(html, base).flatMap((a) => {
          if (!/\/law\/kar\/registers\/[^/]+\/[^/]+\.pdf$/i.test(a.href)) return [];
          const period = monthPeriod(a.text);
          return period ? [issue(this, a, { period })] : [];
        }),
      );
    },
  },
];

const KEY_PART = /[^A-Za-z0-9.-]+/g;

export function issueId(i: Issue): string | null {
  const when = i.date ?? i.period;
  if (!when) return null;
  const vi = i.volume && i.issue ? `:${`${i.volume}-${i.issue}`.replace(KEY_PART, "").slice(0, 24)}` : "";
  return `${i.state.toLowerCase()}-reg:${when}${vi}`;
}

export function issueRow(i: Issue): CorpusRow | null {
  const id = issueId(i);
  if (!id) return null;
  const when = i.date ?? i.period!;
  const vi =
    i.volume && i.issue ? `Volume ${i.volume}, Issue ${i.issue}` : i.pages ? `Pages ${i.pages}` : NR;
  const title = `${i.publication}, ${i.date ?? i.label}`;
  return corpusRecord(DATASET, id, title, {
    source_url: i.url,
    subtitle: i.state,
    state: i.state,
    cells: {
      publication: i.publication,
      issue_date: i.date ?? (i.period ? `${i.period} (month)` : NR),
      issue: vi,
    },
    facts: [
      ["Publication", i.publication],
      ["State", i.state],
      ["Issue date", i.date ?? NR],
      ["Month", i.period ?? (i.date ? i.date.slice(0, 7) : NR)],
      ["Volume", i.volume ?? NR],
      ["Issue", i.issue ?? NR],
      ["Pages", i.pages ?? NR],
      ["As listed", i.label],
      ["Official address", i.url],
    ],
    text: [i.publication, i.label].join(" "),
    filters: { state: [i.state], year: [when.slice(0, 4)] },
    extra: {
      register_issue: {
        state: i.state,
        publication: i.publication,
        date: i.date,
        period: i.period,
        volume: i.volume,
        issue: i.issue,
        pages: i.pages,
        label: i.label,
        url: i.url,
      } as JsonObject,
    },
  });
}

/** Newest first (the dataset's order): by date or month, then id. */
export function sortRows(rows: CorpusRow[]): CorpusRow[] {
  const when = (r: CorpusRow) => {
    const ri = r.item["register_issue"] as JsonObject;
    return String(ri["date"] ?? `${ri["period"]}-00`);
  };
  return [...rows].sort((a, b) => (when(a) === when(b) ? (a.id < b.id ? -1 : 1) : when(a) < when(b) ? 1 : -1));
}

export const stateRegisters: SourceAdapter = {
  source: "state_registers",
  dataset: DATASET,
  mode: "upsert",
  ordinalPolicy: "prepend",
  functionName: "ingest-state-registers",
  limits: { maxRequests: 20, minIntervalMs: 2000 },
  secrets: [],

  async collect(ctx: CollectContext): Promise<Collected> {
    const rows: CorpusRow[] = [];
    const notes: JsonObject = {};
    let fetched = 0;
    let complete = true;
    const ids = new Set<string>();
    for (const src of REGISTERS) {
      try {
        const res = await ctx.http.getText(src.url, { headers: { Accept: "text/html,application/xhtml+xml" } });
        if (res.status !== 200) {
          notes[src.state] = `HTTP ${res.status}`;
          complete = false;
          continue;
        }
        const issues = src.parse(res.text, src.url);
        fetched += issues.length;
        let n = 0;
        for (const i of issues) {
          const row = issueRow(i);
          if (!row || ids.has(row.id)) continue;
          ids.add(row.id);
          rows.push(row);
          n++;
        }
        notes[src.state] = n;
        if (n === 0) complete = false; // a listing that yields nothing has changed shape: the run is partial
      } catch (error) {
        if (error instanceof BudgetExhausted || error instanceof RateLimited) {
          notes["stopped"] = error.message;
          complete = false;
          break;
        }
        notes[src.state] = `failed: ${error instanceof Error ? error.message.slice(0, 120) : "error"}`;
        complete = false;
      }
    }
    return {
      rows: sortRows(rows),
      fetched,
      held: [],
      cursorAfter: { read_at: ctx.now.toISOString().slice(0, 10) } as Json,
      complete,
      notes,
    };
  },

  comparable(content) {
    return content as unknown as Json;
  },
};
