import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./rest.server", () => ({ restGet: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (handler: unknown) => handler,
    inputValidator: () => ({ handler: (handler: unknown) => handler }),
  }),
}));

import { restGet } from "./rest.server";
import {
  getCompanyDocuments,
  getCompanyStatements,
  getDocumentText,
} from "./companyStatements.functions";
import type { IrDocument, StatementsProfile } from "@/components/companies/companyStatements";

const mocked = vi.mocked(restGet);
const statementsFn = getCompanyStatements as unknown as (a: {
  data: { cik: string };
}) => Promise<StatementsProfile | null>;
const documentsFn = getCompanyDocuments as unknown as (a: {
  data: { cik: string };
}) => Promise<IrDocument[]>;
const textFn = getDocumentText as unknown as (a: {
  data: { id: string };
}) => Promise<{ id: string; text: string } | null>;

const doc = (cik: string, accn: string, date: string, exhibit = "EX99.1") => ({
  id: `${cik}:${accn}:${exhibit}:abcdef`,
  profile: {
    cik,
    accn,
    date,
    form: "8-K",
    exhibit: exhibit.replace("EX99", "EX-99"),
    doc_type: "earnings_release",
    url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accn.replace(/-/g, "")}/ex991.htm`,
  },
});

beforeEach(() => mocked.mockReset());

describe("company statements server functions", () => {
  it("reads one statements profile by CIK and caches it", async () => {
    mocked.mockResolvedValue({
      rows: [{ profile: { cik: "0000000011", name: "Example Co", statements: null } }] as never,
      total: null,
    });
    const first = await statementsFn({ data: { cik: "0000000011" } });
    const second = await statementsFn({ data: { cik: "0000000011" } });
    expect(first?.name).toBe("Example Co");
    expect(second).toBe(first);
    expect(mocked).toHaveBeenCalledTimes(1);
    expect(mocked.mock.calls[0]![0]).toContain(
      "dataset=eq.company_sec_statements&id=eq.0000000011",
    );
  });

  it("returns null when no record is published", async () => {
    mocked.mockResolvedValue({ rows: [] as never, total: null });
    expect(await statementsFn({ data: { cik: "0000000012" } })).toBeNull();
  });

  it("lists only the registrant's valid documents, newest first", async () => {
    mocked.mockResolvedValue({
      rows: [
        doc("0000000013", "0000000013-24-000001", "2024-02-01"),
        doc("0000000013", "0000000013-26-000002", "2026-02-01"),
        doc("0000000099", "0000000099-26-000003", "2026-03-01"),
        { id: "bad", profile: {} },
      ] as never,
      total: null,
    });
    const docs = await documentsFn({ data: { cik: "0000000013" } });
    expect(docs.map((d) => d.date)).toEqual(["2026-02-01", "2024-02-01"]);
    expect(mocked.mock.calls[0]![0]).toContain("id=like.0000000013:*");
  });

  it("reads one document's text by its id", async () => {
    const id = "0000000013:0000000013-26-000002:EX99.1:abcdef";
    mocked.mockResolvedValue({
      rows: [{ id, text: "Results for the quarter" }] as never,
      total: null,
    });
    expect(await textFn({ data: { id } })).toEqual({ id, text: "Results for the quarter" });
    expect(mocked.mock.calls[0]![0]).toContain(`id=eq.${encodeURIComponent(id)}`);
    mocked.mockResolvedValue({ rows: [{ id, text: null }] as never, total: null });
    expect(await textFn({ data: { id } })).toBeNull();
  });
});
