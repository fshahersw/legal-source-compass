export type CourtArtworkKind = "seal" | "banner" | "photo";

export type VerifiedCourtArtwork = {
  courtId: string;
  courtName: string;
  assetPath: string;
  kind: CourtArtworkKind;
  sourcePage: string;
  sourceImage: string;
  retrievedAt: string;
  sha256: string;
  description: string;
};

/** Exact-ID-only registry. Entries require official source provenance and a checked local asset. */
export const verifiedCourtArtwork: readonly VerifiedCourtArtwork[] = [
  {
    courtId: "cand",
    courtName: "U.S. District Court for the Northern District of California",
    assetPath: "/court-marks/cand.svg",
    kind: "seal",
    sourcePage: "https://cand.uscourts.gov/",
    sourceImage:
      "https://cand.uscourts.gov/sites/default/files/images/Northern-District-of-California-Court---Full-Color.svg",
    retrievedAt: "2026-10-05",
    sha256: "39c8d5df694f50f5a45259250c923a16f7777fe8b7c82a9862fc94ec9d24dadd",
    description: "Official court artwork served by the court homepage.",
  },
  {
    courtId: "njd",
    courtName: "U.S. District Court for the District of New Jersey",
    assetPath: "/court-marks/njd.png",
    kind: "seal",
    sourcePage: "https://www.njd.uscourts.gov/",
    sourceImage: "https://www.njd.uscourts.gov/sites/njd/files/small_njdis_courtseal_color.png",
    retrievedAt: "2026-10-05",
    sha256: "1eb0f9bc0981a9bbf19935a533cb493def87c7b7abf1f95505175df3eeb1f454",
    description: "Court seal image published by the court.",
  },
  {
    courtId: "paed",
    courtName: "U.S. District Court for the Eastern District of Pennsylvania",
    assetPath: "/court-marks/paed.png",
    kind: "seal",
    sourcePage: "https://www.paed.uscourts.gov/",
    sourceImage: "https://www.paed.uscourts.gov/sites/paed/files/courtseal.png",
    retrievedAt: "2026-10-05",
    sha256: "6670aab43d7826084174ca6afe573583fa199447ef74e9fb8f24d578918e6e06",
    description: "Court seal image published by the court.",
  },
  {
    courtId: "flsd",
    courtName: "U.S. District Court for the Southern District of Florida",
    assetPath: "/court-marks/flsd.png",
    kind: "seal",
    sourcePage: "https://www.flsd.uscourts.gov/",
    sourceImage:
      "https://www.flsd.uscourts.gov/sites/flsd/files/SOUTHERN%20DISTRICT%20OF%20FLORIDA_color1_0_0.png",
    retrievedAt: "2026-10-05",
    sha256: "eada1e9badb6ed9ff6dc85a3ad3c9844e8333e00d31b6cd3eaa854b8c806a7bc",
    description: "Court seal image published by the court.",
  },
  {
    courtId: "scd",
    courtName: "U.S. District Court for the District of South Carolina",
    assetPath: "/court-marks/scd.gif",
    kind: "banner",
    sourcePage: "https://www.scd.uscourts.gov/",
    sourceImage: "https://www.scd.uscourts.gov/Graphics/top_grey.gif",
    retrievedAt: "2026-10-05",
    sha256: "d76fe5fdf3e1e82a45cd3951d22d122781f6cf8b0dad736660b6c749efe59a5f",
    description: "Official homepage header containing the district seal and court name.",
  },
] as const;

const artworkByCourtId = new Map(verifiedCourtArtwork.map((entry) => [entry.courtId, entry]));

export function artworkForCourtId(courtId: string): VerifiedCourtArtwork | null {
  return artworkByCourtId.get(courtId) ?? null;
}

export type CourtTypeGroup =
  | "us-supreme"
  | "federal-appellate"
  | "federal-district"
  | "federal-bankruptcy"
  | "state-high"
  | "state-appellate"
  | "state-trial"
  | "county"
  | "local-specialty"
  | "historical"
  | "unclassified";

export const courtTypeLabels: Record<CourtTypeGroup, string> = {
  "us-supreme": "U.S. Supreme Court",
  "federal-appellate": "Federal appellate court",
  "federal-district": "Federal district court",
  "federal-bankruptcy": "Federal bankruptcy court",
  "state-high": "State high court",
  "state-appellate": "State appellate court",
  "state-trial": "State trial court",
  county: "County or parish court",
  "local-specialty": "Local or specialty court",
  historical: "Historical court record",
  unclassified: "Court type not recorded",
};

/** Uses recorded system/type labels only. The court title is deliberately not an input. */
export function classifyCourtType(system: string | null | undefined, type: string | null | undefined): CourtTypeGroup {
  const s = (system ?? "").trim().toLowerCase();
  const t = (type ?? "").trim().toLowerCase();
  if (!t || t === "not recorded") return "unclassified";
  if (/histor|former|territorial|defunct|abolish/.test(t)) return "historical";
  if (/supreme court of the united states|u\.s\. supreme|federal supreme/.test(t)) return "us-supreme";
  if (/bankrupt/.test(t)) return "federal-bankruptcy";
  if (/federal/.test(s) || /federal|u\.s\.|united states/.test(t)) {
    if (/appeal|appellate|circuit/.test(t)) return "federal-appellate";
    if (/district|trial/.test(t)) return "federal-district";
    return "unclassified";
  }
  if (/supreme|court of last resort|high court/.test(t)) return "state-high";
  if (/appeal|appellate/.test(t)) return "state-appellate";
  if (/county|parish/.test(t)) return "county";
  if (/municipal|mayor|justice|probate|family|juvenile|small claims|tax|claims|special/.test(t))
    return "local-specialty";
  if (/district|circuit|superior|trial|common pleas|chancery/.test(t)) return "state-trial";
  return "unclassified";
}

export function courtTypeCoverage(rows: readonly { system: string; type: string }[]) {
  const bySourceType = new Map<string, { system: string; type: string; group: CourtTypeGroup; count: number }>();
  for (const row of rows) {
    const key = `${row.system}\u0000${row.type}`;
    const existing = bySourceType.get(key);
    if (existing) existing.count += 1;
    else bySourceType.set(key, { ...row, group: classifyCourtType(row.system, row.type), count: 1 });
  }
  return [...bySourceType.values()].sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

export function recordedCourtArtwork(links: readonly { url: string; label: string }[]) {
  const candidates = links.filter(
    (link) => link.url.startsWith("/") && /seal|image|logo|court mark/i.test(link.label),
  );
  return candidates.find((link) => /seal/i.test(link.label)) ?? candidates[0] ?? null;
}