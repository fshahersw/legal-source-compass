/** Reproducible quality measures. These describe the supplied rows, never a national census. */
export type DirectoryQualityRow = {
  id: string;
  url: string;
  domain: string;
  jurisdictions: readonly string[];
  headings: readonly string[];
  occurrences: number;
};

const duplicateGroups = (values: readonly string[]) => {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].filter(([, n]) => n > 1).map(([value, rows]) => ({ value, rows }));
};

export function directoryJurisdictionCounts(rows: readonly { jurisdictions: readonly string[] }[]) {
  const counts = new Map<string, number>();
  for (const row of rows)
    for (const j of new Set(row.jurisdictions.map((v) => v.trim()).filter(Boolean))) {
      counts.set(j, (counts.get(j) ?? 0) + 1);
    }
  return counts;
}

export function directoryQuality(rows: readonly DirectoryQualityRow[]) {
  const issues: {
    id: string;
    issue: "invalid_url" | "non_http_url" | "domain_mismatch";
  }[] = [];
  const headings = new Map<string, number>();
  for (const row of rows) {
    try {
      const url = new URL(row.url);
      if (!/^https?:$/.test(url.protocol)) issues.push({ id: row.id, issue: "non_http_url" });
      const host = url.hostname.toLowerCase().replace(/^www\./, "");
      const imported = row.domain.toLowerCase().replace(/^www\./, "");
      if (imported && host !== imported) issues.push({ id: row.id, issue: "domain_mismatch" });
    } catch {
      issues.push({ id: row.id, issue: "invalid_url" });
    }
    for (const h of new Set(row.headings.filter(Boolean)))
      headings.set(h, (headings.get(h) ?? 0) + 1);
  }
  return {
    rows: rows.length,
    uniqueUrls: new Set(rows.map((r) => r.url)).size,
    occurrences: rows.reduce((n, r) => n + r.occurrences, 0),
    duplicateIds: duplicateGroups(rows.map((r) => r.id)),
    duplicateUrls: duplicateGroups(rows.map((r) => r.url)),
    withoutJurisdiction: rows.filter((r) => !r.jurisdictions.some((j) => j.trim())).length,
    multipleJurisdictions: rows.filter((r) => new Set(r.jurisdictions.filter(Boolean)).size > 1)
      .length,
    withoutHeading: rows.filter((r) => !r.headings.some((h) => h.trim())).length,
    jurisdictions: [...directoryJurisdictionCounts(rows)]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    headings: [...headings]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    issues,
  };
}

export type RegistryQualityRow = {
  id: string;
  parent_id: string;
  url: string;
  jurisdiction: string;
  record_category: string;
  verified_date: string;
  http_status: string;
};

export function registryQuality(rows: readonly RegistryQualityRow[]) {
  const ids = new Set(rows.map((r) => r.id));
  const dates = rows
    .map((r) => r.verified_date)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  const statuses = new Map<string, number>();
  for (const row of rows)
    statuses.set(
      row.http_status || "Not recorded",
      (statuses.get(row.http_status || "Not recorded") ?? 0) + 1,
    );
  return {
    rows: rows.length,
    uniqueUrls: new Set(rows.map((r) => r.url)).size,
    duplicateIds: duplicateGroups(rows.map((r) => r.id)),
    orphanParentIds: [
      ...new Set(rows.filter((r) => r.parent_id && !ids.has(r.parent_id)).map((r) => r.parent_id)),
    ].sort(),
    withoutCategory: rows.filter((r) => !r.record_category).length,
    withoutJurisdiction: rows.filter((r) => !r.jurisdiction).length,
    withoutCheckDate: rows.filter((r) => !/^\d{4}-\d{2}-\d{2}$/.test(r.verified_date)).length,
    earliestCheckDate: dates[0] ?? null,
    latestCheckDate: dates.at(-1) ?? null,
    recordedNon2xx: rows.filter((r) => r.http_status && !/^2\d\d$/.test(r.http_status)).length,
    statuses: [...statuses]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
  };
}

/** Unknown/loading is kept distinct from a verified count of zero. */
export function knownCount(status: string, value: number): number | null {
  return status === "ready" ? value : null;
}
