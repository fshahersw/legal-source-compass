import {
  VERIFICATION_GRADE_LABELS,
  type FetchRoute,
  type LimitationRule,
  type LimitationsSnapshot,
  type RuleCurrency,
  type SourceCurrency,
} from "@/lib/limitations/types";

export const NOT_RECORDED = "Not recorded";

export type SourceCurrencyFacts = {
  /** Short label for a chip. */
  label: string;
  /** "ok" when the fresh official text still carries the evidence, "lost" when it does not, "unknown" otherwise. */
  tone: "ok" | "lost" | "unknown";
  checked: string;
  detail: string;
  /** Bundle path of the fresh text when the page changed; null when there is none. */
  freshTextPath: string | null;
  /** Public sections the passages were matched in when the route was the full-code capture. */
  codeSections: string[];
};

export type RuleCurrencyFacts = {
  label: string;
  tone: "ok" | "partial" | "lost" | "unknown";
  checked: string;
  detail: string;
};

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
    currency: SourceCurrencyFacts;
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
  currency: RuleCurrencyFacts;
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

/** What the latest recheck of one official source showed; absent records read "Not re-read". */
export function sourceCurrencyFacts(currency: SourceCurrency | undefined): SourceCurrencyFacts {
  if (!currency)
    return {
      label: "Not re-read",
      tone: "unknown",
      checked: NOT_RECORDED,
      detail: "No currency check is recorded for this source; the original capture stands.",
      freshTextPath: null,
      codeSections: [],
    };
  const checked = day(currency.checkedAt);
  const base = {
    checked,
    detail: currency.detail,
    freshTextPath: currency.freshTextPath ?? null,
    codeSections: currency.codeCapture?.sectionNativeIds ?? [],
  };
  if (currency.status === "confirmed_unchanged")
    return { ...base, label: `Official page unchanged · ${checked}`, tone: "ok" };
  if (currency.status === "confirmed_evidence_intact")
    return currency.route === "official_code_capture"
      ? { ...base, label: `Quoted passages found in current code text · ${checked}`, tone: "ok" }
      : { ...base, label: `Page changed; quoted passages intact · ${checked}`, tone: "ok" };
  if (currency.status === "evidence_lost")
    return { ...base, label: `Quoted passage no longer on the official page · ${checked}`, tone: "lost" };
  return { ...base, label: `Not re-read · ${checked}`, tone: "unknown" };
}

/** Roll-up of the recheck across every source a rule quotes. */
export function ruleCurrencyFacts(currency: RuleCurrency | undefined): RuleCurrencyFacts {
  if (!currency)
    return {
      label: "No literal passage tracked",
      tone: "unknown",
      checked: NOT_RECORDED,
      detail:
        "This rule records no quoted passage, so no recheck can confirm it mechanically; rely on the cited authorities and their own currency.",
    };
  const checked = day(currency.checkedAt);
  const labels: Record<RuleCurrency["status"], [string, RuleCurrencyFacts["tone"]]> = {
    confirmed: ["Quoted text confirmed on the current official text", "ok"],
    partially_confirmed: ["Quoted text confirmed in part; see detail", "partial"],
    evidence_lost: ["Quoted text no longer on the official page; no date is issued", "lost"],
    not_rechecked: ["Official text could not be re-read; original capture stands", "unknown"],
  };
  const [label, tone] = labels[currency.status];
  return { label: `${label} · ${checked}`, tone, checked, detail: currency.detail };
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
            currency: sourceCurrencyFacts(s.currency),
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
    currency: ruleCurrencyFacts(rule.currency),
  };
}
