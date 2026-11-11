import { describe, expect, it } from "vitest";
import { normalizePlateVin, plateIlikeLoosePattern, plateMatchesQuery } from "./plateVin";

describe("normalizePlateVin", () => {
  it("uppercases, strips spaces/dashes, and maps Cyrillic look-alikes", () => {
    expect(normalizePlateVin("AB 123")).toBe("AB123");
    expect(normalizePlateVin("AB-123")).toBe("AB123");
    expect(normalizePlateVin("АВ 123")).toBe("AB123");
    expect(normalizePlateVin("с 001 кх")).toBe("C001KX");
    expect(normalizePlateVin("b123abc")).toBe("B123ABC");
  });
});

describe("plateMatchesQuery", () => {
  it("matches exact, partial, case, and spaced registration numbers", () => {
    expect(plateMatchesQuery("B 123 ABC", "B123ABC")).toBe(true);
    expect(plateMatchesQuery("B-123-ABC", "b123abc")).toBe(true);
    expect(plateMatchesQuery("B 123 ABC", "B 123")).toBe(true);
    expect(plateMatchesQuery("B 123 ABC", "999")).toBe(false);
  });
});

describe("plateIlikeLoosePattern", () => {
  it("inserts wildcards between normalized characters", () => {
    expect(plateIlikeLoosePattern("B123ABC")).toBe("%B%1%2%3%A%B%C%");
    expect(plateIlikeLoosePattern("")).toBe("");
  });
});
