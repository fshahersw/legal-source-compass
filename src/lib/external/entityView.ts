/** Pure: turn any corpus detail object into a top-down page model without inventing values. */
import { fieldLabel } from "./domainRegistry";
import { cleanText, decodeEntities } from "./entities";
import { externalHref } from "./href";

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
  qualification: string | null;
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
  "qualification",
]);

function scalar(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "string") return cleanText(v) || null;
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
/**
 * A nested item's own recorded name; when it has none, the label names what kind of record it is
 * (from the collection it sits in) instead of a bare "Record".
 */
function titleOf(o: Record<string, unknown>, kind: string | null = null) {
  return (
    scalar(o["title"]) ??
    scalar(o["name"]) ??
    scalar(o["text"]) ??
    scalar(o["label"]) ??
    scalar(o["description"]) ??
    scalar(o["id"]) ??
    `${kind ?? "Record"} — title not recorded`
  );
}
/** Singular names for items of known nested collections (sample key first, then parent key). */
const ITEM_KIND: Record<string, string> = {
  top_holdings_latest_year: "Reported holding",
  mdls: "MDL appearance",
  documents: "Document",
  analyses: "Analysis",
  sources: "Source",
  courts: "Court",
  judges: "Judge",
  firms: "Firm",
  judge_links: "Linked judge",
  counsel_directory: "Counsel entry",
  docket_activity: "Docket entry",
};
function itemKind(key: string, sampleKey?: string): string {
  return (
    (sampleKey ? ITEM_KIND[sampleKey] : undefined) ?? ITEM_KIND[key] ?? `${fieldLabel(key)} entry`
  );
}
/** Years are labels, never thousands-separated quantities. */
function yearText(v: unknown): string | null {
  return typeof v === "number" && Number.isInteger(v)
    ? String(v)
    : typeof v === "string" && /^\d{4}$/.test(v.trim())
      ? v.trim()
      : null;
}
/** "2002–2008, 2010, 2012–2020": consecutive recorded years collapse to ranges; nothing is added. */
export function yearRanges(years: readonly unknown[]): string {
  const ys = [
    ...new Set(
      years
        .map(yearText)
        .filter((y): y is string => y != null)
        .map(Number),
    ),
  ]
    .filter(Number.isInteger)
    .sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < ys.length;) {
    let j = i;
    while (j + 1 < ys.length && ys[j + 1] === ys[j]! + 1) j += 1;
    parts.push(i === j ? String(ys[i]) : `${ys[i]}–${ys[j]}`);
    i = j + 1;
  }
  return parts.join(", ");
}

const DISCLOSURE_STATUS: Record<string, string> = {
  filing_with_reportable_holdings: "Filed; reportable holdings listed",
  filing_with_no_reportable_holdings: "Filed; no reportable holdings listed",
  no_filing_in_snapshot: "No filing found in the disclosure snapshot",
  not_bridged_to_courtlistener_person_id:
    "Not linked to a CourtListener person record, so no filing could be looked up",
};
/** The judge profile's financial-disclosure summary (years filed, holdings per year, latest-year holdings). */
function isDisclosureSummary(v: unknown): v is Record<string, unknown> {
  return isObj(v) && Array.isArray(v["years_filed"]) && isObj(v["holdings_count_by_year"]);
}
/** True only when every item has a description and they run A–Z, ignoring case, as stored. */
function inDescriptionOrder(items: readonly Record<string, unknown>[]): boolean {
  const keys = items.map((h) =>
    typeof h["description"] === "string" && h["description"].trim()
      ? h["description"].toLowerCase()
      : null,
  );
  return keys.every((k, i) => k != null && (i === 0 || keys[i - 1]! <= k));
}
/**
 * Financial-disclosure summary → a facts block plus the latest year's listed holdings, each titled by
 * its recorded description. Counts per year come from the summary itself; when the stored list is
 * shorter than that year's count, the label states "N of M shown" (and "A–Z by description" only
 * when the stored order really is A–Z) and carries no separate total, so no bare count can be read
 * as the size of the list. The builder's scope note is shown as "Source scope" for filed and
 * not-filed states; for a judge never linked to a CourtListener person it is internal bridge
 * wording, already said plainly by "Filing status", so it moves to the technical details.
 */
function disclosureSections(
  key: string,
  d: Record<string, unknown>,
): { sections: EntitySection[]; technical: [string, string][] } {
  const state = scalar(d["state"]);
  const years = (d["years_filed"] as unknown[]).map(yearText).filter((y): y is string => !!y);
  const byYear = Object.entries(d["holdings_count_by_year"] as Record<string, unknown>)
    .filter((e): e is [string, number] => yearText(e[0]) != null && typeof e[1] === "number")
    .sort(([a], [b]) => Number(a) - Number(b));
  const latest = yearText(d["latest_year"]);
  const facts: [string, string][] = [
    ["Filing status", (state && DISCLOSURE_STATUS[state]) ?? state ?? "Not recorded"],
  ];
  if (years.length) {
    facts.push(["Years filed", yearRanges(years)]);
    if (latest) facts.push(["Latest year filed", latest]);
    if (typeof d["total_holdings"] === "number")
      facts.push(["Holding entries, all filed years", scalar(d["total_holdings"])!]);
    const withHoldings = byYear.filter(([, n]) => n > 0);
    facts.push([
      "Years with holdings listed",
      withHoldings.length
        ? withHoldings.map(([y, n]) => `${y} (${n.toLocaleString("en-US")})`).join(", ")
        : "None",
    ]);
    if (typeof d["total_holdings_inferred"] === "number")
      facts.push(["Entries with inferred values", scalar(d["total_holdings_inferred"])!]);
  }
  const technical: [string, string][] = [];
  const scope =
    typeof d["qualification"] === "string" && d["qualification"].trim()
      ? decodeEntities(d["qualification"])
      : null;
  if (scope && state === "not_bridged_to_courtlistener_person_id")
    technical.push(["Disclosure source scope", scope]);
  else if (scope) facts.push(["Source scope", scope]);
  const sections: EntitySection[] = [{ kind: "facts", key, label: "Financial disclosures", facts }];
  const holdings = Array.isArray(d["top_holdings_latest_year"])
    ? (d["top_holdings_latest_year"] as unknown[]).filter(isObj)
    : [];
  if (holdings.length) {
    const latestCount = latest ? byYear.find(([y]) => y === latest)?.[1] : undefined;
    const partial = latestCount != null && holdings.length < latestCount;
    sections.push({
      kind: "collection",
      key: `${key}_latest_holdings`,
      label: `Holdings listed in the ${latest ?? "latest"} disclosure${
        partial
          ? ` — ${holdings.length.toLocaleString("en-US")} of ${latestCount.toLocaleString(
              "en-US",
            )} shown${inDescriptionOrder(holdings) ? ", A–Z by description" : ""}`
          : ""
      }`,
      link: null,
      total: partial ? null : (latestCount ?? holdings.length),
      sample: holdings.map((h) => {
        const flags = [
          h["redacted"] === true ? "Row contains redactions" : null,
          h["inferred"] === true ? "Values inferred during CourtListener extraction" : null,
        ].filter((f): f is string => !!f);
        return {
          title:
            scalar(h["description"]) ??
            (h["redacted"] === true
              ? "Redacted holding — description not recorded"
              : "Reported holding — description not recorded"),
          subtitle: flags.length ? flags.join(" · ") : null,
          link: null,
        };
      }),
    });
  }
  return { sections, technical };
}
/** Links are encoded for the href only (raw spaces in stored URLs); in-app links such as "#mdl/3140" pass through. */
function hrefOf(url: string): string {
  return /^https?:\/\//i.test(url) ? externalHref(url) : url;
}
function linkOf(o: Record<string, unknown>): string | null {
  for (const k of ["link", "url", "source_url"])
    if (typeof o[k] === "string" && o[k]) return hrefOf(o[k] as string);
  if (Array.isArray(o["links"]) && isObj(o["links"][0]) && typeof o["links"][0]["url"] === "string")
    return hrefOf(o["links"][0]["url"] as string);
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

/** eCFR section CITA and SOURCE excerpts are publisher text, never executable links. */
function publisherSectionNotes(value: unknown): EntitySection[] {
  if (!Array.isArray(value)) return [];
  const citations: Extract<EntitySection, { kind: "items" }>["items"] = [];
  const sources: Extract<EntitySection, { kind: "items" }>["items"] = [];
  for (const section of value.filter(isObj)) {
    const title =
      [scalar(section["section_identifier"]), scalar(section["heading"])]
        .filter((part): part is string => part != null)
        .join(" — ") || "Section identifier not recorded";
    if (Array.isArray(section["citation_notes"])) {
      for (const citation of section["citation_notes"].filter(isObj)) {
        const text = citation["text"];
        if (typeof text === "string" && text.trim())
          citations.push({ title, subtitle: decodeEntities(text), links: [] });
      }
    }
    if (Array.isArray(section["source_notes"])) {
      for (const text of section["source_notes"])
        if (typeof text === "string" && text.trim())
          sources.push({ title, subtitle: decodeEntities(text), links: [] });
    }
  }
  const sections: EntitySection[] = [];
  if (citations.length)
    sections.push({
      kind: "items",
      key: "publisher_section_citations",
      label: "Publisher section citation notes",
      items: citations,
    });
  if (sources.length)
    sections.push({
      kind: "items",
      key: "publisher_section_sources",
      label: "Publisher section source notes",
      items: sources,
    });
  return sections;
}

export function buildEntityView(raw: Record<string, unknown>): EntityView {
  const view: EntityView = {
    title: scalar(raw["title"]) ?? scalar(raw["name"]) ?? String(raw["id"] ?? "Record"),
    subtitle: scalar(raw["subtitle"]),
    qualification:
      typeof raw["qualification"] === "string" && raw["qualification"].trim()
        ? decodeEntities(raw["qualification"])
        : null,
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
    text:
      typeof raw["text"] === "string" && raw["text"].trim() ? decodeEntities(raw["text"]) : null,
  };
  if (Array.isArray(raw["facts"])) {
    for (const f of raw["facts"])
      if (Array.isArray(f) && f.length >= 2) {
        const v = typeof f[1] === "string" ? decodeEntities(f[1]) : JSON.stringify(f[1]);
        (/basis|snapshot|saved \(utc\)|how the count|capture time/i.test(String(f[0]))
          ? view.technical
          : view.facts
        ).push([String(f[0]), v]);
      }
  }
  if (Array.isArray(raw["links"]))
    view.links = (raw["links"] as unknown[])
      .filter(isObj)
      .filter((l) => typeof l["url"] === "string")
      .map((l) => ({
        url: hrefOf(l["url"] as string),
        label: scalar(l["label"]) ?? (l["url"] as string),
      }));
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
            title: titleOf(o, `${label} entry`),
            subtitle: scalar(o["subtitle"]),
            links: Array.isArray(o["links"])
              ? (o["links"] as unknown[])
                  .filter(isObj)
                  .filter((l) => typeof l["url"] === "string")
                  .map((l) => ({
                    url: hrefOf(l["url"] as string),
                    label: scalar(l["label"]) ?? "Open",
                  }))
              : [],
          })),
        });
      }
    });
  }
  for (const [k, v] of Object.entries(raw)) {
    if (SKIP.has(k)) continue;
    if (k === "section_source_notes") view.sections.push(...publisherSectionNotes(v));
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
      if (k === "source_url") view.links.push({ url: hrefOf(s), label: "Original source" });
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
          items: objs.map((o) => decodeEntities(o["text"] as string)),
        });
      else if (objs.length) view.sections.push(tableFrom(k, objs));
      continue;
    }
    if (isDisclosureSummary(v)) {
      const disclosure = disclosureSections(k, v);
      view.sections.push(...disclosure.sections);
      view.technical.push(...disclosure.technical);
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
        const kind = itemKind(k, sampleKey);
        const sample = sampleKey
          ? (v[sampleKey] as unknown[]).map((o) =>
              isObj(o)
                ? {
                    title: titleOf(o, kind),
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
