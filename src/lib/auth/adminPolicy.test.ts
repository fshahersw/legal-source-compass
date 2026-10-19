import { describe, expect, it } from "vitest";
import { isAdminUser } from "./accessPolicy";

const user = {
  id: "u1",
  email: "Owner@Example.com",
  email_confirmed_at: "2026-01-01T00:00:00Z",
  is_anonymous: false,
};

describe("administrator policy", () => {
  it("admits only a verified account on the server list", () => {
    expect(isAdminUser(user, { ADMIN_EMAILS: "someone@x.com, owner@example.com" })).toBe(true);
    expect(isAdminUser(user, { ADMIN_EMAILS: "someone@x.com" })).toBe(false);
  });
  it("has no administrators when the list is unset or the account is unverified", () => {
    expect(isAdminUser(user, {})).toBe(false);
    expect(isAdminUser(null, { ADMIN_EMAILS: "owner@example.com" })).toBe(false);
    expect(
      isAdminUser({ ...user, email_confirmed_at: null }, { ADMIN_EMAILS: "owner@example.com" }),
    ).toBe(false);
    expect(
      isAdminUser({ ...user, is_anonymous: true }, { ADMIN_EMAILS: "owner@example.com" }),
    ).toBe(false);
  });
});
