/**
 * Shared validation for the image datasets built from the owner's visual registry (court_buildings,
 * judge_portraits_open, agency_images, committee_marks, company_logos_open, state_capitol_images). Pure functions,
 * no I/O. Owner decision 2026-10-24 ("forget the license check"): every registry image may be shown whatever its
 * rights status; the recorded author, licence and source page are still shown with it. Shape checks still reject:
 * a field that is missing, out of shape, served from a host outside the fixed allowlist or carrying markup makes the
 * caller drop the whole record; nothing is repaired.
 *
 * Images are served from their origin (Wikimedia, the Library of Congress, the Federal Judicial Center, the Federal
 * Register, a committee's own site, ...); nothing is copied.
 */

export type Rendition = { url: string; width: number; height: number };
export type LicenceFamily = "public domain" | "cc0" | "cc by" | "cc by-sa" | "other";
/** Where the image's own page lives: a Commons file page, a Library of Congress item page, or another site. */
export type ImageOrigin = "commons" | "loc" | "other";

/** The licence and credit of one image, as recorded. */
export type ImageCredit = {
  /** The image's own page (Commons file page, Library item, or the page the image was taken from). */
  filePage: string;
  origin: ImageOrigin;
  /** Null when the record names no licence: the credit then reads "Source: <site>" only. */
  license: string | null;
  licenseFamily: LicenceFamily | null;
  /** The licence deed or statement page, when one is recorded. */
  licenseUrl: string | null;
  licenseUrlIsDeed: boolean;
  author: string | null;
  /** A credit line as the origin records it (e.g. the Library of Congress credit line), when one is given. */
  credit: string | null;
  /** The registry's rights status as recorded; not displayed. */
  rightsStatus: string | null;
  verifiedAt: string | null;
};

export type OpenImage = ImageCredit & { display: Rendition; thumb: Rendition };

export const LICENCE_FAMILIES: readonly LicenceFamily[] = [
  "public domain",
  "cc0",
  "cc by",
  "cc by-sa",
  "other",
];

/**
 * Image hosts: exactly the hosts of every image_url and thumbnail_url in the owner's visual registry
 * (11cf86c0-image-registry.json, 2026-10-24; all https), computed once and fixed here.
 */
export const IMAGE_HOSTS: ReadonlySet<string> = new Set([
  "agency-logos.federalregister.gov",
  "agriculture.house.gov",
  "appropriations.house.gov",
  "armedservices.house.gov",
  "budget.house.gov",
  "cha.house.gov",
  "d1dth6e84htgma.cloudfront.net",
  "dailymontanan.com",
  "edworkforce.house.gov",
  "ethics.house.gov",
  "financialservices.house.gov",
  "foreignaffairs.house.gov",
  "homeland.house.gov",
  "intelligence.house.gov",
  "judiciary.house.gov",
  "lawlibrary.nmcourts.gov",
  "marylandmatters.org",
  "msa.maryland.gov",
  "naturalresources.house.gov",
  "npr-brightspot.s3.amazonaws.com",
  "oversight.house.gov",
  "rules.house.gov",
  "storage.googleapis.com",
  "thumb.wikimedia.org",
  "tile.loc.gov",
  "upload.wikimedia.org",
  "veterans.house.gov",
  "waysandmeans.house.gov",
  "www.agriculture.senate.gov",
  "www.armed-services.senate.gov",
  "www.banking.senate.gov",
  "www.budget.senate.gov",
  "www.drugcaucus.senate.gov",
  "www.energy.senate.gov",
  "www.finance.senate.gov",
  "www.fjc.gov",
  "www.foreign.senate.gov",
  "www.gsa.gov",
  "www.hsgac.senate.gov",
  "www.indian.senate.gov",
  "www.intelligence.senate.gov",
  "www.jec.senate.gov",
  "www.pacificjudicialcouncil.org",
  "www.rules.senate.gov",
]);
const COMMONS_IMAGE_HOSTS: ReadonlySet<string> = new Set([
  "upload.wikimedia.org",
  "thumb.wikimedia.org",
]);
const LOC_IMAGE_HOSTS: ReadonlySet<string> = new Set(["tile.loc.gov"]);
/** A link flagged as a licence deed must be on one of these hosts. */
const DEED_HOSTS: ReadonlySet<string> = new Set(["creativecommons.org", "commons.wikimedia.org"]);
const LOC_PAGE_HOSTS: ReadonlySet<string> = new Set(["www.loc.gov", "loc.gov"]);

const MAX_PX = 20000;
const MARKUP = /<\s*\/?\s*[a-z!]/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ][0-9:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;

export const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** A trimmed plain-text string within `max` characters; markup is rejected, never stripped. */
export function text(v: unknown, max = 600): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s && s.length <= max && !MARKUP.test(s) ? s : null;
}

/** Text that may be absent: undefined/null/"" read as null; anything else must be valid text or the record fails. */
export function optionalText(v: unknown, max = 600): { ok: boolean; value: string | null } {
  if (v === undefined || v === null || (typeof v === "string" && v.trim() === ""))
    return { ok: true, value: null };
  const s = text(v, max);
  return s ? { ok: true, value: s } : { ok: false, value: null };
}

/** Integer pixel size: whole, positive, not absurd. 640.0 from JSON is an integer; 640.5 is not. */
export const px = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v > 0 && v <= MAX_PX ? v : null;

function parseUrl(v: unknown): URL | null {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s || s.length > 2000) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" && !u.username && !u.password && !u.port ? u : null;
  } catch {
    return null;
  }
}

/** An https URL whose host is exactly one of `hosts`. */
export function httpsUrl(v: unknown, hosts: ReadonlySet<string>): string | null {
  const u = parseUrl(v);
  return u && hosts.has(u.hostname) ? u.href : null;
}

/** Any https URL without credentials or a port (a link the reader opens, never an embedded resource). */
export function httpsLink(v: unknown): string | null {
  return parseUrl(v)?.href ?? null;
}

/** An https URL on a host that is `suffix` itself or a subdomain of it (e.g. judiciary.house.gov for house.gov). */
export function httpsUrlUnder(v: unknown, suffixes: readonly string[]): string | null {
  const u = parseUrl(v);
  if (!u) return null;
  const host = u.hostname;
  return suffixes.some((s) => host === s || host.endsWith(`.${s}`)) ? u.href : null;
}

export function parseRendition(
  v: unknown,
  hosts: ReadonlySet<string> = IMAGE_HOSTS,
): Rendition | null {
  const o = obj(v);
  const url = httpsUrl(o?.["url"], hosts);
  const width = px(o?.["width"]);
  const height = px(o?.["height"]);
  return url && width && height ? { url, width, height } : null;
}

/** The image's own page: a Commons `File:` page, a Library of Congress item page, or another https page. */
export function parseFilePage(v: unknown): { url: string; origin: ImageOrigin } | null {
  const url = httpsLink(v);
  if (!url) return null;
  const u = new URL(url);
  if (u.hostname === "commons.wikimedia.org" && u.pathname.startsWith("/wiki/File:"))
    return { url, origin: "commons" };
  if (
    LOC_PAGE_HOSTS.has(u.hostname) &&
    /^\/(?:pictures\/)?item\/[A-Za-z0-9._-]+\/?$/.test(u.pathname)
  )
    return { url, origin: "loc" };
  return { url, origin: "other" };
}

/** A timestamp or date written ISO style (2026-10-24 or 2026-10-24T05:00:00Z). */
export function isoDate(v: unknown): string | null {
  const s = text(v, 40);
  return s && ISO_DATE.test(s) ? s : null;
}

/**
 * Registry status wording that sits in a licence field without naming a licence ("Not assessed; ...", "Pending
 * file-specific policy and visual review", "Not specified by logo registry", "... rights/credit not stated on
 * profile"). It is a review status, not a licence, so the credit reads "Source: <site>" for it.
 */
const LICENCE_STATUS =
  /^(?:not\s+(?:assessed|specified|stated|recorded)|pending|unknown|none$)|\bnot\s+stated\b/i;

/** The licence text as a credit may print it: null when the field is empty or only a review status. */
export function recordedLicence(license: string | null | undefined): string | null {
  const s = license?.trim();
  return s && !LICENCE_STATUS.test(s) ? s : null;
}

/**
 * The licence family as recorded: one of the known families, or "other" for any other plain-text value (nothing is
 * filtered on it, owner decision 2026-10-24). Absent reads null; a value that is not plain text is undefined (malformed).
 */
export function licenceFamily(v: unknown): LicenceFamily | null | undefined {
  if (v === undefined || v === null || v === "") return null;
  const t = text(v, 40)?.toLowerCase();
  if (!t) return undefined;
  return (LICENCE_FAMILIES as readonly string[]).includes(t) ? (t as LicenceFamily) : "other";
}

/**
 * Licence fields as recorded. All may be absent (the credit then names the source only); what is present must be well
 * formed: a known family, plain text, an https link, and a link flagged as a deed only on creativecommons.org or
 * commons.wikimedia.org.
 */
export function parseLicence(
  p: Record<string, unknown>,
): Pick<ImageCredit, "license" | "licenseFamily" | "licenseUrl" | "licenseUrlIsDeed"> | null {
  const family = licenceFamily(p["license_family"]);
  if (family === undefined) return null;
  const license = optionalText(p["license"], 160);
  const deedRaw = p["license_url_is_deed"];
  if (deedRaw !== undefined && deedRaw !== null && typeof deedRaw !== "boolean") return null;
  const deed = deedRaw === true;
  const urlRaw = p["license_url"];
  const hasUrl = urlRaw !== undefined && urlRaw !== null && urlRaw !== "";
  const licenseUrl = hasUrl ? (deed ? httpsUrl(urlRaw, DEED_HOSTS) : httpsLink(urlRaw)) : null;
  if (!license.ok || (hasUrl && !licenseUrl) || (deed && !licenseUrl)) return null;
  const named = recordedLicence(license.value);
  return {
    license: named,
    licenseFamily: family,
    licenseUrl: named ? licenseUrl : null,
    licenseUrlIsDeed: deed && !!named,
  };
}

/**
 * display + thumb renditions, own page, licence, author, credit, rights status and verification time of one image.
 * Renditions must be on the registry's image hosts, and a Commons file's renditions on Wikimedia's hosts, a Library
 * item's on tile.loc.gov. `keys` names the fields a dataset uses for the page and the credit line.
 */
export function parseOpenImage(
  raw: unknown,
  keys: { filePage: string; credit: string } = { filePage: "file_page", credit: "credit" },
): OpenImage | null {
  const p = obj(raw);
  if (!p) return null;
  const page = parseFilePage(p[keys.filePage]);
  if (!page) return null;
  const hosts =
    page.origin === "commons"
      ? COMMONS_IMAGE_HOSTS
      : page.origin === "loc"
        ? LOC_IMAGE_HOSTS
        : IMAGE_HOSTS;
  const display = parseRendition(p["display"], hosts);
  const thumb = parseRendition(p["thumb"], hosts);
  const licence = parseLicence(p);
  const verifiedRaw = p["verified_at"];
  const verifiedAt =
    verifiedRaw === undefined || verifiedRaw === null ? null : isoDate(verifiedRaw);
  const author = optionalText(p["author"], 400);
  const credit = optionalText(p[keys.credit], 600);
  const rights = optionalText(p["rights_status"], 200);
  if (!display || !thumb || !licence || !author.ok || !credit.ok || !rights.ok) return null;
  if (verifiedAt === null && verifiedRaw !== undefined && verifiedRaw !== null) return null;
  return {
    display,
    thumb,
    filePage: page.url,
    origin: page.origin,
    ...licence,
    author: author.value,
    credit: credit.value,
    rightsStatus: rights.value,
    verifiedAt,
  };
}

export const MARK_MIMES: ReadonlySet<string> = new Set([
  "image/png",
  "image/svg+xml",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/bmp",
]);

/** What the registry calls the mark: an official seal, a logo, or something else (a wordmark, for example). */
export type MarkKind = "seal" | "logo";

/** A seal, logo or wordmark served as one image from its source site. */
export type MarkImage = {
  /** "seal" or "logo" as the record's asset_type says; null when it says neither or nothing. */
  kind: MarkKind | null;
  url: string;
  width: number;
  height: number;
  mime: string;
  /** The page the mark was taken from. */
  sourcePage: string;
  license: string | null;
  licenseUrl: string | null;
  author: string | null;
  rightsStatus: string | null;
};

/**
 * url, size, type, kind, source page and the recorded licence, author and rights status of one mark. Nothing here
 * filters on rights status or licence family (owner decisions 2026-10-24: agency seals and logos are used whatever the
 * registry's rights label says).
 */
export function parseMarkImage(raw: unknown): MarkImage | null {
  const m = obj(raw);
  if (!m) return null;
  const url = httpsUrl(m["url"], IMAGE_HOSTS);
  const width = px(m["width"]);
  const height = px(m["height"]);
  const mime = text(m["mime"], 40);
  const sourcePage = httpsLink(m["source_page"]);
  const license = optionalText(m["license"], 160);
  const author = optionalText(m["author"], 400);
  const rights = optionalText(m["rights_status"], 200);
  const kindRaw = m["asset_type"];
  const kind: MarkKind | null = kindRaw === "seal" || kindRaw === "logo" ? kindRaw : null;
  const urlRaw = m["license_url"];
  const hasLicenceUrl = urlRaw !== undefined && urlRaw !== null && urlRaw !== "";
  const licenseUrl = hasLicenceUrl ? httpsLink(urlRaw) : null;
  if (!url || !width || !height || !mime || !MARK_MIMES.has(mime) || !sourcePage) return null;
  if (!license.ok || !author.ok || !rights.ok || (hasLicenceUrl && !licenseUrl)) return null;
  const named = recordedLicence(license.value);
  return {
    kind,
    url,
    width,
    height,
    mime,
    sourcePage,
    license: named,
    licenseUrl: named ? licenseUrl : null,
    author: author.value,
    rightsStatus: rights.value,
  };
}

/** "PNG", "SVG", "JPEG" ... for a mark's image type. */
export function mimeLabel(mime: string): string {
  const sub = mime.split("/")[1] ?? mime;
  return sub.replace(/\+xml$/, "").toUpperCase();
}

/** Wide wordmarks get a plate; square seals a square frame. */
export const isWideMark = (m: Pick<MarkImage, "width" | "height">) => m.width / m.height > 1.6;

/** The site a link opens, for link text: "rules.house.gov". */
export function hostOf(url: string): string {
  return new URL(url).hostname.replace(/^www\./, "");
}

/** srcset from the thumbnail and display renditions (widths as recorded), smallest first, no duplicates. */
export function imageSrcSet(img: Pick<OpenImage, "display" | "thumb">): string {
  const parts = [img.thumb, img.display]
    .filter((r, i, all) => all.findIndex((x) => x.url === r.url) === i)
    .sort((a, b) => a.width - b.width);
  return parts.map((r) => `${r.url} ${r.width}w`).join(", ");
}

/** The name of the site the image's own page is on: "Wikimedia Commons", "Library of Congress" or its host. */
export function sourceLabel(img: Pick<ImageCredit, "origin" | "filePage">): string {
  if (img.origin === "commons") return "Wikimedia Commons";
  if (img.origin === "loc") return "Library of Congress";
  return hostOf(img.filePage);
}

const MONTH =
  "(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\\.?";
const EXACT_YEAR = [
  /^(\d{4})(?:-\d{2}(?:-\d{2}(?:[T ][0-9:.]+(?:Z|[+-]\d{2}:?\d{2})?)?)?)?$/,
  new RegExp(`^(\\d{4}),? ${MONTH}(?: \\d{1,2})?\\.?$`, "i"),
  new RegExp(`^${MONTH}(?: \\d{1,2},?)? (\\d{4})\\.?$`, "i"),
];

/**
 * The year of a recorded date written as a plain date ("2012-01-01", "2008 July.", "July 2008"); null for anything
 * looser ("[between 1980 and 2006]", "ca. 1950", "1930s"), so a range or an estimate is never narrowed to a year.
 */
export function yearOf(v: string | null): string | null {
  // A recorded date often ends with a full stop ("2018-02-27.", "2008 July."); that is punctuation, not a range.
  const s = v?.trim().replace(/\.$/, "");
  if (!s) return null;
  for (const re of EXACT_YEAR) {
    const m = re.exec(s);
    if (m && /^(1[6-9]|20)\d{2}$/.test(m[1]!)) return m[1]!;
  }
  return null;
}

export type CreditSegment =
  { kind: "text"; text: string } | { kind: "link"; href: string; host: string };

const URL_IN_TEXT = /https?:\/\/[^\s<>"]+/gi;
const TRAILING = /[.,;:!?)\]}'"]+$/;

/**
 * Splits a recorded author or credit string into text and links. Every http(s) URL in it becomes a link labelled with
 * its host ("flickr.com"), never the raw address; trailing punctuation stays text. A URL that does not parse stays text.
 */
export function creditSegments(value: string): CreditSegment[] {
  const out: CreditSegment[] = [];
  let last = 0;
  const push = (text: string) => {
    if (!text) return;
    const prev = out[out.length - 1];
    if (prev?.kind === "text") prev.text += text;
    else out.push({ kind: "text", text });
  };
  for (const m of value.matchAll(URL_IN_TEXT)) {
    const start = m.index ?? 0;
    const raw = m[0];
    const url = raw.replace(TRAILING, "");
    let parsed: URL | null = null;
    try {
      parsed = new URL(url);
    } catch {
      parsed = null;
    }
    push(value.slice(last, start));
    if (parsed && (parsed.protocol === "https:" || parsed.protocol === "http:") && parsed.hostname)
      out.push({ kind: "link", href: parsed.href, host: parsed.hostname.replace(/^www\./, "") });
    else push(url);
    push(raw.slice(url.length));
    last = start + raw.length;
  }
  push(value.slice(last));
  return out;
}

/** The same string with each URL replaced by its host, for a tooltip or an accessible name. */
export function plainCredit(value: string): string {
  return creditSegments(value)
    .map((seg) => (seg.kind === "text" ? seg.text : seg.host))
    .join("");
}
