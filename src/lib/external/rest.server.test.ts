import { afterEach, expect, it, vi } from "vitest";
import { fetchArtifact } from "./rest.server";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("requires a ready artifact before reading private object storage", async () => {
  vi.stubEnv("EXTERNAL_SUPABASE_URL", "https://corpus.example");
  vi.stubEnv("EXTERNAL_SUPABASE_KEY", "sb_test_publication_gate");
  const request = vi
    .fn()
    .mockResolvedValue(new Response("[]", { headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", request);
  const result = await fetchArtifact("/held/item.pdf");
  expect(result.status).toBe(404);
  expect(request).toHaveBeenCalledTimes(1);
  const url = new URL(request.mock.calls[0]![0]);
  expect(url.searchParams.get("ready")).toBe("eq.true");
  expect(url.searchParams.get("route")).toBe("eq./held/item.pdf");
});
