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
    ...(rule?.calculation?.requiresExposureWithinDeliveryYears
      ? [input.firstProductDeliveryDate, input.qualifyingExposureDate]
      : []),
  ];
  if (requiredDates.some((d) => !d || !parseCivilDate(d)))
    return finish("invalid", [
      "Supply each legally relevant real civil date in YYYY-MM-DD format (1900–2199).",
    ]);
  if ([...requiredDates, input.deathDate].filter(Boolean).some((d) => d! > snapshot.snapshotDate))
    return finish("needs_review", [
      "A selected date is later than the legal-source snapshot. Future-law applicability needs review.",
    ]);
  if (input.deathDate && !parseCivilDate(input.deathDate))
    return finish("invalid", ["The death date is invalid."]);
  if (
    !rule.period ||
    rule.period.unit !== "calendar_years" ||
    !rule.sourceIds.length ||
    rule.sourceIds.some((id) => !snapshot.sources.some((s) => s.id === id)) ||
    rule.caseReferenceIds?.some((id) => !snapshot.cases.some((c) => c.id === id))
  )
    return finish("needs_review", ["The rule's period or primary-source evidence is incomplete."]);
  const reasons: string[] = [];
  if (!input.governingLawConfirmed)
    reasons.push(
      "Confirm the governing state's limitations law; residence, injury location and MDL venue alone do not establish it.",
    );
  if (!input.accrualConfirmed)
    reasons.push(
      "Confirm the legally relevant accrual date under this rule; exposure, diagnosis and discovery are not interchangeable.",
    );
  if (!input.applicabilityConfirmed)
    reasons.push(
      "Confirm this current statutory rule and its claim category apply to the facts and historical dates.",
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
  if (rule.calculation?.mode === "death_cause_min" && input.causeDiscoveryDate! < input.deathDate!)
    reasons.push(
      "Cause-of-death discovery cannot precede death; a diagnosis date is not automatically cause-of-death discovery.",
    );
  if (rule.calculation?.deathCapYears && input.deathDate && trigger > input.deathDate)
    reasons.push(
      "Post-death knowledge requires separate representative / accrual analysis; this branch does not resolve it.",
    );
  if (rule.effectiveFrom && trigger < rule.effectiveFrom)
    reasons.push("The date precedes this rule version's recorded effective window.");
  if (rule.effectiveThrough && trigger > rule.effectiveThrough)
    reasons.push("The date follows this rule version's recorded effective window.");
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
  const ordinaryDate = calendarAnniversary(trigger, rule.period.amount);
  const capYears = rule.calculation?.deathCapYears ?? rule.calculation?.secondaryCapYears;
  const cap = capYears && input.deathDate ? calendarAnniversary(input.deathDate, capYears) : null;
  if (capYears && input.deathDate && !cap)
    return finish("needs_review", [
      "The death-related cap has no exact anniversary. A verified leap-day / counting rule is required.",
    ]);
  const date = ordinaryDate && cap ? [ordinaryDate, cap].sort()[0]! : ordinaryDate;
  if (!date)
    return finish("needs_review", [
      "This date has no exact calendar anniversary. A verified jurisdiction-specific leap-day / counting rule is required.",
    ]);
  return {
    status: "baseline",
    date,
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
        text: `The cited statutory baseline is ${rule.period.amount} calendar years.`,
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
      {
        text: `The unadjusted calendar anniversary is ${date}. Holiday / closure, commencement, service and filing-cutoff adjustments remain uncomputed.`,
        sourceIds: rule.sourceIds,
        pinpoint: rule.pinpoint,
      },
    ],
  };
}
