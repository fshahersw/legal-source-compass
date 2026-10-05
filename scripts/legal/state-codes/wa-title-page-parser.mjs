function decodeHtml(value) {
  return value.replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)));
}

export function htmlToText(value) {
  return decodeHtml(value.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function anchorsIn(html) {
  const anchors = [];
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const hrefMatch = match[1].match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    if (!hrefMatch) continue;
    anchors.push({href: decodeHtml(hrefMatch[1] ?? hrefMatch[2]), text: htmlToText(match[2])});
  }
  return anchors;
}

function chapterIdFromUrl(href) {
  let decoded;
  try { decoded = decodeURIComponent(href); } catch { decoded = href; }
  const match = decoded.match(/RCW\s+([0-9]+[A-Z]?)\s*\.\s*([0-9]+[A-Z]?)\s+CHAPTER\.htm$/i);
  return match ? `${match[1].toUpperCase()}.${match[2].toUpperCase()}` : null;
}

function titleIdFromUrl(href) {
  let decoded;
  try { decoded = decodeURIComponent(href); } catch { decoded = href; }
  return decoded.match(/RCW\s+([0-9]+[A-Z]?)\s+TITLE(?:\.htm|\/)/i)?.[1]?.toUpperCase() ?? null;
}

export function parseTitlePage(html) {
  const visible = htmlToText(html);
  const titleMatch = visible.match(/\bTitle\s+([0-9]+[A-Z]?)\s+RCW\b/i);
  if (!titleMatch) throw new Error('Native Title N RCW heading not found.');
  const nativeTitleId = titleMatch[1].toUpperCase();
  const chaptersHeading = /<b\b[^>]*>\s*Chapters\s*<\/b>/i.exec(html);
  if (!chaptersHeading) throw new Error('Native Chapters table heading not found.');
  const tableStart = html.toLowerCase().lastIndexOf('<table', chaptersHeading.index);
  const tableEnd = html.toLowerCase().indexOf('</table>', chaptersHeading.index + chaptersHeading[0].length);
  if (tableStart < 0 || tableEnd < 0) throw new Error('Native Chapters table bounds not found.');
  const tableHtml = html.slice(tableStart, tableEnd + '</table>'.length);
  const chapters = [];
  for (const rowMatch of tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const rowHtml = rowMatch[1];
    const cells = [...rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(match => match[1]);
    const anchor = anchorsIn(rowHtml).find(item => /CHAPTER\.htm(?:[?#].*)?$/i.test(item.href));
    if (!anchor) continue;
    const chapterId = anchor.text.replace(/\s+/g, '').toUpperCase();
    const hrefChapterId = chapterIdFromUrl(anchor.href);
    chapters.push({chapterId, description: cells[1] ? htmlToText(cells[1]) : '', hrefChapterId, href: anchor.href, identityCheck: chapterId === hrefChapterId ? 'text-and-path-match' : 'text-or-path-mismatch'});
  }
  if (!chapters.length) throw new Error('No chapter links found in the native Chapters table.');
  const pdfLinks = anchorsIn(html).filter(anchor => /\.pdf(?:[?#].*)?$/i.test(anchor.href));
  const titlePdfLinks = pdfLinks.filter(anchor => ['title digest', 'complete title'].includes(anchor.text.toLowerCase())).map(anchor => ({label: anchor.text, href: anchor.href}));
  const mismatchTitleLinks = titlePdfLinks.filter(link => titleIdFromUrl(link.href) !== nativeTitleId);
  return {
    nativeTitleId,
    chapters,
    titlePdfLinks: titlePdfLinks.map(link => ({...link, hrefTitleId: titleIdFromUrl(link.href), identityCheck: titleIdFromUrl(link.href) === nativeTitleId ? 'text-and-path-match' : 'text-or-path-mismatch'})),
    chapterIdentityMismatches: chapters.filter(item => item.identityCheck !== 'text-and-path-match'),
    titlePdfIdentityMismatches: mismatchTitleLinks
  };
}
