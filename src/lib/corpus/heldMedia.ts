/**
 * Stored media whose label says reuse permission is not established is held, not released: its
 * artifacts are not ready and are never served. Such media is neither drawn nor linked; pages say
 * that it is held instead.
 */
export const isHeldMediaLabel = (label: string) => /permission not established/i.test(label);

/** A stored file path ("/supplement-files/...") as opposed to an external page. */
export const isStoredFilePath = (url: string) => /^\/(?!\/)/.test(url);
