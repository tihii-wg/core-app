import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearPasswordRecoveryFlag,
  clearStalePasswordRecoveryMarker,
  confirmPasswordRecovery,
  ensurePasswordRecoveryCallbackPath,
  getConfirmedRecoveryUserId,
  isConfirmedRecoveryForUser,
  isExpiredRecoveryError,
  normalizeRecoveryLocale,
  passwordResetPath,
  passwordResetRedirectUrl,
  readAuthCallbackError,
  urlIndicatesPasswordRecovery,
} from "./passwordRecovery";
import { finishSignOut, isPublicAuthPath } from "./session";

describe("password recovery redirect URLs", () => {
  afterEach(() => {
    clearPasswordRecoveryFlag();
    window.history.replaceState({}, "", "/en/reset-password");
  });

  it("builds English / Romanian / Russian reset paths", () => {
    expect(passwordResetPath("en")).toBe("/en/reset-password");
    expect(passwordResetPath("ro")).toBe("/ro/reset-password");
    expect(passwordResetPath("ru")).toBe("/ru/reset-password");
    expect(normalizeRecoveryLocale("nope")).toBe("en");
  });

  it("builds absolute redirect URLs from the current origin (never root alone)", () => {
    const origin = window.location.origin;
    expect(passwordResetRedirectUrl("en")).toBe(`${origin}/en/reset-password`);
    expect(passwordResetRedirectUrl("ro")).toBe(`${origin}/ro/reset-password`);
    expect(passwordResetRedirectUrl("ru")).toBe(`${origin}/ru/reset-password`);
    expect(passwordResetRedirectUrl("en")).not.toBe(origin);
    expect(passwordResetRedirectUrl("en")).not.toBe(`${origin}/`);
  });

  it("uses the local development origin when present", () => {
    // jsdom origin is the test host; assert we always append the reset path on that origin.
    const url = passwordResetRedirectUrl("en");
    expect(url.startsWith(window.location.origin)).toBe(true);
    expect(url.endsWith("/en/reset-password")).toBe(true);
  });
});

describe("password recovery confirmation + callback bootstrap", () => {
  afterEach(() => {
    clearPasswordRecoveryFlag();
    window.history.replaceState({}, "", "/en/reset-password");
  });

  it("does not treat a recovery-looking URL as a confirmed recovery session", () => {
    window.history.replaceState({}, "", "/en/reset-password?code=pkce-code");
    expect(urlIndicatesPasswordRecovery()).toBe(true);
    expect(getConfirmedRecoveryUserId()).toBeNull();
    expect(isConfirmedRecoveryForUser("user-a")).toBe(false);
  });

  it("rewrites a Site-URL recovery callback from / onto /en/reset-password without dropping hash", () => {
    window.history.replaceState({}, "", "/#access_token=fake&type=recovery");
    expect(ensurePasswordRecoveryCallbackPath()).toBe(true);
    expect(window.location.pathname).toBe("/en/reset-password");
    expect(window.location.hash).toContain("type=recovery");
    // Still only a hint — not confirmation.
    expect(isConfirmedRecoveryForUser("user-a")).toBe(false);
  });

  it("does not rewrite non-recovery auth callbacks at root", () => {
    window.history.replaceState({}, "", "/#access_token=fake&type=signup");
    expect(ensurePasswordRecoveryCallbackPath()).toBe(false);
    expect(window.location.pathname).toBe("/");
  });

  it("confirms recovery only when bound to a user id (PASSWORD_RECOVERY)", () => {
    confirmPasswordRecovery("user-a");
    expect(getConfirmedRecoveryUserId()).toBe("user-a");
    expect(isConfirmedRecoveryForUser("user-a")).toBe(true);
    expect(isConfirmedRecoveryForUser("user-b")).toBe(false);
  });

  it("preserves confirmed recovery for the same user across a simulated refresh", () => {
    confirmPasswordRecovery("user-a");
    expect(clearStalePasswordRecoveryMarker("user-a")).toBe(false);
    expect(isConfirmedRecoveryForUser("user-a")).toBe(true);
  });

  it("rejects a stale marker when another user session is present", () => {
    confirmPasswordRecovery("user-a");
    expect(clearStalePasswordRecoveryMarker("user-b")).toBe(true);
    expect(getConfirmedRecoveryUserId()).toBeNull();
  });

  it("clears the marker on explicit cleanup (sign-out / leave recovery)", () => {
    confirmPasswordRecovery("user-a");
    clearPasswordRecoveryFlag();
    expect(getConfirmedRecoveryUserId()).toBeNull();
  });

  it("reads Auth callback errors without requiring tokens", () => {
    window.history.replaceState({}, "", "/en/reset-password#error=access_denied&error_code=otp_expired&error_description=Link+expired");
    expect(readAuthCallbackError()).toMatch(/expired/i);
    expect(isExpiredRecoveryError(readAuthCallbackError()!)).toBe(true);
  });

  it("keeps reset-password as a public auth path so success survives global sign-out navigation", () => {
    expect(isPublicAuthPath("/en/reset-password")).toBe(true);
    confirmPasswordRecovery("user-a");
    const navigate = vi.fn();
    const queryClient = { clear: vi.fn() } as never;
    window.history.replaceState({}, "", "/en/reset-password");
    finishSignOut(queryClient, navigate);
    expect(navigate).not.toHaveBeenCalled();
    expect(getConfirmedRecoveryUserId()).toBeNull();
  });
});
