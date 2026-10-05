// Pure helpers for partial, append/update-only registry projections.
// The source rows are never removed: metadata is reconciled from the complete
// read-back so a selected MDL subset cannot shrink global counts or facets.

export function mergeProjectionRows(remoteRows, projectedRecords) {
  const rows = new Map(remoteRows.map(row => [row.id, {
    id: row.id,
    ordinal: Number(row.ordinal),
    h: row.h ?? row.projection_row_sha256 ?? row.detail?.provenance?.projection_row_sha256 ?? null,
    filters: row.filters ?? {},
  }]));
  for (const record of projectedRecords) rows.set(record.id, {
    id: record.id,
    ordinal: Number(record.ordinal),
    h: record.detail?.provenance?.projection_row_sha256 ?? null,
    filters: record.filters ?? {},
  });
  return rows;
}

function countFilter(rows, name) {
  const counts = new Map();
  for (const row of rows.values()) {
    const raw = row.filters?.[name];
    const values = Array.isArray(raw) ? raw : raw == null || raw === '' ? [] : [raw];
    for (const item of new Set(values.map(value => String(value)))) counts.set(item, (counts.get(item) ?? 0) + 1);
  }
  return counts;
}

function reconciledListing(existing, projected, rows) {
  const oldListing = existing?.listing ?? {};
  const newListing = projected?.listing ?? {};
  const definitions = new Map();
  for (const filter of [...(oldListing.filters ?? []), ...(newListing.filters ?? [])]) definitions.set(filter.name, filter);
  const oldDefinitions = new Map((oldListing.filters ?? []).map(filter => [filter.name, filter]));
  const newDefinitions = new Map((newListing.filters ?? []).map(filter => [filter.name, filter]));
  const filters = [...definitions.values()].map(definition => {
    const labels = new Map();
    for (const option of [...(oldDefinitions.get(definition.name)?.options ?? []), ...(newDefinitions.get(definition.name)?.options ?? [])]) {
      labels.set(String(option.value), option.label);
    }
    const counts = countFilter(rows, definition.name);
    return {
      ...definition,
      options: [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([value, count]) => ({ value, label: labels.get(value) ?? value, count })),
    };
  });
  return { ...oldListing, ...newListing, filters };
}

export function mergeProjectionMetadata(existing, projected, rows, projectionValidation) {
  const sourceRuns = [...new Set([...(existing?.source_runs ?? []), ...(projected?.source_runs ?? [])])];
  return {
    ...(existing ?? {}),
    ...(projected ?? {}),
    source_runs: sourceRuns,
    listing: reconciledListing(existing, projected, rows),
    projection_validation: projectionValidation,
  };
}

export function beforeImagePayload({ dataset, run, rows, capturedAt }) {
  return {
    schema_version: 'members-projection-before-images/1',
    dataset,
    run,
    captured_at: capturedAt,
    changed_existing_rows: rows.map(row => ({ ...row })).sort((a, b) => a.id.localeCompare(b.id)),
  };
}
