import { describe, expect, it } from "vitest";
import { profileDisplayName, profileInitials } from "./profileName";

describe("profile display name", () => {
  it("uses the saved full name", () => {
    expect(profileDisplayName("Maria Pop", "Owner")).toBe("Maria Pop");
  });

  it("falls back to the signup name when the profile name is empty", () => {
    expect(profileDisplayName("  ", "Owner")).toBe("Owner");
    expect(profileDisplayName(null, null)).toBe("User");
  });

  it("builds initials from the first and last name", () => {
    expect(profileInitials("Maria Pop")).toBe("MP");
    expect(profileInitials("Ada")).toBe("A");
    expect(profileInitials("   ")).toBe("U");
  });
});
