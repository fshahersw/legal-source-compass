import { expect, it } from "vitest";
import { isObsoleteDataAsset } from "./legacyDataAssets";

it.each([
  "/data/atlas-import-bundle.json",
  "/data/registry_v06_1.jsonl?download=1",
  "/data/research/raw/original.csv",
  "/data/source.xlsx",
  "/data/source.txt",
  "/data/source.JsOn/",
  "/d%61ta/atlas-import-bundle%2ejson",
  "/data%2fatlas-import-bundle.json",
  "/data%5catlas-import-bundle.json",
  "/data/atlas-import-bundle%252ejson",
  "/data/atlas-import-bundle%2525252ejson",
  "/data/%ZZ.json",
  "/d%61ta/%ZZ",
])("rejects obsolete or ambiguously encoded dataset asset %s", (path) => {
  expect(isObsoleteDataAsset(`https://workspace.example${path}`)).toBe(true);
});

it.each([
  "/data",
  "/data/",
  "/data/mdls",
  "/data/cl_master_entries?f=example",
  "/data/tables/corpus_context",
  "/sources/library",
  "/api/bundles?file=source.json",
  "/data-other/source.json",
  "/assets/source.json",
  "/data/mdls?file=source.json",
])("preserves actual browser/API route %s", (path) => {
  expect(isObsoleteDataAsset(`https://workspace.example${path}`)).toBe(false);
});
