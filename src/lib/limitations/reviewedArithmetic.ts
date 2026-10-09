import { addCivilPeriod, parseCivilDate } from "./engine";
import type { PeriodUnit } from "./types";

/** A user's case-specific legal direction. This is NOT a publisher-verified rule. */
type InstructionEvidence = {
  id: string;
  authority: string;
  explanation: string;
  reviewer: string;
  legalEffectConfirmed: boolean;
  boundariesConfirmed: boolean;
  interactionsConfirmed: boolean;
};
export type ReviewedInstruction = InstructionEvidence &
  (
    | {
        kind: "pause";
        startDate: string;
        resumeDate: string;
        maximumExclusion?: { amount: number; unit: PeriodUnit };
      }
    | { kind: "defer_start"; resumeDate: string; presentAtAccrualConfirmed: boolean }
    | {
        kind: "minimum_after_event";
        protectedFromDate: string;
        eventDate: string;
        amount: number;
        unit: PeriodUnit;
      }
    | { kind: "fixed_deadline"; date: string }
  );
export type InstructionStep = {
  instructionIds: string[];
  text: string;
  days?: number;
  date?: string;
};
export type ReviewedArithmeticResult = {
  status: "calculated" | "needs_review" | "invalid" | "open_ended";
  date: string | null;
  originalStartDate: string;
  effectiveStartDate: string;
  excludedDays: number;
  capped: boolean;
  reasons: string[];
  steps: InstructionStep[];
};
export const INSTRUCTION_LABELS: Record<ReviewedInstruction["kind"], string> = {
  pause: "Exclude a confirmed interval",
  defer_start: "Run the period after a confirmed resumption date",
  minimum_after_event: "Preserve at least a period after a later event",
  fixed_deadline: "Use an expressly agreed or ordered date",
};
const present = (value: unknown, minimum = 1): value is string =>
  typeof value === "string" && value.trim().length >= minimum && value.length <= 10000;
const real = (value: unknown): value is string =>
  typeof value === "string" && !!parseCivilDate(value);
const periodValid = (amount: unknown, unit: unknown): boolean =>
  Number.isSafeInteger(amount) &&
  (amount as number) > 0 &&
  ((unit === "calendar_years" && (amount as number) <= 100) ||
    (unit === "calendar_months" && (amount as number) <= 1200) ||
    (unit === "calendar_days" && (amount as number) <= 36500));

export function validateInstruction(value: ReviewedInstruction): string[] {
  if (!value || typeof value !== "object")
    return ["An adjustment must be a structured instruction."];
  const errors: string[] = [];
  if (!present(value.id)) errors.push("Adjustment identity is missing.");
  if (!present(value.authority, 3))
    errors.push("Record the exact statute, order or agreement relied on.");
  if (!present(value.explanation, 10))
    errors.push("Explain why this effect applies to this claim, party and statutory version.");
  if (!present(value.reviewer))
    errors.push("Record who reviewed the case-specific legal instruction.");
  if (value.legalEffectConfirmed !== true)
    errors.push("Confirm the legal effect, rather than only the dates.");
  if (value.boundariesConfirmed !== true)
    errors.push("Confirm which days count and the exact resumption boundary.");
  if (value.interactionsConfirmed !== true)
    errors.push("Confirm interaction with other tolls, exclusions, outer bars and prior expiry.");
  switch (value.kind) {
    case "pause":
      if (
        value.maximumExclusion !== undefined &&
        (!value.maximumExclusion ||
          !periodValid(value.maximumExclusion.amount, value.maximumExclusion.unit))
      )
        errors.push("The optional suspension maximum needs a supported positive period and unit.");
      if (!real(value.startDate)) errors.push("Enter a real suspension start date.");
      if (value.resumeDate !== "" && !real(value.resumeDate))
        errors.push("Enter a real resume date or leave an ongoing suspension open.");
      if (real(value.startDate) && real(value.resumeDate) && value.resumeDate <= value.startDate)
        errors.push("The resume date must follow the suspension start date.");
      break;
    case "defer_start":
      if (value.resumeDate !== "" && !real(value.resumeDate))
        errors.push("Enter a real resumption date.");
      if (value.presentAtAccrualConfirmed !== true)
        errors.push("Confirm that the qualifying protection existed at the original accrual date.");
      break;
    case "minimum_after_event":
      if (!real(value.protectedFromDate))
        errors.push("Identify when the extension protection first attached, before expiry.");
      if (!real(value.eventDate)) errors.push("Enter the event or legally effective notice date.");
      if (
        real(value.protectedFromDate) &&
        real(value.eventDate) &&
        value.eventDate < value.protectedFromDate
      )
        errors.push("The later event cannot precede the protection start.");
      if (!periodValid(value.amount, value.unit))
        errors.push("Enter a supported positive whole-number period and unit.");
      break;
    case "fixed_deadline":
      if (!real(value.date))
        errors.push("Enter the exact date expressly established by the reviewed authority.");
      break;
    default:
      errors.push("This adjustment effect is not supported.");
  }
  return errors;
}

/** UTC is used only to index real Gregorian civil days, never local time or DST durations. */
function dayIndex(value: string): number {
  const d = parseCivilDate(value)!;
  return Math.floor(Date.UTC(d.year, d.month - 1, d.day) / 86400000);
}
function shiftDays(value: string, days: number): string | null {
  return days === 0 ? value : addCivilPeriod(value, days, "calendar_days");
}

type ArithmeticInput = {
  startDate: string;
  baselineDate: string;
  period: { amount: number; unit: PeriodUnit };
  instructions: readonly ReviewedInstruction[];
  /** Explicitly established independent limits. Instructions never extend them. */
  outerCaps?: readonly { date: string; citation: string }[];
};

/**
 * Conditional arithmetic only: no statutory duration, majority age or toll is inferred.
 * Intervals are [startDate inclusive, resumeDate exclusive]. Overlaps and adjacency
 * form one excluded interval. A pause must begin while the running clock is live.
 * Extension floors run after the suspension calculation, not as fictional stay days.
 */
export function applyReviewedInstructions(input: ArithmeticInput): ReviewedArithmeticResult {
  const result: ReviewedArithmeticResult = {
    status: "calculated",
    date: null,
    originalStartDate: input.startDate,
    effectiveStartDate: input.startDate,
    excludedDays: 0,
    capped: false,
    reasons: [],
    steps: [],
  };
  const stop = (status: ReviewedArithmeticResult["status"], ...reasons: string[]) => ({
    ...result,
    status,
    date: null,
    reasons,
  });
  if (
    !real(input.startDate) ||
    !real(input.baselineDate) ||
    input.baselineDate < input.startDate ||
    !periodValid(input.period?.amount, input.period?.unit)
  ) {
    return stop("invalid", "The original clock needs valid civil dates and a supported period.");
  }
  if (!Array.isArray(input.instructions) || input.instructions.length > 100)
    return stop("invalid", "At most 100 explicit adjustments are supported.");
  const errors = input.instructions.flatMap(validateInstruction);
  if (errors.length) return stop("invalid", ...errors);
  if (new Set(input.instructions.map((x) => x.id)).size !== input.instructions.length)
    errors.push("Duplicate adjustment identity.");
  if (errors.length) return stop("invalid", ...errors);
  if ((input.outerCaps ?? []).some((x) => !real(x.date) || !present(x.citation)))
    return stop("invalid", "An independent cap is missing its real date or authority.");
  const fixed = input.instructions.filter(
    (i): i is Extract<ReviewedInstruction, { kind: "fixed_deadline" }> =>
      i.kind === "fixed_deadline",
  );
  if (fixed.length && input.instructions.length !== 1)
    return stop(
      "needs_review",
      "A fixed-date order or agreement cannot be stacked with other adjustments without an explicit interaction rule.",
    );
  if (input.instructions.some((i) => i.kind === "defer_start" && i.resumeDate === "")) {
    return stop(
      "open_ended",
      "A suspension or delayed-start protection is still open. No end date or final deadline was invented.",
    );
  }
  let date = input.baselineDate;
  const deferred = input.instructions.filter(
    (i): i is Extract<ReviewedInstruction, { kind: "defer_start" }> => i.kind === "defer_start",
  );
  if (deferred.some((i) => i.resumeDate < input.startDate))
    return stop("invalid", "Resumption cannot precede the original start of this protected clock.");
  if (deferred.length) {
    result.effectiveStartDate = deferred
      .map((i) => i.resumeDate)
      .sort()
      .at(-1)!;
    const next = addCivilPeriod(result.effectiveStartDate, input.period.amount, input.period.unit);
    if (!next)
      return stop(
        "needs_review",
        "The supplied resumption creates a missing leap-day or month-end anniversary. A jurisdiction-specific counting rule is required.",
      );
    date = next;
    result.steps.push({
      instructionIds: deferred.map((i) => i.id),
      date,
      text: `On the reviewed instruction, the period runs from ${result.effectiveStartDate}; original legal accrual remains ${input.startDate}. Multiple protections were not added end to end.`,
    });
  }
  const pauses: { start: string; end: string; ids: string[] }[] = [];
  for (const instruction of input.instructions) {
    if (instruction.kind !== "pause") continue;
    let end = instruction.resumeDate;
    // Cap each protection BEFORE unioning overlaps, anchored to its reviewed start.
    // An ongoing interval does not prove that its entire maximum was actually used.
    if (end && instruction.maximumExclusion) {
      const maximum = addCivilPeriod(
        instruction.startDate,
        instruction.maximumExclusion.amount,
        instruction.maximumExclusion.unit,
      );
      if (!maximum)
        return stop(
          "needs_review",
          "The suspension maximum has a missing anniversary or unsupported date range. No replacement date was assumed.",
        );
      if (end > maximum) {
        end = maximum;
        result.steps.push({
          instructionIds: [instruction.id],
          date: maximum,
          text:
            "Apply the reviewer's explicit maximum to this suspension at " +
            maximum +
            "; any later days under this instruction are not excluded.",
        });
      }
    }
    if (end && end <= result.effectiveStartDate) continue;
    pauses.push({
      start:
        instruction.startDate < result.effectiveStartDate
          ? result.effectiveStartDate
          : instruction.startDate,
      end,
      ids: [instruction.id],
    });
  }
  pauses.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  const intervals: typeof pauses = [];
  for (const interval of pauses) {
    const last = intervals.at(-1);
    if (last && (last.end === "" || interval.start <= last.end)) {
      if (interval.end === "" || (last.end !== "" && interval.end > last.end))
        last.end = interval.end;
      last.ids.push(...interval.ids);
    } else intervals.push({ ...interval, ids: [...interval.ids] });
  }
  for (const interval of intervals) {
    if (interval.start > date)
      return stop(
        "needs_review",
        `Suspension ${interval.ids.join(", ")} begins on ${interval.start}, after the then-running date ${date}. No revival was assumed.`,
      );
    if (interval.end === "")
      return stop(
        "open_ended",
        "A reviewed suspension is still ongoing. Earlier closed periods were counted, but no resumption date or final deadline was invented.",
      );
    const days = dayIndex(interval.end) - dayIndex(interval.start);
    const next = shiftDays(date, days);
    if (!next || result.excludedDays + days > 36500)
      return stop(
        "needs_review",
        "The reviewed suspension exceeds the supported civil-date range.",
      );
    date = next;
    result.excludedDays += days;
    result.steps.push({
      instructionIds: interval.ids,
      days,
      date,
      text: `Exclude ${days} civil days from ${interval.start} inclusive until ${interval.end} exclusive. Overlapping periods count once.`,
    });
  }
  const floors = input.instructions
    .filter(
      (i): i is Extract<ReviewedInstruction, { kind: "minimum_after_event" }> =>
        i.kind === "minimum_after_event",
    )
    .sort((a, b) => a.protectedFromDate.localeCompare(b.protectedFromDate));
  for (const instruction of floors) {
    if (instruction.protectedFromDate > date)
      return stop(
        "needs_review",
        `Protection for ${instruction.id} attached after the then-running date ${date}. An expired claim was not revived.`,
      );
    const candidate = addCivilPeriod(instruction.eventDate, instruction.amount, instruction.unit);
    if (!candidate)
      return stop(
        "needs_review",
        "The extension floor has a missing anniversary or unsupported date range.",
      );
    if (candidate > date) date = candidate;
    result.steps.push({
      instructionIds: [instruction.id],
      date,
      text: `Preserve the later of the existing date and ${candidate}, based on the reviewed event ${instruction.eventDate}; do not add the duration of a stay.`,
    });
  }
  if (fixed.length) {
    if (fixed[0]!.date < input.startDate)
      return stop(
        "needs_review",
        "The expressly supplied date precedes this claim's original accrual. Review its scope instead of applying it automatically.",
      );
    date = fixed[0]!.date;
    result.steps.push({
      instructionIds: [fixed[0]!.id],
      date,
      text: "Use the expressly supplied date. Its legal scope is the reviewer's assumption, not a verified statutory interpretation.",
    });
  }
  for (const cap of [...(input.outerCaps ?? [])].sort((a, b) => a.date.localeCompare(b.date))) {
    if (date > cap.date) {
      date = cap.date;
      result.capped = true;
      result.steps.push({
        instructionIds: [],
        date,
        text: `The separate outer bar (${cap.citation}) remains ${cap.date}; tolling instructions did not extend it.`,
      });
    }
  }
  return { ...result, date };
}
