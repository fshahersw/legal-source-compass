import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseFacts } from "./layer";
import { clearLayerCache, readLayer, UNAVAILABLE } from "./layer.server";

describe("readLayer", () => {
  beforeEach(() => clearLayerCache());

  it("reports a missing RPC as unavailable and does not cache it", async () => {
    const call = vi.fn().mockResolvedValue(null);
    expect(await readLayer("insights_latest_v1", { p_metric: "x" }, parseFacts, { call })).toEqual({
      status: "unavailable",
      message: UNAVAILABLE,
    });
    await readLayer("insights_latest_v1", { p_metric: "x" }, parseFacts, { call });
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("parses and memoizes a successful answer per input for the read window", async () => {
    let t = 0;
    const call = vi.fn().mockResolvedValue([]);
    const now = () => t;
    await readLayer("insights_catalog_v1", {}, (r) => r, { call, now });
    await readLayer("insights_catalog_v1", {}, (r) => r, { call, now });
    expect(call).toHaveBeenCalledTimes(1);
    await readLayer("insights_snapshot_v1", { p_period: "2024" }, (r) => r, { call, now });
    expect(call).toHaveBeenCalledTimes(2);
    t = 11 * 60 * 1000;
    await readLayer("insights_catalog_v1", {}, (r) => r, { call, now });
    expect(call).toHaveBeenCalledTimes(3);
  });

  it("lets a failed read throw without caching it", async () => {
    const call = vi
      .fn()
      .mockRejectedValueOnce(new Error("External corpus read failed (500)."))
      .mockResolvedValue([]);
    await expect(readLayer("insights_catalog_v1", {}, (r) => r, { call })).rejects.toThrow(/500/);
    expect(await readLayer("insights_catalog_v1", {}, (r) => r, { call })).toEqual({
      status: "ok",
      data: [],
    });
  });
});
