// GovInfo (U.S. Government Publishing Office) USCOURTS collection: the opinions and orders that federal courts designate as published, one package per case
// (USCOURTS-<court>-<office>_<yy>-<type>-<seq>) and one granule per document (<package>-<part>, part numbers 0,1,2,...).
// Per package two documents are read, one request each:
//   * PREMIS  https://www.govinfo.gov/metadata/pkg/<package>/premis.xml  (small): every granule PDF with GPO's own SHA-256 fixity digest and byte size -> the authoritative file list
//   * MODS    https://www.govinfo.gov/metadata/pkg/<package>/mods.xml    (one request; 25 MB for the talc docket because it embeds the court's party list, no Range support):
//             the constituent records (one per granule) carry the docket text, date issued, court and docket number as GPO published them. The party list is never copied anywhere;
//             the raw bytes are kept gzip-compressed in the private run dir with the sha256 of the uncompressed bytes.
// (The per-granule MODS / website detail endpoints return the same party list for every granule, so they are not used.)
import { createHash } from 'node:crypto';
import { collapse, decodeEntities } from './html-lite.mjs';

export const GOVINFO_HOST = 'www.govinfo.gov';
// The registry's master dockets (Tier 1 + Tier 2) as listed in _work/contracts/registry-master-ids.md (2026-10-03). `official_id` is the string the matter's court-hosted documents
// already use as native_case_id (see official-court-case-ids.md); GovInfo rows reuse it so one id finds both sources, else the registry's docket number is used.
export const GOVINFO_MASTERS = [
  { mdl: '2738', tier: 1, court: 'njd', docket: '3:16-md-02738', official_id: '3:16-md-02738' },
  { mdl: '3140', tier: 1, court: 'flnd', docket: '3:25md3140', official_id: '3:25md3140' },
  { mdl: '3060', tier: 1, court: 'ilnd', docket: '1:23-cv-00818', official_id: '1:23-cv-00818' },
  { mdl: '3114', tier: 1, court: 'txnd', docket: '3:24-md-03114', official_id: '3:24-md-03114-D' },
  { mdl: '3163', tier: 1, court: 'paed', docket: '2:25-md-03163', official_id: '2:25-md-03163-KSM' },
  { mdl: '3185', tier: 1, court: 'moed', docket: '4:26-md-03185', official_id: '4:26-md-3185' },
  { mdl: '3180', tier: 1, court: 'njd', docket: '3:26-md-03180' },
  { mdl: '3125', tier: 1, court: 'casd', docket: '3:24-md-03125' },
  { mdl: '3047', tier: 1, court: 'cand', docket: '4:22-md-03047' },
  { mdl: '3094', tier: 1, court: 'paed', docket: '2:24-md-03094' },
  { mdl: '3166', tier: 1, court: 'cand', docket: '3:25-md-03166' },
  { mdl: '3080', tier: 1, court: 'njd', docket: '2:23-md-3080', official_id: '2:23-md-3080' },
  { mdl: '3113', tier: 1, court: 'njd', docket: '2:24-md-3113', official_id: '2:24-md-3113' },
  { mdl: '3081', tier: 1, court: 'azd', docket: '2:23-md-03081' },
  { mdl: '2846', tier: 1, court: 'ohsd', docket: '2:18-md-02846' },
  { mdl: '2873', tier: 1, court: 'scd', docket: '2:18-mn-02873' },
  { mdl: '2804', tier: 1, court: 'ohnd', docket: '1:17-md-02804' },
  { mdl: '3108', tier: 1, court: 'mnd', docket: '0:24-md-03108' },
  { mdl: '3149', tier: 1, court: 'casd', docket: '3:25-md-03149' },
  { mdl: '3144', tier: 1, court: 'cacd', docket: '2:25-ml-03144' },
  { mdl: '3043', tier: 1, court: 'nysd', docket: '1:22-md-03043' },
  { mdl: '3014', tier: 1, court: 'pawd', docket: '2:21-mc-01230' },
  { mdl: '2741', tier: 1, court: 'cand', docket: '3:16-md-02741' },
  { mdl: '3026', tier: 1, court: 'ilnd', docket: '1:22-cv-00071' },
  { mdl: '2885', tier: 2, court: 'flnd', docket: '3:19-md-02885' },
  { mdl: '2924', tier: 2, court: 'flsd', docket: '9:20-md-02924' },
  { mdl: '2323', tier: 2, court: 'paed', docket: '2:12-md-02323' },
  { mdl: '2973', tier: 2, court: 'njd', docket: '2:20-md-02973' },
  { mdl: '2789', tier: 2, court: 'njd', docket: '2:17-md-02789' },
  { mdl: '2921', tier: 2, court: 'njd', docket: '2:19-md-02921' },
  { mdl: '2672', tier: 2, court: 'cand', docket: '3:15-md-02672' },
  { mdl: '2843', tier: 2, court: 'cand', docket: '3:18-md-02843' },
  { mdl: '2800', tier: 2, court: 'gand', docket: '1:17-md-02800' },
  { mdl: '3031', tier: 2, court: 'mnd', docket: '0:22-md-03031' },
  { mdl: '2606', tier: 2, court: 'njd', docket: '1:15-md-02606' },
  { mdl: '2592', tier: 2, court: 'laed', docket: '2:14-md-02592' },
  { mdl: '2545', tier: 2, court: 'ilnd', docket: '1:14-cv-01748' },
  { mdl: '2782', tier: 2, court: 'gand', docket: '1:17-md-02782' },
];

// "3:25md3140" / "2:23-md-3080" / "4:26-md-03185" -> {office, yy, type, seq5}; null when the string is not a docket number
export function parseDocket(text) {
  const m = /^(\d{1,2}):(\d{2}|\d{4})-?([a-z]{2,4})-?(\d{1,6})$/i.exec(String(text).trim());
  if (!m) return null;
  return { office: String(Number(m[1])), yy: m[2].slice(-2), type: m[3].toLowerCase(), seq5: String(Number(m[4])).padStart(5, '0') };
}
export function packageId(master) {
  const d = parseDocket(master.docket);
  if (!d) throw Error('UNPARSEABLE_DOCKET ' + master.docket);
  return `USCOURTS-${master.court}-${d.office}_${d.yy}-${d.type}-${d.seq5}`;
}
export const caseIdOf = master => master.official_id ?? master.docket;
export const granuleId = (pkg, n) => `${pkg}-${n}`;
export const premisUrl = pkg => `https://${GOVINFO_HOST}/metadata/pkg/${pkg}/premis.xml`;
export const packageModsUrl = pkg => `https://${GOVINFO_HOST}/metadata/pkg/${pkg}/mods.xml`;
export const granuleModsUrl = (pkg, n) => `https://${GOVINFO_HOST}/metadata/granule/${pkg}/${granuleId(pkg, n)}/mods.xml`;
export const granulePdfUrl = (pkg, n) => `https://${GOVINFO_HOST}/content/pkg/${pkg}/pdf/${granuleId(pkg, n)}.pdf`;
export const granuleDetailsUrl = (pkg, n) => `https://${GOVINFO_HOST}/app/details/${pkg}/${granuleId(pkg, n)}`;

const tag = (xml, name) => { const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml); return m ? collapse(decodeEntities(m[1].replace(/<[^>]*>/g, ' '), { legacy: true })) : null; };
// One granule MODS record -> the fields the court's docket entry carries as GPO published them (docketText = the court's docket text; dateIssued = ISO date).
export function parseGranuleMods(xml, { pkg, n }) {
  const searchTitle = tag(xml, 'searchTitle');
  const docket = /USCOURTS\s+([0-9]{1,2}:[0-9]{2}-[A-Za-z]{1,5}-[0-9]{3,6})/.exec(searchTitle ?? '')?.[1] ?? null;
  const pdf = /<url[^>]*displayLabel="PDF rendition"[^>]*>([^<]+)<\/url>/.exec(xml)?.[1] ?? null;
  return {
    package_id: pkg, granule_id: granuleId(pkg, n), part_number: tag(xml, 'partNumber'), access_id: tag(xml, 'accessId'), sequence_number: tag(xml, 'sequenceNumber'),
    case_title: tag(xml, 'title'), docket_text: tag(xml, 'docketText') ?? tag(xml, 'subTitle'), subtitle: tag(xml, 'subTitle'), date_issued: tag(xml, 'dateIssued'),
    court_name: tag(xml, 'courtName'), state: tag(xml, 'state'), search_title: searchTitle, docket_number_published: docket, pdf_url: pdf,
    fdsys_unique_id: /<identifier type="FDsys Unique ID">([^<]+)<\/identifier>/.exec(xml)?.[1] ?? null,
  };
}
// PREMIS: every `file` object of a granule PDF has originalName "<package>-<n>.pdf", a SHA-256 fixity digest and a byte size.
export function parsePremis(xml, pkg) {
  const files = [];
  for (const block of xml.split('<object xsi:type="file">').slice(1)) {
    const body = block.split('</object>')[0];
    const name = /<originalName>([^<]+)<\/originalName>/.exec(body)?.[1] ?? null;
    const m = name ? new RegExp('^' + pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-([0-9]{1,6})\\.pdf$').exec(name) : null;
    if (!m) continue;
    const digest = /<messageDigestAlgorithm>SHA-256<\/messageDigestAlgorithm>\s*<messageDigest>([a-f0-9]{64})<\/messageDigest>/.exec(body)?.[1] ?? null;
    const size = /<size>([0-9]+)<\/size>/.exec(body)?.[1];
    files.push({ part: Number(m[1]), granule_id: pkg + '-' + m[1], original_name: name, sha256: digest, bytes: size ? Number(size) : null, fdsys_id: /<objectIdentifierValue>([^<]+)<\/objectIdentifierValue>/.exec(body)?.[1] ?? null });
  }
  return files.sort((a, b) => a.part - b.part);
}
// Package MODS: the package-level docket number is titleInfo/partNumber; every constituent relatedItem is one granule. Party elements are skipped without being read.
export function parsePackageMods(xml, pkg) {
  const start = xml.indexOf('<relatedItem type="constituent"');
  const tail = start >= 0 ? xml.slice(start) : '';
  const constituents = [];
  for (const piece of tail.split('<relatedItem type="constituent"').slice(1)) {
    const block = '<relatedItem type="constituent"' + piece;
    const id = /\bID="id-([^"]+)"/.exec(block)?.[1] ?? null;
    const n = id && id.startsWith(pkg + '-') ? id.slice(pkg.length + 1) : null;
    const g = parseGranuleMods(block, { pkg, n: n ?? '?' });
    g.granule_id = id ?? g.granule_id;
    constituents.push(g);
  }
  const head = start >= 0 ? xml.slice(Math.max(0, start - 1500), start) : xml.slice(-1500);
  const pkgTitle = (() => { const m = /<titleInfo>\s*<title>([\s\S]*?)<\/title>\s*<partNumber>([^<]*)<\/partNumber>\s*<\/titleInfo>/.exec(xml.slice(Math.max(0, start - 20000), start < 0 ? undefined : start)); return m ? { case_title: collapse(decodeEntities(m[1])), docket_number_published: collapse(m[2]) } : null; })();
  return { constituents, package_title: pkgTitle, date_ingested: /<dateIngested>([^<]+)<\/dateIngested>/.exec(xml.slice(0, 6000))?.[1] ?? null, head_check: head.length };
}
export const sha256Hex = x => createHash('sha256').update(x).digest('hex');
