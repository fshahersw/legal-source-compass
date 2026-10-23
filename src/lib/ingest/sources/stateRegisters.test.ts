import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  REGISTERS,
  cleanLabel,
  issueId,
  issueRow,
  longDate,
  sortRows,
  stateRegisters,
  type Issue,
} from "./stateRegisters.ts";
import type { CollectContext, CorpusRow, RequestRecord } from "../types.ts";

const FIX = JSON.parse(
  readFileSync(new URL("../fixtures/state-registers.json", import.meta.url), "utf8"),
) as { pages: Record<string, { url: string; anchors: string }> };

const parsed = (st: string): Issue[] => {
  const src = REGISTERS.find((r) => r.state === st)!;
  return src.parse(FIX.pages[st]!.anchors, src.url);
};

describe("state register listings", () => {
  it("every configured listing has a fixture and yields issues", () => {
    for (const src of REGISTERS) {
      expect(FIX.pages[src.state]?.url, src.state).toBe(src.url);
      expect(parsed(src.state).length, src.state).toBeGreaterThan(0);
    }
  });

  it("reads dates, volumes and issues exactly as printed", () => {
    const tx = parsed("TX").find((i) => i.date === "2026-10-16")!;
    expect(tx).toMatchObject({ publication: "Texas Register", pages: "7091-7200", volume: null, issue: null });
    expect(tx.url).toBe("https://www.sos.texas.gov/texreg/pdf/backview/1016/index.shtml");
    const co = parsed("CO").find((i) => i.date === "2026-01-10")!;
    expect(co).toMatchObject({ volume: "49", issue: "1" });
    const md = parsed("MD").find((i) => i.volume === "53" && i.issue === "7")!;
    expect(md.date).toBe("2026-04-03");
    const mo = parsed("MO").find((i) => i.date === "2026-10-15")!;
    expect(mo).toMatchObject({ volume: "51", issue: "20" });
    const nm = parsed("NM").find((i) => i.issue === "20" && i.volume === "XXXVII")!;
    expect(nm.date).toBe("2026-10-20");
    const ny = parsed("NY").find((i) => i.date === "2026-10-21")!;
    expect(ny).toMatchObject({ volume: "XLVIII", issue: "42" });
    const mn = parsed("MN").find((i) => i.date === "2026-10-19")!;
    expect(mn.url).toMatch(/\.pdf$/);
    const or = parsed("OR").find((i) => i.period === "2026-01")!;
    expect(or.date).toBeNull();
    expect(or.url).not.toMatch(/JSESSIONID/);
    const ky = parsed("KY").find((i) => i.period === "2026-07")!;
    expect(ky.url).toMatch(/^https:\/\/apps\.legislature\.ky\.gov\/law\/kar\/registers\/.+\.pdf$/);
  });

  it("never guesses a date", () => {
    expect(longDate("Volume 53")).toBeNull();
    expect(longDate("October 41, 2026")).toBeNull();
    expect(cleanLabel("Volume 53 I​ssue 10​ &ndash; M​ay 15, 2026")).toBe("Volume 53 Issue 10 – May 15, 2026");
  });

  it("builds rows that match the ingest source id pattern and sorts newest first", () => {
    const pattern = /^[a-z]{2}-reg:[0-9]{4}-[0-9]{2}(-[0-9]{2})?(:[A-Za-z0-9.-]{1,24})?$/;
    const rows: CorpusRow[] = [];
    for (const src of REGISTERS)
      for (const i of parsed(src.state)) {
        const r = issueRow(i);
        if (r) rows.push(r);
      }
    expect(rows.length).toBeGreaterThan(100);
    for (const r of rows) {
      expect(r.id).toMatch(pattern);
      expect(r.category).toBe("state_register_issues");
      expect(r.source_url).toMatch(/^https:\/\//);
      expect(JSON.stringify(r)).not.toMatch(/Not recorded".*Not recorded".*Not recorded".*Not recorded".*Not recorded".*Not recorded".*Not recorded/);
    }
    const sorted = sortRows(rows);
    const when = (r: CorpusRow) => {
      const ri = r.item["register_issue"] as Record<string, string | null>;
      return ri["date"] ?? `${ri["period"]}-00`;
    };
    for (let k = 1; k < sorted.length; k++) expect(when(sorted[k - 1]!) >= when(sorted[k]!)).toBe(true);
    expect(issueId({ state: "OR", publication: "x", date: null, period: null, volume: null, issue: null, pages: null, label: "", url: "" })).toBeNull();
  });

  it("the ingest pattern in state-regs-v1.sql matches the one tested here", () => {
    const sql = readFileSync(new URL("../../../../database/contracts/state-regs-v1.sql", import.meta.url), "utf8");
    expect(sql).toContain("'^[a-z]{2}-reg:[0-9]{4}-[0-9]{2}(-[0-9]{2})?(:[A-Za-z0-9.-]{1,24})?$'");
    expect(sql).toContain("'ingest-state-registers'");
  });

  it("collect reads one page per state and reports a listing that yields nothing", async () => {
    const requests: RequestRecord[] = [];
    const ctx = {
      http: {
        requests,
        remaining: 20,
        async getText(url: string) {
          const st = REGISTERS.find((r) => r.url === url)!.state;
          const text = st === "KY" ? "<html>moved</html>" : FIX.pages[st]!.anchors;
          return { status: 200, text, record: { url, status: 200, bytes: text.length, sha256: "", retrieved_at: "" } };
        },
      },
      corpus: {} as CollectContext["corpus"],
      cursor: null,
      now: new Date("2026-10-23T12:00:00Z"),
      env: () => undefined,
    } as unknown as CollectContext;
    const out = await stateRegisters.collect(ctx);
    expect(out.complete).toBe(false);
    expect(out.notes["KY"]).toBe(0);
    expect(Number(out.notes["TX"])).toBeGreaterThan(3);
    expect(new Set(out.rows.map((r) => r.id)).size).toBe(out.rows.length);
  });
});
