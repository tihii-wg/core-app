import { describe, expect, it } from "vitest";
import { phoneDigits, phoneMatchesQuery, phoneSearchVariants } from "./phoneSearch";

describe("phoneDigits", () => {
  it("strips spaces, plus, and separators", () => {
    expect(phoneDigits("+373 69 123 456")).toBe("37369123456");
    expect(phoneDigits("069-123-456")).toBe("069123456");
  });
});

describe("phoneSearchVariants", () => {
  it("maps MD local and international forms", () => {
    expect(phoneSearchVariants("069123456")).toEqual(
      expect.arrayContaining(["069123456", "37369123456", "69123456"]),
    );
    expect(phoneSearchVariants("37369123456")).toEqual(
      expect.arrayContaining(["37369123456", "69123456", "069123456"]),
    );
  });

  it("ignores very short digit sequences", () => {
    expect(phoneSearchVariants("12")).toEqual([]);
  });
});

describe("phoneMatchesQuery", () => {
  it("matches full, partial, and differently formatted numbers", () => {
    const stored = "+37369123456";
    expect(phoneMatchesQuery(stored, "+37369123456")).toBe(true);
    expect(phoneMatchesQuery(stored, "373 69 123 456")).toBe(true);
    expect(phoneMatchesQuery(stored, "069123456")).toBe(true);
    expect(phoneMatchesQuery(stored, "123456")).toBe(true);
    expect(phoneMatchesQuery(stored, "999999")).toBe(false);
  });
});
