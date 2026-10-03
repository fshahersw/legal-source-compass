// node parse-govinfo-mods.mjs <mods.xml> [--json=out.json] — lists the granules (relatedItem type=constituent) of a GovInfo USCOURTS package MODS record.
import fs from 'node:fs';
import crypto from 'node:crypto';
const file = process.argv[2];
const jsonOut = (process.argv.find(a => a.startsWith('--json=')) ?? '').slice(7);
const buf = fs.readFileSync(file);
const xml = buf.toString('utf8');
const decode = s => String(s ?? '').replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const items = [...xml.matchAll(/<relatedItem type="constituent"[^>]*>([\s\S]*?)<\/relatedItem>\s*(?=<relatedItem type="constituent"|<\/mods>|<recordInfo|<extension|$)/g)].map(m => m[0]);
const tag = (s, t) => (s.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) ?? [])[1];
const out = [];
for (const it of xml.split('<relatedItem type="constituent"').slice(1)) {
  const block = it.split('</relatedItem>')[0] + '</relatedItem>';
  const sub = decode(tag(block, 'subTitle'));
  const part = decode(tag(block, 'partNumber'));
  const date = decode(tag(block, 'dateIssued'));
  const href = (block.match(/xlink:href="(https:\/\/www\.govinfo\.gov\/content\/pkg\/[^"]+\.pdf)"/) ?? [])[1] ?? null;
  const gid = (it.match(/^[^>]*ID="([^"]+)"/) ?? [])[1] ?? null;
  const docNum = (sub.match(/\b(?:ECF No\.?|Document|Doc\.?)\s*#?\s*(\d{1,6})\b/i) ?? [])[1] ?? null;
  out.push({ granule: gid, part_number: part, date_issued: date, subtitle: sub, pdf_url: href, doc_number_in_text: docNum });
}
console.log(JSON.stringify({ file, bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), granules: out.length }));
for (const o of out) console.log(JSON.stringify(o).slice(0, 420));
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ file, sha256: crypto.createHash('sha256').update(buf).digest('hex'), granules: out }, null, 1));
