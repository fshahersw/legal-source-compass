/**
 * The United States Government Manual as GPO publishes it on GovInfo (package GOVMAN-<edition>, XML), one row per
 * entity: the parent agencies and their sub-entities at every level, with what the edition prints for each one:
 * addresses, the leadership tables (title and name as printed), the mission statement, legal authority, organization
 * statement, programs and activities, and the "Sources of Information" entries with their links.
 *
 *   - The edition is found from GovInfo's GOVMAN collection page; a newer edition replaces the rows (same ids), so the
 *     catalog always reflects one edition, named in every row.
 *   - The manual's nesting (Entity → SubEntityLevelOne → …) is kept as `parent` and `level`. It is the manual's
 *     arrangement, not a reporting relationship (charts/AGENTS.md): pages must not draw it as one.
 *   - Leadership names are shown exactly as printed in the edition; the manual can lag appointments, so every row and
 *     page states the edition date.
 * Public domain (GPO). Source: https://www.govinfo.gov/app/collection/govman
 */
import { BudgetExhausted, RateLimited } from "../http.ts";
import { corpusRecord } from "../rows.ts";
import type {
  Collected,
  CorpusRow,
  Json,
  JsonObject,
  RowContent,
  SourceAdapter,
} from "../types.ts";
import { child, childText, kids, parseXml, type XmlNode } from "../xmlTree.ts";

export const GOVMAN_DATASET = "govman_agencies";
/** The edition read when the collection page cannot be read (the latest at the time of writing). */
export const GOVMAN_DEFAULT_EDITION = "GOVMAN-2025-12-31";
const LEVEL: Record<string, number> = {
  Entity: 0,
  SubEntityLevelOne: 1,
  SubEntityLevelTwo: 2,
  SubEntityLevelThree: 3,
  SubEntityLevelFour: 4,
};

export const govmanXmlUrl = (pkg: string) =>
  `https://www.govinfo.gov/content/pkg/${pkg}/xml/${pkg}.xml`;
export const govmanPageUrl = (pkg: string) => `https://www.govinfo.gov/app/details/${pkg}`;
export const manualAgencyUrl = (id: string, parent: string, type: string) =>
  `https://www.usgovernmentmanual.gov/Agency?EntityId=${encodeURIComponent(id)}&ParentEId=${encodeURIComponent(parent)}&EType=${encodeURIComponent(type)}`;

const web = (s: string | null) => {
  if (!s) return null;
  const t = s.trim();
  return /^https?:\/\/\S+$/i.test(t) ? t : null;
};

export type GovmanLeader = { table: string | null; title: string; name: string | null };
export type GovmanEntry = {
  heading: string | null;
  text: string;
  url: string | null;
  email: string | null;
};
export type GovmanProgram = {
  name: string | null;
  text: string | null;
  contact: string | null;
  url: string | null;
  details: GovmanEntry[];
};

export type GovmanEntity = {
  id: string;
  parent: string;
  level: number;
  type: string;
  sort: number;
  category: string | null;
  name: string;
  intro: string | null;
  addresses: {
    address: string | null;
    phone: string | null;
    phone2: string | null;
    fax: string | null;
    email: string | null;
    url: string | null;
  }[];
  leaders: GovmanLeader[];
  leaderUrls: string[];
  mission: string[];
  legalAuthority: string[];
  organization: string[];
  orgChart: string | null;
  programs: GovmanProgram[];
  sources: GovmanEntry[];
};

/** Paragraphs of a section (Record/Paragraph and Paragraph children), in sort order, whitespace collapsed. */
function paragraphs(section: XmlNode | null): string[] {
  if (!section) return [];
  const out: string[] = [];
  const add = (p: XmlNode | null) => {
    if (!p) return;
    const t = p.text.replace(/\s+/g, " ").trim();
    if (t) out.push(t);
  };
  for (const r of kids(section, "Record")) for (const p of kids(r, "Paragraph")) add(p);
  for (const p of kids(section, "Paragraph")) add(p);
  return out;
}

const footer = (n: XmlNode | null) => {
  const f = child(n, "FooterDetails");
  return { url: web(childText(f, "WebAddress")), email: childText(f, "Email") };
};

/** Every entity of the manual at every level, in document order. */
export function govmanEntities(xml: string): GovmanEntity[] {
  const doc = parseXml(xml);
  const root = child(doc, "GovernmentManual");
  if (!root) return [];
  const out: GovmanEntity[] = [];
  const visit = (n: XmlNode) => {
    const level = LEVEL[n.tag];
    const name = childText(n, "AgencyName");
    if (level !== undefined && name && n.attrs["EntityId"]) {
      const leaders: GovmanLeader[] = [];
      const leaderUrls: string[] = [];
      for (const t of kids(child(n, "LeaderShipTables"), "LeaderShipTable")) {
        const header = childText(t, "Header");
        const u = footer(t).url;
        if (u) leaderUrls.push(u);
        for (const v of kids(child(t, "LeaderShipTableValues"), "Values")) {
          const title = childText(v, "TitleColumnValue");
          if (!title || /^-+$/.test(title)) continue;
          leaders.push({ table: header, title, name: childText(v, "NameColumnValue") });
        }
      }
      const programs: GovmanProgram[] = kids(child(n, "ProgramAndActivities"), "ProgramAndActivity")
        .map((p) => ({
          name: childText(p, "ProgramName"),
          text: childText(p, "MainParagraph"),
          contact: childText(p, "PointOfContact"),
          url: footer(p).url,
          details: kids(p, "Activity").flatMap((a) => {
            const ah = childText(a, "Heading");
            return kids(child(a, "Details"), "Detail").flatMap((d) => {
              const text = childText(d, "Paragraph");
              if (!text) return [];
              const f = footer(d);
              return [{ heading: childText(d, "Heading") ?? ah, text, url: f.url, email: f.email }];
            });
          }),
        }))
        .filter((p) => p.name || p.text || p.details.length);
      const sources: GovmanEntry[] = kids(
        child(n, "SourceOfInformationDetails"),
        "EntitySourceOfInformation",
      ).flatMap((s) => {
        const text = childText(s, "Paragraph");
        const heading = childText(s, "Header");
        if (!text && !heading) return [];
        const f = footer(s);
        return [{ heading, text: text ?? "", url: f.url, email: f.email }];
      });
      const chart = child(n, "OrganizationChart");
      out.push({
        id: n.attrs["EntityId"]!,
        parent: n.attrs["ParentId"] ?? "0",
        level,
        type: n.tag,
        sort: Number(n.attrs["SortOrder"] ?? 0) || 0,
        category: childText(n, "Category"),
        name,
        intro: childText(n, "IntroductoryParagraph"),
        addresses: kids(child(n, "Addresses"), "Address")
          .map((a) => {
            const f = footer(a);
            return {
              address: childText(a, "Address"),
              phone: childText(a, "Phone"),
              phone2: childText(a, "Phone2"),
              fax: childText(a, "Fax"),
              email: f.email,
              url: f.url,
            };
          })
          .filter((a) => a.address || a.phone || a.url),
        leaders,
        leaderUrls: [...new Set(leaderUrls)],
        mission: paragraphs(child(n, "MissionStatement")),
        legalAuthority: paragraphs(child(n, "LegalAuthority")),
        organization: paragraphs(child(n, "OrganizationStatement")),
        orgChart: chart
          ? (web(childText(chart, "WebAddress")) ?? web(chart.text) ?? footer(chart).url)
          : null,
        programs,
        sources,
      });
    }
    for (const c of n.children) {
      if (c.tag === "Childrens") c.children.forEach(visit);
      else if (c.tag in LEVEL) visit(c);
    }
  };
  root.children.forEach(visit);
  return out;
}

/** The edition package of the newest GOVMAN link on GovInfo's collection page, or null. */
export function latestEdition(html: string): string | null {
  const found = [...html.matchAll(/GOVMAN-(\d{4}-\d{2}-\d{2})/g)].map((m) => m[1]!);
  if (!found.length) return null;
  return `GOVMAN-${found.sort().reverse()[0]}`;
}

export function govmanRow(e: GovmanEntity, pkg: string, names: Map<string, string>): CorpusRow {
  const edition = pkg.replace(/^GOVMAN-/, "");
  const parentName = e.parent !== "0" ? (names.get(e.parent) ?? null) : null;
  const site = e.addresses.find((a) => a.url)?.url ?? null;
  const textParts = [
    e.name,
    e.category ?? "",
    e.intro ?? "",
    ...e.mission,
    ...e.legalAuthority,
    ...e.organization,
    ...e.programs.flatMap((p) => [p.name ?? "", p.text ?? "", ...p.details.map((d) => d.text)]),
    ...e.sources.map((s) => `${s.heading ?? ""} ${s.text}`),
    ...e.leaders.map((l) => `${l.title} ${l.name ?? ""}`),
  ];
  return corpusRecord(GOVMAN_DATASET, `govman:${e.id}`, e.name, {
    source_url: govmanPageUrl(pkg),
    subtitle: [
      e.category,
      parentName ? `within ${parentName}` : null,
      `Government Manual, edition of ${edition}`,
    ]
      .filter(Boolean)
      .join(" · "),
    cells: {
      agency: e.name,
      branch: e.category,
      within: parentName,
      level: e.level,
      leaders: e.leaders.filter((l) => l.name).length,
      programs: e.programs.length,
      sources_of_information: e.sources.length,
      website: site,
      edition,
    },
    facts: [
      ["Agency", e.name],
      ["Branch or category", e.category ?? "Not recorded"],
      ["Listed under", parentName ?? "Top level of the manual"],
      ["Edition", `The United States Government Manual, ${edition} (GPO)`],
      ...(e.mission[0] ? [["Mission", e.mission[0]] as [string, string]] : []),
      ...(e.legalAuthority[0]
        ? [["Legal authority", e.legalAuthority[0]] as [string, string]]
        : []),
      [
        "Note",
        "The manual's nesting is its arrangement of entries, not a reporting relationship; leadership names are as printed in this edition.",
      ],
    ],
    text: textParts.join(" ").replace(/\s+/g, " ").slice(0, 60_000),
    filters: {
      branch: [e.category ?? "Not recorded"],
      level: [String(e.level)],
      parent: [e.parent],
    },
    links: [
      { label: "Government Manual on GovInfo", url: govmanPageUrl(pkg) },
      { label: "Entry on usgovernmentmanual.gov", url: manualAgencyUrl(e.id, e.parent, e.type) },
      ...(site ? [{ label: "Agency website", url: site }] : []),
    ],
    extra: {
      govman: {
        edition,
        package: pkg,
        entity_id: e.id,
        parent_id: e.parent,
        parent_name: parentName,
        level: e.level,
        type: e.type,
        sort: e.sort,
        category: e.category,
        intro: e.intro,
        addresses: e.addresses,
        leaders: e.leaders,
        leader_urls: e.leaderUrls,
        mission: e.mission,
        legal_authority: e.legalAuthority,
        organization: e.organization,
        org_chart: e.orgChart,
        programs: e.programs,
        sources: e.sources,
      } as unknown as JsonObject,
    },
  });
}

export const comparableGovman = (content: RowContent): Json => content as unknown as Json;

export const govmanAgencies: SourceAdapter = {
  source: "govman_agencies",
  dataset: GOVMAN_DATASET,
  mode: "upsert",
  ordinalPolicy: "append",
  functionName: "ingest-reference",
  limits: { maxRequests: 4, minIntervalMs: 1000 },
  secrets: [],

  async collect(ctx): Promise<Collected> {
    const notes: JsonObject = {};
    let pkg = GOVMAN_DEFAULT_EDITION;
    try {
      const page = await ctx.http.getText("https://www.govinfo.gov/app/collection/govman");
      const found = page.status === 200 ? latestEdition(page.text) : null;
      if (found && found > pkg) pkg = found;
      notes["collection_page"] = page.status;
    } catch (error) {
      if (error instanceof BudgetExhausted || error instanceof RateLimited) throw error;
      notes["collection_page"] = "unreadable";
    }
    const cursor =
      ctx.cursor && typeof ctx.cursor === "object" && !Array.isArray(ctx.cursor)
        ? (ctx.cursor as JsonObject)
        : {};
    notes["edition"] = pkg;
    const res = await ctx.http.getText(govmanXmlUrl(pkg));
    if (res.status !== 200) throw new Error(`Government Manual XML HTTP ${res.status}`);
    const entities = govmanEntities(res.text);
    if (entities.length < 50)
      throw new Error(`only ${entities.length} entities read from the manual`);
    const names = new Map(entities.map((e) => [e.id, e.name]));
    const seen = new Set<string>();
    const rows: CorpusRow[] = [];
    const held = [];
    for (const e of entities) {
      if (seen.has(e.id)) {
        held.push({ key: e.id, reason: "entity id repeated in the manual" });
        continue;
      }
      seen.add(e.id);
      rows.push(govmanRow(e, pkg, names));
    }
    notes["entities"] = entities.length;
    notes["by_level"] = entities.reduce<Record<string, number>>((m, e) => {
      m[String(e.level)] = (m[String(e.level)] ?? 0) + 1;
      return m;
    }, {}) as unknown as Json;
    return {
      rows,
      fetched: entities.length,
      held,
      cursorAfter: { edition: pkg, previous: (cursor["edition"] as Json) ?? null },
      complete: true,
      notes,
    };
  },

  comparable: comparableGovman,
};
