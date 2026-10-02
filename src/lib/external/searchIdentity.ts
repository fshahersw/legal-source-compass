/** Native row identity is (dataset,id). Equal titles or reused ids are not identity evidence. */
export type SearchRecord = {
  id: string;
  dataset: string;
  title: string | null;
  state: string | null;
  source_url: string | null;
  category: string | null;
  item: Record<string, unknown>;
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

/** Attach identity only on exact equality to the stored listing item; preserve the RPC's result order. */
export function resolveSearchIdentities(
  items: readonly Record<string, unknown>[],
  records: readonly SearchRecord[],
) {
  const candidates = new Map<string, SearchRecord[]>();
  for (const record of records) {
    const key = canonical(record.item);
    const queue = candidates.get(key) ?? [];
    queue.push(record);
    candidates.set(key, queue);
  }
  const matches: { item: Record<string, unknown>; record: SearchRecord }[] = [];
  const requested = new Map<string, number>();
  for (const item of items) {
    const key = canonical(item);
    requested.set(key, (requested.get(key) ?? 0) + 1);
  }
  // A partial page of identical items cannot identify which dataset supplied its row.
  // A complete identical-item group can expose the full set of native identities.
  const resolvedKeys = new Set(
    [...requested]
      .filter(([key, count]) => candidates.get(key)?.length === count)
      .map(([key]) => key),
  );
  let unresolved = 0;
  for (const item of items) {
    const key = canonical(item);
    const record = resolvedKeys.has(key) ? candidates.get(key)?.shift() : undefined;
    if (record) matches.push({ item, record });
    else unresolved++;
  }
  return { matches, unresolved };
}

/** Quote each PostgREST IN literal before encoding it; ids may contain commas, quotes or parentheses. */
export function inFilter(values: readonly string[]): string {
  return encodeURIComponent(
    `(${values.map((v) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")})`,
  );
}

/** Candidate retrieval aliases explicitly present in native items. Equality still decides the match. */
export function candidateRecordIds(items: readonly Record<string, unknown>[]): string[] {
  const ids = new Set<string>();
  for (const item of items) {
    const id = item["id"];
    if (typeof id === "string" || typeof id === "number") {
      ids.add(String(id));
      if (/^mdl:\d+$/.test(String(id))) ids.add(String(id).slice(4));
    }
    for (const key of ["geoid", "fips"])
      if (typeof item[key] === "string" && /^\d{5}$/.test(item[key] as string))
        ids.add(item[key] as string);
  }
  return [...ids];
}
