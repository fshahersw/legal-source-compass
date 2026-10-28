/**
 * Daily share prices of the SEC registrants on the company pages, as a self-updating source (ingest/1):
 * company_price_history, one row per registrant (`px:<CIK>`).
 *
 *   - Targets: the registrants of company_sec_statements with a ticker and an exchange in their SEC profile (the first
 *     ticker is the listed common stock).
 *   - Prices: ten years of daily closes from a public market-data chart endpoint (no key; owner decision 2026-10-28,
 *     see AGENTS.md: the provider is not named in UI text or published data). Closes are split-adjusted as the endpoint
 *     serves them; dividends are not added back. A trading day still in session is left out, so every stored point is
 *     a finished close. The response must name the same symbol and an equity instrument, or the company is held.
 *   - The row's source_url is the listing exchange's quote page for the ticker (NYSE, Nasdaq, OTC Markets), where a
 *     reader can check any close; for other venues the SEC filing index that states the ticker and exchange.
 *   - Nothing is computed into the row except the facts restated from the points (latest close, its date, the close a
 *     year earlier and the change between them, the range of the last 52 weeks).
 *   - Rotation: PER_RUN registrants a run, stalest first (by the cursor's visit times), every three hours.
 */
import { BudgetExhausted, RateLimited } from "../http.ts";
import { corpusRecord } from "../rows.ts";
import type {
  CollectContext,
  Collected,
  CorpusRow,
  HeldRecord,
  Json,
  JsonObject,
  RowContent,
  SourceAdapter,
} from "../types.ts";

export const PRICE_DATASET = "company_price_history";
const PER_RUN = 46;
const DAY = 86_400_000;
/** Browser-style agent: the chart endpoint refuses generic clients with HTTP 429. */
const AGENT = "Mozilla/5.0 (compatible; LegalSourceAtlas/1.0; scheduled public-data refresh)";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export const chartUrl = (ticker: string) =>
  `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=10y&interval=1d&events=split`;

/** The ticker as the chart endpoint writes it (class shares with a hyphen: BRK.B and BRK/B → BRK-B). */
export function chartTicker(ticker: string): string {
  return ticker.trim().toUpperCase().replace(/[./]/g, "-");
}

/** The listing exchange's public quote page for a ticker; null for venues without a stable public page. */
export function listingUrl(exchange: string, ticker: string): string | null {
  const t = ticker.toUpperCase();
  const e = exchange.toUpperCase();
  if (e === "NYSE" || e === "NYSE AMERICAN" || e === "NYSE ARCA")
    return `https://www.nyse.com/quote/XNYS:${encodeURIComponent(t.replace("-", "."))}`;
  if (e.startsWith("NASDAQ"))
    return `https://www.nasdaq.com/market-activity/stocks/${encodeURIComponent(t.toLowerCase())}`;
  if (e === "OTC" || e.startsWith("OTC"))
    return `https://www.otcmarkets.com/stock/${encodeURIComponent(t)}/overview`;
  return null;
}

export type PricePoint = [string, number];

export type ParsedChart = {
  symbol: string;
  /** The company name the endpoint gives for the symbol (long name, else short name). */
  name: string | null;
  currency: string;
  exchange: string | null;
  points: PricePoint[];
  splits: { date: string; ratio: string }[];
};

/**
 * The finished daily closes of one chart response, oldest first: dates in the exchange's own time zone (the response's
 * gmtoffset), null closes dropped, one point per date, and the current day left out while its session is open.
 * Null when the response is not a chart for `ticker` of an equity instrument.
 */
export function parseChart(json: unknown, ticker: string, nowMs: number): ParsedChart | null {
  if (!isObj(json) || !isObj(json["chart"])) return null;
  const result = (json["chart"] as Obj)["result"];
  if (!Array.isArray(result) || !isObj(result[0])) return null;
  const r = result[0] as Obj;
  const meta = isObj(r["meta"]) ? (r["meta"] as Obj) : null;
  if (!meta) return null;
  const symbol = str(meta["symbol"]);
  if (!symbol || symbol.toUpperCase() !== ticker.toUpperCase()) return null;
  const kind = str(meta["instrumentType"]);
  if (kind && kind !== "EQUITY") return null;
  const offset = num(meta["gmtoffset"]) ?? 0;
  const ts = Array.isArray(r["timestamp"]) ? (r["timestamp"] as unknown[]) : [];
  const ind = isObj(r["indicators"]) ? (r["indicators"] as Obj) : {};
  const quote =
    Array.isArray(ind["quote"]) && isObj(ind["quote"][0]) ? (ind["quote"][0] as Obj) : {};
  const close = Array.isArray(quote["close"]) ? (quote["close"] as unknown[]) : [];
  const period = isObj(meta["currentTradingPeriod"]) ? (meta["currentTradingPeriod"] as Obj) : {};
  const regular = isObj(period["regular"]) ? (period["regular"] as Obj) : {};
  const sessionStart = num(regular["start"]);
  const sessionEnd = num(regular["end"]);
  const open = sessionStart !== null && sessionEnd !== null && nowMs / 1000 < sessionEnd;
  const openDate =
    open && sessionStart !== null
      ? new Date((sessionStart + offset) * 1000).toISOString().slice(0, 10)
      : null;
  const byDate = new Map<string, number>();
  for (let i = 0; i < ts.length; i++) {
    const t = num(ts[i]);
    const c = num(close[i]);
    if (t === null || c === null || c <= 0) continue;
    const date = new Date((t + offset) * 1000).toISOString().slice(0, 10);
    if (date === openDate) continue;
    byDate.set(date, Math.round(c * 10_000) / 10_000);
  }
  const points = [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])) as PricePoint[];
  const ev = isObj(r["events"]) ? (r["events"] as Obj) : {};
  const splitsObj = isObj(ev["splits"]) ? (ev["splits"] as Obj) : {};
  const splits = Object.values(splitsObj)
    .flatMap((s) => {
      if (!isObj(s)) return [];
      const d = num(s["date"]);
      const ratio = str(s["splitRatio"]);
      return d !== null && ratio
        ? [{ date: new Date((d + offset) * 1000).toISOString().slice(0, 10), ratio }]
        : [];
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  return {
    symbol: symbol.toUpperCase(),
    name: str(meta["longName"]) ?? str(meta["shortName"]),
    currency: str(meta["currency"]) ?? "USD",
    exchange: str(meta["fullExchangeName"]),
    points,
    splits,
  };
}

/** The latest close on or before `date` (points oldest first), or null. */
export function closeOnOrBefore(points: readonly PricePoint[], date: string): PricePoint | null {
  let lo = 0;
  let hi = points.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid]![0] <= date) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found >= 0 ? points[found]! : null;
}

export type PriceFacts = {
  last: PricePoint;
  yearAgo: PricePoint | null;
  change1y: number | null;
  high52: PricePoint;
  low52: PricePoint;
};

/** Facts restated from the points: latest close, the close a year before it, the 52-week high and low. */
export function priceFacts(points: readonly PricePoint[]): PriceFacts | null {
  const last = points[points.length - 1];
  if (!last) return null;
  const yearBefore = new Date(Date.parse(`${last[0]}T00:00:00Z`) - 365 * DAY)
    .toISOString()
    .slice(0, 10);
  const yearAgo = closeOnOrBefore(points, yearBefore);
  const window = points.filter((p) => p[0] > yearBefore);
  let high52 = last;
  let low52 = last;
  for (const p of window) {
    if (p[1] > high52[1]) high52 = p;
    if (p[1] < low52[1]) low52 = p;
  }
  const change1y =
    yearAgo && yearAgo[1] > 0 ? Math.round((last[1] / yearAgo[1] - 1) * 10_000) / 100 : null;
  return { last, yearAgo, change1y, high52, low52 };
}

export type PriceTarget = {
  cik: string;
  name: string;
  ticker: string;
  exchange: string;
};

const money = (v: number, currency: string) =>
  `${currency === "USD" ? "$" : ""}${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${currency === "USD" ? "" : ` ${currency}`}`;

export function priceRow(t: PriceTarget, chart: ParsedChart, retrieved: string): CorpusRow | null {
  const f = priceFacts(chart.points);
  if (!f) return null;
  const listing = listingUrl(t.exchange, t.ticker);
  const secIndex = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${t.cik}&type=10-K`;
  const cur = chart.currency;
  return corpusRecord(PRICE_DATASET, `px:${t.cik}`, `${t.name}: daily share price (${t.ticker})`, {
    source_url: listing ?? secIndex,
    subtitle: `${t.ticker} · ${t.exchange} · close ${money(f.last[1], cur)} on ${f.last[0]}`,
    cells: {
      company: t.name,
      ticker: t.ticker,
      exchange: t.exchange,
      last_close: f.last[1],
      as_of: f.last[0],
      change_1y_pct: f.change1y,
      points: chart.points.length,
    },
    facts: [
      ["Company", t.name],
      ["Ticker and exchange", `${t.ticker} on ${t.exchange} (as stated in SEC filings)`],
      ["Latest close", `${money(f.last[1], cur)} on ${f.last[0]}`],
      [
        "A year earlier",
        f.yearAgo
          ? `${money(f.yearAgo[1], cur)} on ${f.yearAgo[0]} (${f.change1y !== null && f.change1y >= 0 ? "+" : ""}${f.change1y}%)`
          : "Not recorded",
      ],
      [
        "52-week range",
        `${money(f.low52[1], cur)} (${f.low52[0]}) to ${money(f.high52[1], cur)} (${f.high52[0]})`,
      ],
      [
        "Meaning",
        "Daily closing prices of the listed common stock, adjusted for stock splits; dividends are not added back. A trading day still in session is not included.",
      ],
      ["Retrieved", retrieved],
    ],
    text: `${t.cik} ${t.name} ${t.ticker} share price stock price`,
    filters: { company: [t.cik] },
    links: [
      ...(listing ? [{ label: `${t.exchange} quote page`, url: listing }] : []),
      { label: "SEC filings", url: secIndex },
      { label: "Company profile", url: `/companies/${t.cik}` },
    ],
    extra: {
      prices: {
        ticker: t.ticker,
        exchange: t.exchange,
        currency: cur,
        adjusted: "splits",
        first: chart.points[0]![0],
        last: f.last[0],
        splits: chart.splits,
        points: chart.points,
      } as unknown as JsonObject,
    },
  });
}

/** Change detection ignores the retrieval date (an unchanged price history never rewrites a row). */
export function comparablePrice(content: RowContent): Json {
  const facts = (Array.isArray(content.detail["facts"]) ? content.detail["facts"] : []).filter(
    (f) => !(Array.isArray(f) && f[0] === "Retrieved"),
  );
  return {
    ...(content as unknown as JsonObject),
    detail: { ...content.detail, facts },
  } as unknown as Json;
}

const PREFERRED = /([-.]P[A-Z]?|[-.]PR[A-Z]?)$/i;

const NAME_NOISE =
  /\b(the|inc|incorporated|corp|corporation|co|company|companies|ltd|limited|plc|llc|lp|sa|nv|ag|se|holdings?|group|and)\b/g;

/** Significant words of a company name (case, punctuation and legal-form words removed). */
export function nameWords(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(NAME_NOISE, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

/**
 * Whether the endpoint's name for the symbol is the registrant: the first significant word of either name appears in
 * the other. A reused or reassigned ticker (another company under the same symbol) fails and the company is held.
 * An endpoint without a name passes (the symbol check already applied).
 */
export function sameCompany(secName: string, endpointName: string | null): boolean {
  if (!endpointName) return true;
  const a = nameWords(secName);
  const b = nameWords(endpointName);
  if (!a.length || !b.length) return true;
  return b.includes(a[0]!) || a.includes(b[0]!);
}

/** Registrants with a ticker and exchange in company_sec_statements (first common-stock ticker and its exchange). */
export async function readPriceTargets(ctx: CollectContext): Promise<PriceTarget[]> {
  const rows = await ctx.corpus.query(
    "corpus_records?select=id,n:item->profile->>name,t:item->profile->tickers,e:item->profile->exchanges" +
      "&dataset=eq.company_sec_statements&order=id.asc&limit=1000",
  );
  return rows.flatMap((r) => {
    const cik = String(r["id"] ?? "");
    const tickers = Array.isArray(r["t"]) ? (r["t"] as unknown[]) : [];
    const exchanges = Array.isArray(r["e"]) ? (r["e"] as unknown[]) : [];
    // the listed common stock: the first ticker that is not a preferred series (CTA-PB, XYZ.PRA, ABC-P)
    const pick = tickers.findIndex((x) => {
      const t = str(x);
      return !!t && !PREFERRED.test(t);
    });
    const ticker = pick >= 0 ? str(tickers[pick]) : null;
    const exchange = str(exchanges[pick] ?? exchanges[0]);
    if (!/^\d{10}$/.test(cik) || !ticker || !exchange) return [];
    if (!/^[A-Za-z0-9.\-/]{1,12}$/.test(ticker)) return [];
    return [{ cik, name: str(r["n"]) ?? cik, ticker: ticker.toUpperCase(), exchange }];
  });
}

/** Targets in visiting order: never visited first, then the longest since the last visit; ties by CIK. */
export function rotation(
  targets: readonly PriceTarget[],
  visited: Record<string, string>,
): PriceTarget[] {
  return [...targets].sort(
    (a, b) =>
      (visited[a.cik] ?? "").localeCompare(visited[b.cik] ?? "") || a.cik.localeCompare(b.cik),
  );
}

export const companyPrices: SourceAdapter = {
  source: "company_price_history",
  dataset: PRICE_DATASET,
  mode: "upsert",
  ordinalPolicy: "append",
  functionName: "ingest-company-ir",
  limits: { maxRequests: PER_RUN + 2, minIntervalMs: 400 },
  secrets: [],

  async collect(ctx): Promise<Collected> {
    const cursor = isObj(ctx.cursor) ? (ctx.cursor as Obj) : {};
    const visited: Record<string, string> = {};
    if (isObj(cursor["visited"]))
      for (const [k, v] of Object.entries(cursor["visited"] as Obj))
        if (/^\d{10}$/.test(k) && typeof v === "string") visited[k] = v;
    const retrieved = ctx.now.toISOString().slice(0, 10);
    const targets = await readPriceTargets(ctx);
    const order = rotation(targets, visited);
    const rows: CorpusRow[] = [];
    const held: HeldRecord[] = [];
    let fetched = 0;
    let complete = true;
    const notes: JsonObject = { targets: targets.length };
    try {
      for (const t of order.slice(0, PER_RUN)) {
        const symbol = chartTicker(t.ticker);
        const res = await ctx.http.getText(chartUrl(symbol), { headers: { "User-Agent": AGENT } });
        visited[t.cik] = ctx.now.toISOString();
        fetched++;
        if (res.status === 404) {
          held.push({ key: t.cik, reason: "ticker not found by the price endpoint" });
          continue;
        }
        if (res.status !== 200) {
          held.push({ key: t.cik, reason: `price endpoint HTTP ${res.status}` });
          continue;
        }
        let json: unknown;
        try {
          json = JSON.parse(res.text);
        } catch {
          held.push({ key: t.cik, reason: "price response is not JSON" });
          continue;
        }
        const chart = parseChart(json, symbol, ctx.now.getTime());
        if (!chart) {
          held.push({ key: t.cik, reason: "price response is not this ticker's equity chart" });
          continue;
        }
        if (!sameCompany(t.name, chart.name)) {
          held.push({ key: t.cik, reason: "price endpoint names another company for this ticker" });
          continue;
        }
        if (chart.points.length < 20) {
          held.push({ key: t.cik, reason: "fewer than 20 finished closes" });
          continue;
        }
        const row = priceRow({ ...t, ticker: symbol }, chart, retrieved);
        if (row) rows.push(row);
      }
    } catch (error) {
      if (error instanceof BudgetExhausted || error instanceof RateLimited) {
        complete = false;
        notes["stopped"] = error.message;
      } else throw error;
    }
    notes["visited"] = fetched;
    return {
      rows,
      fetched,
      held,
      cursorAfter: { visited } as unknown as Json,
      complete,
      notes,
    };
  },

  comparable: comparablePrice,
};
