/**
 * Legislation server functions (read-only corpus reads through restGet): search over congress_bills and state_bills,
 * one federal bill, one state bill, the CRS reports that cite a bill, the bill behind a public law and a state's recent
 * enactments and pending bills. Search uses the GIN-indexed record filters for exact keys (Congress, type, number, law,
 * state, session, identifier) and the full-text index for words; nothing scans record text in the app.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  BILL_NUMBER,
  BILL_TYPES,
  CONGRESS,
  CRS_DATASET,
  FEDERAL_DATASET,
  LAW_NUMBER,
  SESSION,
  STATE,
  STATE_BILL_ID,
  STATE_DATASET,
  cs,
  federalId,
  federalSearchPath,
  obj,
  parseCrsHit,
  parseFacetOptions,
  parseFederalBill,
  parseFederalHit,
  parseStateBill,
  parseStateHit,
  stateSearchPath,
  str,
  type CrsHit,
  type FacetOption,
  type FederalBill,
  type FederalHit,
  type StateBill,
  type StateHit,
} from "./legislation";
import { restGet } from "./rest.server";

export const PAGE_SIZE = 25;
const MAX_PAGE = 200;

const searchInput = z.object({
  scope: z.enum(["federal", "state"]),
  q: z.string().max(200).default(""),
  congress: z.string().regex(CONGRESS).optional(),
  type: z.enum(BILL_TYPES).optional(),
  status: z
    .string()
    .regex(/^[a-z_]{2,30}$/)
    .optional(),
  policyArea: z.string().min(2).max(120).optional(),
  state: z.string().regex(STATE).optional(),
  session: z.string().regex(SESSION).optional(),
  page: z.number().int().min(1).max(MAX_PAGE).default(1),
});
export type LegislationSearchInput = z.input<typeof searchInput>;

export type LegislationSearchResult =
  | {
      scope: "federal";
      mode: string;
      rows: FederalHit[];
      total: number | null;
      page: number;
      pageSize: number;
      dropped: number;
    }
  | {
      scope: "state";
      mode: string;
      rows: StateHit[];
      total: number | null;
      page: number;
      pageSize: number;
      dropped: number;
    };

async function page(path: string, p: number) {
  const start = (p - 1) * PAGE_SIZE;
  return await restGet<unknown[]>(path, { count: true, range: [start, start + PAGE_SIZE - 1] });
}

export async function runLegislationSearch(
  input: LegislationSearchInput,
): Promise<LegislationSearchResult> {
  const d = searchInput.parse(input);
  if (d.scope === "federal") {
    const { path, mode } = federalSearchPath(d);
    const r = await page(path, d.page);
    const rows = r.rows.map(parseFederalHit).filter((x): x is FederalHit => !!x);
    return {
      scope: "federal",
      mode,
      rows,
      total: r.total,
      page: d.page,
      pageSize: PAGE_SIZE,
      dropped: r.rows.length - rows.length,
    };
  }
  let { path, mode } = stateSearchPath(d);
  let r = await page(path, d.page);
  if (mode === "identifier" && !r.rows.length && d.page === 1) {
    // "tax 2026" is identifier-shaped but meant as words: fall back to the word search
    ({ path, mode } = stateSearchPath(d, false));
    r = await page(path, d.page);
  }
  const rows = r.rows.map(parseStateHit).filter((x): x is StateHit => !!x);
  return {
    scope: "state",
    mode,
    rows,
    total: r.total,
    page: d.page,
    pageSize: PAGE_SIZE,
    dropped: r.rows.length - rows.length,
  };
}

export const searchLegislation = createServerFn({ method: "GET" })
  .inputValidator((d: LegislationSearchInput) => searchInput.parse(d))
  .handler(async ({ data }): Promise<LegislationSearchResult> => runLegislationSearch(data));

export type LegislationFacets = {
  federal: {
    ready: boolean | null;
    records: number | null;
    congresses: FacetOption[];
    types: FacetOption[];
    statuses: FacetOption[];
    policyAreas: FacetOption[];
    retrieved: string | null;
  } | null;
  state: {
    ready: boolean | null;
    records: number | null;
    states: FacetOption[];
    sessions: FacetOption[];
    statuses: FacetOption[];
    dumpDate: string | null;
  } | null;
};

/** Filter options and counts from each dataset's catalog listing (null when a dataset is not published). */
export const getLegislationFacets = createServerFn({ method: "GET" }).handler(
  async (): Promise<LegislationFacets> => {
    const r = await restGet<
      {
        id: unknown;
        ready: unknown;
        imported_records: unknown;
        listing: unknown;
        summary: unknown;
      }[]
    >(
      `corpus_datasets?select=id,ready,imported_records,listing:metadata->listing,summary:metadata->summary&id=in.(${FEDERAL_DATASET},${STATE_DATASET})`,
    );
    const fed = r.rows.find((x) => x.id === FEDERAL_DATASET);
    const st = r.rows.find((x) => x.id === STATE_DATASET);
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const dump = obj(obj(st?.summary)?.["dump"]);
    return {
      federal: fed
        ? {
            ready: typeof fed.ready === "boolean" ? fed.ready : null,
            records: n(fed.imported_records),
            congresses: parseFacetOptions(fed.listing, "congress"),
            types: parseFacetOptions(fed.listing, "type"),
            statuses: parseFacetOptions(fed.listing, "status"),
            policyAreas: parseFacetOptions(fed.listing, "policy_area"),
            retrieved: str(obj(fed.summary)?.["retrieved"], 20),
          }
        : null,
      state: st
        ? {
            ready: typeof st.ready === "boolean" ? st.ready : null,
            records: n(st.imported_records),
            states: parseFacetOptions(st.listing, "state"),
            sessions: parseFacetOptions(st.listing, "session"),
            statuses: parseFacetOptions(st.listing, "status"),
            dumpDate: str(dump?.["last_modified"], 60),
          }
        : null,
    };
  },
);

const federalInput = z.object({
  congress: z.string().regex(CONGRESS),
  type: z.enum(BILL_TYPES),
  number: z.string().regex(BILL_NUMBER),
});

export type FederalBillResult = { bill: FederalBill; crs: CrsHit[] } | null;

export async function readFederalBill(d: z.infer<typeof federalInput>): Promise<FederalBillResult> {
  const id = federalId(d.congress, d.type, d.number);
  const [r, crs] = await Promise.all([
    restGet<{ id: unknown; b: unknown }[]>(
      `corpus_records?select=id,b:detail->bill&dataset=eq.${FEDERAL_DATASET}&id=eq.${encodeURIComponent(id)}&limit=2`,
    ),
    restGet<unknown[]>(
      `corpus_records?select=id,source_url,c:item->cells&dataset=eq.${CRS_DATASET}&filters=cs.${cs({ related_bill: [id] })}&order=ordinal.asc&limit=20`,
    ).catch(() => ({ rows: [] as unknown[], total: null })),
  ]);
  if (r.rows.length !== 1) return null;
  const bill = parseFederalBill(id, r.rows[0]!.b);
  if (!bill) return null;
  return { bill, crs: crs.rows.map(parseCrsHit).filter((x): x is CrsHit => !!x) };
}

export const getFederalBill = createServerFn({ method: "GET" })
  .inputValidator((d: z.input<typeof federalInput>) => federalInput.parse(d))
  .handler(async ({ data }): Promise<FederalBillResult> => readFederalBill(data));

const stateInput = z.object({ id: z.string().regex(STATE_BILL_ID) });

export async function readStateBill(id: string): Promise<StateBill | null> {
  const r = await restGet<{ id: unknown; source_url: unknown; b: unknown }[]>(
    `corpus_records?select=id,source_url,b:detail->bill&dataset=eq.${STATE_DATASET}&id=eq.${encodeURIComponent(id)}&limit=2`,
  );
  if (r.rows.length !== 1) return null;
  return parseStateBill(id, r.rows[0]!.b, r.rows[0]!.source_url);
}

export const getStateBill = createServerFn({ method: "GET" })
  .inputValidator((d: z.input<typeof stateInput>) => stateInput.parse(d))
  .handler(async ({ data }): Promise<StateBill | null> => readStateBill(data.id));

export type StateLegislationSummary = {
  state: string;
  sessions: FacetOption[];
  enacted: StateHit[];
  enactedTotal: number | null;
  pending: StateHit[];
  pendingTotal: number | null;
  currentTotal: number | null;
} | null;

const LIST = "select=id,title,source_url,c:item->cells";

/** A state's recent enactments (became law or signed) and pending bills of the current session. */
export const getStateLegislation = createServerFn({ method: "GET" })
  .inputValidator((d: { state: string }) => z.object({ state: z.string().regex(STATE) }).parse(d))
  .handler(async ({ data }): Promise<StateLegislationSummary> => {
    const st = data.state;
    const base = `corpus_records?${LIST}&dataset=eq.${STATE_DATASET}`;
    const [facets, enacted, pending, current] = await Promise.all([
      restGet<{ listing: unknown }[]>(
        `corpus_datasets?select=listing:metadata->listing&id=eq.${STATE_DATASET}&limit=1`,
      ),
      restGet<unknown[]>(
        `${base}&filters=cs.${cs({ state: [st], outcome: ["enacted"] })}&order=ordinal.asc`,
        {
          count: true,
          range: [0, 5],
        },
      ),
      restGet<unknown[]>(
        `${base}&filters=cs.${cs({ state: [st], session_role: ["current"], outcome: ["none"] })}&order=ordinal.asc`,
        { count: true, range: [0, 5] },
      ),
      restGet<unknown[]>(
        `corpus_records?select=id&dataset=eq.${STATE_DATASET}&filters=cs.${cs({ state: [st], session_role: ["current"] })}`,
        { count: true, range: [0, 0] },
      ),
    ]);
    if (!facets.rows.length) return null;
    const sessions = parseFacetOptions(facets.rows[0]!.listing, "session").filter(
      (s) => s.state === st,
    );
    return {
      state: st,
      sessions,
      enacted: enacted.rows.map(parseStateHit).filter((x): x is StateHit => !!x),
      enactedTotal: enacted.total,
      pending: pending.rows.map(parseStateHit).filter((x): x is StateHit => !!x),
      pendingTotal: pending.total,
      currentTotal: current.total,
    };
  });

const lawInput = z.object({
  congress: z.string().regex(CONGRESS),
  number: z.string().regex(/^[1-9]\d{0,3}$/),
});

export type BillForLawResult = { law: string; bills: FederalHit[] };

/** The measure(s) whose Bill Status <laws> lists this public law number (exact Congress-number key). */
export async function readBillForLaw(d: z.infer<typeof lawInput>): Promise<BillForLawResult> {
  const law = `${d.congress}-${d.number}`;
  if (!LAW_NUMBER.test(law)) return { law, bills: [] };
  const r = await restGet<unknown[]>(
    `corpus_records?${LIST}&dataset=eq.${FEDERAL_DATASET}&filters=cs.${cs({ law: [law] })}&order=ordinal.asc&limit=5`,
  );
  return { law, bills: r.rows.map(parseFederalHit).filter((x): x is FederalHit => !!x) };
}

export const getBillForLaw = createServerFn({ method: "GET" })
  .inputValidator((d: z.input<typeof lawInput>) => lawInput.parse(d))
  .handler(async ({ data }): Promise<BillForLawResult> => readBillForLaw(data));
