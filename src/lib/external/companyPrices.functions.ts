/**
 * Share-price history of a registrant (company_price_history, self-updating: src/lib/ingest/sources/companyPrices.ts;
 * contract database/contracts/company-prices-v1.sql) with the MDL dates of its linked MDLs (company_sec_mdl_links →
 * mdls: JPML transfer order and closing dates). Read-only; rows validated in src/components/companies/companyPrices.ts.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { restGet } from "./rest.server";
import {
  mdlEvents,
  parsePriceRow,
  type MdlLinkInput,
  type PriceEvent,
  type PriceSeries,
} from "@/components/companies/companyPrices";

const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; value: CompanyPrices }>();

export type CompanyPrices = { series: PriceSeries | null; mdlEvents: PriceEvent[] };

const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export const getCompanyPrices = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ cik: z.string().regex(/^\d{10}$/) }).parse(d))
  .handler(async ({ data }): Promise<CompanyPrices> => {
    const hit = cache.get(data.cik);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
    const [px, links] = await Promise.all([
      restGet<{ id: string; item: unknown; source_url: unknown }[]>(
        `corpus_records?select=id,item,source_url&dataset=eq.company_price_history&id=eq.px:${data.cik}&limit=1`,
      ),
      restGet<{ link: unknown }[]>(
        `corpus_records?select=link:item->link&dataset=eq.company_sec_mdl_links&id=like.${data.cik}:*&order=id.asc&limit=200`,
      ),
    ]);
    const row = px.rows[0];
    const series = row ? parsePriceRow(row.id, row.item, row.source_url) : null;
    const parsedLinks = links.rows.flatMap((r) => {
      const l = obj(r.link);
      const mdl = typeof l?.["mdl"] === "number" && Number.isInteger(l["mdl"]) ? l["mdl"] : null;
      if (!l || mdl === null || mdl <= 0) return [];
      return [
        {
          mdl,
          tier: s(l["tier"]),
          role: s(l["role"]),
          dismissed: l["dismissed"] === true || l["dismissed"] === "true",
        },
      ];
    });
    let inputs: MdlLinkInput[] = [];
    const numbers = [...new Set(parsedLinks.map((l) => l.mdl))];
    if (numbers.length) {
      const mdls = await restGet<{ id: string; title: unknown; t: unknown; c: unknown }[]>(
        `corpus_records?select=id,title:item->>title,t:item->>date_transferred,c:item->>date_closed&dataset=eq.mdls&id=in.(${numbers.join(",")})&limit=200`,
      );
      const byNumber = new Map(mdls.rows.map((m) => [String(m.id).replace(/^mdl:/, ""), m]));
      inputs = parsedLinks.map((l) => {
        const m = byNumber.get(String(l.mdl));
        return {
          ...l,
          title: s(m?.title),
          dateTransferred: s(m?.t),
          dateClosed: s(m?.c),
        };
      });
    }
    const value: CompanyPrices = { series, mdlEvents: mdlEvents(inputs) };
    cache.set(data.cik, { at: Date.now(), value });
    if (cache.size > 300) cache.delete(cache.keys().next().value as string);
    return value;
  });
