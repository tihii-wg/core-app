import { describe, expect, it } from "vitest";
import { buildPhotosOAuthRedirect } from "./photosOAuthRedirect.ts";

describe("buildPhotosOAuthRedirect", () => {
  it("builds settings storage URL with gdrive flag", () => {
    expect(
      buildPhotosOAuthRedirect({
        appUrl: "https://app.example.com",
        gdrive: "connected",
        workspaceId: "pundggjzzaqzbvykbxvo",
        locale: "ru",
      }),
    ).toBe("https://app.example.com/ru/pundggjzzaqzbvykbxvo/settings?tab=storage&gdrive=connected");
  });

  it("includes error reason", () => {
    const url = buildPhotosOAuthRedirect({
      appUrl: "https://app.example.com",
      gdrive: "error",
      reason: "token",
      workspaceId: "ws-12345678",
      locale: "en",
    });
    expect(url).toContain("tab=storage");
    expect(url).toContain("gdrive=error");
    expect(url).toContain("reason=token");
  });
});
