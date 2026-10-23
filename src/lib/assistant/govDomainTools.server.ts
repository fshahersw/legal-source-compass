/**
 * Assistant tool that checks hosts or web addresses against the government domain registries stored in the corpus
 * (gov_domains: the CISA .gov registry of every domain registered in the .gov zone, and the GSA list of government domains
 * outside .gov and .mil). Read-only. A host matches only an entry equal to it or one of its parent domains, label by label;
 * the result carries the publishers' own wording (type, organization, city, state when given) and the snapshot date, and
 * says plainly that a listing is not a statement about any page and that "not listed" is not a finding.
 */
import { lookupGovDomains } from "@/lib/external/govDomains.server";
import { evidenceLabel, type GovLookupResult } from "@/lib/external/govDomainsModel";
import type { ToolDefinition, ToolOutcome } from "./tools.server";

const MAX_INPUTS = 20;
const CISA_VIEWER = "https://data.get.gov/?file=current-full.csv";
const GSA_LIST = "https://github.com/GSA/govt-urls";

export const GOV_DOMAIN_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "lookup_government_domain",
    description:
      "Check whether a host or web address belongs to a registered or listed U.S. government domain, using the CISA .gov registry (every domain registered in the .gov zone) and the GSA list of government domains outside .gov and .mil. Matches only the exact host or one of its parent domains, never a similar name. Returns, in the publishers' own wording, the domain type, organization, city and state where given, which list names it, any disagreement between the registries, and the snapshot date. A listing shows the domain is registered or listed as a government domain; it does not vouch for any page on it, and a host that is not listed is not thereby unofficial (.mil hosts cannot be checked). Use it to decide whether a source link is an official government site instead of guessing from the name.",
    input_schema: {
      type: "object",
      properties: {
        host: { type: "string", description: "A host name, e.g. courts.ca.gov." },
        url: {
          type: "string",
          description: "An http(s) address; its host (and path for page-only listings) is checked.",
        },
        hosts: {
          type: "array",
          items: { type: "string" },
          maxItems: MAX_INPUTS,
          description: "Several hosts or addresses at once (up to 20).",
        },
      },
    },
  },
];

const text = (v: unknown, n = 2048) => (typeof v === "string" ? v.trim().slice(0, n) : "");

/** The inputs named in the tool call, de-duplicated, in order. */
export function lookupInputs(input: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const v of [
    input["host"],
    input["url"],
    ...(Array.isArray(input["hosts"]) ? input["hosts"] : []),
  ]) {
    const t = text(v);
    if (t && !out.includes(t)) out.push(t);
  }
  return out.slice(0, MAX_INPUTS);
}

/** One result as the model sees it: the publishers' facts only, no inference. */
export function resultPayload(r: GovLookupResult) {
  const f = r.facts;
  const evidence = evidenceLabel(r);
  return {
    input: r.input,
    host: r.host,
    status: r.status,
    invalid_reason: r.invalidReason,
    match: r.scope,
    matched_entry: r.matchedEntry,
    evidence: evidence ? `${evidence.label}: ${evidence.detail}` : null,
    registries: f?.registries ?? [],
    lists: f?.lists ?? [],
    government_level: f?.group ?? null,
    cisa: f?.cisa
      ? {
          domain_type: f.cisa.type,
          organization: f.cisa.organization,
          suborganization: f.cisa.suborganization,
          city: f.cisa.city,
          state: f.cisa.state,
          in_zone_file: f.cisa.inZone,
        }
      : null,
    gsa: f?.gsa
      ? {
          rows: f.gsa.rows.map((x) => ({
            type_of_government: x.type,
            agency: x.agency,
            state_as_published: x.stateAsPublished,
            note: x.note,
            date_added: x.dateAdded,
          })),
          lists: f.gsa.views.map((v) => ({
            list: v.list,
            level: v.level,
            location: v.location,
            status: v.status,
          })),
        }
      : null,
    states: f?.states ?? [],
    registries_disagree: f?.conflicts ?? [],
    also_named_out_of_use: f?.notUsed ?? null,
    only_these_pages_are_listed: r.status === "path_listed_only" ? r.pathScopedEntries : undefined,
    notes: [...r.cautions, ...(r.tldNote ? [r.tldNote] : [])],
  };
}

async function lookupGovernmentDomainTool(input: Record<string, unknown>): Promise<ToolOutcome> {
  const inputs = lookupInputs(input);
  if (!inputs.length) throw new Error("give a host name or an http(s) address to check");
  const { results, snapshot } = await lookupGovDomains(inputs);
  const registered = results.filter((r) => r.status === "registered");
  const sources: ToolOutcome["sources"] = [];
  if (registered.some((r) => r.tier === "cisa_registered"))
    sources.push({ title: "CISA .gov registry data", url: CISA_VIEWER, internal: false });
  if (registered.some((r) => r.facts?.registries.includes("gsa")))
    sources.push({ title: "GSA government URLs list", url: GSA_LIST, internal: false });
  for (const r of registered.slice(0, 5))
    if (r.matchedEntry)
      sources.push({
        title: `${r.matchedEntry} in the registry dataset`,
        url: `/records/gov_domains/${encodeURIComponent(r.matchedEntry)}`,
        internal: true,
      });
  const first = results[0]!;
  return {
    content: JSON.stringify({
      snapshot: snapshot
        ? {
            cisa_zone_exported_utc: snapshot.cisaZoneExport,
            gsa_list_commit_date: snapshot.gsaCommitDate,
          }
        : "snapshot date not recorded",
      how_to_read:
        "Registered or listed means the domain appears in a government registry; it says nothing about any page on the site. Not listed is not a finding that a site is unofficial. State, city and type are as the publisher gave them, never inferred from the name.",
      results: results.map(resultPayload),
    }),
    sources,
    label: "Checked a government domain",
    detail:
      results.length === 1
        ? `${first.host ?? first.input} · ${first.status.replace(/_/g, " ")}`
        : `${results.length} hosts · ${registered.length} registered or listed`,
  };
}

export const GOV_DOMAIN_EXECUTORS: Record<
  string,
  (input: Record<string, unknown>) => Promise<ToolOutcome>
> = {
  lookup_government_domain: lookupGovernmentDomainTool,
};
