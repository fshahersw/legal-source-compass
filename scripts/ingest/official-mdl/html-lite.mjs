// Minimal, forgiving HTML parser for court web pages (Node built-ins only). It keeps source offsets for every element so a parsed
// listing row can always be traced back to the exact bytes of the captured page. It is not a general HTML5 parser: it understands
// void elements, raw-text elements (script/style), unclosed p/li/tr/td/th/dt/dd/option, and ignores comments/doctype/PI.
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW_TEXT = new Set(['script', 'style']);
const TABLE_CELL = new Set(['td', 'th']);
const TAG = /<(\/?)([A-Za-z][A-Za-z0-9:_-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/y;
const ATTR = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…', copy: '©', reg: '®', deg: '°', sect: '§', para: '¶', middot: '·', bull: '•', times: '×', eacute: 'é', egrave: 'è', agrave: 'à', ntilde: 'ñ', ccedil: 'ç', uuml: 'ü', ouml: 'ö', auml: 'ä' };
export function decodeEntities(s, { legacy = false } = {}) {
  // In text content browsers also decode the legacy semicolon-less forms of a few entities ("&nbspForms"); in attribute values they do not.
  const text = legacy ? String(s).replace(/&(nbsp|amp|lt|gt|quot)(?!;)/g, '&$1;') : String(s);
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      try { return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole; } catch { return whole; }
    }
    return Object.prototype.hasOwnProperty.call(NAMED, body) ? NAMED[body] : whole;
  });
}
// Whitespace collapsed only: the printed text is otherwise kept exactly (case, punctuation, typos).
export const collapse = s => String(s).replace(/[   ]/g, ' ').replace(/[​‌‍﻿]/g, '').replace(/\s+/g, ' ').trim();

function parseAttrs(source) {
  const attrs = {};
  ATTR.lastIndex = 0;
  for (let m; (m = ATTR.exec(source));) {
    const name = m[1].toLowerCase();
    if (!(name in attrs)) attrs[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

export function parseHtml(src) {
  const root = { type: 'element', tag: '#root', attrs: {}, children: [], parent: null, start: 0, end: src.length, innerStart: 0, innerEnd: src.length };
  let top = root;
  const stack = [root];
  const open = () => stack[stack.length - 1];
  const closeTop = at => { const node = stack.pop(); if (node.end === undefined || node.end < 0) { node.end = at; node.innerEnd = Math.min(node.innerEnd ?? at, at); } top = open(); };
  const text = (from, to) => { if (to > from) open().children.push({ type: 'text', raw: src.slice(from, to), start: from, end: to, parent: open() }); };
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) { text(i, src.length); break; }
    if (lt > i) text(i, lt);
    if (src.startsWith('<!--', lt)) { const e = src.indexOf('-->', lt + 4); i = e < 0 ? src.length : e + 3; continue; }
    if (src.startsWith('<![CDATA[', lt)) { const e = src.indexOf(']]>', lt + 9); text(lt + 9, e < 0 ? src.length : e); i = e < 0 ? src.length : e + 3; continue; }
    if (src[lt + 1] === '!' || src[lt + 1] === '?') { const e = src.indexOf('>', lt + 2); i = e < 0 ? src.length : e + 1; continue; }
    TAG.lastIndex = lt;
    const m = TAG.exec(src);
    if (!m) { text(lt, lt + 1); i = lt + 1; continue; }
    const closing = m[1] === '/', tag = m[2].toLowerCase(), end = lt + m[0].length;
    if (closing) {
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].tag === tag) {
          while (stack.length - 1 >= k) { const node = stack.pop(); node.innerEnd = stack.length === k ? lt : node.innerEnd ?? lt; node.end = stack.length === k ? end : lt; if (node.innerEnd === undefined) node.innerEnd = lt; }
          break;
        }
      }
      top = open(); i = end; continue;
    }
    // implicit closes
    const cur = () => open().tag;
    if (tag === 'tr') while (['td', 'th', 'tr'].includes(cur())) closeTop(lt);
    else if (TABLE_CELL.has(tag)) { if (TABLE_CELL.has(cur())) closeTop(lt); }
    else if (tag === 'li') { if (cur() === 'li') closeTop(lt); }
    else if (tag === 'p') { if (cur() === 'p') closeTop(lt); }
    else if (tag === 'dt' || tag === 'dd') { if (['dt', 'dd'].includes(cur())) closeTop(lt); }
    else if (tag === 'option') { if (cur() === 'option') closeTop(lt); }
    const selfClosing = /\/\s*$/.test(m[3]);
    const node = { type: 'element', tag, attrs: parseAttrs(m[3].replace(/\/\s*$/, '')), children: [], parent: open(), start: lt, end: -1, innerStart: end, innerEnd: -1 };
    open().children.push(node);
    if (VOID.has(tag) || selfClosing) { node.end = end; node.innerStart = end; node.innerEnd = end; i = end; continue; }
    if (RAW_TEXT.has(tag)) {
      const re = new RegExp('</' + tag + '\\s*>', 'ig'); re.lastIndex = end;
      const c = re.exec(src);
      const bodyEnd = c ? c.index : src.length;
      node.children.push({ type: 'text', raw: src.slice(end, bodyEnd), start: end, end: bodyEnd, parent: node });
      node.innerEnd = bodyEnd; node.end = c ? c.index + c[0].length : src.length;
      i = node.end; continue;
    }
    stack.push(node); top = node; i = end;
  }
  while (stack.length > 1) { const node = stack.pop(); node.end = src.length; node.innerEnd = src.length; }
  return root;
}

export function* walk(node) {
  if (node.type === 'element') {
    yield node;
    for (const child of node.children) yield* walk(child);
  }
}
export const findAll = (node, predicate) => { const out = []; for (const n of walk(node)) if (n !== node && predicate(n)) out.push(n); return out; };
export const findFirst = (node, predicate) => { for (const n of walk(node)) if (n !== node && predicate(n)) return n; return null; };
export const hasClass = (node, name) => (node.attrs?.class ?? '').split(/\s+/).includes(name);
// Text of a node. <br> and block boundaries become single spaces; script/style never contribute.
export function textOf(node, { raw = false, skip = null } = {}) {
  const parts = [];
  const visit = n => {
    if (n.type === 'text') { parts.push(n.raw); return; }
    if (RAW_TEXT.has(n.tag)) return;
    if (skip && skip(n)) return;
    if (n.tag === 'br') { parts.push(' '); return; }
    const block = ['p', 'div', 'li', 'tr', 'td', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'dt', 'dd', 'table', 'ul', 'ol'].includes(n.tag);
    if (block) parts.push(' ');
    for (const c of n.children) visit(c);
    if (block) parts.push(' ');
  };
  visit(node);
  const joined = parts.join('');
  return raw ? joined : collapse(decodeEntities(joined, { legacy: true }));
}
export const children = (node, tag) => node.children.filter(c => c.type === 'element' && (!tag || c.tag === tag));
export const ancestorOf = (node, predicate) => { for (let p = node.parent; p; p = p.parent) if (p.type === 'element' && predicate(p)) return p; return null; };
