/**
 * Law firms on the matter registry's MDL master dockets, read from three published corpus datasets built by
 * scripts/enrichment/firm_intel: firm_matter_overview (overview, per-MDL landscape and associations across MDLs),
 * firm_profiles (one record per firm) and firm_network (co-counsel and opposing-counsel pairs).
 *
 * One appearance is one counsel entry for one party on an MDL master docket; member dockets are not counted. Firm spellings
 * are merged only by the builder's documented rules, and government counsel is kept apart. Stored JSON is validated here: a
 * value that cannot be read becomes null ("Not recorded"), a row that cannot be read is dropped, and links are kept only
 * when they have the exact shape of a firm, matter or court page.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { ilikeTerm, restGet } from "./rest.server";

export type Side = "plaintiff" | "defense" | "other";
export const SIDES: readonly Side[] = ["plaintiff", "defense", "other"];

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const count = (v: unknown) => {
  const n = num(v);
  return n != null && Number.isInteger(n) && n >= 0 ? n : null;
};
const pct = (v: unknown) => {
  const n = num(v);
  return n != null && n >= 0 && n <= 100 ? n : null;
};
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const arr = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : []);
const year = (v: unknown) => {
  const n = count(v);
  return n != null && n >= 1960 && n <= 2100 ? n : null;
};
const side = (v: unknown): Side | null => (SIDES.includes(v as Side) ? (v as Side) : null);

export const FIRM_RECORD = /^firm:[a-z0-9-]{1,140}$/;
const FIRM_HREF = /^\/records\/firm_profiles\/firm:[a-z0-9-]{1,140}$/;
const MATTER_HREF = /^\/records\/sw_matters_v1\/sw-matter:\d{1,5}$/;
const COURT_ID = /^[a-z0-9]{2,24}$/;

/** A firm page link only when it is exactly the firm record path. */
export const firmHref = (v: unknown) => {
  const s = str(v);
  return s && FIRM_HREF.test(s) ? s : null;
};
const matterHref = (v: unknown, mdl: number) => {
  const s = str(v);
  return s && MATTER_HREF.test(s) && s.endsWith(`:${mdl}`) ? s : null;
};

// ------------------------------------------------------------------------------------------------ landscape

export type FirmShare = {
  firm: string;
  href: string | null;
  appearances: number;
  sharePct: number | null;
};
export type SideLandscape = {
  firms: number | null;
  appearances: number | null;
  hhi: number | null;
  top1: number | null;
  top3: number | null;
  top5: number | null;
  top: FirmShare[];
};
export type MdlLandscape = {
  mdl: number;
  title: string | null;
  type: string | null;
  year: number | null;
  href: string | null;
  plaintiff: SideLandscape;
  defense: SideLandscape;
  leadPlaintiff: { firm: string; href: string | null; designations: number }[];
};
export type Association = {
  id: string;
  label: string;
  rho: number;
  n: number;
  low: number;
  high: number;
  strength: string | null;
  points: { mdl: number; x: number; y: number }[];
};
export type FirmOverview = {
  firms: number | null;
  appearances: number | null;
  mdls: number | null;
  multiMdlFirms: number | null;
  sideFirms: Record<Side, number | null>;
  leftOut: { label: string; n: number }[];
  government: {
    entries: number | null;
    offices: { name: string; entries: number }[];
    mdls: number;
  };
  top: (FirmShare & { mdls: number | null; side: Side | null })[];
};
export type FirmLandscape = {
  overview: FirmOverview | null;
  mdls: MdlLandscape[];
  associations: Association[];
  dropped: number;
};

function sideLandscape(raw: unknown): SideLandscape {
  const o = obj(raw);
  const top = arr(o?.["top"])
    .map((t) => {
      const r = obj(t);
      const firm = str(r?.["firm"]);
      const n = count(r?.["appearances"]);
      return firm && n != null
        ? { firm, href: firmHref(r?.["link"]), appearances: n, sharePct: pct(r?.["share_pct"]) }
        : null;
    })
    .filter((x): x is FirmShare => !!x);
  const hhi = num(o?.["hhi"]);
  return {
    firms: count(o?.["firms"]),
    appearances: count(o?.["appearances"]),
    hhi: hhi != null && hhi >= 0 && hhi <= 10000 ? hhi : null,
    top1: pct(o?.["top1_pct"]),
    top3: pct(o?.["top3_pct"]),
    top5: pct(o?.["top5_pct"]),
    top,
  };
}

export function parseMdl(raw: unknown, id: string): MdlLandscape | null {
  const p = obj(raw);
  const mdl = count(p?.["mdl"]);
  if (!p || mdl == null || id !== `mdl:${mdl}`) return null;
  return {
    mdl,
    title: str(p["title"]),
    type: str(p["type"]),
    year: year(p["year"]),
    href: null,
    plaintiff: sideLandscape(p["plaintiff"]),
    defense: sideLandscape(p["defense"]),
    leadPlaintiff: arr(p["lead_plaintiff"])
      .map((t) => {
        const r = obj(t);
        const firm = str(r?.["firm"]);
        const n = count(r?.["designations"]);
        const slug = slugOf(r?.["key"]);
        return firm && n != null
          ? {
              firm,
              href: slug ? firmHref(`/records/firm_profiles/${slug}`) : null,
              designations: n,
            }
          : null;
      })
      .filter((x): x is { firm: string; href: string | null; designations: number } => !!x),
  };
}

/**
 * The firm record id the builder derives from a firm key: "firm:" and the key with spaces as hyphens. Keys longer than 120
 * characters get a hashed tail in the builder, so they are not rebuilt here ("" means no link).
 */
export function slugOf(key: unknown): string {
  const k = str(key);
  const s = k ? k.split(/\s+/).join("-") : "";
  return s && s.length <= 120 ? `firm:${s}` : "";
}

export function parseAssociation(raw: unknown, id: string): Association | null {
  const p = obj(raw);
  const rho = num(p?.["rho"]);
  const n = count(p?.["n"]);
  const ci = arr(p?.["ci"]).map(num);
  const label = str(p?.["label"]);
  if (!p || !label || rho == null || Math.abs(rho) > 1 || n == null || n < 4) return null;
  const [low, high] = ci;
  if (low == null || high == null || low > rho || high < rho || low < -1 || high > 1) return null;
  return {
    id,
    label,
    rho,
    n,
    low,
    high,
    strength: str(p["strength"]),
    points: arr(p["points"])
      .map((t) => {
        const r = obj(t);
        const mdl = count(r?.["mdl"]);
        const x = num(r?.["x"]);
        const y = num(r?.["y"]);
        return mdl != null && x != null && y != null ? { mdl, x, y } : null;
      })
      .filter((x): x is { mdl: number; x: number; y: number } => !!x),
  };
}

export function parseOverview(raw: unknown): FirmOverview | null {
  const p = obj(raw);
  if (!p) return null;
  const sf = obj(p["side_firms"]);
  const ex = obj(p["excluded"]);
  const gov = obj(p["government"]);
  return {
    firms: count(p["firms"]),
    appearances: count(p["appearances"]),
    mdls: count(p["mdls"]),
    multiMdlFirms: count(p["multi_mdl_firms"]),
    sideFirms: {
      plaintiff: count(sf?.["plaintiff"]),
      defense: count(sf?.["defense"]),
      other: count(sf?.["other"]),
    },
    leftOut: Object.entries(ex ?? {})
      .map(([label, n]) => ({ label, n: count(n) }))
      .filter((x): x is { label: string; n: number } => x.n != null)
      .sort((a, b) => b.n - a.n),
    government: {
      entries: count(gov?.["entries"]),
      offices: arr(gov?.["offices"])
        .map((t) => {
          const r = obj(t);
          const name = str(r?.["name"]);
          const n = count(r?.["entries"]);
          return name && n != null ? { name, entries: n } : null;
        })
        .filter((x): x is { name: string; entries: number } => !!x),
      mdls: arr(gov?.["mdls"]).filter((m) => count(m) != null).length,
    },
    top: arr(p["top"])
      .map((t): FirmOverview["top"][number] | null => {
        const r = obj(t);
        const firm = str(r?.["firm"]);
        const n = count(r?.["appearances"]);
        return firm && n != null
          ? {
              firm,
              href: firmHref(r?.["link"]),
              appearances: n,
              sharePct: null,
              mdls: count(r?.["mdls"]),
              side: side(r?.["side"]),
            }
          : null;
      })
      .filter((x): x is FirmOverview["top"][number] => !!x),
  };
}

export const getFirmLandscape = createServerFn({ method: "GET" }).handler(
  async (): Promise<FirmLandscape> => {
    const r = await restGet<{ id: string; p: unknown; link: unknown }[]>(
      "corpus_records?select=id,p:item->profile,link:item->links->0->url&dataset=eq.firm_matter_overview&limit=200",
    );
    let dropped = 0;
    let overview: FirmOverview | null = null;
    const mdls: MdlLandscape[] = [];
    const associations: Association[] = [];
    for (const row of r.rows) {
      if (row.id === "overview:all") {
        overview = parseOverview(row.p);
        if (!overview) dropped++;
      } else if (row.id.startsWith("mdl:")) {
        const m = parseMdl(row.p, row.id);
        if (m) mdls.push({ ...m, href: matterHref(row.link, m.mdl) });
        else dropped++;
      } else if (row.id.startsWith("corr:")) {
        const a = parseAssociation(row.p, row.id);
        if (a) associations.push(a);
        else dropped++;
      }
    }
    mdls.sort((a, b) => a.mdl - b.mdl);
    associations.sort((a, b) => Math.abs(b.rho) - Math.abs(a.rho));
    return { overview, mdls, associations, dropped };
  },
);

// ------------------------------------------------------------------------------------------------ directory

export type FirmRow = {
  id: string;
  firm: string;
  side: Side | null;
  mdls: number | null;
  appearances: number;
  parties: number | null;
  attorneys: number | null;
  lead: number | null;
  firstYear: number | null;
  lastYear: number | null;
  rank: number | null;
};

export function parseFirmRow(id: unknown, raw: unknown): FirmRow | null {
  const c = obj(raw);
  const rid = str(id);
  const firm = str(c?.["firm"]);
  const appearances = count(c?.["appearances"]);
  if (!c || !rid || !FIRM_RECORD.test(rid) || !firm || appearances == null) return null;
  const parties = count(c["parties"]);
  return {
    id: rid,
    firm,
    side: side(c["side"]),
    mdls: count(c["mdls"]),
    appearances,
    parties: parties != null && parties <= appearances ? parties : null,
    attorneys: count(c["attorneys"]),
    lead: (() => {
      const l = count(c["lead"]);
      return l != null && l <= appearances ? l : null;
    })(),
    firstYear: year(c["first_mdl_year"]),
    lastYear: year(c["last_mdl_year"]),
    rank: count(c["rank"]),
  };
}

export const FIRM_SORTS = ["appearances", "mdls", "parties", "attorneys"] as const;
export type FirmSort = (typeof FIRM_SORTS)[number];
const SORT_SQL: Record<FirmSort, string> = {
  appearances: "item->cells->rank.asc",
  mdls: "item->cells->mdls.desc,item->cells->rank.asc",
  parties: "item->cells->parties.desc,item->cells->rank.asc",
  attorneys: "item->cells->attorneys.desc,item->cells->rank.asc",
};
export const FIRM_PAGE = 50;

const listInput = z.object({
  side: z.enum(["all", "plaintiff", "defense", "other"]).default("all"),
  q: z.string().max(80).default(""),
  sort: z.enum(FIRM_SORTS).default("appearances"),
  offset: z.number().int().min(0).max(5000).default(0),
});

export const getFirmList = createServerFn({ method: "GET" })
  .inputValidator((d) => listInput.parse(d))
  .handler(
    async ({ data }): Promise<{ rows: FirmRow[]; total: number | null; dropped: number }> => {
      let path = `corpus_records?select=id,c:item->cells&dataset=eq.firm_profiles&order=${SORT_SQL[data.sort]}`;
      if (data.side !== "all") path += `&item->cells->>side=eq.${data.side}`;
      const q = data.q.replace(/[^A-Za-z0-9&.' -]/g, " ").trim();
      if (q) path += `&title=ilike.${ilikeTerm(q)}`;
      const r = await restGet<{ id: unknown; c: unknown }[]>(path, {
        count: true,
        range: [data.offset, data.offset + FIRM_PAGE - 1],
      });
      const rows = r.rows.map((x) => parseFirmRow(x.id, x.c)).filter((x): x is FirmRow => !!x);
      return { rows, total: r.total, dropped: r.rows.length - rows.length };
    },
  );

// ------------------------------------------------------------------------------------------------ profile

export type FirmLink = { firm: string; href: string | null };
export type FirmProfile = {
  id: string;
  name: string;
  spellings: { text: string; n: number }[];
  appearances: number;
  parties: number | null;
  attorneys: number | null;
  plaintiffsRepresented: number | null;
  sideMix: Record<Side, number | null>;
  lead: number | null;
  proHacVice: number | null;
  terminated: number | null;
  perMdl: {
    mdl: number;
    title: string | null;
    type: string | null;
    year: number | null;
    appearances: number;
    parties: number | null;
    side: Side | null;
    lead: number | null;
    href: string | null;
  }[];
  litigationTypes: { type: string; mdls: number }[];
  courts: { courtId: string; appearances: number; href: string | null }[];
  defenseClients: { name: string; appearances: number }[];
  cocounsel: (FirmLink & { sharedParties: number })[];
  opposing: (FirmLink & { dockets: number; mdls: number[] })[];
  sameSide: (FirmLink & { sharedMdls: number; jaccard: number | null })[];
};

export function parseFirmProfile(raw: unknown, id: string): FirmProfile | null {
  const p = obj(raw);
  const name = str(p?.["name"]);
  const appearances = count(p?.["appearances"]);
  const key = str(p?.["key"]);
  const joined = key ? `firm:${key.split(/\s+/).join("-")}` : "";
  const sameFirm = joined.length <= 125 ? joined === id : id.startsWith(joined.slice(0, 115));
  if (!p || !name || appearances == null || !key || !sameFirm) return null;
  const mix = obj(p["side_mix"]);
  const within = (v: unknown) => {
    const n = count(v);
    return n != null && n <= appearances ? n : null;
  };
  const link = (r: Record<string, unknown> | null) => ({
    firm: str(r?.["firm"]) ?? "",
    href: firmHref(r?.["link"]),
  });
  return {
    id,
    name,
    spellings: arr(p["raw_forms"])
      .map((t) => {
        const r = obj(t);
        const text = str(r?.["text"]);
        const n = count(r?.["n"]);
        return text && n != null ? { text, n } : null;
      })
      .filter((x): x is { text: string; n: number } => !!x),
    appearances,
    parties: within(p["parties"]),
    attorneys: count(p["attorneys"]),
    plaintiffsRepresented: within(p["plaintiffs_represented"]),
    sideMix: {
      plaintiff: within(mix?.["plaintiff"]),
      defense: within(mix?.["defense"]),
      other: within(mix?.["other"]),
    },
    lead: within(p["lead_designations"]),
    proHacVice: within(p["pro_hac_vice"]),
    terminated: within(p["terminated"]),
    perMdl: arr(p["per_mdl"])
      .map((t) => {
        const r = obj(t);
        const mdl = count(r?.["mdl"]);
        const n = within(r?.["appearances"]);
        if (mdl == null || n == null) return null;
        return {
          mdl,
          title: str(r?.["title"]),
          type: str(r?.["type"]),
          year: year(r?.["year"]),
          appearances: n,
          parties: count(r?.["parties"]),
          side: side(r?.["side"]),
          lead: count(r?.["lead"]),
          href: matterHref(r?.["link"], mdl),
        };
      })
      .filter((x): x is FirmProfile["perMdl"][number] => !!x),
    litigationTypes: arr(p["litigation_types"])
      .map((t) => {
        const r = obj(t);
        const type = str(r?.["type"]);
        const n = count(r?.["mdls"]);
        return type && n != null ? { type, mdls: n } : null;
      })
      .filter((x): x is { type: string; mdls: number } => !!x),
    courts: arr(p["courts"])
      .map((t) => {
        const r = obj(t);
        const courtId = str(r?.["court_id"]);
        const n = within(r?.["appearances"]);
        if (!courtId || !COURT_ID.test(courtId) || n == null) return null;
        return {
          courtId,
          appearances: n,
          href: r?.["link"] === `/courts/${courtId}` ? `/courts/${courtId}` : null,
        };
      })
      .filter((x): x is FirmProfile["courts"][number] => !!x),
    defenseClients: arr(p["defense_parties"])
      .map((t) => {
        const r = obj(t);
        const nm = str(r?.["name"]);
        const n = within(r?.["appearances"]);
        return nm && n != null ? { name: nm, appearances: n } : null;
      })
      .filter((x): x is { name: string; appearances: number } => !!x),
    cocounsel: arr(p["cocounsel"])
      .map((t) => {
        const r = obj(t);
        const n = count(r?.["shared_parties"]);
        const l = link(r);
        return l.firm && n != null ? { ...l, sharedParties: n } : null;
      })
      .filter((x): x is FirmProfile["cocounsel"][number] => !!x),
    opposing: arr(p["opposing"])
      .map((t) => {
        const r = obj(t);
        const n = count(r?.["dockets"]);
        const l = link(r);
        return l.firm && n != null
          ? {
              ...l,
              dockets: n,
              mdls: arr(r?.["mdls"])
                .map(count)
                .filter((m): m is number => m != null),
            }
          : null;
      })
      .filter((x): x is FirmProfile["opposing"][number] => !!x),
    sameSide: arr(p["same_side_overlap"])
      .map((t) => {
        const r = obj(t);
        const n = count(r?.["shared_mdls"]);
        const j = num(r?.["jaccard"]);
        const l = link(r);
        return l.firm && n != null
          ? { ...l, sharedMdls: n, jaccard: j != null && j >= 0 && j <= 1 ? j : null }
          : null;
      })
      .filter((x): x is FirmProfile["sameSide"][number] => !!x),
  };
}

export const getFirmProfile = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: z.string().regex(FIRM_RECORD) }).parse(d))
  .handler(async ({ data }): Promise<FirmProfile | null> => {
    const r = await restGet<{ p: unknown }[]>(
      `corpus_records?select=p:item->profile&dataset=eq.firm_profiles&id=eq.${encodeURIComponent(data.id)}&limit=1`,
    );
    return r.rows.length === 1 ? parseFirmProfile(r.rows[0]!.p, data.id) : null;
  });

// ------------------------------------------------------------------------------------------------ network

export type FirmPair = { a: FirmLink; b: FirmLink; weight: number; mdls: number[] };
export type FirmNetwork = { cocounsel: FirmPair[]; opposing: FirmPair[]; dropped: number };

export function parsePair(raw: unknown, links: unknown): FirmPair | null {
  const c = obj(raw);
  const l = arr(links).map(obj);
  const a = str(c?.["firm_a"]);
  const b = str(c?.["firm_b"]);
  const w = count(c?.["weight"]);
  if (!a || !b || w == null || w < 1) return null;
  return {
    a: { firm: a, href: firmHref(l[0]?.["url"]) },
    b: { firm: b, href: firmHref(l[1]?.["url"]) },
    weight: w,
    mdls: [],
  };
}

export const getFirmNetwork = createServerFn({ method: "GET" }).handler(
  async (): Promise<FirmNetwork> => {
    const base =
      "corpus_records?select=c:item->cells,l:item->links,p:item->profile&dataset=eq.firm_network";
    const [co, opp] = await Promise.all([
      restGet<{ c: unknown; l: unknown; p: unknown }[]>(
        `${base}&item->cells->>kind=eq.co-counsel&order=item->cells->weight.desc&limit=30`,
      ),
      restGet<{ c: unknown; l: unknown; p: unknown }[]>(
        `${base}&item->cells->>kind=eq.opposing&order=item->cells->weight.desc&limit=30`,
      ),
    ]);
    const parse = (rows: { c: unknown; l: unknown; p: unknown }[]) =>
      rows
        .map((r) => {
          const pair = parsePair(r.c, r.l);
          if (!pair) return null;
          return {
            ...pair,
            mdls: arr(obj(r.p)?.["mdls"])
              .map(count)
              .filter((m): m is number => m != null),
          };
        })
        .filter((x): x is FirmPair => !!x);
    const cocounsel = parse(co.rows);
    const opposing = parse(opp.rows);
    return {
      cocounsel,
      opposing,
      dropped: co.rows.length + opp.rows.length - cocounsel.length - opposing.length,
    };
  },
);
