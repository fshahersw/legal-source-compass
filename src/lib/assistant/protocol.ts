/** Request and stream-event contract between the assistant panel and /api/assistant. Shared by client and server. */
import { z } from "zod";

export const MEMORY_MESSAGES = 8;
export const MAX_ROUNDS = 23;
export const MAX_MESSAGE_CHARS = 8000;
export const MAX_PAGE_TEXT = 14000;
export const MAX_ATTACHMENTS = 3;
export const MAX_ATTACHMENT_BYTES = 6 * 1024 * 1024;

export const ATTACHMENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "text/csv",
  "text/markdown",
  "application/json",
] as const;

const message = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string().min(1).max(MAX_MESSAGE_CHARS),
  })
  .strict();

const attachment = z
  .object({
    name: z.string().min(1).max(200),
    type: z.enum(ATTACHMENT_TYPES),
    /** Base64 without a data: prefix. */
    data: z
      .string()
      .min(1)
      .max(Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3) + 8)
      .regex(/^[A-Za-z0-9+/=]+$/),
  })
  .strict();

export const pageContextSchema = z
  .object({
    path: z.string().max(600),
    title: z.string().max(300),
    headings: z.array(z.string().max(200)).max(40),
    text: z.string().max(MAX_PAGE_TEXT),
    selection: z.string().max(3000),
    focus: z.string().max(300),
    dialog: z.string().max(3000),
    viewport: z.string().max(40),
  })
  .strict();

export const assistantRequestSchema = z
  .object({
    messages: z
      .array(message)
      .min(1)
      .max(MEMORY_MESSAGES)
      .refine((m) => m[m.length - 1]!.role === "user", "The last message must be the user's."),
    page: pageContextSchema.nullable(),
    attachments: z.array(attachment).max(MAX_ATTACHMENTS),
  })
  .strict();

export type AssistantMessage = z.infer<typeof message>;
export type AssistantAttachment = z.infer<typeof attachment>;
export type PageContext = z.infer<typeof pageContextSchema>;
export type AssistantRequest = z.infer<typeof assistantRequestSchema>;

/** A step the agent took, phrased for people; tool and vendor names never appear. */
export type AssistantStep = {
  id: string;
  label: string;
  detail: string;
  state: "running" | "done" | "failed";
};
export type AssistantSource = { title: string; url: string; internal: boolean };

export type AssistantEvent =
  | { type: "round"; round: number }
  | { type: "step"; step: AssistantStep }
  | { type: "delta"; round: number; text: string }
  | { type: "done"; text: string; sources: AssistantSource[]; rounds: number }
  | { type: "error"; message: string };

export function encodeEvent(event: AssistantEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/** Keep only the rolling memory the server accepts: the last eight messages, ending with the user's. */
export function rollingMemory(messages: AssistantMessage[]): AssistantMessage[] {
  const trimmed = messages
    .filter((m) => m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) }));
  let tail = trimmed.slice(-MEMORY_MESSAGES);
  while (tail.length && tail[0]!.role !== "user") tail = tail.slice(1);
  return tail;
}
