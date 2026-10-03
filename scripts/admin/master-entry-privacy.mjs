/** Source-null seal flags are unknown. Only explicit false permits a public document ID. */
export function reviewEntryPrivacy(entry, docket) {
  const documents = entry.recap_documents ?? [];
  if (!Array.isArray(documents)) throw new Error('Invalid native document association array');
  const sourceBlocked = !docket || docket.blocked !== false || docket.date_blocked != null;
  const explicitlySealed = documents.some(document => document.is_sealed === true);
  const unknownDocumentSeal = documents.some(document => typeof document.is_sealed !== 'boolean');
  const explicitUnsealedIds = [...new Set(documents.filter(document => document.is_sealed === false).map(document => {
    const id = String(document.id);
    if (!/^[0-9]+$/.test(id)) throw new Error('Invalid native document ID');
    return id;
  }))].sort();
  return { sourceBlocked, explicitlySealed, unknownDocumentSeal,
    eligible: !sourceBlocked && !explicitlySealed, explicitUnsealedIds };
}
