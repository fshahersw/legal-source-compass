/**
 * Dry run without corpus REST credentials: corpus reads are answered from a snapshot file made with read-only SQL, and
 * the comparison with stored rows is emitted as read-only SQL (hash of the same comparable JSON on both sides).
 *
 * Snapshot file:
 *   {
 *     "query":  { "<exact PostgREST path and query the adapter issues>": [rows] },
 *     "edge":   { "<dataset>|<asc|desc>|<select>|<limit>": [rows] },
 *     "rowsBy": { "<dataset>|<id|source_url>": { "<value>": row } },   // rows absent here are not held
 *     "rpc":    { "<name>": result }
 *   }
 * A read the snapshot cannot answer is recorded and stops that source ("needs snapshot"), never answered with a guess.
 */
import { jsonbHash } from "./jsonb.mjs";

export class MissingSnapshot extends Error {
  constructor(what) {
    super(`snapshot has no answer for ${what}`);
    this.name = "MissingSnapshot";
    this.what = what;
  }
}

export function snapshotCorpus(snapshot, missing) {
  const miss = (what) => {
    missing.push(what);
    throw new MissingSnapshot(what);
  };
  return {
    async rowsBy(dataset, column, values) {
      // without a table the stored rows are compared in the emitted SQL instead (classificationSql, presenceSql)
      const table = snapshot.rowsBy?.[`${dataset}|${column}`];
      if (!table) return [];
      // compact entries: [id, ordinal, combo] with the shared parts in __combos
      const expand = (v) => {
        const e = table[v];
        if (!Array.isArray(e)) return e;
        return { id: e[0], ordinal: e[1], [column]: v, ...(table.__combos?.[e[2]] ?? {}) };
      };
      return [...new Set(values)].filter((v) => v in table && v !== "__combos").map(expand);
    },
    async edge(dataset, order, select, limit = 1) {
      const key = `${dataset}|${order}|${select}|${limit}`;
      return snapshot.edge?.[key] ?? miss(`edge ${key}`);
    },
    async query(q) {
      if (snapshot.query && q in snapshot.query) return snapshot.query[q];
      // ftc_hsr lookups by API id or transaction number, answered from "notices": [[id, ordinal, api_id, txn, date, created]]
      // (the newest notices); a transaction-number lookup outside that table is reported, not guessed
      const notices = snapshot.notices?.map(
        ([id, ordinal, api_id, transaction_number, date, created]) => ({
          id,
          ordinal,
          item: { notice: { api_id, transaction_number, date, created } },
        }),
      );
      const byApi = decodeURIComponent(q).match(/item->notice->>api_id=in\.\((.*)\)$/);
      if (notices && byApi) {
        const ids = byApi[1].split(",").map((x) => x.replace(/"/g, ""));
        return notices.filter((n) => ids.includes(n.item.notice.api_id));
      }
      const byTxn = decodeURIComponent(q).match(/or=\(id\.eq\.(\d{8}),id\.like\.\d{8}-\*\)$/);
      if (notices && byTxn && snapshot.notices_cover_txn?.includes(byTxn[1])) {
        return notices.filter((n) => n.id === byTxn[1] || n.id.startsWith(`${byTxn[1]}-`));
      }
      return miss(`query ${q}`);
    },
    async rpc(name) {
      if (snapshot.rpc && name in snapshot.rpc) return snapshot.rpc[name];
      return miss(`rpc ${name}`);
    },
    async call(name) {
      throw new Error(`dry run: refused RPC ${name}`);
    },
  };
}

const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** SQL for the comparable JSON of a stored row r, matching each adapter's comparable(contentOf(row)). */
const BASE = (detail) =>
  `jsonb_build_object('id', r.id, 'category', r.category, 'state', coalesce(r.state, ''), 'county_geoids', to_jsonb(r.county_geoids), 'title', r.title, 'source_url', coalesce(r.source_url, ''), 'item', r.item, 'detail', ${detail}, 'text', r.text, 'filters', r.filters)`;
const OPENFDA_MASKS = [
  "{temporal,captured_at}",
  "{temporal,captured_at_basis}",
  "{temporal,source_as_of}",
  "{temporal,source_as_of_basis}",
  "{source_as_of}",
  "{original_file}",
  "{qualification}",
];
// create_missing = false: a path is masked only where it exists (maskPath does the same)
const openfdaDetail = () =>
  OPENFDA_MASKS.reduce((d, p) => `jsonb_set(${d}, '${p}', '"<masked>"', false)`, "r.detail");
export const COMPARABLE_SQL = {
  cpsc_recalls: BASE(
    `jsonb_set(r.detail, '{facts}', coalesce((select jsonb_agg(case when f->>0 = 'Source' then jsonb_build_array('Source', regexp_replace(f->>1, 'retrieved [0-9]{4}-[0-9]{2}-[0-9]{2}$', 'retrieved <date>')) else f end order by n) from jsonb_array_elements(case when jsonb_typeof(r.detail->'facts') = 'array' then r.detail->'facts' else '[]' end) with ordinality t(f, n)), '[]'::jsonb))`,
  ),
  openfda_drug_enforcement: BASE(openfdaDetail()),
  openfda_device_enforcement: BASE(openfdaDetail()),
  openfda_food_enforcement: BASE(openfdaDetail()),
  ftc_hsr: BASE("r.detail"),
};
/** Full stored row (insert-only parity): content, id and ordinal. */
export const FULL_ROW_SQL = `(${BASE("r.detail")} || jsonb_build_object('ordinal', r.ordinal))`;

/** The longest prefix shared by every key (factored out of the VALUES list to keep statements short). */
function commonPrefix(keys) {
  let p = keys[0] ?? "";
  for (const k of keys) while (!k.startsWith(p)) p = p.slice(0, -1);
  return p;
}

/** One SQL statement: per candidate (id, hash), is it new, unchanged or changed in the stored dataset? */
export function classificationSql(source, dataset, pairs, expr) {
  if (!pairs.length) return null;
  const prefix = commonPrefix(pairs.map(([id]) => id));
  const values = pairs.map(([id, h]) => `(${lit(id.slice(prefix.length))}, ${lit(h)})`).join(",");
  return `with v(k, h) as (values ${values}), c as (select ${lit(prefix)} || k as id, h from v),
s as (select r.id, left(md5((${expr})::text), 16) as h from public.corpus_records r where r.dataset = ${lit(dataset)} and r.id in (select id from c))
select ${lit(source)} as source, count(*) as candidates, count(*) filter (where s.id is null) as not_held,
  count(*) filter (where s.h = c.h) as identical, count(*) filter (where s.h <> c.h) as differs,
  (array_agg(c.id order by c.id) filter (where s.h <> c.h))[1:8] as sample_differs
from c left join s using (id);`;
}

/** Insert-only sources: which records read are already held (by match key), and which are new or older than the newest held day. */
export function presenceSql(source, dataset, column, keys, newestHeld) {
  if (!keys.length) return null;
  const prefix = commonPrefix(keys.map((k) => k.key));
  const values = keys
    .map(({ key, date }) => `(${lit(key.slice(prefix.length))}, ${date ? lit(date) : "null"})`)
    .join(",");
  return `with v(k, d) as (values ${values}), c as (select ${lit(prefix)} || k as k, d from v),
s as (select r.${column} as k from public.corpus_records r where r.dataset = ${lit(dataset)} and r.${column} in (select k from c))
select ${lit(source)} as source, count(*) as read, count(s.k) as already_held,
  count(*) filter (where s.k is null and c.d >= ${lit(newestHeld)}) as would_insert,
  count(*) filter (where s.k is null and c.d < ${lit(newestHeld)}) as late_not_held
from c left join s using (k);`;
}

export { jsonbHash };
