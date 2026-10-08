import {
  PERIOD_LIMB_STARTS,
  SPECIAL_ISSUES,
  type PeriodLimb,
  type ReposeClock,
  type BaselineInput,
  type BaselineResult,
  type LimitationRule,
  type LimitationsSnapshot,
  type WeekendNotice,
} from "./types";

/** Civil dates only: never parse a local midnight or add a fixed number of milliseconds. */
export function parseCivilDate(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]),
    month = Number(match[2]),
    day = Number(match[3]);
  if (year < 1900 || year > 2199 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day
    ? { year, month, day }
    : null;
}

/** A missing leap-day anniversary needs a jurisdiction-specific counting rule; never silently clamp. */
export function calendarAnniversary(value: string, years: number): string | null {
  const date = parseCivilDate(value);
  if (!date || !Number.isInteger(years) || years < 1 || years > 100) return null;
  const result = `${date.year + years}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
  return parseCivilDate(result) ? result : null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Civil-date period arithmetic. Years and months keep the day of month; a target day that does not exist
 * (Feb 29 + 1 year, Aug 31 + 6 months) returns null so the caller withholds the date instead of clamping.
 */
export function addCivilPeriod(
  value: string,
  amount: number,
  unit: "calendar_years" | "calendar_months" | "calendar_days",
): string | null {
  const date = parseCivilDate(value);
  if (!date || !Number.isInteger(amount) || amount < 1) return null;
  if (unit === "calendar_years") return calendarAnniversary(value, amount);
  if (unit === "calendar_months") {
    if (amount > 1200) return null;
    const index = date.year * 12 + (date.month - 1) + amount;
    const year = Math.floor(index / 12);
    const month = (index % 12) + 1;
    const result = `${year}-${pad(month)}-${pad(date.day)}`;
    return parseCivilDate(result) ? result : null;
  }
  if (amount > 36500) return null;
  const moved = new Date(Date.UTC(date.year, date.month - 1, date.day + amount));
  const result = `${moved.getUTCFullYear()}-${pad(moved.getUTCMonth() + 1)}-${pad(moved.getUTCDate())}`;
  return parseCivilDate(result) ? result : null;
}

/** Day of week for a civil date: 0 = Sunday ... 6 = Saturday. */
export function civilWeekday(value: string): number | null {
  const d = parseCivilDate(value);
  return d ? new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay() : null;
}

/** Next weekday on or after the date (Saturday -> Monday, Sunday -> Monday). Legal holidays are not known here. */
export function nextWeekday(value: string): string | null {
  const weekday = civilWeekday(value);
  if (weekday === null) return null;
  return (
    addCivilPeriod(value, weekday === 6 ? 2 : weekday === 0 ? 1 : 0, "calendar_days") ??
    (weekday === 6 || weekday === 0 ? null : value)
  );
}

export function periodLabel(period: { amount: number; unit: string }): string {
  const unit = period.unit.replace("calendar_", "").replace(/s$/, "");
  return `${period.amount} calendar ${unit}${period.amount === 1 ? "" : "s"}`;
}

/**
 * How a Saturday/Sunday last day is treated for one jurisdiction. Only a *verified* recorded rule that
 * extends weekends moves the date, and then only beside the unadjusted anniversary. A flagged rule or no
 * rule yields a notice so the weekend never passes in silence; nothing is inferred from another state.
 */
export function weekendTreatment(
  snapshot: LimitationsSnapshot,
  jurisdiction: string,
  date: string,
): {
  adjustedDate: NonNullable<BaselineResult["adjustedDate"]> | null;
  weekendNotice: WeekendNotice | null;
  /** Sentence(s) about the weekend, or null when the date is a weekday. Ends with a period. */
  weekendText: string | null;
  /** Full step sentence for a "calendar anniversary" step. */
  stepText: string;
} {
  const row = snapshot.coverage.find((c) => c.state === jurisdiction);
  const timeRule = row?.timeComputation;
  const weekday = civilWeekday(date);
  const weekdayName = weekday === 6 ? "Saturday" : weekday === 0 ? "Sunday" : null;
  const uncomputed =
    "Legal holidays, closures, commencement, service and filing-cutoff adjustments remain uncomputed.";
  const finish = (
    adjustedDate: NonNullable<BaselineResult["adjustedDate"]> | null,
    weekendNotice: WeekendNotice | null,
    weekendText: string | null,
  ) => ({
    adjustedDate,
    weekendNotice,
    weekendText,
    stepText: weekendText
      ? `The unadjusted calendar anniversary is ${date}, a ${weekdayName}. ${weekendText} ${uncomputed}`
      : `The unadjusted calendar anniversary is ${date}. Holiday / closure, commencement, service and filing-cutoff adjustments remain uncomputed.`,
  });
  if (!weekdayName) return finish(null, null, null);
  const rolled =
    timeRule?.status === "verified" && timeRule.extendsWhenLastDayIsWeekend ? nextWeekday(date) : null;
  if (rolled && timeRule)
    return finish(
      { date: rolled, citation: timeRule.citation, holidaysComputed: false },
      null,
      `The recorded state counting rule (${timeRule.citation}) extends a last day that falls on a weekend to the next weekday, ${rolled}.`,
    );
  if (timeRule)
    return finish(
      null,
      {
        kind: "flagged_rule",
        weekday: weekdayName,
        ruleStatus: timeRule.status,
        citation: timeRule.citation,
        note: timeRule.note,
        extendsWhenLastDayIsWeekend: timeRule.extendsWhenLastDayIsWeekend,
      },
      timeRule.status === "verified"
        ? `The recorded state counting rule (${timeRule.citation}) does not extend a last day that falls on a ${weekdayName}; the date is shown unadjusted.`
        : `${jurisdiction}'s recorded counting rule (${timeRule.citation}) is flagged and was not applied: ${timeRule.note.replace(/\.$/, "")}. The date is shown unadjusted.`,
    );
  const reason = row?.timeComputationNotRecorded?.reason ?? null;
  return finish(
    null,
    { kind: "no_rule", weekday: weekdayName, reason },
    `No last-day counting rule is recorded for ${jurisdiction}${reason ? ` (${reason.replace(/\.$/, "")})` : ""}; the date is shown unadjusted.`,
  );
}

export function baselineRule(
  rules: LimitationRule[],
  jurisdiction: string,
  claimType: BaselineInput["claimType"],
  subtype = "general",
): LimitationRule | null {
  const matches = rules.filter(
    (r) =>
      r.jurisdiction === jurisdiction &&
      r.claimType === claimType &&
      (r.subtype ?? "general") === subtype &&
      r.computation === "baseline_only",
  );
  return matches.length === 1 ? matches[0]! : null;
}

/** A bundle release does not refresh its authorities. Use the oldest required-authority review. */
export function sourceReviewDate(
  snapshot: LimitationsSnapshot,
  rule: LimitationRule,
): string | null {
  if (!parseCivilDate(snapshot.snapshotDate) || !rule.sourceIds.length) return null;
  const linked = rule.sourceIds.map((id) => {
    const sources = snapshot.sources.filter((s) => s.id === id);
    return sources.length === 1 ? sources[0] : undefined;
  });
  if (
    linked.some((source) => !source) ||
    !linked.some((source) => source?.authorityKind === "statute")
  )
    return null;
  const dates = linked.map((source) => source?.verifiedAt?.slice(0, 10));
  if (dates.some((date) => !date || !parseCivilDate(date))) return null;
  return [snapshot.snapshotDate, ...(dates as string[])].sort()[0]!;
}

/** True when two statutory windows share at least one date (open ends are unbounded). */
function windowsOverlap(
  a: Pick<LimitationRule, "effectiveFrom" | "effectiveThrough">,
  b: Pick<LimitationRule, "effectiveFrom" | "effectiveThrough">,
): boolean {
  const start = [a.effectiveFrom, b.effectiveFrom].filter((d): d is string => !!d).sort().at(-1);
  const end = [a.effectiveThrough, b.effectiveThrough].filter((d): d is string => !!d).sort()[0];
  return !start || !end || start <= end;
}

/**
 * The one sibling baseline rule (same state, claim type, accrual basis and window event) whose statutory
 * window covers `date`, when `rule`'s own window does not. Only another *version* qualifies: its window
 * must not overlap this rule's window, which excludes fact-pattern variants that run alongside the
 * general rule. Null unless the match is unique, so a user is never steered to a guessed version.
 */
export function windowSibling(
  snapshot: LimitationsSnapshot,
  rule: LimitationRule,
  date: string,
): LimitationRule | null {
  const windowEvent = rule.calculation?.windowFrom ?? "accrual";
  const matches = snapshot.rules.filter(
    (r) =>
      r.id !== rule.id &&
      r.jurisdiction === rule.jurisdiction &&
      r.claimType === rule.claimType &&
      r.computation === "baseline_only" &&
      r.accrualBasis === rule.accrualBasis &&
      (r.calculation?.windowFrom ?? "accrual") === windowEvent &&
      (r.effectiveFrom !== null || r.effectiveThrough !== null) &&
      !windowsOverlap(rule, r) &&
      (r.effectiveFrom === null || r.effectiveFrom <= date) &&
      (r.effectiveThrough === null || date <= r.effectiveThrough),
  );
  return matches.length === 1 ? matches[0]! : null;
}

/** Fact-pattern key the caller passes as `input.subtype` to select the sibling. */
const siblingSubtype = (sibling: LimitationRule | null): string | null =>
  sibling ? (sibling.subtype ?? "general") : null;

function siblingReason(sibling: LimitationRule | null): string[] {
  if (!sibling) return [];
  const span =
    sibling.effectiveFrom && sibling.effectiveThrough
      ? `${sibling.effectiveFrom} through ${sibling.effectiveThrough}`
      : sibling.effectiveThrough
        ? `on or before ${sibling.effectiveThrough}`
        : `on or after ${sibling.effectiveFrom}`;
  return [
    `A separately captured version of this rule covers dates ${span} (${sibling.pinpoint}). Select that fact pattern to calculate under it.`,
  ];
}

export function calculateBaseline(
  snapshot: LimitationsSnapshot,
  input: BaselineInput,
): BaselineResult {
  const rule = baselineRule(snapshot.rules, input.jurisdiction, input.claimType, input.subtype);
  let suggestedSubtype: string | null = null;
  const finish = (
    status: BaselineResult["status"],
    reasons: string[],
    date: string | null = null,
  ): BaselineResult => ({ status, date, rule, reasons, steps: [], suggestedSubtype });
  if (!snapshot.coverage.some((c) => c.state === input.jurisdiction))
    return finish("invalid", ["Select one of the 50 states or DC."]);
  if (!rule)
    return finish("needs_review", [
      "This jurisdiction and claim have no uniquely supported baseline rule. Consult the source inventory and claim-specific research below.",
    ]);
  if (rule.calculation?.mode === "clocks_min") return calculateClocks(snapshot, input, rule);
  const hasRepose = rule.calculation?.mode === "accrual_repose_min";
  /** The repose clock starts at the act/omission date, or at first delivery to a purchaser for product repose. */
  const reposeStart =
    rule.calculation?.reposeTrigger === "first_delivery"
      ? input.firstProductDeliveryDate
      : input.reposeActDate;
  const reposeYears = rule.calculation?.reposeYears;
  if (
    (rule.calculation &&
      !["discovery_min", "diagnosis", "death_cause_min", "accrual_repose_min"].includes(
        rule.calculation.mode,
      )) ||
    (hasRepose &&
      (!Number.isSafeInteger(reposeYears) ||
        !reposeYears ||
        reposeYears < 1 ||
        reposeYears > 100 ||
        !["last_act_or_omission", "act_or_omission", "first_delivery"].includes(
          rule.calculation?.reposeTrigger ?? "",
        ) ||
        !parseCivilDate(rule.calculation?.reposeEffectiveFrom ?? "") ||
        (rule.calculation?.reposeEffectiveThrough !== undefined &&
          (!parseCivilDate(rule.calculation.reposeEffectiveThrough) ||
            rule.calculation.reposeEffectiveFrom! > rule.calculation.reposeEffectiveThrough)) ||
        !["confirmed_accrual", "death"].includes(rule.accrualBasis) ||
        rule.calculation?.deathCapYears !== undefined ||
        rule.calculation?.secondaryCapYears !== undefined ||
        rule.calculation?.requiresExposureWithinDeliveryYears !== undefined)) ||
    (!hasRepose &&
      (reposeYears !== undefined ||
        rule.calculation?.reposeTrigger !== undefined ||
        rule.calculation?.reposeEffectiveFrom !== undefined ||
        rule.calculation?.reposeEffectiveThrough !== undefined)) ||
    (rule.effectiveFrom && !parseCivilDate(rule.effectiveFrom)) ||
    (rule.effectiveThrough && !parseCivilDate(rule.effectiveThrough)) ||
    (rule.effectiveFrom && rule.effectiveThrough && rule.effectiveFrom > rule.effectiveThrough)
  )
    return finish("needs_review", [
      "This rule's calculation or applicability window is not supported.",
    ]);
  const triggerDates =
    rule?.calculation?.mode === "discovery_min"
      ? [input.actualDiscoveryDate, input.constructiveDiscoveryDate]
      : rule?.calculation?.mode === "diagnosis"
        ? [input.diagnosisCommunicationDate]
        : rule?.calculation?.mode === "death_cause_min"
          ? [input.deathDate, input.causeDiscoveryDate]
          : [input.accrualDate];
  const requiredDates = [
    ...triggerDates,
    ...(hasRepose ? [reposeStart] : []),
    ...(rule?.calculation?.requiresExposureWithinDeliveryYears
      ? [input.firstProductDeliveryDate, input.qualifyingExposureDate]
      : []),
  ];
  if (requiredDates.some((d) => !d || !parseCivilDate(d)))
    return finish("invalid", [
      "Supply each legally relevant real civil date in YYYY-MM-DD format (1900–2199).",
    ]);
  if (input.deathDate && !parseCivilDate(input.deathDate))
    return finish("invalid", ["The death date is invalid."]);
  if (
    !rule.period ||
    !["calendar_years", "calendar_months", "calendar_days"].includes(rule.period.unit) ||
    !rule.sourceIds.length ||
    rule.sourceIds.some((id) => !snapshot.sources.some((s) => s.id === id)) ||
    !rule.sourceIds.some((id) =>
      snapshot.sources.some((source) => source.id === id && source.authorityKind === "statute"),
    ) ||
    rule.caseReferenceIds?.some((id) => !snapshot.cases.some((c) => c.id === id))
  )
    return finish("needs_review", ["The rule's period or primary-source evidence is incomplete."]);
  const reviewedThrough = sourceReviewDate(snapshot, rule);
  if (!reviewedThrough)
    return finish("needs_review", ["The required authorities have no reliable review date."]);
  if ([...requiredDates, input.deathDate].filter(Boolean).some((d) => d! > reviewedThrough))
    return finish("needs_review", [
      `A selected date is later than ${reviewedThrough}, the oldest review date among this rule's required authorities. Confirm subsequent law before calculating.`,
    ]);
  const reasons: string[] = [];
  if (input.governingLawConfirmed !== true)
    reasons.push(
      "Confirm the governing state's limitations law; residence, injury location and MDL venue alone do not establish it.",
    );
  if (input.accrualConfirmed !== true)
    reasons.push(
      "Confirm the legally relevant accrual date under this rule; exposure, diagnosis and discovery are not interchangeable.",
    );
  if (input.applicabilityConfirmed !== true)
    reasons.push(
      "Confirm this current statutory rule and its claim category apply to the facts and historical dates.",
    );
  if (hasRepose && input.reposeApplicabilityConfirmed !== true)
    reasons.push(
      "Confirm that the cited repose rule applies to this claim and defendant, and verify the qualifying act or omission date.",
    );
  if (rule.calculation?.deathCapYears && (!input.vitalStatus || input.vitalStatus === "unknown"))
    reasons.push("Confirm whether the injured person is alive; this rule has a death-related cap.");
  if (rule.calculation?.deathCapYears && input.vitalStatus === "deceased" && !input.deathDate)
    reasons.push("Supply the death date for this rule's death-related cap.");
  if (rule.calculation?.deathCapYears && input.vitalStatus === "alive" && input.deathDate)
    reasons.push("A death date conflicts with the selected living status.");
  if (input.exceptionReview !== "no_unresolved_issues")
    reasons.push(
      "Resolve exceptions, special claims, tolling, repose and previous filings before computing a baseline.",
    );
  for (const id of input.issues)
    reasons.push(
      `${SPECIAL_ISSUES.find((x) => x.id === id)?.label ?? "Unrecognized special issue"}: this issue requires separate legal review.`,
    );
  const trigger =
    rule.calculation?.mode === "discovery_min"
      ? [input.actualDiscoveryDate!, input.constructiveDiscoveryDate!].sort()[0]!
      : rule.calculation?.mode === "diagnosis"
        ? input.diagnosisCommunicationDate!
        : rule.calculation?.mode === "death_cause_min"
          ? input.causeDiscoveryDate!
          : input.accrualDate;
  if (hasRepose && reposeStart! > trigger)
    reasons.push(
      "The qualifying act or omission date follows the confirmed accrual date. Review the claim and defendant chronology; a later event does not automatically restart repose.",
    );
  if (hasRepose && reposeStart! < rule.calculation!.reposeEffectiveFrom!)
    reasons.push(
      `The act or omission predates ${rule.calculation!.reposeEffectiveFrom}, the supported historical range for this repose rule. Review the earlier statutory version and transition before calculating.`,
    );
  if (
    hasRepose &&
    rule.calculation!.reposeEffectiveThrough &&
    reposeStart! > rule.calculation!.reposeEffectiveThrough
  )
    reasons.push(
      `The act or omission follows ${rule.calculation!.reposeEffectiveThrough}, the end of the supported historical range for this repose rule. Review the later statutory version before calculating.`,
    );
  if (rule.calculation?.mode === "death_cause_min" && input.causeDiscoveryDate! < input.deathDate!)
    reasons.push(
      "Cause-of-death discovery cannot precede death; a diagnosis date is not automatically cause-of-death discovery.",
    );
  if (rule.calculation?.deathCapYears && input.deathDate && trigger > input.deathDate)
    reasons.push(
      "Post-death knowledge requires separate representative / accrual analysis; this branch does not resolve it.",
    );
  if (
    (rule.effectiveFrom && trigger < rule.effectiveFrom) ||
    (rule.effectiveThrough && trigger > rule.effectiveThrough)
  ) {
    reasons.push(
      rule.effectiveFrom && trigger < rule.effectiveFrom
        ? `This calculator branch supports trigger dates on or after ${rule.effectiveFrom}. Earlier dates require the historical statute and transition analysis; the current period cannot be applied automatically.`
        : `This calculator branch ends on ${rule.effectiveThrough}. Later dates require a supported statutory version.`,
    );
    const sibling = windowSibling(snapshot, rule, trigger);
    suggestedSubtype = siblingSubtype(sibling);
    reasons.push(...siblingReason(sibling));
  }
  if (rule.calculation?.requiresExposureWithinDeliveryYears) {
    const lastExposure = calendarAnniversary(
      input.firstProductDeliveryDate!,
      rule.calculation.requiresExposureWithinDeliveryYears,
    );
    if (!lastExposure)
      reasons.push(
        "The delivery-based exposure window has no exact anniversary; jurisdiction-specific counting requires review.",
      );
    else if (
      input.qualifyingExposureDate! < input.firstProductDeliveryDate! ||
      input.qualifyingExposureDate! > lastExposure
    )
      reasons.push(
        "The supplied exposure is outside this statutory branch's delivery-based exposure window. A different repose exception requires review.",
      );
    if (input.qualifyingExposureDate! > trigger)
      reasons.push(
        "The supplied qualifying exposure follows the injury-discovery trigger. Review the exposure and medical chronology.",
      );
  }
  if (reasons.length) return finish("needs_review", reasons);
  const ordinaryDate = addCivilPeriod(trigger, rule.period.amount, rule.period.unit);
  const capYears = rule.calculation?.deathCapYears ?? rule.calculation?.secondaryCapYears;
  const cap = capYears && input.deathDate ? calendarAnniversary(input.deathDate, capYears) : null;
  const reposeCap = hasRepose ? calendarAnniversary(reposeStart!, reposeYears!) : null;
  if (hasRepose && !reposeCap)
    return finish("needs_review", [
      "The repose date has no exact calendar anniversary. A verified jurisdiction-specific counting rule is required.",
    ]);
  if (reposeCap && reposeCap < trigger)
    return finish("needs_review", [
      `The cited repose cutoff (${reposeCap}) precedes the confirmed accrual date (${trigger}). Review whether repose bars this claim before relying on an accrual-based period.`,
    ]);
  if (capYears && input.deathDate && !cap)
    return finish("needs_review", [
      "The death-related cap has no exact anniversary. A verified leap-day / counting rule is required.",
    ]);
  const date = ordinaryDate
    ? [ordinaryDate, cap, reposeCap].filter((d): d is string => d !== null).sort()[0]!
    : null;
  if (!date)
    return finish("needs_review", [
      "This date has no exact calendar anniversary. A verified jurisdiction-specific leap-day / counting rule is required.",
    ]);
  const weekend = weekendTreatment(snapshot, input.jurisdiction, date);
  return {
    status: "baseline",
    date,
    adjustedDate: weekend.adjustedDate,
    weekendNotice: weekend.weekendNotice,
    rule,
    reasons: [...rule.warnings],
    steps: [
      {
        text:
          rule.calculation?.mode === "discovery_min"
            ? `Use the earlier of actual discovery (${input.actualDiscoveryDate}) and legally confirmed reasonable-diligence discovery (${input.constructiveDiscoveryDate}): ${trigger}.`
            : rule.calculation?.mode === "diagnosis"
              ? `Use the legally qualifying physician communication date: ${trigger}.`
              : rule.calculation?.mode === "death_cause_min"
                ? `Use cause-of-death discovery (${trigger}) and the independently recorded death date (${input.deathDate}).`
                : `Use the confirmed ${rule.accrualBasis === "death" ? "death" : rule.accrualBasis === "discovery_of_death" ? "discovery-of-death" : "accrual"} date: ${trigger}.`,
        sourceIds: rule.sourceIds,
        pinpoint: rule.pinpoint,
      },
      {
        text: `The cited statutory baseline is ${periodLabel(rule.period)}.`,
        sourceIds: rule.sourceIds,
        pinpoint: rule.pinpoint,
      },
      ...(rule.calculation?.requiresExposureWithinDeliveryYears
        ? [
            {
              text: `Recorded qualifying exposure (${input.qualifyingExposureDate}) falls within the ${rule.calculation.requiresExposureWithinDeliveryYears}-year window after first qualifying purchaser / lessee delivery (${input.firstProductDeliveryDate}). Other branch definitions and exceptions were separately confirmed.`,
              sourceIds: rule.sourceIds,
              pinpoint: rule.pinpoint,
            },
          ]
        : []),
      ...(cap
        ? [
            {
              text: `Compare the ${ordinaryDate} anniversary with the ${capYears}-year death-related cap (${cap}); use the earlier unadjusted date.`,
              sourceIds: rule.sourceIds,
              pinpoint: rule.pinpoint,
            },
          ]
        : []),
      ...(reposeCap
        ? [
            {
              text: `The confirmed ${rule.calculation?.reposeTrigger === "last_act_or_omission" ? "last act or omission" : rule.calculation?.reposeTrigger === "first_delivery" ? "first delivery to a purchaser" : "act or omission complained of"} (${reposeStart}) produces a separate ${reposeYears}-year repose cutoff of ${reposeCap}. Compare it with the accrual-based anniversary (${ordinaryDate}); the earlier date controls this conditional calculation.`,
              sourceIds: rule.sourceIds,
              pinpoint: rule.pinpoint,
            },
          ]
        : []),
      {
        text: weekend.stepText,
        sourceIds: rule.sourceIds,
        pinpoint: rule.pinpoint,
      },
    ],
  };
}

const CLOCK_START_LABEL: Record<ReposeClock["from"], string> = {
  act_or_omission: "act or omission complained of",
  last_act_or_omission: "last act or omission",
  injury_date: "date of injury",
  substantial_completion: "substantial completion of the improvement",
  first_delivery: "first delivery to a purchaser",
};
const LIMB_START_LABEL: Record<PeriodLimb["from"], string> = {
  accrual: "accrual",
  discovery: "discovery (earlier of actual and constructive)",
  injury_date: "injury",
  death: "death",
  act_or_omission: "act or omission complained of",
};

/** Input date that starts a repose clock. */
function clockStart(input: BaselineInput, from: ReposeClock["from"]): string | undefined {
  if (from === "injury_date") return input.injuryDate;
  if (from === "substantial_completion") return input.substantialCompletionDate;
  if (from === "first_delivery") return input.firstProductDeliveryDate;
  return input.reposeActDate;
}

/** Input date that starts a period limb. */
function limbStart(input: BaselineInput, from: PeriodLimb["from"]): string | undefined {
  if (from === "death") return input.deathDate;
  if (from === "injury_date") return input.injuryDate;
  if (from === "act_or_omission") return input.reposeActDate;
  if (from === "discovery") {
    const dates = [input.actualDiscoveryDate, input.constructiveDiscoveryDate];
    return dates.every((d) => d && parseCivilDate(d)) ? (dates as string[]).sort()[0] : undefined;
  }
  return input.accrualDate;
}

/**
 * clocks_min: one or two period limbs joined by "earlier" or "later", then capped by every repose clock; the
 * earliest resulting date is issued. Nothing is clamped, guessed or inferred: a missing start date, an
 * unsupported historical start, an impossible anniversary or a bar that already ran withholds the date.
 */
function calculateClocks(
  snapshot: LimitationsSnapshot,
  input: BaselineInput,
  rule: LimitationRule,
): BaselineResult {
  let suggestedSubtype: string | null = null;
  const finish = (
    status: BaselineResult["status"],
    reasons: string[],
    date: string | null = null,
  ): BaselineResult => ({ status, date, rule, reasons, steps: [], suggestedSubtype });
  const calc = rule.calculation!;
  const limbs = calc.limbs ?? [];
  const clocks = calc.clocks ?? [];
  const unsupported =
    limbs.length < 1 ||
    limbs.length > 2 ||
    (limbs.length === 2 && calc.combine !== "earlier" && calc.combine !== "later") ||
    limbs.some(
      (l) =>
        !Number.isSafeInteger(l.amount) ||
        l.amount < 1 ||
        !["calendar_years", "calendar_months", "calendar_days"].includes(l.unit) ||
        !PERIOD_LIMB_STARTS.includes(l.from),
    ) ||
    clocks.some(
      (c) =>
        !Number.isSafeInteger(c.years) ||
        c.years < 1 ||
        c.years > 100 ||
        !Object.hasOwn(CLOCK_START_LABEL, c.from) ||
        (c.effectiveFrom === null
          ? c.startBasis !== "not_recorded"
          : !parseCivilDate(c.effectiveFrom)) ||
        (c.effectiveThrough !== undefined &&
          (!parseCivilDate(c.effectiveThrough) ||
            (c.effectiveFrom !== null && c.effectiveFrom > c.effectiveThrough))),
    ) ||
    (calc.windowFrom !== undefined && !limbs.some((l) => l.from === calc.windowFrom)) ||
    calc.deathCapYears !== undefined ||
    calc.secondaryCapYears !== undefined ||
    calc.requiresExposureWithinDeliveryYears !== undefined ||
    !["confirmed_accrual", "death"].includes(rule.accrualBasis) ||
    (rule.effectiveFrom && !parseCivilDate(rule.effectiveFrom)) ||
    (rule.effectiveThrough && !parseCivilDate(rule.effectiveThrough));
  if (unsupported)
    return finish("needs_review", [
      "This rule's calculation or applicability window is not supported.",
    ]);
  if (
    !rule.sourceIds.length ||
    rule.sourceIds.some((id) => !snapshot.sources.some((s) => s.id === id)) ||
    !rule.sourceIds.some((id) =>
      snapshot.sources.some((source) => source.id === id && source.authorityKind === "statute"),
    ) ||
    rule.caseReferenceIds?.some((id) => !snapshot.cases.some((c) => c.id === id))
  )
    return finish("needs_review", ["The rule's period or primary-source evidence is incomplete."]);

  const limbDates = limbs.map((l) => limbStart(input, l.from));
  const clockDates = clocks.map((c) => clockStart(input, c.from));
  const required = [...limbDates, ...clockDates];
  if (required.some((d) => !d || !parseCivilDate(d)))
    return finish("invalid", [
      "Supply each legally relevant real civil date in YYYY-MM-DD format (1900–2199).",
    ]);
  const reviewedThrough = sourceReviewDate(snapshot, rule);
  if (!reviewedThrough)
    return finish("needs_review", ["The required authorities have no reliable review date."]);
  if (required.some((d) => d! > reviewedThrough))
    return finish("needs_review", [
      `A selected date is later than ${reviewedThrough}, the oldest review date among this rule's required authorities. Confirm subsequent law before calculating.`,
    ]);

  const reasons: string[] = [];
  if (input.governingLawConfirmed !== true)
    reasons.push(
      "Confirm the governing state's limitations law; residence, injury location and MDL venue alone do not establish it.",
    );
  if (input.accrualConfirmed !== true)
    reasons.push(
      "Confirm the legally relevant accrual date under this rule; exposure, diagnosis and discovery are not interchangeable.",
    );
  if (input.applicabilityConfirmed !== true)
    reasons.push(
      "Confirm this current statutory rule and its claim category apply to the facts and historical dates.",
    );
  if (clocks.length && input.reposeApplicabilityConfirmed !== true)
    reasons.push(
      "Confirm that each cited repose rule applies to this claim and defendant, and verify the dates that start them.",
    );
  if (input.exceptionReview !== "no_unresolved_issues")
    reasons.push(
      "Resolve exceptions, special claims, tolling, repose and previous filings before computing a baseline.",
    );
  for (const id of input.issues)
    reasons.push(
      `${SPECIAL_ISSUES.find((x) => x.id === id)?.label ?? "Unrecognized special issue"}: this issue requires separate legal review.`,
    );
  const earliestStart = [...(limbDates as string[])].sort()[0]!;
  const latestStart = [...(limbDates as string[])].sort().at(-1)!;
  clocks.forEach((c, i) => {
    const start = clockDates[i]!;
    if (c.effectiveFrom !== null && start < c.effectiveFrom)
      reasons.push(
        `The ${CLOCK_START_LABEL[c.from]} (${start}) predates ${c.effectiveFrom}, the supported historical start of this repose rule. Review the earlier statutory version and transition before calculating.`,
      );
    if (c.effectiveThrough && start > c.effectiveThrough)
      reasons.push(
        `The ${CLOCK_START_LABEL[c.from]} follows ${c.effectiveThrough}, the end of the supported historical range of this repose rule. Review the later statutory version before calculating.`,
      );
    if (start > latestStart)
      reasons.push(
        `The ${CLOCK_START_LABEL[c.from]} follows the confirmed accrual or discovery date. Review the chronology; a later event does not restart repose.`,
      );
  });
  // The historical window is tested against the event the statute itself uses to define its reach when the
  // rule names one (`windowFrom`); otherwise every limb start must fall inside it.
  const windowIndex = calc.windowFrom ? limbs.findIndex((l) => l.from === calc.windowFrom) : -1;
  const windowEarliest = windowIndex >= 0 ? limbDates[windowIndex]! : earliestStart;
  const windowLatest = windowIndex >= 0 ? limbDates[windowIndex]! : latestStart;
  const windowLabel = windowIndex >= 0 ? LIMB_START_LABEL[limbs[windowIndex]!.from] : "trigger";
  const beforeWindow = Boolean(rule.effectiveFrom && windowEarliest < rule.effectiveFrom);
  const afterWindow = Boolean(rule.effectiveThrough && windowLatest > rule.effectiveThrough);
  if (beforeWindow)
    reasons.push(
      `This calculator branch supports ${windowLabel} dates on or after ${rule.effectiveFrom}. Earlier dates require the historical statute and transition analysis.`,
    );
  if (afterWindow)
    reasons.push(
      `This calculator branch ends on ${rule.effectiveThrough} (${windowLabel} date). Later dates require a supported statutory version.`,
    );
  // Only a single out-of-window date can name a sibling version; a span straddling both ends cannot.
  if (beforeWindow !== afterWindow) {
    const sibling = windowSibling(snapshot, rule, beforeWindow ? windowEarliest : windowLatest);
    suggestedSubtype = siblingSubtype(sibling);
    reasons.push(...siblingReason(sibling));
  }
  if (reasons.length) return finish("needs_review", reasons);

  const limbEnds = limbs.map((l, i) => addCivilPeriod(limbDates[i]!, l.amount, l.unit));
  if (limbEnds.some((d) => !d))
    return finish("needs_review", [
      "A limitations anniversary has no exact calendar date. A verified jurisdiction-specific counting rule is required.",
    ]);
  const ends = limbEnds as string[];
  const combined =
    ends.length === 2
      ? calc.combine === "later"
        ? [...ends].sort()[1]!
        : [...ends].sort()[0]!
      : ends[0]!;
  const caps = clocks.map((c, i) => calendarAnniversary(clockDates[i]!, c.years));
  if (caps.some((d) => !d))
    return finish("needs_review", [
      "A repose date has no exact calendar anniversary. A verified jurisdiction-specific counting rule is required.",
    ]);
  const barred = clocks.findIndex((_, i) => (caps[i] as string) < earliestStart);
  if (barred >= 0)
    return finish("needs_review", [
      `The cited repose cutoff (${caps[barred]}) precedes the confirmed accrual or discovery date (${earliestStart}). Review whether repose bars this claim before relying on an accrual-based period.`,
    ]);
  const date = [combined, ...(caps as string[])].sort()[0]!;
  const limbText = limbs
    .map(
      (l, i) =>
        `${periodLabel({ amount: l.amount, unit: l.unit })} from ${LIMB_START_LABEL[l.from]} (${limbDates[i]}) = ${ends[i]}`,
    )
    .join(calc.combine === "later" ? "; the later of: " : "; the earlier of: ");
  const sources = { sourceIds: rule.sourceIds, pinpoint: rule.pinpoint };
  const weekend = weekendTreatment(snapshot, input.jurisdiction, date);
  const undatedClocks = clocks.filter((c) => c.effectiveFrom === null);
  return {
    status: "baseline",
    date,
    adjustedDate: weekend.adjustedDate,
    weekendNotice: weekend.weekendNotice,
    rule,
    reasons: [
      ...rule.warnings,
      ...(undatedClocks.length
        ? [
            `The captured text does not print the date the ${undatedClocks.length === 1 ? "outer limit" : "outer limits"} took effect; the current bar was applied to the entered dates. For conduct before the current statutory version, confirm the historical outer limit.`,
          ]
        : []),
    ],
    steps: [
      {
        text:
          limbs.length === 2
            ? `Limitations limbs: ${limbText}. ${calc.combine === "later" ? "The later" : "The earlier"} controls: ${combined}.`
            : `The cited statutory baseline is ${limbText}.`,
        ...sources,
      },
      ...clocks.map((c, i) => ({
        text: `Repose: ${c.years} calendar years from the ${CLOCK_START_LABEL[c.from]} (${clockDates[i]}) is ${caps[i]}${c.effectiveFrom === null ? " (start date of this bar not printed in the captured text; applied as current law)" : ""}.`,
        ...sources,
      })),
      {
        text: weekend.weekendText
          ? `The earliest applicable date is ${date}, a ${weekend.weekendNotice?.weekday ?? (civilWeekday(date) === 6 ? "Saturday" : "Sunday")}. ${weekend.weekendText} Legal holidays, closures, commencement, service and filing-cutoff adjustments remain uncomputed.`
          : `The earliest applicable date is ${date}. Holiday / closure, commencement, service and filing-cutoff adjustments remain uncomputed.`,
        ...sources,
      },
    ],
  };
}
