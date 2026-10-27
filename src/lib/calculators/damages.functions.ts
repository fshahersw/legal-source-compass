/**
 * Damages-input reads for /law/calculators (datasets econ_bls_oews, econ_ssa_awi, econ_bls_cpi_areas). Read-only,
 * bounded PostgREST queries selecting only the JSON paths a view needs; memoized for 10 minutes, failures not cached.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { restGet } from "@/lib/external/rest.server";
import { memoAsync, READ_TTL_MS } from "@/lib/insights/readers/cache";
import {
  parseAwi,
  parseCpiArea,
  parseOccupationCodes,
  parseOewsArea,
  parseOewsCell,
  type AwiPoint,
  type CpiArea,
  type OewsArea,
  type OewsOccupation,
  type OewsWage,
} from "./damagesInputs";

export type OewsIndex = {
  release: string | null;
  occupations: OewsOccupation[];
  areas: OewsArea[];
};

const readOewsIndex = memoAsync(READ_TTL_MS, async (): Promise<OewsIndex> => {
  const [codes, areas] = await Promise.all([
    restGet<{ c: unknown }[]>(
      "corpus_records?select=c:item->codes&dataset=eq.econ_bls_oews&id=eq.oews:occupations&limit=1",
    ),
    restGet<{ id: string; a: unknown; t: unknown; u: unknown; r: unknown }[]>(
      "corpus_records?select=id,a:item->oews->>area,t:item->oews->>areatype,u:item->oews->>usps,r:item->oews->>release&dataset=eq.econ_bls_oews&id=neq.oews:occupations&order=ordinal.asc&limit=1000",
    ),
  ]);
  const release = areas.rows.find((r) => typeof r.r === "string")?.r;
  return {
    release: typeof release === "string" ? release : null,
    occupations: parseOccupationCodes(codes.rows[0]?.c),
    areas: areas.rows.flatMap((r) => {
      const a = parseOewsArea(r);
      return a ? [a] : [];
    }),
  };
});

export const getOewsIndex = createServerFn({ method: "GET" }).handler((): Promise<OewsIndex> =>
  readOewsIndex().catch((e: unknown) => {
    console.error("oews index", e);
    throw new Error("The BLS wage tables could not be read just now.");
  }),
);

export type OewsWageRow = {
  id: string;
  area: string;
  type: "N" | "S" | "M";
  release: string | null;
  sourceUrl: string | null;
  wage: OewsWage | null;
};

const areaId = z.string().regex(/^oews:[NSM]\d{7}$/);

/** One occupation's wages in the nation and up to four chosen areas (national always included). */
export const getOewsWages = createServerFn({ method: "GET" })
  .inputValidator((d) =>
    z.object({ soc: z.string().regex(/^\d{6}$/), areas: z.array(areaId).max(4) }).parse(d),
  )
  .handler(async ({ data }): Promise<OewsWageRow[]> => {
    const ids = [...new Set(["oews:N0000000", ...data.areas])];
    const res = await restGet<
      { id: string; a: unknown; t: unknown; r: unknown; w: unknown; source_url: unknown }[]
    >(
      `corpus_records?select=id,source_url,a:item->oews->>area,t:item->oews->>areatype,r:item->oews->>release,w:item->oews->occupations->${data.soc}&dataset=eq.econ_bls_oews&id=in.(${ids.join(",")})&limit=10`,
    ).catch((e: unknown) => {
      console.error("oews wages", e);
      throw new Error("The BLS wage tables could not be read just now.");
    });
    return ids.flatMap((id) => {
      const r = res.rows.find((x) => x.id === id);
      const area = r ? parseOewsArea({ id: r.id, a: r.a, t: r.t }) : null;
      if (!r || !area) return [];
      return [
        {
          id,
          area: area.area,
          type: area.type,
          release: typeof r.r === "string" ? r.r : null,
          sourceUrl:
            typeof r.source_url === "string" && /^https:\/\//.test(r.source_url)
              ? r.source_url
              : null,
          wage: parseOewsCell(r.w),
        },
      ];
    });
  });

const readAwi = memoAsync(READ_TTL_MS, async (): Promise<AwiPoint[]> => {
  const res = await restGet<{ awi: unknown; source_url: unknown }[]>(
    "corpus_records?select=awi:item->awi,source_url&dataset=eq.econ_ssa_awi&order=ordinal.asc&limit=200",
  );
  return res.rows
    .flatMap((r) => {
      const p = parseAwi(r);
      return p ? [p] : [];
    })
    .sort((a, b) => a.year - b.year);
});

export const getAwiSeries = createServerFn({ method: "GET" }).handler((): Promise<AwiPoint[]> =>
  readAwi().catch((e: unknown) => {
    console.error("ssa awi", e);
    throw new Error("The SSA wage index could not be read just now.");
  }),
);

const readCpiAreas = memoAsync(READ_TTL_MS, async (): Promise<CpiArea[]> => {
  const res = await restGet<{ cpi: unknown; source_url: unknown }[]>(
    "corpus_records?select=cpi:item->cpi,source_url&dataset=eq.econ_bls_cpi_areas&id=like.cpi:CUUR*&order=ordinal.asc&limit=200",
  );
  return res.rows
    .flatMap((r) => {
      const a = parseCpiArea(r);
      return a && a.annual.length >= 2 ? [a] : [];
    })
    .sort((a, b) => a.area.localeCompare(b.area));
});

export const getCpiAreas = createServerFn({ method: "GET" }).handler((): Promise<CpiArea[]> =>
  readCpiAreas().catch((e: unknown) => {
    console.error("cpi areas", e);
    throw new Error("The BLS CPI area series could not be read just now.");
  }),
);
