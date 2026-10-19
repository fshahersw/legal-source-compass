/** Only public http(s) URLs: literal private, loopback, link-local and metadata hosts and embedded credentials are refused. */
export function publicUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password) return null;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    !h ||
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".internal") ||
    h.endsWith(".local") ||
    /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(
      h,
    ) ||
    h === "::1" ||
    h === "::" ||
    /^f[cd][0-9a-f]{2}:/.test(h) ||
    /^fe80:/.test(h) ||
    /^::ffff:/.test(h)
  )
    return null;
  return u;
}
