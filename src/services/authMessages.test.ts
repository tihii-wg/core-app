import { describe, expect, it } from "vitest";
import { formatSetupKey, mfaVerifyMessage, passwordChangeMessage, sessionNeedsMfa, totpQrSrc } from "./authMessages";

describe("session MFA", () => {
  it("requires a code only when the next assurance level is higher", () => {
    expect(sessionNeedsMfa({ currentLevel: "aal1", nextLevel: "aal2" })).toBe(true);
    expect(sessionNeedsMfa({ currentLevel: "aal2", nextLevel: "aal2" })).toBe(false);
    expect(sessionNeedsMfa({ currentLevel: "aal1", nextLevel: "aal1" })).toBe(false);
    expect(sessionNeedsMfa(null)).toBe(false);
  });
});

describe("auth messages", () => {
  it("hides raw password errors", () => {
    expect(passwordChangeMessage("Invalid login credentials")).toBe("Current password is incorrect.");
    expect(passwordChangeMessage("something unexpected from the server")).toBe("Unable to change password. Please try again.");
  });

  it("hides raw verification errors", () => {
    expect(mfaVerifyMessage("Invalid TOTP code entered")).toBe("Invalid verification code.");
    expect(mfaVerifyMessage("Challenge expired")).toBe("The verification code expired. Enter the current code from your authenticator app.");
  });

  it("formats the authenticator setup key and QR source", () => {
    expect(formatSetupKey("ABCDEFGH12345678")).toBe("ABCD EFGH 1234 5678");
    expect(totpQrSrc("<svg></svg>")).toContain("data:image/svg+xml");
  });
});
