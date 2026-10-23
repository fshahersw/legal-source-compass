/**
 * Server functions for the law visualizations (atlas, regulatory lineage, bill flow, enforcement calendar). Read-only:
 * bounded RPCs of database/contracts/lawviz-v1.sql plus exact-key corpus reads; no key reaches the browser. When the
 * contract has not been applied the RPC is missing and the view reports "unavailable" instead of failing the page.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  AUTHORITIES_DATASET,
  AUTHORITY_SELECT,
  parseAuthorityRows,
  type AuthorityRow,
} from "@/lib/external/ecfrAuthorities";
import {
  CFR_PART,
  CFR_TITLE,
  SECTIONS_DATASET,
  parseNotes,
  partRecordId,
} from "@/lib/external/ecfrFull";
import { restGet, rpcPostOptional } from "@/lib/external/rest.server";
import { isNodeId, parseAtlasView, parseBuilt, type AtlasView } from "./atlas";
import { parseBillFlow, type BillFlowData } from "./billFlow";
import { isAgency, parseCalendar, type CalendarData } from "./calendar";
import {
  parseAuthorityLine,
  parseLineage,
  uniqueIds,
  type AuthorityCite,
  type LineageView,
} from "./lineage";

const enc = encodeURIComponent;
const cs = (v: Record<string, string[]>) => enc(JSON.stringify(v));

// ------------------------------------------------------------------------------------------------ atlas
const atlasInput = z
  .object({
    corpus: z.enum(["usc", "cfr"]),
    node: z.string().max(300).refine(isNodeId).nullable().optional(),
    from: z.number().int().min(0).max(1e12).optional(),
    to: z.number().int().min(0).max(1e12).optional(),
  })
  .refine((d) => (d.from === undefined) === (d.to === undefined) && (d.from ?? 0) <= (d.to ?? 0));

/** One atlas level: a node with its ancestors, children and (when few) grandchildren. */
export const getAtlasView = createServerFn({ method: "GET" })
  .inputValidator((d) => atlasInput.parse(d))
  .handler(async ({ data }): Promise<AtlasView> => {
    const raw = await rpcPostOptional<unknown>("lawviz_atlas_v1", {
      p_corpus: data.corpus,
      p_node: data.node ?? null,
      p_from: data.from ?? null,
      p_to: data.to ?? null,
    });
    return parseAtlasView(raw, data.corpus);
  });

// ------------------------------------------------------------------------------------------------ lineage
export type LineageAuthority = AuthorityCite & {
  basis: ("ptoa" | "note")[];
  /** Printed scope of the authority note (part or subpart heading). */
  scope: string | null;
};
export type PartLineage = {
  lineage: LineageView;
  authorities: LineageAuthority[];
  /** Exact ids sent to the RPC (at most 24, first seen first). */
  requested: string[];
  /** Exact ids beyond the 24 drawn. */
  notDrawn: string[];
  ptoaTotal: number;
  ptoaTruncated: boolean;
};

const lineageInput = z.object({
  title: z.string().regex(CFR_TITLE),
  part: z
    .string()
    .regex(CFR_PART)
    .regex(/^[0-9A-Za-z][0-9A-Za-z .-]{0,59}$/),
});

function ptoaCites(rows: AuthorityRow[]): LineageAuthority[] {
  const out: LineageAuthority[] = [];
  for (const r of rows) {
    if (r.category !== "usc") continue;
    const exact = r.link.state === "resolved" && r.link.id;
    out.push({
      printed: r.citation,
      id: exact ? r.link.id : null,
      reason: exact
        ? "exact"
        : r.link.state === "et_seq"
          ? "et_seq"
          : r.link.state === "range"
            ? "range"
            : r.link.state === "resolved_note"
              ? "note"
              : "other_form",
      basis: ["ptoa"],
      scope: null,
    });
  }
  return out;
}

/** The part's authorities (Parallel Table of Authorities + the part's printed authority note) and its lineage. */
export const getPartLineage = createServerFn({ method: "GET" })
  .inputValidator((d) => lineageInput.parse(d))
  .handler(async ({ data }): Promise<PartLineage> => {
    const [partRow, ptoa] = await Promise.all([
      restGet<{ id: unknown; n: unknown }[]>(
        `corpus_records?select=id,n:detail->notes&dataset=eq.${SECTIONS_DATASET}&id=eq.${enc(partRecordId(data.title, data.part))}&limit=1`,
      ),
      restGet<unknown[]>(
        `corpus_records?${AUTHORITY_SELECT}&dataset=eq.${AUTHORITIES_DATASET}&filters=cs.${cs({ cfr_part: [`${data.title}:${data.part}`] })}&order=ordinal.asc&limit=400`,
      ),
    ]);
    const notes = parseNotes(partRow.rows[0]?.n).filter((n) => n.kind === "authority");
    const fromNotes: LineageAuthority[] = notes.flatMap((n) =>
      parseAuthorityLine(n.text).map((c) => ({ ...c, basis: ["note" as const], scope: n.scope })),
    );
    const parsed = parseAuthorityRows(ptoa.rows);
    const merged = new Map<string, LineageAuthority>();
    for (const a of [...fromNotes, ...ptoaCites(parsed.rows)]) {
      const key = a.id ?? `printed:${a.printed}`;
      const had = merged.get(key);
      if (had) had.basis = [...new Set([...had.basis, ...a.basis])];
      else merged.set(key, { ...a, basis: [...a.basis] });
    }
    const authorities = [...merged.values()];
    const exactIds = authorities.map((a) => a.id);
    const requested = uniqueIds(exactIds, 24);
    const all = uniqueIds(exactIds, 10_000);
    const raw = await rpcPostOptional<unknown>("lawviz_part_lineage_v1", {
      p_title: data.title,
      p_part: data.part,
      p_usc: requested,
    });
    return {
      lineage: parseLineage(raw),
      authorities,
      requested,
      notDrawn: all.slice(requested.length),
      ptoaTotal: parsed.rows.length,
      ptoaTruncated: ptoa.rows.length >= 400,
    };
  });

// ------------------------------------------------------------------------------------------------ bills
export const getBillFlow = createServerFn({ method: "GET" }).handler(
  async (): Promise<BillFlowData> => {
    const raw = await rpcPostOptional<Record<string, unknown>>("lawviz_bill_flow_v1", {});
    return parseBillFlow(raw, parseBuilt(raw?.["built"]));
  },
);

// ------------------------------------------------------------------------------------------------ calendar
export const getEnforcementCalendar = createServerFn({ method: "GET" })
  .inputValidator((d) =>
    z
      .object({ agency: z.string().refine(isAgency), year: z.number().int().min(1950).max(2100) })
      .parse(d),
  )
  .handler(async ({ data }): Promise<CalendarData> => {
    const raw = await rpcPostOptional<Record<string, unknown>>("lawviz_calendar_v1", {
      p_agency: data.agency,
      p_year: data.year,
    });
    return parseCalendar(raw, parseBuilt(raw?.["built"]));
  });
