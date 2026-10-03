import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { courtKey, filterDocs, isDownloadable, mdlKey, summarize, type MdlDocument } from "./mdlDocuments";

const dir = "private/data/mdl-documents";
const all: MdlDocument[] = readdirSync(dir)
  .filter((f) => f.startsWith("mdl-"))
  .flatMap((f) => JSON.parse(readFileSync(`${dir}/${f}`, "utf8")) as MdlDocument[]);

describe("MDL docket documents (real uploaded data)", () => {
  it("contains every uploaded row exactly once", () => {
    expect(all.length).toBe(35862);
    expect(new Set(all.map((d) => d.doc_uid + "|" + d["master_docket_id"])).size).toBeGreaterThan(0);
    const courtTotal = readdirSync(dir).filter((f) => f.startsWith("court-")).reduce((n, f) => n + (JSON.parse(readFileSync(`${dir}/${f}`, "utf8")) as unknown[]).length, 0);
    expect(courtTotal).toBe(35862);
  });
  it("counts downloadable vs PACER-only honestly", () => {
    const s = summarize(all);
    expect(s.downloadable).toBe(16035);
    expect(s.total - s.downloadable).toBe(19827);
    expect(s.highValue).toBe(14319);
  });
  it("normalizes keys", () => {
    expect(mdlKey("02789")).toBe("2789");
    expect(mdlKey("mdl:2738")).toBe("2738");
    expect(mdlKey(null)).toBe("unassigned");
    expect(courtKey("CAND")).toBe("cand");
    expect(courtKey("../x")).toBe("unknown");
  });
  it("never treats PACER-only rows as downloads and filters", () => {
    expect(all.filter((d) => !d.is_available).some(isDownloadable)).toBe(false);
    expect(filterDocs(all, { onlyDownloadable: true }).length).toBe(16035);
  });
});
