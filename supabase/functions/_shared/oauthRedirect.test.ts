import { describe, expect, it } from "vitest";
import { oauthStateExpiresAt, peekOAuthState, signOAuthState, verifyOAuthState } from "./crypto.ts";
import { buildBackupOAuthRedirect } from "./oauthRedirect.ts";

describe("buildBackupOAuthRedirect", () => {
  it("builds a workspace settings URL when workspaceId is known", () => {
    expect(
      buildBackupOAuthRedirect({
        appUrl: "https://app.example.com",
        workspaceId: "ws-12345678",
        locale: "ru",
        error: "invalid_state",
      }),
    ).toBe("https://app.example.com/ru/ws-12345678/settings?tab=backups&error=invalid_state");
  });

  it("falls back to ws/locale query params", () => {
    expect(
      buildBackupOAuthRedirect({
        appUrl: "https://app.example.com",
        ws: "ws-abcdef01",
        localeParam: "ro",
        error: "oauth",
      }),
    ).toBe("https://app.example.com/ro/ws-abcdef01/settings?tab=backups&error=oauth");
  });

  it("falls back to the app root when workspace is unknown", () => {
    expect(
      buildBackupOAuthRedirect({
        appUrl: "https://app.example.com",
        error: "oauth",
      }),
    ).toBe("https://app.example.com/?error=oauth");
  });

  it("builds a connected success URL", () => {
    expect(
      buildBackupOAuthRedirect({
        appUrl: "https://app.example.com/",
        workspaceId: "ws-12345678",
        locale: "en",
        connected: "google",
      }),
    ).toBe("https://app.example.com/en/ws-12345678/settings?tab=backups&connected=google");
  });
});

describe("peekOAuthState for expired redirects", () => {
  it("returns workspace/locale from an expired but signed state", async () => {
    const secret = "redirect-secret";
    const now = Date.UTC(2026, 10, 7, 12, 0, 0);
    const state = await signOAuthState(
      {
        workspaceId: "ws-12345678",
        userId: "user-1",
        exp: oauthStateExpiresAt(now - 20 * 60_000, 10),
        nonce: "n1",
        locale: "ru",
      },
      secret,
    );
    await expect(verifyOAuthState(state, secret, now)).resolves.toBeNull();
    await expect(peekOAuthState(state, secret)).resolves.toMatchObject({
      workspaceId: "ws-12345678",
      locale: "ru",
    });
  });
});
