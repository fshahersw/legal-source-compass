import {
  SPECIAL_ISSUES,
  type BaselineInput,
  type BaselineResult,
  type LimitationRule,
  type LimitationsSnapshot,
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

export function calculateBaseline(
  snapshot: LimitationsSnapshot,
  input: BaselineInput,
): BaselineResult {
  const rule = baselineRule(snapshot.rules, input.jurisdiction, input.claimType, input.subtype);
  const finish = (
    status: BaselineResult["status"],
    reasons: string[],
    date: string | null = null,
  ): BaselineResult => ({ status, date, rule, reasons, steps: [] });
  if (!snapshot.coverage.some((c) => c.state === input.jurisdiction))
    return finish("invalid", ["Select one of the 50 states or DC."]);
  if (!rule)
    return finish("needs_review", [
      "This jurisdiction and claim have no uniquely supported baseline rule. Consult the source inventory and claim-specific research below.",
    ]);
  const hasRepose = rule.calculation?.mode === "accrual_repose_min";
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
        !["last_act_or_omission", "act_or_omission"].includes(
          rule.calculation?.reposeTrigger ?? "",
        ) ||
        !parseCivilDate(rule.calculation?.reposeEffectiveFrom ?? "") ||
        (rule.calculation?.reposeEffectiveThrough !== undefined &&
          (!parseCivilDate(rule.calculation.reposeEffectiveThrough) ||
            rule.calculation.reposeEffectiveFrom! > rule.calculation.reposeEffectiveThrough)) ||
        rule.accrualBasis !== "confirmed_accrual" ||
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
    ...(hasRepose ? [input.reposeActDate] : []),
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
  if (hasRepose && input.reposeActDate! > trigger)
    reasons.push(
      "The qualifying act or omission date follows the confirmed accrual date. Review the claim and defendant chronology; a later event does not automatically restart repose.",
    );
  if (hasRepose && input.reposeActDate! < rule.calculation!.reposeEffectiveFrom!)
    reasons.push(
      `The act or omission predates ${rule.calculation!.reposeEffectiveFrom}, the supported historical range for this repose rule. Review the earlier statutory version and transition before calculating.`,
    );
  if (
    hasRepose &&
    rule.calculation!.reposeEffectiveThrough &&
    input.reposeActDate! > rule.calculation!.reposeEffectiveThrough
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
  if (rule.effectiveFrom && trigger < rule.effectiveFrom)
    reasons.push(
      `This calculator branch supports trigger dates on or after ${rule.effectiveFrom}. Earlier dates require the historical statute and transition analysis; the current period cannot be applied automatically.`,
    );
  if (rule.effectiveThrough && trigger > rule.effectiveThrough)
    reasons.push(
      `This calculator branch ends on ${rule.effectiveThrough}. Later dates require a supported statutory version.`,
    );
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
  const reposeCap = hasRepose ? calendarAnniversary(input.reposeActDate!, reposeYears!) : null;
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
  const timeRule = snapshot.coverage.find((c) => c.state === input.jurisdiction)?.timeComputation;
  const weekday = civilWeekday(date);
  const rolled =
    timeRule?.extendsWhenLastDayIsWeekend && (weekday === 6 || weekday === 0)
      ? nextWeekday(date)
      : null;
  return {
    status: "baseline",
    date,
    adjustedDate: rolled
      ? { date: rolled, citation: timeRule!.citation, holidaysComputed: false }
      : null,
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
              text: `The confirmed ${rule.calculation?.reposeTrigger === "last_act_or_omission" ? "last act or omission" : "act or omission complained of"} (${input.reposeActDate}) produces a separate ${reposeYears}-year repose cutoff of ${reposeCap}. Compare it with the accrual-based anniversary (${ordinaryDate}); the earlier date controls this conditional calculation.`,
              sourceIds: rule.sourceIds,
              pinpoint: rule.pinpoint,
            },
          ]
        : []),
      {
        text: rolled
          ? `The unadjusted calendar anniversary is ${date}, a ${weekday === 6 ? "Saturday" : "Sunday"}. The recorded state counting rule (${timeRule!.citation}) extends a last day that falls on a weekend to the next weekday, ${rolled}. Legal holidays, closures, commencement, service and filing-cutoff adjustments remain uncomputed.`
          : `The unadjusted calendar anniversary is ${date}. Holiday / closure, commencement, service and filing-cutoff adjustments remain uncomputed.`,
        sourceIds: rule.sourceIds,
        pinpoint: rule.pinpoint,
      },
    ],
  };
}
