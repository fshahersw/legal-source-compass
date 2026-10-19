/** A link the assistant may render: an in-app path, or an http(s) URL. Anything else is shown as plain text. */
export function safeHref(raw: string): { url: string; internal: boolean } | null {
  const href = raw.trim();
  if (/^\/(?!\/)[^\s<>"'\\]*$/.test(href)) return { url: href, internal: true };
  try {
    const u = new URL(href);
    return u.protocol === "https:" || u.protocol === "http:"
      ? { url: u.toString(), internal: false }
      : null;
  } catch {
    return null;
  }
}
