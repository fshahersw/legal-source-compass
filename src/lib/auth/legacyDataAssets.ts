const DATA_NAMESPACE = /^\/data(?:\/|$)/i;
const OBSOLETE_ASSET = /\.(?:jsonl?|csv|txt|xlsx)\/*$/i;

/** Retired assets must not fall through to the app shell; dataset-browser routes remain valid. */
export function isObsoleteDataAsset(url: string): boolean {
  let path = new URL(url).pathname.replace(/\\/g, "/");
  let dataNamespace = DATA_NAMESPACE.test(path);
  // Decode the leading segment separately so malformed later escapes fail closed in /data.
  let leading = path.split("/")[1] ?? "";
  for (let attempt = 0; attempt < 4; attempt++) {
    if (leading.toLowerCase() === "data") dataNamespace = true;
    try {
      leading = decodeURIComponent(leading);
    } catch {
      break;
    }
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    dataNamespace ||= DATA_NAMESPACE.test(path);
    let decoded: string;
    try {
      decoded = decodeURIComponent(path).replace(/\\/g, "/");
    } catch {
      return dataNamespace;
    }
    if (decoded === path) return dataNamespace && OBSOLETE_ASSET.test(path);
    path = decoded;
  }
  return dataNamespace && (OBSOLETE_ASSET.test(path) || path.includes("%"));
}
