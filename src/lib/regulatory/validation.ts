import { z } from "zod";
import { REGULATORY_EVENT_TYPES, REGULATORY_REVIEW_STATUSES, REGULATORY_SOURCE_IDS } from "./types";

export const civilDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const d = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
  }, "Enter an exact calendar date.");
export const regulatoryQuerySchema = z
  .object({
    q: z.string().trim().max(300).optional(),
    source: z.enum(REGULATORY_SOURCE_IDS).optional(),
    sourceFamily: z.enum(["fda", "nhtsa", "cpsc", "federal_register"]).optional(),
    eventType: z.enum(REGULATORY_EVENT_TYPES).optional(),
    from: civilDateSchema.optional(),
    to: civilDateSchema.optional(),
    dateBasis: z.enum(["detected", "published"]).optional(),
    entityNamespace: z.string().min(1).max(100).optional(),
    entityId: z.string().min(1).max(300).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().min(0).max(10000).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.from && data.to && data.from > data.to)
      ctx.addIssue({
        code: "custom",
        message: "The end date precedes the start date.",
        path: ["to"],
      });
    if (Boolean(data.entityNamespace) !== Boolean(data.entityId))
      ctx.addIssue({
        code: "custom",
        message: "An entity requires its exact namespace and native ID.",
        path: ["entityId"],
      });
  });
export const regulatoryEntityQuerySchema = z
  .object({
    q: z.string().trim().max(300).optional(),
    source: z.enum(REGULATORY_SOURCE_IDS).optional(),
    sourceFamily: z.enum(["fda", "nhtsa", "cpsc", "federal_register"]).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().min(0).max(10000).optional(),
  })
  .strict();
export const regulatoryDetailSchema = z
  .object({ source: z.enum(REGULATORY_SOURCE_IDS), nativeId: z.string().min(1).max(500) })
  .strict();
export const regulatoryTrendSchema = regulatoryQuerySchema.refine(
  ({ from, to }) =>
    Boolean(from && to && to >= from && Date.parse(to) - Date.parse(from) <= 366 * 86400000),
  "Trend windows must be ordered and no longer than 366 days.",
);
export const organizationSchema = z.object({ organizationId: z.string().uuid() }).strict();
const privateBase = { organizationId: z.string().uuid() };
const investigationId = z.string().uuid().nullable().optional();
export const investigationInputSchema = z
  .object({
    ...privateBase,
    id: z.string().uuid().optional(),
    title: z.string().trim().min(1).max(200),
    description: z.string().max(10000),
  })
  .strict();
export const watchlistInputSchema = z
  .object({
    ...privateBase,
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(200),
    investigationId,
    query: regulatoryQuerySchema,
  })
  .strict();
export const reviewInputSchema = z
  .object({
    ...privateBase,
    eventId: z.string().regex(/^[a-f0-9]{64}$/),
    status: z.enum(REGULATORY_REVIEW_STATUSES),
    note: z.string().trim().min(1).max(10000),
    investigationId,
  })
  .strict();
export const briefInputSchema = z
  .object({
    ...privateBase,
    title: z.string().trim().min(1).max(200),
    investigationId,
    eventIds: z
      .array(z.string().regex(/^[a-f0-9]{64}$/))
      .min(1)
      .max(50)
      .refine((ids) => new Set(ids).size === ids.length, "Select each event once."),
    query: regulatoryQuerySchema,
  })
  .strict();
