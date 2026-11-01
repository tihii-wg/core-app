import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearPasswordRecoveryFlag, confirmPasswordRecovery } from "../features/auth/passwordRecovery";

const getSession = vi.fn();
const updateUser = vi.fn();
const signOut = vi.fn();
const resetPasswordForEmail = vi.fn();

vi.mock("./supabase", () => ({
  default: {
    auth: {
      getSession: (...args: unknown[]) => getSession(...args),
      updateUser: (...args: unknown[]) => updateUser(...args),
      signOut: (...args: unknown[]) => signOut(...args),
      resetPasswordForEmail: (...args: unknown[]) => resetPasswordForEmail(...args),
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      getUser: vi.fn(),
      mfa: {
        getAuthenticatorAssuranceLevel: vi.fn(),
        listFactors: vi.fn(),
      },
    },
  },
}));

describe("requestPasswordReset redirectTo", () => {
  beforeEach(() => {
    clearPasswordRecoveryFlag();
    resetPasswordForEmail.mockReset();
    resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
  });

  afterEach(() => {
    clearPasswordRecoveryFlag();
  });

  it("passes an explicit localized redirectTo (never the site root)", async () => {
    const { requestPasswordReset } = await import("./apiAuth");
    await requestPasswordReset("user@example.com", "en");

    expect(resetPasswordForEmail).toHaveBeenCalledTimes(1);
    const [, options] = resetPasswordForEmail.mock.calls[0];
    expect(options.redirectTo).toBe(`${window.location.origin}/en/reset-password`);
    expect(options.redirectTo).not.toBe(window.location.origin);
  });

  it("uses Romanian and Russian locales in redirectTo", async () => {
    const { requestPasswordReset } = await import("./apiAuth");

    await requestPasswordReset("user@example.com", "ro");
    expect(resetPasswordForEmail.mock.calls.at(-1)?.[1].redirectTo).toBe(`${window.location.origin}/ro/reset-password`);

    await requestPasswordReset("user@example.com", "ru");
    expect(resetPasswordForEmail.mock.calls.at(-1)?.[1].redirectTo).toBe(`${window.location.origin}/ru/reset-password`);
  });

  it("falls back unknown locales to English in redirectTo", async () => {
    const { requestPasswordReset } = await import("./apiAuth");
    await requestPasswordReset("user@example.com", "xx");
    expect(resetPasswordForEmail.mock.calls.at(-1)?.[1].redirectTo).toBe(`${window.location.origin}/en/reset-password`);
  });
});

describe("updateRecoveredPassword recovery guard", () => {
  beforeEach(() => {
    clearPasswordRecoveryFlag();
    getSession.mockReset();
    updateUser.mockReset();
    signOut.mockReset();
  });

  afterEach(() => {
    clearPasswordRecoveryFlag();
  });

  it("rejects password update when session exists without confirmed recovery", async () => {
    getSession.mockResolvedValue({
      data: { session: { user: { id: "user-a" } } },
      error: null,
    });

    const { updateRecoveredPassword } = await import("./apiAuth");
    await expect(updateRecoveredPassword("newsecret")).rejects.toThrow();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("updates password when session matches confirmed recovery user", async () => {
    confirmPasswordRecovery("user-a");
    getSession.mockResolvedValue({
      data: { session: { user: { id: "user-a" } } },
      error: null,
    });
    updateUser.mockResolvedValue({ data: { user: { id: "user-a" } }, error: null });

    const { updateRecoveredPassword } = await import("./apiAuth");
    await updateRecoveredPassword("newsecret");
    expect(updateUser).toHaveBeenCalledWith({ password: "newsecret" });
  });

  it("rejects when confirmed recovery belongs to a different user than the session", async () => {
    confirmPasswordRecovery("user-a");
    getSession.mockResolvedValue({
      data: { session: { user: { id: "user-b" } } },
      error: null,
    });

    const { updateRecoveredPassword } = await import("./apiAuth");
    await expect(updateRecoveredPassword("newsecret")).rejects.toThrow();
    expect(updateUser).not.toHaveBeenCalled();
  });
});
