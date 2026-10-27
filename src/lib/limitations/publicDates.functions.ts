/**
 * Read-only corpus reads for the Time Limits public-date picker. Lookups are by exact identifier (record id, or the
 * MDL number on a transfer order); free text runs a full-text search limited to 20 rows that the user must pick from.
 * Nothing here reads or writes rules, sources, coverage or the manifest, and nothing computes a period.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { restGet, rpcPostOptional } from "@/lib/external/rest.server";
import {
  IDENTIFIER_PATTERNS,
  MDLS_DATASET,
  PUBLIC_DATE_DATASETS,
  PUBLIC_DATE_KINDS,
  dedupeHits,
  exactIdentifier,
  mdlPublicDates,
  parseCpscRecall,
  parseDrugsFdaLabeling,
  parseEnforcement,
  parseHit,
  parseMdlProducts,
  parseNhtsaRecall,
  parsePmaLabeling,
  recordIdFor,
  type PublicDateHit,
  type PublicDateKind,
  type PublicDatesResult,
} from "./publicDates";

type Row = { id?: unknown; source_url?: unknown; item?: unknown; detail?: unknown };

const memo = new Map<string, { at: number; v: unknown }>();
const TTL = 10 * 60 * 1000;
async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.v as T;
  const v = await fn();
  memo.set(key, { at: Date.now(), v });
  if (memo.size > 300) memo.delete(memo.keys().next().value as string);
  return v;
}

const enc = encodeURIComponent;
const cs = (v: Record<string, string[]>) => enc(JSON.stringify(v));

/** Words for the simple full-text configuration: letters and digits only, at most 6 terms. */
export function ftsWords(q: string): string | null {
  const words = (q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 6).map((w) => w.slice(0, 40));
  return words.length ? words.join(" ") : null;
}

const searchInput = z.object({
  kind: z.enum(PUBLIC_DATE_KINDS),
  q: z.string().trim().min(1).max(120),
});

export type PublicDateSearch = { mode: "identifier" | "words"; hits: PublicDateHit[] };

async function searchKind(kind: PublicDateKind, q: string): Promise<PublicDateSearch> {
  const exact = exactIdentifier(kind, q);
  if (exact) return { mode: "identifier", hits: [{ kind, identifier: exact, label: exact, date: null }] };
  const words = ftsWords(q);
  if (!words) return { mode: "words", hits: [] };
  const fts = `search_vector=plfts(simple).${enc(words)}`;
  const select = "select=id,title,item";
  const paths =
    kind === "mdl"
      ? [
          `corpus_records?${select}&dataset=eq.${PUBLIC_DATE_DATASETS.mdl}&filters=cs.${cs({ order_kind: ["transfer_order"] })}&${fts}&limit=20`,
          `corpus_records?${select}&dataset=eq.${MDLS_DATASET}&${fts}&limit=20`,
        ]
      : [`corpus_records?${select}&dataset=eq.${PUBLIC_DATE_DATASETS[kind]}&${fts}&limit=20`];
  const results = await Promise.all(paths.map((p) => restGet<unknown[]>(p)));
  const hits = dedupeHits(results.flatMap((r) => r.rows.map((row) => parseHit(kind, row)))).slice(0, 20);
  return { mode: "words", hits };
}

/** Candidates the user picks from. An identifier-shaped query is passed through as itself; nothing is attached. */
export const searchPublicDateSources = createServerFn({ method: "GET" })
  .inputValidator((d: z.input<typeof searchInput>) => searchInput.parse(d))
  .handler(async ({ data }): Promise<PublicDateSearch> => {
    try {
      return await cached(`s:${data.kind}:${data.q.toLowerCase()}`, () =>
        searchKind(data.kind, data.q),
      );
    } catch (e) {
      console.error("public dates search", e);
      throw new Error("The public-record search could not be run just now.");
    }
  });

const datesInput = z
  .object({ kind: z.enum(PUBLIC_DATE_KINDS), id: z.string().trim().min(1).max(40) })
  .refine((d) => IDENTIFIER_PATTERNS[d.kind].test(d.id), { message: "Not an exact identifier." });

async function readDates(kind: PublicDateKind, id: string): Promise<PublicDatesResult> {
  const base = { kind, identifier: id, products: [], notes: [] as string[] };
  const one = async (dataset: string, select: string) =>
    (
      await restGet<Row[]>(
        `corpus_records?select=${select}&dataset=eq.${dataset}&id=eq.${enc(recordIdFor(kind, id))}&limit=2`,
      )
    ).rows;
  switch (kind) {
    case "mdl": {
      const [orders, pending, products] = await Promise.all([
        restGet<Row[]>(
          `corpus_records?select=id,source_url,item&dataset=eq.${PUBLIC_DATE_DATASETS.mdl}&filters=cs.${cs({ order_kind: ["transfer_order"] })}&item->order->>mdl=eq.${id}&limit=20`,
        ),
        restGet<Row[]>(`corpus_records?select=id,item&dataset=eq.${MDLS_DATASET}&id=eq.${id}&limit=2`),
        rpcPostOptional<unknown>("safety_mdl_products_v1", { p_mdl: id }).catch((e: unknown) => {
          console.error("public dates products", e);
          return null;
        }),
      ]);
      const r = mdlPublicDates(id, orders.rows, pending.rows.length === 1 ? pending.rows[0] : undefined);
      return {
        ...base,
        title: r.title,
        candidates: r.candidates,
        notes: r.notes,
        products: parseMdlProducts(products),
        found: orders.rows.length > 0 || pending.rows.length > 0,
      };
    }
    case "drug_application": {
      const rows = await one(
        PUBLIC_DATE_DATASETS.drug_application,
        "id,item,submissions:detail->submissions,original_file:detail->original_file,native_id:detail->native_id",
      );
      const row = rows.length === 1 ? (rows[0] as Row & Record<string, unknown>) : undefined;
      const r = parseDrugsFdaLabeling(
        row
          ? {
              id: row.id,
              item: row.item,
              detail: {
                submissions: row["submissions"],
                original_file: row["original_file"],
                native_id: row["native_id"],
              },
            }
          : undefined,
      );
      return { ...base, ...r, found: !!row };
    }
    case "device_pma": {
      const rows = await restGet<(Row & Record<string, unknown>)[]>(
        `corpus_records?select=id,item,original_file:detail->original_file&dataset=eq.${PUBLIC_DATE_DATASETS.device_pma}&id=like.${enc(`${recordIdFor(kind, id)}:`)}*&limit=1000`,
      );
      const r = parsePmaLabeling(
        id,
        rows.rows.map((x) => ({ id: x.id, item: x.item, detail: { original_file: x["original_file"] } })),
      );
      return { ...base, ...r, found: rows.rows.length > 0 };
    }
    case "fda_drug_recall":
    case "fda_device_recall": {
      const rows = await one(
        PUBLIC_DATE_DATASETS[kind],
        "id,source_url,item,original_file:detail->original_file",
      );
      const row = rows.length === 1 ? (rows[0] as Row & Record<string, unknown>) : undefined;
      const r = parseEnforcement(
        kind,
        row
          ? { id: row.id, source_url: row.source_url, item: row.item, detail: { original_file: row["original_file"] } }
          : undefined,
      );
      return { ...base, ...r, found: !!row };
    }
    case "cpsc_recall": {
      const rows = await one(PUBLIC_DATE_DATASETS.cpsc_recall, "id,source_url,item");
      const r = parseCpscRecall(rows.length === 1 ? rows[0] : undefined);
      return { ...base, ...r, found: rows.length === 1 };
    }
    case "nhtsa_recall": {
      const rows = await one(PUBLIC_DATE_DATASETS.nhtsa_recall, "id,source_url,item");
      const r = parseNhtsaRecall(rows.length === 1 ? rows[0] : undefined);
      return { ...base, ...r, found: rows.length === 1 };
    }
  }
}

/** Dated public events of one record chosen by exact identifier. Identifiers and dates only, never periods. */
export const getPublicDates = createServerFn({ method: "GET" })
  .inputValidator((d: z.input<typeof datesInput>) => datesInput.parse(d))
  .handler(async ({ data }): Promise<PublicDatesResult> => {
    try {
      return await cached(`d:${data.kind}:${data.id}`, () => readDates(data.kind, data.id));
    } catch (e) {
      console.error("public dates", e);
      throw new Error("The public record could not be read just now.");
    }
  });
