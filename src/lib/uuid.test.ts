import { describe, expect, it } from "vitest";
import { isUuid } from "./uuid";

describe("isUuid", () => {
  it("accepts canonical UUIDs", () => {
    expect(isUuid("22222222-2222-4222-8222-222222222222")).toBe(true);
    expect(isUuid("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
  });

  it("rejects empty, partial, and non-uuid strings", () => {
    expect(isUuid("")).toBe(false);
    expect(isUuid("  ")).toBe(false);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid("22222222-2222-4222-8222-22222222222")).toBe(false);
    expect(isUuid("550e8400-e29b-41d4-a716-44665544000g")).toBe(false);
    expect(isUuid(null)).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});
