import assert from "node:assert/strict";
import test from "node:test";
import { isOpenUsLawArtifactRow, validateOpenUsLawStoragePlan } from "./remove-openus-bulk-storage-20261006.mjs";

test("open us law artifact scope matches bulk parquet and oul text routes", () => {
  assert.equal(
    isOpenUsLawArtifactRow({
      route: "/bulk-files/us_ca_statutes.parquet",
      object_key: "0c/abc",
      ready: false,
    }),
    true,
  );
  assert.equal(
    isOpenUsLawArtifactRow({
      route: "/api/text?id=oul:abc",
      object_key: "0a/def",
      ready: false,
    }),
    true,
  );
  assert.equal(
    isOpenUsLawArtifactRow({
      route: "/agency-files/openfda-drug-drugsfda",
      object_key: "0f/abc",
      ready: false,
    }),
    false,
  );
});

test("plan rejects wrong export manifest pin", () => {
  assert.throws(
    () =>
      validateOpenUsLawStoragePlan({
        schema: "owner-openus-bulk-storage-removal/v1",
        project: "xosqzzsnhxcyehcnirpa",
        bucket: "corpus-originals",
        export_manifest_sha256: "0".repeat(64),
        export_manifest_key: "open-us-law-removal-2026-10-06/manifest.json",
        export_record_rows: 2_968_623,
        storage_objects: [],
        artifact_rows: [],
        totals: { storage_objects: 0, storage_bytes: 0, artifact_rows: 0 },
      }),
    /PLAN_TARGET_INVALID/,
  );
});
