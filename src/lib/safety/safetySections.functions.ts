/**
 * Server reads for the Products & safety sections: the NHTSA investigation pipeline, CPSC recalls whose injury text
 * reports a death, the device class × PMA map and the litigation reporting context (REST reads of corpus datasets), and
 * the safety-nhtsa-windows/1 RPCs (complaint surge radar, a recall's effect on complaints, OSHA silica citations).
 * A missing RPC (contract not applied yet) returns null, so those sections show a "not loaded yet" note, never an error.
 * Memoized for 10 minutes; only aggregates and the listed rows reach the browser.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { restGet, rpcPostOptional } from "@/lib/external/rest.server";
import { readAllRows } from "@/lib/analytics/tally.server";
import { latestDate } from "@/lib/analytics/shared.server";
import { memoAsync, READ_TTL_MS } from "@/lib/insights/readers/cache";
import {
  buildNhtsaPipeline,
  type InvestigationRow,
  type NhtsaPipelinePayload,
  type RecallRow,
} from "./nhtsaPipeline";
import {
  buildCpscDeaths,
  CPSC_API_DATASET,
  DEATH_CANDIDATE_PG,
  TITLE_DEATH_CANDIDATE_PG,
  type CpscDeathRow,
  type CpscDeathsPayload,
} from "./cpscDeaths";
import {
  buildDeviceRisk,
  CLASSIFICATION_DATASET,
  PMA_DATASET,
  type ClassificationRow,
  type DeviceRiskPayload,
  type PmaRow,
} from "./deviceRisk";
import { parseLawyerYears, type LawyerSeries, type MdlTransfer } from "./reportingContext";
import type { ComplaintWindows, OshaSilica, RecallComplaints } from "./safetyWindows";

const fail = (what: string) => (e: unknown) => {
  console.error(what, e);
  throw new Error("This data could not be read just now.");
};

// ------------------------------------------------------------------------------------------------ NHTSA pipeline
const INV_SELECT =
  "id,type:item->cells->>type,opened:item->cells->>opened,closed:item->cells->>closed,recall:item->cells->>recall,mfr:item->cells->>manufacturer,subject:item->cells->>subject";
const REC_SELECT =
  "id,date:item->cells->>date,mfr:item->cells->>manufacturer,inf:item->recall->>influenced_by,dnd:item->recall->>do_not_drive,po:item->recall->>park_outside,pa:item->recall->>potentially_affected";

const readPipeline = memoAsync(READ_TTL_MS, async (): Promise<NhtsaPipelinePayload> => {
  const [inv, rec] = await Promise.all([
    readAllRows<InvestigationRow>(
      `corpus_records?select=${INV_SELECT}&dataset=eq.agency_safety_nhtsa_investigations&order=ordinal.asc,id.asc`,
      { max: 20_000 },
    ),
    readAllRows<RecallRow>(
      `corpus_records?select=${REC_SELECT}&dataset=eq.agency_safety_nhtsa_recalls&order=ordinal.asc,id.asc`,
      { max: 40_000 },
    ),
  ]);
  return buildNhtsaPipeline(inv, rec, new Date().toISOString());
});

export const getNhtsaPipeline = createServerFn({ method: "GET" }).handler(
  async (): Promise<NhtsaPipelinePayload> => readPipeline().catch(fail("nhtsa pipeline")),
);

// ------------------------------------------------------------------------------------------------ CPSC deaths
const CPSC_SELECT =
  "id,title,date:item->cells->>date,tag:item->cells->>death_mention,injuries:item->recall->>injuries,hazard:item->cells->>hazard,firm:item->cells->>firm,url:item->recall->>url";

const readCpscDeaths = memoAsync(READ_TTL_MS, async (): Promise<CpscDeathsPayload> => {
  // Rows the dataset tags with a death (Product-related, Background), plus untagged rows whose injury statement or
  // title has a death-like word; buildCpscDeaths decides which of the latter report a death.
  const base = `corpus_records?select=${CPSC_SELECT}&dataset=eq.${CPSC_API_DATASET}`;
  const re = encodeURIComponent(DEATH_CANDIDATE_PG);
  const [tagged, byText, byTitle, meta, through] = await Promise.all([
    readAllRows<CpscDeathRow>(
      `${base}&item->cells->>death_mention=neq.No&order=ordinal.asc,id.asc`,
      { max: 5_000 },
    ),
    readAllRows<CpscDeathRow>(
      `${base}&item->recall->>injuries=imatch.${re}&order=ordinal.asc,id.asc`,
      { max: 5_000 },
    ),
    readAllRows<CpscDeathRow>(
      `${base}&item->cells->>death_mention=eq.No&title=imatch.${encodeURIComponent(TITLE_DEATH_CANDIDATE_PG)}&order=ordinal.asc,id.asc`,
      { max: 5_000 },
    ),
    restGet<{ imported_records: number | null }[]>(
      `corpus_datasets?select=imported_records&id=eq.${CPSC_API_DATASET}&limit=1`,
    ),
    latestDate(CPSC_API_DATASET, "item->cells->>date", "item->cells->>date"),
  ]);
  return buildCpscDeaths(
    [...tagged, ...byText, ...byTitle],
    meta.rows[0]?.imported_records ?? null,
    through,
    new Date().toISOString(),
  );
});

export const getCpscDeaths = createServerFn({ method: "GET" }).handler(
  async (): Promise<CpscDeathsPayload> => readCpscDeaths().catch(fail("cpsc deaths")),
);

// ------------------------------------------------------------------------------------------------ device risk map
const readDeviceRisk = memoAsync(READ_TTL_MS, async (): Promise<DeviceRiskPayload> => {
  const [cls, pma] = await Promise.all([
    readAllRows<ClassificationRow>(
      `corpus_records?select=pc:item->cells->>product_code,name:item->cells->>device_name,cls:item->cells->>device_class,implant:item->cells->>implant_flag,life:item->cells->>life_sustain_support_flag&dataset=eq.${CLASSIFICATION_DATASET}&order=ordinal.asc,id.asc`,
      { max: 20_000 },
    ),
    readAllRows<PmaRow>(
      `corpus_records?select=pc:item->>product_code,nid:item->>native_id,dd:item->dates->>decision_date&dataset=eq.${PMA_DATASET}&order=ordinal.asc,id.asc`,
      { max: 120_000, concurrency: 6 },
    ),
  ]);
  return buildDeviceRisk(cls, pma, new Date().toISOString());
});

export const getDeviceRisk = createServerFn({ method: "GET" }).handler(
  async (): Promise<DeviceRiskPayload> => readDeviceRisk().catch(fail("device risk")),
);

// ------------------------------------------------------------------------------------------------ reporting context
export type ReportingContextPayload = { transfers: MdlTransfer[]; lawyer: LawyerSeries[] };

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

export const getReportingContext = createServerFn({ method: "GET" })
  .inputValidator((d: { mdls: number[] }) =>
    z.object({ mdls: z.array(z.number().int().min(1).max(999_999)).min(1).max(12) }).parse(d),
  )
  .handler(async ({ data }): Promise<ReportingContextPayload> => {
    const ids = [...new Set(data.mdls)].join(",");
    const [mdls, faers] = await Promise.all([
      restGet<Record<string, unknown>[]>(
        `corpus_records?select=id,source_url,title:item->>title,transferred:item->>date_transferred,pending:item->>actions_pending,total:item->>total_actions&dataset=eq.mdls&id=in.(${ids})`,
      ),
      restGet<Record<string, unknown>[]>(
        `corpus_records?select=id,source_url,product:item->>product,series:item->series&dataset=eq.fda_faers_product_series&id=in.(${ids})`,
      ),
    ]).catch(fail("reporting context"));
    return {
      transfers: mdls.rows.map((r) => ({
        mdl: Number(r["id"]),
        title: typeof r["title"] === "string" ? r["title"] : null,
        transferred: typeof r["transferred"] === "string" ? r["transferred"] : null,
        pending: num(r["pending"]),
        total: num(r["total"]),
        sourceUrl: typeof r["source_url"] === "string" && r["source_url"] ? r["source_url"] : null,
      })),
      lawyer: faers.rows.map((r) => ({
        mdl: Number(r["id"]),
        product: typeof r["product"] === "string" ? r["product"] : null,
        search: typeof r["source_url"] === "string" && r["source_url"] ? r["source_url"] : null,
        sourceUrl: typeof r["source_url"] === "string" && r["source_url"] ? r["source_url"] : null,
        years: parseLawyerYears(r["series"]),
      })),
    };
  });

// ------------------------------------------------------------------------------------------------ RPCs (windows/1)
const readWindows = memoAsync(READ_TTL_MS, () =>
  rpcPostOptional<ComplaintWindows>("safety_nhtsa_complaint_windows_v1", {
    p_as_of: null,
    p_min: 50,
    p_limit: 60,
  }),
);

export const getComplaintWindows = createServerFn({ method: "GET" }).handler(
  async (): Promise<ComplaintWindows | null> => readWindows().catch(fail("complaint windows")),
);

const readSilica = memoAsync(READ_TTL_MS, () =>
  rpcPostOptional<OshaSilica>("safety_osha_silica_v1", {}),
);

export const getOshaSilica = createServerFn({ method: "GET" }).handler(
  async (): Promise<OshaSilica | null> => readSilica().catch(fail("osha silica")),
);

const recallMemo = new Map<string, () => Promise<RecallComplaints | null>>();

export const getRecallComplaints = createServerFn({ method: "GET" })
  .inputValidator((d: { campaign: string }) =>
    z.object({ campaign: z.string().regex(/^\d{2}[VEITC]\d{3}000$/) }).parse(d),
  )
  .handler(async ({ data }): Promise<RecallComplaints | null> => {
    let read = recallMemo.get(data.campaign);
    if (!read) {
      if (recallMemo.size > 500) recallMemo.clear();
      read = memoAsync(READ_TTL_MS, () =>
        rpcPostOptional<RecallComplaints | null>("safety_nhtsa_recall_complaints_v1", {
          p_campaign: data.campaign,
        }),
      );
      recallMemo.set(data.campaign, read);
    }
    return read().catch(fail("recall complaints"));
  });
