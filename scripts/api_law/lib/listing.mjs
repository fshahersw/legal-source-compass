/**
 * corpus_writer.listing(columns, filters) in JavaScript, with optional option counts (the catalog's counted filters):
 * columns are [key, label] pairs; filters are [name, label, {value: label}] triples; counts {name: {value: n}}.
 * Options keep the given order; with counts, an option without rows is dropped.
 */
export function listing(columns, filters = [], counts = {}) {
  return {
    page: 1,
    limit: 50,
    columns: columns.map(([key, label]) => ({ key, label })),
    filters: [
      { name: "q", type: "search", label: "Search" },
      ...filters.map(([name, label, options]) => ({
        name,
        type: "select",
        label,
        options: Object.entries(options)
          .filter(([v]) => !counts[name] || (counts[name][v] ?? 0) > 0)
          .map(([value, l]) => (counts[name] ? { label: l, value, count: counts[name][value] ?? 0 } : { label: l, value })),
      })),
    ],
  };
}

/** Count filter values over rows: {name: {value: rows}} for the named filters. */
export function countFilters(rows, names) {
  const out = Object.fromEntries(names.map((n) => [n, {}]));
  for (const r of rows)
    for (const n of names)
      for (const v of new Set(Array.isArray(r.filters?.[n]) ? r.filters[n] : [])) out[n][v] = (out[n][v] ?? 0) + 1;
  return out;
}

/** {value: label} for the values present, sorted descending (years) or by count. */
export function presentOptions(counts, { order = "desc", label = (v) => v } = {}) {
  const keys = Object.keys(counts);
  keys.sort(order === "desc" ? (a, b) => (a < b ? 1 : a > b ? -1 : 0) : (a, b) => counts[b] - counts[a] || (a < b ? -1 : 1));
  return Object.fromEntries(keys.map((k) => [k, label(k)]));
}
