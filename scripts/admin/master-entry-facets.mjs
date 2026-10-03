/** Facets describe eligible entry rows, never all filings or total documents. */
export function buildMasterEntryFacets(entries) {
  const nativeEntries = new Set(), byDocket = new Map(), byDocuments = new Map();
  let unsealedDocumentAssociations = 0;
  for (const entry of entries) {
    if (!/^[0-9]+$/.test(entry.nativeEntryId) || !/^[0-9]+$/.test(entry.nativeDocketId)) {
      throw new Error('Invalid native facet identity');
    }
    if (nativeEntries.has(entry.nativeEntryId)) throw new Error('Duplicate native entry facet');
    if (!Number.isSafeInteger(entry.sourceUnsealedDocumentCount) || entry.sourceUnsealedDocumentCount < 0) {
      throw new Error('Invalid explicitly unsealed document association count');
    }
    nativeEntries.add(entry.nativeEntryId);
    byDocket.set(entry.nativeDocketId, (byDocket.get(entry.nativeDocketId) ?? 0) + 1);
    const count = entry.sourceUnsealedDocumentCount;
    byDocuments.set(count, (byDocuments.get(count) ?? 0) + 1);
    unsealedDocumentAssociations += count;
  }
  const docketOptions = [...byDocket].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([value, count]) => ({ value, label: `Native docket ${value}`, count }));
  const documentOptions = [...byDocuments].sort(([a], [b]) => a - b)
    .map(([count, entries]) => ({ value: String(count),
      label: `${count} explicitly unsealed document${count === 1 ? '' : 's'} (source)`, count: entries }));
  const total = options => options.reduce((sum, option) => sum + option.count, 0);
  if (total(docketOptions) !== nativeEntries.size || total(documentOptions) !== nativeEntries.size) {
    throw new Error('Facet totals do not reconcile');
  }
  return {
    eligibleEntries: nativeEntries.size, unsealedDocumentAssociations,
    filters: [
      { name: 'native_docket_id', type: 'select', label: 'Native source docket',
        placeholder: 'All native source dockets', options: docketOptions },
      { name: 'source_unsealed_document_count', type: 'select',
        label: 'Explicitly unsealed documents (source)',
        placeholder: 'All source unsealed-document counts', options: documentOptions },
    ],
  };
}
