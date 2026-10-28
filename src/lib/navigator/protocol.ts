/**
 * Contract between the navigator panel and /api/navigator. The navigator is the in-app agent that moves through the
 * site, reads pages and works their controls. Its loop runs on the server, but the tools that touch the page run in
 * the browser: when the model asks for one, the server pauses, hands the calls to the browser with a signed
 * transcript, and resumes when the browser posts the results back. Shared by client and server.
 */
import { z } from "zod";
import { pageContextSchema } from "@/lib/assistant/protocol";

export const NAV_MAX_ROUNDS = 30;
export const NAV_MEMORY_MESSAGES = 6;
export const NAV_MAX_MESSAGE_CHARS = 6000;
/** Bound on one browser tool result sent back to the server. */
export const NAV_MAX_RESULT_CHARS = 16000;
/** Bound on the signed transcript the browser round-trips (characters). */
export const NAV_MAX_TRANSCRIPT_CHARS = 1_500_000;

/** Tools that run in the browser, on the page the user is looking at. */
export const CLIENT_TOOL_NAMES = [
  "go_to",
  "read_page",
  "read_chart",
  "find_links",
  "click",
  "type_into",
  "scroll_to",
] as const;
export type ClientToolName = (typeof CLIENT_TOOL_NAMES)[number];
export const isClientTool = (name: string): name is ClientToolName =>
  (CLIENT_TOOL_NAMES as readonly string[]).includes(name);

export type ToolSchema = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export const CLIENT_TOOL_DEFINITIONS: ToolSchema[] = [
  {
    name: "go_to",
    description:
      "Open a page of this site in the user's browser and wait for it to finish loading. Give a path that starts with / (for example /safety/products?view=drugs&q=ozempic, /matters/3140, /companies/0000078003). Returns the page's title, headings, section index and the charts it shows. Use site_map first when you are not sure which page holds what you need.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Site path with optional query, starting with /." },
      },
      required: ["path"],
    },
  },
  {
    name: "read_page",
    description:
      "Read the page the user is on now: path, title, headings, section ids, every chart card with its title, subtitle, sources and the first rows of its data table, and the visible text. Call after a click or a filter change to see the new state.",
    input_schema: {
      type: "object",
      properties: {
        section: {
          type: "string",
          description: "Optional section id (from the section index) to read only that section.",
        },
      },
    },
  },
  {
    name: "read_chart",
    description:
      "Read more rows of one chart's data table on the current page (the chart number comes from read_page or go_to). Rows are the exact figures behind the chart.",
    input_schema: {
      type: "object",
      properties: {
        chart: { type: "integer", minimum: 0, description: "Chart number from read_page." },
        offset: { type: "integer", minimum: 0, description: "First row to return (default 0)." },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 200,
          description: "Rows to return (default 60).",
        },
      },
      required: ["chart"],
    },
  },
  {
    name: "find_links",
    description:
      "List links on the current page that lead to other pages of this site (text and path), optionally only those whose text or path contains some words. Use it to find the profile or record page of something listed on screen.",
    input_schema: {
      type: "object",
      properties: {
        contains: {
          type: "string",
          description: "Optional words the link text or path must contain.",
        },
        section: { type: "string", description: "Optional section id to search within." },
      },
    },
  },
  {
    name: "click",
    description:
      "Click a button, tab, toggle or link on the current page by its visible label or accessible name (for example 'Type', 'Year centralized', 'Devices (MAUDE)', 'Play'). Downloads, sign-in, deleting and leaving the site are not allowed. Returns what changed.",
    input_schema: {
      type: "object",
      properties: {
        label: { type: "string", description: "The control's visible text or accessible name." },
        section: {
          type: "string",
          description: "Optional section id to look in, when the label repeats.",
        },
      },
      required: ["label"],
    },
  },
  {
    name: "type_into",
    description:
      "Type text into a search or filter box on the current page, found by its placeholder or accessible name (for example 'Find a company, MDL or product'). Clears the box first; returns what changed.",
    input_schema: {
      type: "object",
      properties: {
        label: { type: "string", description: "The box's placeholder or accessible name." },
        text: { type: "string", description: "What to type (at most 200 characters)." },
      },
      required: ["label", "text"],
    },
  },
  {
    name: "scroll_to",
    description:
      "Scroll the user's view to a section (by section id) or to the first element containing some text, and highlight it so the user can see what you are pointing at.",
    input_schema: {
      type: "object",
      properties: {
        section: { type: "string" },
        text: { type: "string" },
      },
    },
  },
];

const message = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string().min(1).max(NAV_MAX_MESSAGE_CHARS),
  })
  .strict();

const toolResult = z
  .object({
    id: z.string().min(1).max(100),
    content: z.string().max(NAV_MAX_RESULT_CHARS + 200),
    is_error: z.boolean().optional(),
  })
  .strict();

export const resumeSchema = z
  .object({
    transcript: z.string().min(2).max(NAV_MAX_TRANSCRIPT_CHARS),
    signature: z.string().regex(/^[a-f0-9]{64}$/),
    round: z.number().int().min(1).max(NAV_MAX_ROUNDS),
    /** Ids of the browser tool calls the server is waiting for, in the signed order. */
    pending: z.array(z.string().max(100)).min(1).max(20),
    results: z.array(toolResult).min(1).max(20),
  })
  .strict();

export const navigatorRequestSchema = z
  .object({
    messages: z
      .array(message)
      .min(1)
      .max(NAV_MEMORY_MESSAGES)
      .refine((m) => m[m.length - 1]!.role === "user", "The last message must be the user's."),
    page: pageContextSchema.nullable(),
    resume: resumeSchema.nullish(),
  })
  .strict();

export type NavigatorRequest = z.infer<typeof navigatorRequestSchema>;
export type NavigatorResume = z.infer<typeof resumeSchema>;
export type ClientCall = { id: string; name: ClientToolName; input: Record<string, unknown> };
export type NavigatorStep = {
  id: string;
  label: string;
  detail: string;
  state: "running" | "done" | "failed";
  /** The page the step happened on or opened, for the trail. */
  path?: string | undefined;
};
export type NavigatorSource = { title: string; url: string; internal: boolean };

export type NavigatorEvent =
  | { type: "round"; round: number }
  | { type: "step"; step: NavigatorStep }
  | { type: "delta"; round: number; text: string }
  | {
      type: "client_tools";
      calls: ClientCall[];
      resume: { transcript: string; signature: string; round: number; pending: string[] };
    }
  | { type: "done"; text: string; sources: NavigatorSource[]; rounds: number }
  | { type: "error"; message: string };

export function encodeNavigatorEvent(event: NavigatorEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/** A site path the navigator may open: same-site, no protocol-relative or API paths, bounded. */
export function safeSitePath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const p = raw.trim();
  if (!/^\/(?!\/)[^\s<>"'\\]{0,600}$/.test(p)) return null;
  if (/^\/(api|_serverFn|_build|assets)(\/|$|\?)/i.test(p)) return null;
  if (/^\/(auth|login|sign-?in|sign-?out|reset-password|account)(\/|$|\?)/i.test(p)) return null;
  return p;
}

/** Labels of controls the navigator never presses. */
export const FORBIDDEN_LABEL =
  /\b(delete|remove|erase|clear all|sign[ -]?(in|out|up)|log[ -]?(in|out)|password|download|export|csv|xlsx|print|share|copy link|subscribe|unsubscribe|send|submit|pay|purchase|buy)\b/i;
