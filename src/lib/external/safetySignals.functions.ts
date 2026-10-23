/**
 * Server functions over safety/1 (database/contracts/safety-signals-v1.sql): product and device subjects, their monthly
 * series, reaction / problem breakdowns, record lists, company profiles and the MDL product signal timeline. Read-only
 * RPCs with the server-side corpus key; nothing reaches the browser but the RPC results. A missing RPC (the contract is
 * not applied yet) returns null, so the pages show their "not loaded yet" state instead of an error.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { rpcPostOptional } from "./rest.server";
import type {
  SafetyBreakdown,
  SafetyCompanyProfile,
  SafetyRecordPage,
  SafetySignalRow,
  SafetySubjectList,
  SafetySubjectProfile,
  SafetyTermPeriods,
} from "@/components/safety/products/productModel";

const SUBJECT_ID = /^[a-z][a-z0-9_]{1,20}:[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const subjectId = z.string().regex(SUBJECT_ID);

export const getSafetySubjects = createServerFn({ method: "GET" })
  .inputValidator((d) =>
    z
      .object({
        type: z.enum(["product", "device_code", "mdl_group"]).nullable(),
        kind: z
          .string()
          .regex(/^[a-z_]{2,20}$/)
          .nullable(),
        q: z.string().max(100).nullable(),
        limit: z.number().int().min(1).max(100),
        offset: z.number().int().min(0).max(100000),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<SafetySubjectList | null> =>
    rpcPostOptional<SafetySubjectList>("safety_subjects_v1", {
      p_type: data.type,
      p_kind: data.kind,
      p_q: data.q && data.q.trim() ? data.q.trim() : null,
      p_limit: data.limit,
      p_offset: data.offset,
    }),
  );

export const getSafetySubject = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: subjectId }).parse(d))
  .handler(async ({ data }): Promise<SafetySubjectProfile | null> =>
    rpcPostOptional<SafetySubjectProfile | null>("safety_subject_v1", { p_id: data.id }),
  );

export const getSafetyBreakdown = createServerFn({ method: "GET" })
  .inputValidator((d) =>
    z
      .object({
        id: subjectId,
        dim: z.enum([
          "meddra_pt",
          "device_problem",
          "patient_problem",
          "brand_name",
          "manufacturer",
        ]),
        period: z.string().regex(/^(all|[12][0-9]{3}(-Q[1-4])?)$/),
        limit: z.number().int().min(1).max(1000),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<SafetyBreakdown | null> =>
    rpcPostOptional<SafetyBreakdown>("safety_breakdown_v1", {
      p_id: data.id,
      p_dim: data.dim,
      p_period: data.period,
      p_limit: data.limit,
    }),
  );

export const getSafetyTermPeriods = createServerFn({ method: "GET" })
  .inputValidator((d) =>
    z
      .object({
        id: subjectId,
        dim: z.enum(["meddra_pt", "device_problem"]),
        top: z.number().int().min(1).max(30),
        // first period shown (quarter or calendar year); rows are the terms most reported from then on
        from: z
          .string()
          .regex(/^[12][0-9]{3}(-Q[1-4])?$/)
          .nullable()
          .optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<SafetyTermPeriods | null> =>
    rpcPostOptional<SafetyTermPeriods>("safety_term_quarters_v1", {
      p_id: data.id,
      p_dim: data.dim,
      p_terms: null,
      p_from: data.from ?? null,
      p_to: null,
      p_top: data.top,
    }),
  );

export const getSafetyRecords = createServerFn({ method: "GET" })
  .inputValidator((d) =>
    z
      .object({
        source: z.enum(["maude", "nhtsa", "neiss", "cfpb", "osha", "osha_accidents"]),
        subject: subjectId.nullable(),
        q: z.string().max(100).nullable(),
        from: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable(),
        to: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable(),
        filter: z.record(z.string(), z.string().max(200)).default({}),
        limit: z.number().int().min(1).max(100),
        offset: z.number().int().min(0).max(5000),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<SafetyRecordPage | null> =>
    rpcPostOptional<SafetyRecordPage>("safety_records_v1", {
      p_source: data.source,
      p_subject: data.subject,
      p_q: data.q && data.q.trim() ? data.q.trim() : null,
      p_from: data.from,
      p_to: data.to,
      p_filter: data.filter,
      p_limit: data.limit,
      p_offset: data.offset,
    }),
  );

export const getProductSignals = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ mdl: z.number().int().min(1).max(99999) }).parse(d))
  .handler(async ({ data }): Promise<SafetySignalRow[] | null> =>
    rpcPostOptional<SafetySignalRow[]>("product_signals_v1", { p_mdl: String(data.mdl) }),
  );

export const getSafetyCompany = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ name: z.string().min(2).max(200) }).parse(d))
  .handler(async ({ data }): Promise<SafetyCompanyProfile | null> =>
    rpcPostOptional<SafetyCompanyProfile>("safety_company_profile_v1", { p_name: data.name }),
  );
