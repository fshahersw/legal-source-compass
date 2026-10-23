/**
 * Assistant tool that searches the stored official oversight and accountability reports: public reports of the federal
 * Inspectors General (Oversight.gov), the DOJ OIG's own report pages, the Office of Special Counsel's publications and
 * whistleblower public files, and the Criminal Division's corporate enforcement (CEP) resolution letters. Read-only. A search
 * is a text search over what the publishers print plus exact filters; every result carries its official link, and a field the
 * publisher left empty is returned as null, never filled in. The tool does not summarise a report's findings: read the linked
 * report for that.
 */
import { ilikeTerm, restGet } from "@/lib/external/rest.server";
import type { ToolDefinition, ToolOutcome } from "./tools.server";

const str = (v: unknown, n = 300) => (typeof v === "string" ? v.slice(0, n) : "");
const int = (v: unknown, lo: number, hi: number, d: number) =>
  typeof v === "number" && Number.isInteger(v) ? Math.min(hi, Math.max(lo, v)) : d;
const enc = encodeURIComponent;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const clip = (s: string | null, n: number) => (s && s.length > n ? `${s.slice(0, n)}…` : s);

export const OVERSIGHT_SOURCES = [
  "inspector_general",
  "doj_oig",
  "osc_publications",
  "osc_public_files",
  "doj_cep_resolutions",
] as const;
export type OversightSource = (typeof OVERSIGHT_SOURCES)[number];

const SOURCE_SETUP: Record<OversightSource, { dataset: string; path: string; label: string }> = {
  inspector_general: {
    dataset: "oversight_reports",
    path: "oversight",
    label: "Inspector General reports (Oversight.gov)",
  },
  doj_oig: {
    dataset: "doj_oig_reports",
    path: "dojoig",
    label: "DOJ Office of the Inspector General reports",
  },
  osc_publications: {
    dataset: "osc_publications",
    path: "oscpub",
    label: "Office of Special Counsel publications",
  },
  osc_public_files: {
    dataset: "osc_public_files",
    path: "oscdi",
    label: "Office of Special Counsel whistleblower public files",
  },
  doj_cep_resolutions: {
    dataset: "doj_cep_resolutions",
    path: "cep",
    label: "DOJ Criminal Division CEP resolutions",
  },
};

export const OVERSIGHT_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "search_oversight_reports",
    description:
      "Search official oversight and accountability reports stored in the workspace. source=inspector_general (default): public reports of the federal Offices of Inspector General from Oversight.gov, with the OIG, agency reviewed, report type, date, report number and the recommendation count the OIG states. source=doj_oig: the DOJ Inspector General's own report pages (DOJ component, external entity audited, PDF link, questioned costs and funds for better use as the OIG prints them). source=osc_publications: Office of Special Counsel reports, Hatch Act advisory opinions, testimonies and press releases (press releases carry OSC's tags such as hatch act or prohibited personnel practices). source=osc_public_files: OSC whistleblower disclosure case files. source=doj_cep_resolutions: Criminal Division corporate enforcement voluntary self-disclosure resolution letters. Filter by text, OIG or agency name, report type, and a date range. Results are the publishers' fields with official links; the tool does not summarise report findings, so read the linked report before characterising it, and cite its link.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Words to find in titles, report numbers, names and descriptions (2-200 characters).",
        },
        source: { type: "string", enum: [...OVERSIGHT_SOURCES] },
        oig: {
          type: "string",
          description:
            "Part of the submitting OIG's name, e.g. 'Justice' (inspector_general only).",
        },
        agency: {
          type: "string",
          description:
            "Part of the agency reviewed/investigated, e.g. 'Securities and Exchange' (inspector_general only), or the agency as OSC lists it (osc_public_files).",
        },
        type: {
          type: "string",
          description:
            "Report type as published, e.g. Audit, Investigation, Inspection / Evaluation.",
        },
        date_from: { type: "string", description: "Earliest report date, YYYY-MM-DD." },
        date_to: { type: "string", description: "Latest report date, YYYY-MM-DD." },
        limit: { type: "integer", minimum: 1, maximum: 20 },
        offset: { type: "integer", minimum: 0, maximum: 2000 },
      },
    },
  },
];

type Row = { id?: unknown; title?: unknown; source_url?: unknown; b?: unknown };
const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const text = (v: unknown, n = 300): string | null => {
  const s = str(v, n).trim();
  return s ? s : null;
};
const https = (v: unknown): string | null => {
  const s = text(v, 2000);
  return s && /^https:\/\/[^\s"<>]+$/.test(s) ? s : null;
};
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const list = (v: unknown, n = 8): string[] =>
  Array.isArray(v) ? v.flatMap((x) => (text(x, 160) ? [text(x, 160)!] : [])).slice(0, n) : [];

/** One result in the compact shape the model reads; null where the publisher printed nothing. */
export function shapeResult(
  source: OversightSource,
  row: Row,
): { out: Record<string, unknown>; url: string; title: string } | null {
  const b = obj(row.b);
  const id = text(row.id, 200);
  const title = text(row.title, 500);
  const url = https(b["url"]) ?? https(row.source_url);
  if (!id || !title || !url) return null;
  if (source === "inspector_general") {
    return {
      title,
      url,
      out: {
        id,
        title,
        date: text(b["date"], 10),
        oig: text(b["oig"]),
        agency_reviewed: text(b["agency_reviewed"]),
        type: text(b["type"], 100),
        report_number: text(b["report_number"], 120),
        recommendations_stated: num(b["recommendations"]),
        description: clip(text(b["description"], 1400), 400),
        url,
      },
    };
  }
  if (source === "doj_oig") {
    const money = (m: unknown) => text(obj(m)["text"], 40);
    return {
      title,
      url,
      out: {
        id,
        title,
        date: text(b["date"], 10),
        report_number: text(b["number"], 60),
        type: text(b["type"], 100),
        components: list(b["components"]),
        external_entity: text(b["entity"]),
        recommendations_stated: num(b["recommendations"]),
        questioned_costs_as_printed: money(b["questioned_costs"]),
        funds_for_better_use_as_printed: money(b["funds_better_use"]),
        pdf_url: https(b["pdf_url"]),
        url,
      },
    };
  }
  if (source === "osc_publications") {
    return {
      title,
      url,
      out: {
        id,
        title,
        type: text(b["kind_label"], 80),
        group: text(b["group"]),
        date: text(b["date"], 10),
        year: num(b["year"]),
        osc_tags: list(b["tags"]),
        excerpt: clip(text(b["excerpt"], 500), 300),
        url,
      },
    };
  }
  if (source === "osc_public_files") {
    const files = Array.isArray(b["files"]) ? b["files"] : [];
    return {
      title,
      url,
      out: {
        id,
        file_numbers: text(b["number"], 120),
        agency_as_osc_lists_it: text(b["agency"]),
        place: text(b["location"]),
        date_closed: text(b["date_closed"], 10),
        results_listed: list(b["results"], 10),
        documents: files.slice(0, 8).flatMap((f) => {
          const o = obj(f);
          const u = https(o["url"]);
          return u ? [{ label: text(o["label"], 100), url: u }] : [];
        }),
        url,
      },
    };
  }
  return {
    title,
    url,
    out: {
      id,
      company_as_listed: text(b["label"], 400),
      date_listed: text(b["date"], 10),
      company_profile_cik: text(b["company_cik"], 10),
      url,
    },
  };
}

/** The PostgREST filters for the tool's arguments; throws a readable error for a malformed date. */
export function buildQuery(
  source: OversightSource,
  input: Record<string, unknown>,
): { path: string; note: string[] } {
  const { dataset, path: key } = SOURCE_SETUP[source];
  const notes: string[] = [];
  const params = [`select=id,title,source_url,b:item->${key}`, `dataset=eq.${dataset}`];
  const q = str(input["query"], 200)
    .replace(/[*,()%]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .slice(0, 6);
  for (const t of q) params.push(`text=ilike.${ilikeTerm(t)}`);
  const field = (name: string) => `item->${key}->>${name}`;
  const like = (name: string, raw: unknown) => {
    const v = str(raw, 120)
      .replace(/[*,()%]/g, " ")
      .trim();
    if (v) params.push(`${field(name)}=ilike.${ilikeTerm(v)}`);
  };
  if (source === "inspector_general") {
    like("oig", input["oig"]);
    like("agency_reviewed", input["agency"]);
    like("type", input["type"]);
  } else if (source === "doj_oig") {
    like("type", input["type"]);
    if (str(input["oig"]) || str(input["agency"]))
      notes.push("oig and agency apply to source=inspector_general only; ignored here");
  } else if (source === "osc_public_files") {
    like("agency", input["agency"]);
  } else if (source === "osc_publications") {
    like("kind_label", input["type"]);
  }
  for (const [arg, op] of [
    ["date_from", "gte"],
    ["date_to", "lte"],
  ] as const) {
    const d = str(input[arg], 10);
    if (!d) continue;
    if (!ISO.test(d)) throw new Error(`${arg} must be a date like 2024-01-31`);
    params.push(`${field(source === "osc_public_files" ? "date_closed" : "date")}=${op}.${d}`);
  }
  params.push("order=ordinal.asc");
  return { path: `corpus_records?${params.join("&")}`, note: notes };
}

async function searchOversightTool(input: Record<string, unknown>): Promise<ToolOutcome> {
  const raw = str(input["source"], 40) || "inspector_general";
  if (!(OVERSIGHT_SOURCES as readonly string[]).includes(raw))
    throw new Error(`source must be one of ${OVERSIGHT_SOURCES.join(", ")}`);
  const source = raw as OversightSource;
  const limit = int(input["limit"], 1, 20, 10);
  const offset = int(input["offset"], 0, 2000, 0);
  const { path, note } = buildQuery(source, input);
  const r = await restGet<Row[]>(path, { count: true, range: [offset, offset + limit - 1] });
  const shaped = r.rows.flatMap((row) => {
    const s = shapeResult(source, row);
    return s ? [s] : [];
  });
  const query = str(input["query"], 80);
  const content = JSON.stringify({
    source: SOURCE_SETUP[source].label,
    total_matches: r.total,
    returned: shaped.length,
    offset,
    results: shaped.map((s) => s.out),
    notes: [
      ...note,
      "Fields are the publisher's; null means the publisher printed nothing. Recommendation counts and dollar figures are as the publisher states them, not audited. Read the linked report before describing what it found.",
      ...(shaped.length === 0
        ? ["No stored record matches. This is not proof that no such report exists."]
        : []),
    ],
  });
  return {
    content,
    sources: shaped.slice(0, 10).map((s) => ({ title: s.title, url: s.url, internal: false })),
    label: "Searched oversight reports",
    detail: `${query ? `“${query}” · ` : ""}${SOURCE_SETUP[source].label} · ${r.total ?? shaped.length} matches`,
  };
}

export const OVERSIGHT_EXECUTORS: Record<
  string,
  (input: Record<string, unknown>) => Promise<ToolOutcome>
> = {
  search_oversight_reports: searchOversightTool,
};
