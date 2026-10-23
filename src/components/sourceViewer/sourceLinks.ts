/** Opening outside sources in the in-page panel: the click rule, the panel request event and the first view for a source. */

export const SOURCE_EVENT = "source-viewer:open";
export type SourceRequest = { url: string; title?: string | undefined };

/** Opens an outside address in the source panel. */
export function openSource(url: string, title?: string) {
  window.dispatchEvent(new CustomEvent<SourceRequest>(SOURCE_EVENT, { detail: { url, title } }));
}

type AnchorLike = {
  href: string;
  hasAttribute(name: string): boolean;
  getAttribute(name: string): string | null;
};
type ClickLike = {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
};

/**
 * The outside address a plain click on this link should open in the panel, or null to leave the click to the browser
 * (modified or middle clicks, downloads, opted-out links, same-site links and anything that is not http(s)).
 */
export function interceptTarget(
  anchor: AnchorLike,
  click: ClickLike,
  origin: string,
): string | null {
  if (click.defaultPrevented || click.button !== 0) return null;
  if (click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return null;
  if (anchor.hasAttribute("download") || anchor.getAttribute("data-source-viewer") === "off")
    return null;
  let url: URL;
  try {
    url = new URL(anchor.href, origin);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.origin === origin || url.username || url.password) return null;
  return url.toString();
}

export type SourceKind = "page" | "pdf" | "image" | "text" | "file";
export type ViewMode = "embed" | "document" | "browser" | "reader" | "file" | "blocked";
export type CheckResult = {
  url: string;
  finalUrl: string;
  embeddable: boolean;
  reason: string | null;
  contentType: string | null;
  kind: SourceKind;
  fileName: string | null;
  size: number | null;
  remoteBrowser: boolean;
  reader: boolean;
};

/** How long a loading state runs before it says more and offers the way out. */
export const SLOW_WAIT_MS = 3500;

/** An address that is plainly a PDF by its path: the document view can start before the check has answered. */
export function looksLikeDocument(url: string): boolean {
  try {
    return /\.pdf$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/**
 * The views to start for a checked source: documents through our relay, framable pages directly. A page that refuses framing
 * has no single quickest view (its text answers in under a second on some sites and takes ten on others, a live browser in
 * two to five), so both are started together and the first one ready is shown; the other is a click away, already loading.
 * With only one of them available, that one. Two entries therefore mean a race.
 */
export function startViews(
  check: Pick<CheckResult, "kind" | "embeddable" | "remoteBrowser" | "reader">,
): ViewMode[] {
  if (check.kind === "pdf" || check.kind === "image" || check.kind === "text") return ["document"];
  if (check.kind === "file") return ["file"];
  if (check.embeddable) return ["embed"];
  return quickViews(check);
}

function quickViews(check: Pick<CheckResult, "remoteBrowser" | "reader">): ViewMode[] {
  const views: ViewMode[] = [];
  if (check.reader) views.push("reader");
  if (check.remoteBrowser) views.push("browser");
  return views.length ? views : ["blocked"];
}

/**
 * The views to start when the check itself failed. An address that could not be reached from here may still open from the
 * text service or a live browser (they reach it from elsewhere); a document already loading from its address keeps going; an
 * address that is not public, or a sign-in problem, shows nothing.
 */
export function failureViews(
  failure: { code: string; remoteBrowser: boolean; reader: boolean },
  documentStarted: boolean,
): ViewMode[] {
  if (failure.code !== "unreachable") return ["blocked"];
  if (documentStarted) return ["document"];
  return quickViews(failure);
}

/** The views a source can be switched between, in the order the switcher shows them. */
export function availableViews(
  check: Pick<CheckResult, "kind" | "embeddable" | "remoteBrowser" | "reader">,
): ViewMode[] {
  const views: ViewMode[] = [];
  if (check.kind === "pdf" || check.kind === "image" || check.kind === "text")
    views.push("document");
  else if (check.kind === "file") views.push("file");
  else if (check.embeddable) views.push("embed");
  if (check.reader && check.kind !== "image") views.push("reader");
  if (check.remoteBrowser && check.kind !== "file") views.push("browser");
  return views;
}

export const VIEW_LABEL: Record<ViewMode, string> = {
  embed: "Page",
  document: "Document",
  browser: "Interactive",
  reader: "Text",
  file: "File",
  blocked: "Page",
};

export function relayUrl(url: string, inline: boolean): string {
  return `/api/source-file?url=${encodeURIComponent(url)}${inline ? "&inline=1" : ""}`;
}

export function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function sizeLabel(bytes: number | null): string | null {
  if (!bytes || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
