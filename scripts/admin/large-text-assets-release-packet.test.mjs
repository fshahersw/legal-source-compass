// Offline test for the large_text_assets release packet builder (selection rule mirrors the SQL contract).
// Run: node --test scripts/admin/large-text-assets-release-packet.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { buildPacket, decide, parseSurvey } from "./large-text-assets-release-packet.mjs";

const route = (present) => ({ route: "/api/text?id=x", object_key: "aa/x", bytes: 1, ready: false, object_present: present });

test("olls.info stays held under the statute source rule even with its text present", () => {
  assert.equal(decide({ host: "olls.info", routes: [route(true), route(true)] }).rule, "statute_source_official_publisher_only");
});

test("an official row is released only when every reader route has its stored object", () => {
  assert.equal(decide({ host: "www.ncleg.gov", routes: [route(true), route(true)] }).decision, "released");
  assert.equal(decide({ host: "www.ncleg.gov", routes: [route(true), route(false)] }).rule, "stored_text_missing");
  assert.equal(decide({ host: "www.ncleg.gov", routes: [] }).rule, "stored_text_missing");
});

test("parses a bare array and a tool result envelope, and totals by host", () => {
  const rows = [
    { id: "a", host: "olls.info", category: "statutes", utf8_bytes: 5, routes: [route(false)] },
    { id: "b", host: "gradycountyga.gov", category: "statutes", utf8_bytes: 7, routes: [route(true), route(true)] },
  ];
  const envelope = JSON.stringify({
    result: `x <untrusted-data-1>\n${JSON.stringify([{ survey: JSON.stringify(rows) }])}\n</untrusted-data-1> y`,
  });
  assert.deepEqual(parseSurvey(JSON.stringify(rows)), rows);
  assert.deepEqual(parseSurvey(envelope), rows);
  const { packet } = buildPacket(rows);
  assert.deepEqual(packet.totals.by_decision, { held: 1, released: 1 });
  assert.equal(packet.hosts["gradycountyga.gov"].objects_present, 2);
  assert.equal(packet.hosts["olls.info"].text_bytes, 5);
});
