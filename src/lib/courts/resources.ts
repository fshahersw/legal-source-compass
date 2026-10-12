import type { EntityView } from "@/lib/external/entityView";

export type CourtResourceKind = "rules" | "forms" | "filing" | "fees" | "help" | "website";
export type CourtResource = {
  url: string;
  label: string;
  host: string;
  kind: CourtResourceKind;
  recordedIn: string;
};

export const courtResourceLabels: Record<CourtResourceKind, string> = {
  rules: "Rules and orders",
  forms: "Forms",
  filing: "Filing and case access",
  fees: "Fees",
  help: "Court services",
  website: "Court website",
};

/** Classify the source's label, never construct a destination or infer its contents from a URL. */
export function courtResourceKind(label: string): CourtResourceKind | null {
  if (
    /\b(?:rules?|standing orders?|general orders?|individual practices|operating procedures)\b/i.test(
      label,
    )
  )
    return "rules";
  if (/\bforms?\b/i.test(label)) return "forms";
  if (/\b(?:e[ -]?filing|filing|cm\s*\/\s*ecf|pacer|case (?:access|locator))\b/i.test(label))
    return "filing";
  if (/\bfees?\b/i.test(label)) return "fees";
  if (
    /\b(?:clerk|self[ -]help|pro se|representing yourself|court (?:hours|locations|directory)|accessibility)\b/i.test(
      label,
    )
  )
    return "help";
  if (/\b(?:court (?:home\s?page|website)|official (?:home\s?page|website))\b/i.test(label))
    return "website";
  return null;
}

/** Stored public URLs only. A federal court destination cannot describe a recorded state court. */
export function courtResourceDestination(url: string, system?: string | null): URL | null {
  try {
    const destination = new URL(url);
    if (
      !["https:", "http:"].includes(destination.protocol) ||
      destination.username ||
      destination.password
    )
      return null;
    const host = destination.hostname.toLowerCase();
    if (
      system?.trim().toLowerCase() === "state" &&
      (host === "uscourts.gov" || host.endsWith(".uscourts.gov"))
    )
      return null;
    return destination;
  } catch {
    return null;
  }
}

/** Flatten links already in this exact corpus profile; nothing is fetched or synthesized. */
export function courtResources(
  view: Pick<EntityView, "links" | "sections">,
  system?: string | null,
): CourtResource[] {
  const candidates = view.links.map((link) => ({ ...link, recordedIn: "Court profile" }));
  for (const section of view.sections) {
    if (section.kind === "items") {
      for (const item of section.items)
        for (const link of item.links) candidates.push({ ...link, recordedIn: section.label });
    } else if (section.kind === "table") {
      section.links.forEach((url, index) => {
        const label = section.rows[index]?.[0];
        if (url && label) candidates.push({ url, label, recordedIn: section.label });
      });
    } else if (section.kind === "collection") {
      for (const item of section.sample)
        if (item.link)
          candidates.push({ url: item.link, label: item.title, recordedIn: section.label });
    }
  }
  const seen = new Set<string>();
  return candidates.flatMap((candidate) => {
    const kind = courtResourceKind(candidate.label);
    const destination = courtResourceDestination(candidate.url, system);
    if (!kind || !destination || seen.has(destination.href)) return [];
    seen.add(destination.href);
    return [{ ...candidate, host: destination.host, kind }];
  });
}
