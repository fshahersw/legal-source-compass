// "Show as published" rules of the matter-registry projections (contract sw-matter-registry/1 v1.3, owner decision 2026-10-03).
//
// Published exactly as the court record shows it (whitespace collapsed only): docket-entry descriptions (clipped to 500 characters), member-case
// captions, party names and extra_info text, counsel name + firm + role.
// Never published: anything sealed, restricted, in camera, ex parte or redacted; entries that carry a document flagged is_sealed=true;
// dockets blocked at the source; counsel flagged "Attorney in sealed group"; any contact field (address block, phone, fax, email).
import { createHash } from 'node:crypto';

export const sha256 = x => createHash('sha256').update(x).digest('hex');

// Text that makes a value unpublishable. Deliberately broad: "seal" also catches "Sealed Air" and "motion to seal" (false positives are counted, never published).
export const EXCLUDE_RE = /seal|restricted|in[\s-]*camera|ex[\s-]*parte|redact/i;
export const excluded = s => EXCLUDE_RE.test(String(s ?? ''));
// A published free-text value must not carry a contact field.
export const CONTACT_RE = /[\w.+-]+@[\w-]+\.[\w.-]+|\(\d{3}\)\s?\d{3}[-.\s]?\d{4}|\b\d{3}[-.]\d{3}[-.]\d{4}\b/;
export const hasContact = s => CONTACT_RE.test(String(s ?? ''));
export const ws = s => String(s ?? '').replace(/\s+/g, ' ').trim();

// CourtListener people_db.models.Role (cl/people_db/models.py, read 2026-10-03)
export const ATTORNEY_ROLE = { 1: 'Attorney to be noticed', 2: 'Lead attorney', 3: 'Attorney in sealed group', 4: 'Pro hac vice', 5: 'Self-terminated', 6: 'Terminated', 7: 'Suspended', 8: 'Inactive', 9: 'Disbarred', 10: 'Unknown' };
export const ROLE_SEALED = 3;
export const ROLE_TERMINATED = new Set([5, 6]);

// Canonical JSON (sorted keys, undefined dropped) used for row hashes and read-back comparison.
export function canon(x) {
  if (Array.isArray(x)) return '[' + x.map(v => (v === undefined ? 'null' : canon(v))).join(',') + ']';
  if (x && typeof x === 'object') return '{' + Object.keys(x).filter(k => x[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canon(x[k])).join(',') + '}';
  return JSON.stringify(x);
}

export function clipDescription(text, max = 500) {
  const t = ws(text);
  if (t.length <= max) return { text: t, chars: t.length, truncated: false };
  return { text: t.slice(0, max - 1) + '…', chars: t.length, truncated: true };
}

// Captions extracted from JPML order PDFs (Schedule A / CTO tables) come from text lines, and a wrapped table row can mix the head or tail of the neighbouring row
// into the caption (also a font-encoded "Opposed" marker shows up as 2SSRVHG). A schedule caption is published only when it is a single well-formed caption;
// otherwise it is withheld (never repaired or guessed). Captions that are structured fields (CourtListener header, DocketBird title) are not subject to this test.
const FRAG_START = /^(et al|llc|inc|corp|corporation|company|co\.|ltd|l\.p\.|lp|pharma|pharmaceuticals|usa|plc|and|d\/b\/a)\b/i;
export function scheduleCaptionQuality(caption) {
  const s = ws(caption);
  if (!s) return 'empty';
  if (/2SSRVHG/i.test(s)) return 'garbled_marker';
  if (/[^\x20-\x7e‘’“”–—éèñáíóúüç]/.test(s)) return 'odd_chars';
  if (s.length > 170) return 'too_long';
  if (/C\.A\.\s*No/i.test(s)) return 'contains_docket_number';
  if ((s.match(/\s(?:v|vs)\.?\s/gi) ?? []).length > 1) return 'two_captions_merged';
  if (FRAG_START.test(s)) return 'starts_mid_phrase';
  if (/\s(?:v|vs)\.?$/i.test(s) || /\bet$/i.test(s) || /\b(?:of|the|and|for|d\/b\/a|a|an)$/i.test(s)) return 'ends_mid_phrase';
  if (s.length < 6) return 'too_short';
  return 'ok';
}

// The firm is the first line of the court-record attorney block, unless that line is the attorney's own name (then the second line) or looks like
// an address / contact line. Returned verbatim; null when no safe candidate exists. Nothing else of the block is kept.
const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const ADDRESS_START = /^(\d|p\.?\s*o\.?\s*box|post office box|suite\b|ste\.?\s|floor\b|\d+(st|nd|rd|th)\s+floor)/i;
const STREET_WORD = /\b(street|st\.|avenue|ave\.|road|rd\.|boulevard|blvd\.?|drive|dr\.|plaza|square|parkway|pkwy|highway|hwy|lane|ln\.|way|center|centre|tower|building|bldg)\b/i;
const CONTACT_LABEL = /^(e-?mail|email|phone|tel|telephone|fax|direct|cell|mobile)\s*[:#]/i;
function firmCandidateOk(line, attorneyName) {
  const l = ws(line);
  if (!l || l.length > 160) return false;
  if (norm(l) === norm(attorneyName)) return false;
  if (ADDRESS_START.test(l) || CONTACT_LABEL.test(l) || hasContact(l)) return false;
  if (STREET_WORD.test(l) && /\d/.test(l)) return false;
  if (/^[A-Z]{2}\s+\d{5}(-\d{4})?$/.test(l)) return false;
  if (/,\s*[A-Z]{2}\s+\d{5}/.test(l)) return false;
  return true;
}
export function firmFromLines(attorneyName, lines) {
  const ls = (lines ?? []).map(ws).filter(Boolean);
  if (!ls.length) return null;
  if (firmCandidateOk(ls[0], attorneyName)) return ls[0];
  if (norm(ls[0]) === norm(attorneyName) && ls[1] && firmCandidateOk(ls[1], attorneyName)) return ls[1];
  return null;
}

// Ordinals: pure functions of the record so that collecting more rows never renumbers the rows already projected.
const DAY_MS = 86_400_000;
export function daysSince1970(dateStr) {
  const m = String(dateStr ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return 99_999; // undated entries sort last within their matter
  const d = Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS);
  return Math.min(Math.max(d, 0), 99_998);
}
export const entryOrdinal = (mdl, dateFiled, entryNumber) => Number(mdl) * 1e12 + daysSince1970(dateFiled) * 1e6 + Math.min(Math.max(Number(entryNumber ?? 0) || 0, 0), 99_999) * 10;
export const partyOrdinal = (mdl, partyId) => Number(mdl) * 1e9 + Number(partyId);
