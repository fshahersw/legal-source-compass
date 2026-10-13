import type { RegulatoryEventType, RegulatoryRecordData } from "./types";

/** Byte-stable comparisons of JSON values, independent of object key insertion order. */
export function canonicalRegulatoryJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (Array.isArray(value)) return `[${value.map(canonicalRegulatoryJson).join(",")}]`;
  if (typeof value === "object" && value !== null)
    return `{${Object.keys(value)
      .sort((a, b) => {
        const left = [...a],
          right = [...b];
        for (let i = 0; i < Math.min(left.length, right.length); i++) {
          const difference = left[i]!.codePointAt(0)! - right[i]!.codePointAt(0)!;
          if (difference) return difference;
        }
        return left.length - right.length;
      })
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalRegulatoryJson((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  throw new Error("Regulatory evidence must contain JSON values and safe integers only.");
}

/** Same field-level comparison as the SQL finalizer; no language-model severity or legal inference. */
export function regulatoryChange(
  previous: RegulatoryRecordData | null,
  current: RegulatoryRecordData,
  mode: "initial" | "incremental" | "backfill",
): { eventType: RegulatoryEventType; changedFields: string[]; reason: string } | null {
  if (previous && previous.native_id !== current.native_id)
    throw new Error("Cannot compare different source-native records.");
  const changedFields = previous
    ? Object.keys(current)
        .filter(
          (key) =>
            canonicalRegulatoryJson(current[key as keyof RegulatoryRecordData]) !==
            canonicalRegulatoryJson(previous[key as keyof RegulatoryRecordData]),
        )
        .sort()
    : [];
  if (previous && !changedFields.length) return null;
  const eventType: RegulatoryEventType = current.correction_of.length
    ? "correction"
    : previous
      ? "record_changed"
      : mode === "initial"
        ? "initial_record"
        : mode === "backfill"
          ? "backfill"
          : "new_record";
  const reason =
    eventType === "correction"
      ? "The source records an explicit correction relationship."
      : previous
        ? `Source fields changed: ${changedFields.join(", ")}.`
        : eventType === "initial_record"
          ? "Record observed during initial collection; this is not a new incident."
          : eventType === "backfill"
            ? "Record observed during historical backfill; this is not a new incident."
            : "Record newly observed by this monitor; publication and incident dates may be earlier.";
  return { eventType, changedFields, reason };
}

/** Source-native identities are deliberately namespace-sensitive and never joined by label. */
export function sameRegulatoryEntity(
  a: { namespace: string; native_id: string },
  b: { namespace: string; native_id: string },
): boolean {
  return a.namespace === b.namespace && a.native_id === b.native_id;
}
