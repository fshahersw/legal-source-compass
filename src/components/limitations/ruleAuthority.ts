import {
  VERIFICATION_GRADE_LABELS,
  type CrossReferenceLink,
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

export type CrossReferenceFacts = {
  state: string;
  /** Public section ids the citation resolved to, in the publisher's current text. */
  sectionIds: string[];
  termCheck: CrossReferenceLink["termCheck"];
  /** Short label beside the citation link. */
  label: string;
  /** Full explanation (tooltip). */
  detail: string;
  checked: string;
};

/** What a link to the cited section's current text does and does not establish, in the words shown to users. */
export function crossReferenceFacts(state: string, link: CrossReferenceLink): CrossReferenceFacts {
  const sectionIds = link.sections.map((s) => s.nativeId);
  const checked = link.checkedAt.slice(0, 10);
  const plural = (term: string) => term.replace(/^(\d+) (year|month|week|day)$/, (_m, n, u) => `${n} ${u}${n === "1" ? "" : "s"}`);
  const terms = link.terms.map((t) => (t.foundIn ? `${plural(t.term)}: in ${t.foundIn.replace(/^[A-Z]{2}:/, "")}, which the note names` : plural(t.term)));
  const missing = link.terms.filter((t) => !t.found).map((t) => plural(t.term));
  const partial = link.sectionsNamed > sectionIds.length;
  const where = `${
    partial
      ? `${sectionIds.length} of the ${link.sectionsNamed} sections it names`
      : sectionIds.length === 1
        ? "the cited section"
        : `the ${sectionIds.length} cited sections`
  } in the publisher's current code text held in the corpus${partial ? " (the rest were not found there as operative text)" : ""}`;
  if (link.termCheck === "all_present")
    return {
      state,
      sectionIds,
      termCheck: link.termCheck,
      label: "section text held · periods printed there",
      detail: `On ${checked} this note's citation resolved to ${where}; every period or age the note states (${terms.join("; ")}) is printed in that text${link.terms.some((t) => t.foundIn) ? " or in the other section the note names" : ""}. This checks the note's numbers against the current section, not its reading of the statute.`,
      checked,
    };
  if (link.termCheck === "none_to_check")
    return {
      state,
      sectionIds,
      termCheck: link.termCheck,
      label: "section text held",
      detail: `On ${checked} this note's citation resolved to ${where}. The note states no period or age that could be checked against the section's numbers; read the section itself.`,
      checked,
    };
  return {
    state,
    sectionIds,
    termCheck: link.termCheck,
    label: "section text held · compare before relying on this note",
    detail: `On ${checked} this note's citation resolved to ${where}, but ${missing.length === 1 ? "a period or age the note states" : `${missing.length} of the periods or ages the note states`} (${missing.join(", ")}) was not found printed in that text. The number may come from another provision the note names, or the text may have changed. The note was not changed; compare it with the section before relying on it.`,
    checked,
  };
}

/**
 * The section number a reader expects, from a public native id:
 * `TX:CP:16.001` → `§ 16.001`; `ME:Title 14/Part 2/Chapter 205/§853` → `§ 853`; `CT:…/sec_52-577` → `§ 52-577`;
 * `VT:14/071/01492` → `§ 1492`; `UT:C78B-3-S416_20250901…` → `§ 78B-3-416`; `DE:10-81-8119` → `§ 8119`;
 * `IL:735 ILCS 5/13-213` stays whole; `LA:3463` → `art. 3463`, `LA:40:1231.8` → `R.S. 40:1231.8`.
 */
export function sectionLabel(nativeId: string): string {
  const state = nativeId.slice(0, nativeId.indexOf(":"));
  const tail = nativeId.slice(nativeId.indexOf(":") + 1);
  if (state === "IL") return tail;
  if (state === "LA") return tail.includes(":") ? `R.S. ${tail}` : `art. ${tail}`;
  const last = (tail.includes("/") ? tail.slice(tail.lastIndexOf("/") + 1) : tail).replace(/^(?:§\s*|sec_)/, "");
  const utah = /^C([0-9A-Za-z-]+)-S([0-9A-Za-z.]+)_\d+$/.exec(last);
  if (utah) return `§ ${utah[1]}-${utah[2]}`;
  if (state === "DE" && /^\d+-\d+-\d+$/.test(last)) return `§ ${last.slice(last.lastIndexOf("-") + 1)}`;
  if (state === "TX" || state === "PA") return `§ ${last.slice(last.lastIndexOf(":") + 1)}`;
  return `§ ${/^\d+$/.test(last) ? last.replace(/^0+(?=\d)/, "") : last}`;
}

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
  /** "Accrual" for a limitations clock; "Period runs from" for a repose cutoff or a start the statute words another way. */
  accrualLabel: "Accrual" | "Period runs from";
  accrual: string;
  tolling: string[];
  repose: string[];
  /**
   * One entry per tolling / repose item above (same order): where the cited section's current text is held in
   * the corpus and whether the note's periods and ages are printed there; null when the note is not linked.
   */
  tollingLinks: (CrossReferenceFacts | null)[];
  reposeLinks: (CrossReferenceFacts | null)[];
  confidence: string | null;
  flags: string[];
  entryStatus: "verified" | "flagged" | "legacy";
  grade: string;
  gradeBasis: string;
  currency: RuleCurrencyFacts;
  /** Ledgered changes since first release (field corrections, quoted text attached later), oldest first. */
  history: string[];
};

const fieldValue = (value: unknown): string =>
  value === null || value === undefined
    ? "none"
    : typeof value === "string"
      ? value
      : JSON.stringify(value);

/** One line per ledgered change; nothing is listed for a rule released as it stands. */
export function ruleHistoryLines(rule: LimitationRule, snapshot: LimitationsSnapshot): string[] {
  const titleOf = (id: string) => snapshot.sources.find((s) => s.id === id)?.title ?? id;
  const lines = (rule.corrections ?? []).map(
    (c) =>
      `Release ${c.appliedInVersion}: ${c.field} changed from ${fieldValue(c.from)} to ${fieldValue(c.to)} — ${c.reason} (evidence: ${titleOf(c.evidenceSourceId)}).${c.note ? ` Added condition: ${c.note}` : ""}`,
  );
  if (rule.evidenceAttachment) {
    const a = rule.evidenceAttachment;
    lines.push(
      `Release ${a.appliedInVersion}: the quoted official text, accrual and tolling passages shown above were attached from ${titleOf(a.evidenceSourceId)}; the period, dates and calculation were not changed — ${a.reason}`,
    );
  }
  return lines;
}

const day = (value: string | undefined | null) => (value ? value.slice(0, 10) : NOT_RECORDED);

export function fetchRouteLabel(route: FetchRoute | undefined, method?: string): string {
  // Older captures record the route only as free text ("Tavily advanced HTML extraction"); show those words.
  if (!route) return method?.trim() ? `Capture method as recorded: ${method.trim()}` : NOT_RECORDED;
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
  const pr = currency.passageRecheck;
  const base = {
    checked,
    detail: pr ? `${currency.detail} ${pr.detail}` : currency.detail,
    freshTextPath: currency.freshTextPath ?? pr?.freshTextPath ?? null,
    codeSections: currency.codeCapture?.sectionNativeIds ?? [],
  };
  if (currency.status === "confirmed_unchanged")
    return { ...base, label: `Official page unchanged · ${checked}`, tone: "ok" };
  if (currency.status === "confirmed_evidence_intact")
    return currency.route === "official_code_capture"
      ? { ...base, label: `Quoted passages found in current code text · ${checked}`, tone: "ok" }
      : currency.route === "proxied"
        ? { ...base, label: `Quoted passages found; page read through a fetch proxy · ${checked}`, tone: "ok" }
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
function linkFor(rule: LimitationRule, kind: CrossReferenceLink["kind"], index: number): CrossReferenceFacts | null {
  const link = rule.crossReferenceLinks?.find((l) => l.kind === kind && l.index === index);
  return link ? crossReferenceFacts(rule.jurisdiction, link) : null;
}

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
            route: fetchRouteLabel(s.fetchRoute, s.method),
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
    accrualLabel: rule.ruleKind === "repose" || p?.accrualKind === "other" ? "Period runs from" : "Accrual",
    accrual: p ? (p.accrualKind === "not_recorded" ? NOT_RECORDED : p.accrualText) : NOT_RECORDED,
    tolling: p ? p.tolling.map((t) => `${t.text} (${t.citation})`) : [],
    repose: p
      ? p.repose.map(
          (r) =>
            `${r.years} years from ${r.trigger} (${r.citation})${r.effectiveFrom ? `, effective ${r.effectiveFrom}` : ""}`,
        )
      : [],
    tollingLinks: p ? p.tolling.map((_t, index) => linkFor(rule, "tolling", index)) : [],
    reposeLinks: p ? p.repose.map((_r, index) => linkFor(rule, "repose", index)) : [],
    confidence: p ? `${p.confidence}: ${p.confidenceNote}` : null,
    flags: p?.flags ?? [],
    entryStatus: p ? p.entryStatus : "legacy",
    grade: rule.verification
      ? VERIFICATION_GRADE_LABELS[rule.verification.grade]
      : "Verification grade not recorded",
    gradeBasis: rule.verification?.basis ?? NOT_RECORDED,
    currency: ruleCurrencyFacts(rule.currency),
    history: ruleHistoryLines(rule, snapshot),
  };
}
