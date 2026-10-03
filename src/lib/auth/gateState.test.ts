import { describe, expect, it } from "vitest";
import { isPublicAuthPath, probeFromSession, resolveAccess, safeRedirectPath } from "./gateState";

describe("client access gate state", () => {
  it("opens when the server reports enforcement off, with or without a browser session", () => {
    expect(resolveAccess({ kind: "open" }, { present: false, email: null })).toEqual({
      state: "open",
    });
    expect(resolveAccess({ kind: "open" }, { present: true, email: "a@example.test" })).toEqual({
      state: "open",
    });
  });

  it("admits only a server-verified account when enforcement is on", () => {
    expect(
      resolveAccess(
        { kind: "allowed", userId: "u1", email: "a@example.test" },
        { present: true, email: "a@example.test" },
      ),
    ).toEqual({
      state: "allowed",
      email: "a@example.test",
    });
  });

  it("shows sign-in without a session and an explanation for a refused session", () => {
    expect(resolveAccess({ kind: "rejected" }, { present: false, email: null })).toEqual({
      state: "signed-out",
    });
    expect(resolveAccess({ kind: "rejected" }, { present: true, email: "b@example.test" })).toEqual(
      {
        state: "denied",
        email: "b@example.test",
      },
    );
  });

  it("interprets the server probe payload and fails closed on anything unexpected", () => {
    expect(probeFromSession({ required: false, userId: null, email: null })).toEqual({
      kind: "open",
    });
    expect(probeFromSession({ required: true, userId: "u", email: "c@example.test" })).toEqual({
      kind: "allowed",
      userId: "u",
      email: "c@example.test",
    });
    expect(probeFromSession({ required: true, userId: 7, email: 5 })).toEqual({
      kind: "allowed",
      userId: null,
      email: null,
    });
    for (const bad of [null, undefined, "open", 1, {}, { required: "no" }, { required: null }]) {
      expect(probeFromSession(bad)).toEqual({ kind: "rejected" });
    }
  });

  it("keeps only the provider-facing auth pages outside the gate", () => {
    expect(isPublicAuthPath("/auth")).toBe(true);
    expect(isPublicAuthPath("/auth/")).toBe(true);
    expect(isPublicAuthPath("/reset-password")).toBe(true);
    expect(isPublicAuthPath("/auth/evil")).toBe(false);
    expect(isPublicAuthPath("/matters/3047")).toBe(false);
    expect(isPublicAuthPath("/")).toBe(false);
  });

  it("accepts only same-origin absolute paths as a redirect target", () => {
    expect(safeRedirectPath("/matters/3047?tab=docs#top")).toBe("/matters/3047?tab=docs#top");
    for (const bad of [
      undefined,
      null,
      "https://evil.example/x",
      "//evil.example",
      "/\\evil",
      "matters/3047",
      "/ok\nnext",
      "/auth",
      "/reset-password?x=1",
      "/" + "a".repeat(600),
    ]) {
      expect(safeRedirectPath(bad)).toBeUndefined();
    }
  });
});
