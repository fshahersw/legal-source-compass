/** Pure: turn any corpus detail object into a top-down page model without inventing values. */
import { fieldLabel } from "./domainRegistry";

export type Cell = string;
export type EntitySection =
  | { kind: "facts"; key: string; label: string; facts: [string, string][] }
  | { kind: "list"; key: string; label: string; items: string[] }
  | {
      kind: "table";
      key: string;
      label: string;
      columns: string[];
      rows: Cell[][];
      links: (string | null)[];
    }
  | {
      kind: "collection";
      key: string;
      label: string;
      link: string | null;
      total: number | null;
      sample: { title: string; subtitle: string | null; link: string | null }[];
    }
  | {
      kind: "items";
      key: string;
      label: string;
      items: { title: string; subtitle: string | null; links: { url: string; label: string }[] }[];
    };

export type EntityView = {
  title: string;
  subtitle: string | null;
  photo: string | null;
  facts: [string, string][];
  links: { url: string; label: string }[];
  sections: EntitySection[];
  empty: string[];
  technical: [string, string][];
  /** Original nested evidence is displayed as escaped JSON, never interpreted as links or HTML. */
  provenanceJson: string | null;
  text: string | null;
};

const TECH =
  /(basis|provenance|captured|snapshot|evidence|temporal|^edges$|^reports$|cl_links|saved_at|_note$|qualification|counts_label|profile_layer|source_record_type|^structured$|library_insights|photo_provenance|source_profile_id|unresolved|^has_|_characters$|text_truncated|^entity_id$|date_note|career_note|name_as_printed_basis|title_basis)/;
const SKIP = new Set([
  "id",
  "title",
  "name",
  "subtitle",
  "photo_url",
  "text",
  "facts",
  "links",
  "sections",
  "summary",
]);

function scalar(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "string") return v.replace(/\s+/g, " ").trim() || null;
  if (typeof v === "number") return v.toLocaleString("en-US");
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (
    Array.isArray(v) &&
    v.length &&
    v.every((x) => typeof x === "string" || typeof x === "number")
  )
    return v.join("; ");
  return null;
}
const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
function titleOf(o: Record<string, unknown>) {
  return (
    scalar(o["title"]) ??
    scalar(o["name"]) ??
    scalar(o["text"]) ??
    scalar(o["label"]) ??
    scalar(o["id"]) ??
    "Record"
  );
}
function linkOf(o: Record<string, unknown>): string | null {
  for (const k of ["link", "url", "source_url"])
    if (typeof o[k] === "string" && o[k]) return o[k] as string;
  if (Array.isArray(o["links"]) && isObj(o["links"][0]) && typeof o["links"][0]["url"] === "string")
    return o["links"][0]["url"] as string;
  return null;
}

function tableFrom(key: string, arr: Record<string, unknown>[]): EntitySection {
  const counts = new Map<string, number>();
  for (const o of arr.slice(0, 50))
    for (const [k, v] of Object.entries(o))
      if (
        !TECH.test(k) &&
        !["links", "url", "mime", "object_key", "why", "sha256"].includes(k) &&
        scalar(v) != null &&
        String(scalar(v)).length < 160
      )
        counts.set(k, (counts.get(k) ?? 0) + 1);
  const pref = ["title", "name", "date", "year", "status", "court", "role"];
  const cols = [...counts.keys()]
    .sort(
      (a, b) =>
        (pref.indexOf(a) + 1 || 99) - (pref.indexOf(b) + 1 || 99) ||
        counts.get(b)! - counts.get(a)!,
    )
    .filter((k) => k !== "id" || counts.size === 1)
    .slice(0, 6);
  return {
    kind: "table",
    key,
    label: fieldLabel(key),
    columns: cols.map(fieldLabel),
    rows: arr.map((o) => cols.map((c) => scalar(o[c]) ?? "—")),
    links: arr.map((o) => linkOf(o)),
  };
}

export function buildEntityView(raw: Record<string, unknown>): EntityView {
  const view: EntityView = {
    title: scalar(raw["title"]) ?? scalar(raw["name"]) ?? String(raw["id"] ?? "Record"),
    subtitle: scalar(raw["subtitle"]),
    photo:
      typeof raw["photo_url"] === "string" && raw["photo_url"]
        ? (raw["photo_url"] as string)
        : null,
    facts: [],
    links: [],
    sections: [],
    empty: [],
    technical: [],
    provenanceJson: isObj(raw["provenance"]) ? JSON.stringify(raw["provenance"], null, 2) : null,
    text: typeof raw["text"] === "string" && raw["text"].trim() ? (raw["text"] as string) : null,
  };
  if (Array.isArray(raw["facts"])) {
    for (const f of raw["facts"])
      if (Array.isArray(f) && f.length >= 2) {
        const v = typeof f[1] === "string" ? f[1] : JSON.stringify(f[1]);
        (/\(|basis|snapshot|as recorded|saved \(utc\)|how the count/i.test(String(f[0]))
          ? view.technical
          : view.facts
        ).push([String(f[0]), v]);
      }
  }
  if (Array.isArray(raw["links"]))
    view.links = (raw["links"] as unknown[])
      .filter(isObj)
      .filter((l) => typeof l["url"] === "string")
      .map((l) => ({ url: l["url"] as string, label: scalar(l["label"]) ?? (l["url"] as string) }));
  if (Array.isArray(raw["sections"])) {
    (raw["sections"] as unknown[]).filter(isObj).forEach((s, i) => {
      const label =
        scalar(s["title"]) ?? scalar(s["heading"]) ?? scalar(s["label"]) ?? `Related ${i + 1}`;
      if (Array.isArray(s["rows"]) && s["rows"].length) {
        const rows = (s["rows"] as unknown[])
          .filter(Array.isArray)
          .map((r) => (r as unknown[]).map((c) => scalar(c) ?? "—"));
        const cols = Array.isArray(s["columns"])
          ? (s["columns"] as unknown[]).map(
              (c) => scalar(isObj(c) ? (c["label"] ?? c["key"]) : c) ?? "",
            )
          : [];
        view.sections.push({
          kind: "table",
          key: `s${i}`,
          label,
          columns: cols,
          rows,
          links: rows.map(() => null),
        });
      } else if (Array.isArray(s["items"]) && s["items"].length) {
        view.sections.push({
          kind: "items",
          key: `s${i}`,
          label,
          items: (s["items"] as unknown[]).filter(isObj).map((o) => ({
            title: titleOf(o),
            subtitle: scalar(o["subtitle"]),
            links: Array.isArray(o["links"])
              ? (o["links"] as unknown[])
                  .filter(isObj)
                  .filter((l) => typeof l["url"] === "string")
                  .map((l) => ({ url: l["url"] as string, label: scalar(l["label"]) ?? "Open" }))
              : [],
          })),
        });
      }
    });
  }
  for (const [k, v] of Object.entries(raw)) {
    if (SKIP.has(k)) continue;
    if (TECH.test(k)) {
      const s = scalar(v);
      if (s) view.technical.push([fieldLabel(k), s]);
      continue;
    }
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) {
      view.empty.push(fieldLabel(k));
      continue;
    }
    const s = scalar(v);
    if (s != null) {
      if (k === "source_url") view.links.push({ url: s, label: "Original source" });
      else view.facts.push([fieldLabel(k), s]);
      continue;
    }
    if (Array.isArray(v)) {
      const objs = v.filter(isObj);
      if (
        objs.length &&
        objs.every((o) => Object.keys(o).length === 1 && typeof o["text"] === "string")
      )
        view.sections.push({
          kind: "list",
          key: k,
          label: fieldLabel(k),
          items: objs.map((o) => o["text"] as string),
        });
      else if (objs.length) view.sections.push(tableFrom(k, objs));
      continue;
    }
    if (isObj(v)) {
      const link = typeof v["link"] === "string" ? (v["link"] as string) : null;
      const sampleKey = [
        "sample",
        "latest",
        "results",
        "firms",
        "items",
        "top_holdings_latest_year",
      ].find((sk) => Array.isArray(v[sk]) && (v[sk] as unknown[]).length);
      if (link || sampleKey) {
        const total =
          typeof v["total"] === "number"
            ? (v["total"] as number)
            : typeof v["total_holdings"] === "number"
              ? (v["total_holdings"] as number)
              : null;
        const sample = sampleKey
          ? (v[sampleKey] as unknown[]).map((o) =>
              isObj(o)
                ? {
                    title: titleOf(o),
                    subtitle: scalar(o["subtitle"]) ?? scalar(o["date"]) ?? scalar(o["status"]),
                    link: linkOf(o),
                  }
                : { title: String(o), subtitle: null, link: null },
            )
          : [];
        if (!sample.length && total === 0) {
          view.empty.push(fieldLabel(k));
          continue;
        }
        view.sections.push({
          kind: "collection",
          key: k,
          label: fieldLabel(k),
          link,
          total,
          sample: sample.slice(0, 12),
        });
      } else {
        const facts = Object.entries(v)
          .filter(([kk]) => !TECH.test(kk))
          .map(([kk, vv]) => [fieldLabel(kk), scalar(vv)] as [string, string | null])
          .filter((f): f is [string, string] => f[1] != null);
        if (facts.length)
          view.sections.push({ kind: "facts", key: k, label: fieldLabel(k), facts });
        else view.empty.push(fieldLabel(k));
      }
    }
  }
  if (isObj(raw["summary"]) && !view.facts.length)
    for (const [k, v] of Object.entries(raw["summary"])) {
      const s = scalar(v);
      if (s && !TECH.test(k) && k !== "id" && k !== "title") view.facts.push([fieldLabel(k), s]);
    }
  return view;
}

/** Normalize a person name only for grouping (case, spacing, punctuation, suffixes); never for display. */
export function nameKey(name: string) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|hon|judge|esq)\b\.?/g, "")
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Group names that share a normalized key; groups of 2+ are "possible duplicates". */
export function possibleDuplicates<T extends { title: string }>(rows: T[]): T[][] {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = nameKey(r.title);
    if (!k) continue;
    m.set(k, [...(m.get(k) ?? []), r]);
  }
  return [...m.values()].filter((g) => g.length > 1);
}
