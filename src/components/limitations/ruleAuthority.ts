import {
  VERIFICATION_GRADE_LABELS,
  type FetchRoute,
  type LimitationRule,
  type LimitationsSnapshot,
} from "@/lib/limitations/types";

export const NOT_RECORDED = "Not recorded";

export type RuleAuthorityFacts = {
  citation: string;
  effective: string;
  lastAmended: string;
  retrieved: string;
  sources: {
    id: string;
    title: string;
    url: string;
    retrieved: string;
    kind: string;
    route: string;
  }[];
  excerpt: string | null;
  accrual: string;
  tolling: string[];
  repose: string[];
  confidence: string | null;
  flags: string[];
  entryStatus: "verified" | "flagged" | "legacy";
  grade: string;
  gradeBasis: string;
};

const day = (value: string | undefined | null) => (value ? value.slice(0, 10) : NOT_RECORDED);

export function fetchRouteLabel(route: FetchRoute | undefined): string {
  if (!route) return NOT_RECORDED;
  if (route.kind === "direct") return "Direct fetch from the publisher";
  if (route.kind === "extraction") return "Extraction from the captured publisher file";
  if (route.kind === "proxied" && route.proxy)
    return `Fetched through the ${route.proxy} proxy because the host blocks direct requests`;
  return NOT_RECORDED;
}

/** Facts shown beside every result: nothing is inferred, absent values read "Not recorded". */
export function ruleAuthorityFacts(
  snapshot: LimitationsSnapshot,
  rule: LimitationRule,
): RuleAuthorityFacts {
  const p = rule.provenance;
  const sources = rule.sourceIds.flatMap((id) => {
    const s = snapshot.sources.find((item) => item.id === id);
    return s
      ? [
          {
            id,
            title: s.title,
            url: s.url,
            retrieved: day(s.capturedAt),
            kind: s.authorityKind,
            route: fetchRouteLabel(s.fetchRoute),
          },
        ]
      : [];
  });
  const statute = sources.find((s) => s.kind === "statute") ?? sources[0];
  return {
    citation: p?.citation ?? rule.pinpoint,
    effective: p?.effectiveDate ?? rule.effectiveFrom ?? NOT_RECORDED,
    lastAmended: p
      ? p.lastAmended.date
        ? `${p.lastAmended.date} (${p.lastAmended.text})`
        : p.lastAmended.text
      : NOT_RECORDED,
    retrieved: p ? day(p.retrievedAt) : (statute?.retrieved ?? NOT_RECORDED),
    sources,
    excerpt: p?.excerpt ?? null,
    accrual: p ? (p.accrualKind === "not_recorded" ? NOT_RECORDED : p.accrualText) : NOT_RECORDED,
    tolling: p ? p.tolling.map((t) => `${t.text} (${t.citation})`) : [],
    repose: p
      ? p.repose.map(
          (r) =>
            `${r.years} years from ${r.trigger} (${r.citation})${r.effectiveFrom ? `, effective ${r.effectiveFrom}` : ""}`,
        )
      : [],
    confidence: p ? `${p.confidence}: ${p.confidenceNote}` : null,
    flags: p?.flags ?? [],
    entryStatus: p ? p.entryStatus : "legacy",
    grade: rule.verification
      ? VERIFICATION_GRADE_LABELS[rule.verification.grade]
      : "Verification grade not recorded",
    gradeBasis: rule.verification?.basis ?? NOT_RECORDED,
  };
}
