import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { htmlText, payloadHash, record, requireValue, uniqueRecords } from './core.mjs';
import { pythonCommand } from './nhtsa.mjs';

export const CPSC_RSS_URL = 'https://www.cpsc.gov/Newsroom/CPSC-RSS-Feed/Recalls-RSS';
export const CPSC_RSS_QUALIFICATION = 'Recent items in the official CPSC recall RSS feed only; feed retention is limited and does not prove date-window or archive completeness. Publisher GUIDs are kept distinct from API RecallIDs; no inferred crosswalk. Recall descriptions are source allegations, not individual causation findings. Excludes the removed injury corpus.';

export function parseCpscRss(captured, options) {
  const python = pythonCommand();
  const parsed = spawnSync(python.command, [...python.args, '-B', '-X', 'utf8', fileURLToPath(new URL('./cpsc_rss.py', import.meta.url))], { input: captured.bytes, encoding: 'utf8', timeout: 15000, maxBuffer: 2 * 1024 * 1024 });
  requireValue(!parsed.error && parsed.status === 0, 'CPSC_RSS_INVALID');
  const items = JSON.parse(parsed.stdout); requireValue(items.length <= options.maxRecords, 'SOURCE_RECORD_CAP');
  const rows = items.flatMap((item, index) => {
    if (item.published_on < options.from || item.published_on > options.through) return [];
    const description = htmlText(item.description_html);
    requireValue(description.length > 0, 'CPSC_RSS_DESCRIPTION_EMPTY');
    return [record({ native_id: `rss:${item.guid}`, title: item.title, document_type: 'recall_notice', published_on: item.published_on, source_updated_on: null, source_url: item.url, agency_ids: ['cpsc'], agency_names: ['Consumer Product Safety Commission'], identifiers: [item.guid], evidence_excerpt: description.slice(0, 1800), fields: { publisher_guid: item.guid, description, published_literal: item.published_literal, date_basis: 'RSS pubDate, not injury or last modification date', qualification: CPSC_RSS_QUALIFICATION } }, captured, `/rss/channel/item[${index + 1}]`)];
  });
  return { rows: uniqueRecords(rows), items };
}

export async function collectCpscRss(client, _source, options) {
  const capture = await client.capture(CPSC_RSS_URL, 'xml'); const first = parseCpscRss(capture, options);
  const check = await client.capture(CPSC_RSS_URL, 'xml'); const second = parseCpscRss(check, options);
  const signature = (items) => payloadHash([...items].sort((a, b) => a.guid < b.guid ? -1 : a.guid > b.guid ? 1 : 0));
  requireValue(signature(first.items) === signature(second.items), 'SOURCE_CHANGED_DURING_RUN');
  const dates = first.items.map((item) => item.published_on).sort();
  return { rows: first.rows, expected: first.rows.length, scope: { selection: 'Items present in the recent official recall RSS feed whose pubDate is inside the requested window', date_basis: 'RSS pubDate', feed_item_count: first.items.length, selected_item_count: first.rows.length, feed_earliest_publication: dates[0], feed_latest_publication: dates.at(-1), full_history: false, date_window_complete: false, source_native_id_family: 'RSS publisher GUID, prefixed rss:', repeated_response_verified: true, qualification: CPSC_RSS_QUALIFICATION } };
}
