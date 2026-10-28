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

export function officialOrganizationReference(name: string) {
  if (name === "Centers for Disease Control and Prevention")
    return { label: "Official organization charts", url: "https://www.cdc.gov/about/divisions-offices/index.html" };
  if (name === "Census Bureau")
    return { label: "Official visualizations", url: "https://www.census.gov/library/visualizations.html" };
  return null;
}