import type { AgencyProfile } from "@/lib/external/agencyProfile.functions";

/** Only recorded direct relationships; Manual headings are not reporting relationships. */
export function agencyOrganization(profile: Pick<AgencyProfile, "id" | "name" | "parent" | "children">) {
  const seen = new Set([profile.id]);
  const parent = profile.parent && profile.parent.id !== profile.id ? profile.parent : null;
  if (parent) seen.add(parent.id);
  const children = profile.children.filter((child) => {
    if (seen.has(child.id)) return false;
    seen.add(child.id);
    return true;
  });
  return { parent, current: { id: profile.id, name: profile.name }, children };
}

export type OrganizationReference = {
  label: string;
  url: string;
  /** The date the publisher prints for the chart or page ("Updated: 05/19/2026"), as ISO; null when none is printed. */
  publisherDate: string | null;
  /** When the link was last confirmed to resolve to the publisher's own chart page. */
  checked: string;
};

/**
 * Official organization charts, bound to exact Federal Register agency ids (never to a name match, never inherited by
 * a parent or a component). Charts are dated snapshots: the date is the one the publisher prints, or null.
 */
const OFFICIAL_CHARTS: Readonly<Record<number, Omit<OrganizationReference, "checked">>> = {
  44: { label: "Official organization charts", url: "https://www.cdc.gov/about/divisions-offices/index.html", publisherDate: null },
  42: { label: "Official visualizations", url: "https://www.census.gov/library/visualizations.html", publisherDate: null },
  145: { label: "Official organization chart", url: "https://www.epa.gov/aboutepa/epa-organization-chart", publisherDate: null },
  199: { label: "Official organization charts", url: "https://www.fda.gov/about-fda/fda-organization/fda-organization-charts", publisherDate: null },
  221: { label: "Official organizational charts", url: "https://www.hhs.gov/about/agencies/orgchart/index.html", publisherDate: null },
  227: { label: "Official organizational chart", url: "https://www.dhs.gov/organizational-chart", publisherDate: "2026-05-19" },
  268: { label: "Official organization chart", url: "https://www.justice.gov/agencies/chart", publisherDate: null },
  271: { label: "Official organizational chart", url: "https://www.dol.gov/general/aboutdol/orgchart", publisherDate: null },
  466: { label: "Official divisions and offices", url: "https://www.sec.gov/about/divisions-offices", publisherDate: "2026-07-06" },
  476: { label: "Official organization chart", url: "https://www.state.gov/department-of-state-organization-chart/", publisherDate: "2026-06-15" },
  497: { label: "Official organizational chart", url: "https://home.treasury.gov/about/general-information/organizational-chart", publisherDate: null },
};
const CHECKED = "2026-10-28";

export function officialOrganizationReference(agencyId: number): OrganizationReference | null {
  const ref = OFFICIAL_CHARTS[agencyId];
  return ref ? { ...ref, checked: CHECKED } : null;
}
