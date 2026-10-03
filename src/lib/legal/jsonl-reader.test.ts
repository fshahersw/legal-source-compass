import { describe, expect, it } from "vitest";
import { parseJsonLines } from "../../../scripts/legal/jsonl.ts";

describe("publisher JSONL transport", () => {
  it("preserves Unicode line and paragraph separators inside source titles across chunks", async () => {
    const expected = [{ title: 'NRC policy\u2028 with "quoted" text\u2029 and 😀' }, { title: "Next publication" }];
    const input = expected.map(r => JSON.stringify(r)).join("\r\n");
    async function* chunks() { for (let i = 0; i < input.length; i += 7) yield input.slice(i, i + 7); }
    const rows = []; for await (const row of parseJsonLines(chunks())) rows.push(row);
    expect(rows).toEqual(expected);
  });
  it("rejects a truncated source record instead of silently dropping it", async () => {
    async function* chunks() { yield '{"title":"unfinished'; }
    await expect(async () => { for await (const _row of parseJsonLines(chunks())) { /* consume validation */ } }).rejects.toThrow();
  });
});
