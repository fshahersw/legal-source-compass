export type CourtSourceLink = { label: string; url: string };

/** A federal homepage is not a state court's homepage, even when short IDs collide. */
export function courtLinkCompatible(link: CourtSourceLink, system?: string | null): boolean {
  if (system?.trim().toLowerCase() !== "state") return true;
  if (!/court\s+(?:home\s?page|website)/i.test(link.label)) return true;
  try {
    const host = new URL(link.url).hostname.toLowerCase();
    return host !== "uscourts.gov" && !host.endsWith(".uscourts.gov");
  } catch {
    return false;
  }
}
