import { afterEach, describe, expect, it, vi } from "vitest";
import { hashPassword, validatePasswordStrength, verifyPasswordHash } from "../../src/common/security/password.js";

afterEach(() => vi.unstubAllEnvs());

describe("password strength", () => {
  it("allows a simple development password while still verifying its hash", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const hash = await hashPassword("simplepassword");
    expect(await verifyPasswordHash(hash, "simplepassword")).toBe(true);
    expect(await verifyPasswordHash(hash, "wrongpassword")).toBe(false);
  });

  it.each(["production", "test", ""])("enforces complexity in %s", (nodeEnv) => {
    vi.stubEnv("NODE_ENV", nodeEnv);
    expect(() => validatePasswordStrength("simplepassword")).toThrow(
      "Password must include uppercase, lowercase, number, and special character",
    );
    expect(() => validatePasswordStrength("StrongPassword123!")).not.toThrow();
  });

  it("allows short development passwords but rejects empty passwords", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(() => validatePasswordStrength("short")).not.toThrow();
    expect(() => validatePasswordStrength("")).toThrow(
      "Password must be at least 12 characters long",
    );
  });
});
