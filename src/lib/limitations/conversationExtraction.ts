import { z } from "zod";
import { SCREENING_QUESTIONS } from "./exceptionReview";
import { STATES } from "@/lib/corpus/geo";
import { CLAIM_TYPES } from "./types";

export const CONVERSATION_BASE_DATE_FIELDS = [
  "accrualDate",
  "injuryDate",
  "actualDiscoveryDate",
  "constructiveDiscoveryDate",
  "diagnosisCommunicationDate",
  "deathDate",
  "causeDiscoveryDate",
  "firstProductDeliveryDate",
  "qualifyingExposureDate",
  "substantialCompletionDate",
  "reposeActDate",
  "birthDate",
] as const;
export const SUPPLEMENTAL_CONVERSATION_DATE_FIELDS = [
  "priorFilingDate",
  "dismissalDate",
  "refilingDate",
  "serviceDate",
  "agreementStartDate",
  "agreementEndDate",
  "bankruptcyStartDate",
  "bankruptcyEndDate",
  "militaryStartDate",
  "militaryEndDate",
  "capacityStartDate",
  "capacityEndDate",
  "concealmentEndDate",
  "treatmentEndDate",
  "representationEndDate",
  "representativeAppointmentDate",
  "noticeDate",
] as const;
export const CONVERSATION_DATE_FIELDS = [
  ...CONVERSATION_BASE_DATE_FIELDS,
  ...SUPPLEMENTAL_CONVERSATION_DATE_FIELDS,
] as const;
export const CONVERSATION_FACT_FIELDS = [
  "jurisdiction",
  "claimType",
  "subtype",
  "forumState",
  "eventState",
  "residenceState",
  "vitalStatus",
  ...CONVERSATION_DATE_FIELDS,
  ...SCREENING_QUESTIONS.map(({ id }) => `screen:${id}` as const),
  "screen:calendar",
] as const;
export type ConversationFactField = (typeof CONVERSATION_FACT_FIELDS)[number];
export const CONVERSATION_MAX_MESSAGES = 100;
export const CONVERSATION_MAX_MESSAGE_LENGTH = 8_000;
export const CONVERSATION_MAX_CHARACTERS = 40_000;

const field = z.enum(CONVERSATION_FACT_FIELDS);
const message = z
  .object({
    id: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9_-]+$/),
    role: z.enum(["user", "assistant"]),
    content: z.string().min(1).max(CONVERSATION_MAX_MESSAGE_LENGTH),
  })
  .strict();
export const conversationExtractionInputSchema = z
  .object({
    messages: z.array(message).min(1).max(CONVERSATION_MAX_MESSAGES),
    /** Existing user selections only filter the authoritative server catalog; no client rule data. */
    selection: z
      .object({
        jurisdiction: z.string().refine((value) => STATES.some((state) => state.usps === value)),
        claimType: z.enum(CLAIM_TYPES),
        subtype: z
          .string()
          .regex(/^[a-z0-9_:-]{1,150}$/)
          .optional(),
      })
      .strict()
      .optional(),
    latestQuestion: z
      .object({
        id: z.string().min(1).max(128),
        kind: z.enum(["fact", "confirm_facts", "scenario", "clarify"]),
        field: field.optional(),
        text: z.string().min(1).max(2_000),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.messages.reduce((total, turn) => total + turn.content.length, 0) >
      CONVERSATION_MAX_CHARACTERS
    )
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Conversation is too long." });
    if (new Set(value.messages.map((turn) => turn.id)).size !== value.messages.length)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Message identifiers must be unique.",
      });
    if (value.messages.at(-1)?.role !== "user")
      context.addIssue({ code: z.ZodIssueCode.custom, message: "A new user message is required." });
  });
export type ConversationExtractionInput = z.infer<typeof conversationExtractionInputSchema>;

/** A proposed fact, never a confirmation, source review decision, period, or deadline. */
export const conversationCandidateSchema = z
  .object({
    field,
    value: z.string().min(1).max(200).nullable(),
    certainty: z.enum(["stated", "uncertain", "unknown"]),
    evidence: z
      .object({
        messageId: z.string().min(1).max(64),
        quote: z.string().min(1).max(2_000),
        /** Optional earlier user quote for an explicit, unambiguous "same day" reference. */
        reference: z
          .object({
            messageId: z.string().min(1).max(64),
            quote: z.string().min(1).max(2_000),
          })
          .strict()
          .optional(),
      })
      .strict(),
    replaces: z.boolean(),
  })
  .strict();
export type ConversationCandidate = z.infer<typeof conversationCandidateSchema>;
export const conversationModelOutputSchema = z
  .object({
    candidates: z.array(conversationCandidateSchema).max(64),
  })
  .strict();

export type ConversationCapability = {
  configured: boolean;
  providerName: "Google Gemini" | "Lovable AI" | null;
};
export type ConversationExtractionResult =
  | {
      status: "extracted";
      providerName: "Google Gemini" | "Lovable AI";
      candidates: ConversationCandidate[];
      /** Fixed application wording, never model legal advice. */
      conflicts: string[];
      clarifications: string[];
    }
  | {
      status: "unavailable";
      reason:
        "not_configured" | "provider_error" | "invalid_response" | "busy" | "source_unavailable";
      message: string;
    }
  | { status: "invalid_input"; message: string };
