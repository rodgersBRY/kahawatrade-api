import { describe, expect, it } from "vitest";
import { packagingWeight } from "../../src/modules/procurement/packaging.js";

describe("lot packaging", () => {
  it("includes pockets in total weight", () => {
    expect(packagingWeight(10, 60, 25)).toBe(625);
    expect(packagingWeight(10, 50, 12.345)).toBe(512.345);
    expect(packagingWeight(0, 60, 25)).toBe(25);
    expect(packagingWeight(10, 60, 0)).toBe(600);
  });
  it.each([[0, 60, 0], [-1, 60, 25], [1.5, 60, 0], [10, 60, -1], [10, 60, 60], [10, 50, 51], [10, 60, 0.0001]])("rejects invalid packaging %j", (bags, size, pocket) => {
    expect(() => packagingWeight(bags, size, pocket)).toThrow();
  });
});
