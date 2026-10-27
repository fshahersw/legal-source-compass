import test from "node:test";
import assert from "node:assert/strict";
import { mergeLedger } from "./shared-ledger.mjs";

test("request times merge into the shared ledger once, in order, keeping other fields", () => {
  const t1 = "2026-10-27T15:04:08.215Z";
  const t2 = "2026-10-27T15:04:31.049Z";
  const { ledger, added } = mergeLedger({ timestamps: [Date.parse(t2)], note: "kept" }, [
    t1,
    t2,
    t1,
    "not a date",
  ]);
  assert.equal(added, 1);
  assert.deepEqual(ledger.timestamps, [Date.parse(t1), Date.parse(t2)]);
  assert.equal(ledger.note, "kept");
  assert.deepEqual(mergeLedger(null, [t1]).ledger.timestamps, [Date.parse(t1)]);
});
