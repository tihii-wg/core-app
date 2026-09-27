import { describe, expect, it } from "vitest";
import { workspaceInitials } from "./workspaceInitials";

describe("workspace initials", () => {
  it("uses the first letter of the first two words", () => {
    expect(workspaceInitials("My Company")).toBe("MC");
    expect(workspaceInitials("Acme Company")).toBe("AC");
    expect(workspaceInitials("Service Center")).toBe("SC");
  });

  it("uses the first two letters of a single word", () => {
    expect(workspaceInitials("FixFlow")).toBe("FF");
  });

  it("falls back when the name is empty", () => {
    expect(workspaceInitials("   ")).toBe("C");
  });
});
