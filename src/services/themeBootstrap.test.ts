import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cacheProfileTheme, profileThemeStorageKey, readCachedProfileTheme, resetProfileTheme } from "./apiProfiles";
import { stubLocalStorage } from "../tests/memoryStorage";

beforeEach(() => {
  stubLocalStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.classList.remove("dark");
});

const html = readFileSync(resolve(__dirname, "../../index.html"), "utf8");
const inlineScript = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";

function runBootstrap({ path, cached, systemDark }: { path: string; cached: string | null; systemDark: boolean }) {
  document.documentElement.classList.remove("dark");
  window.history.pushState({}, "", path);
  if (cached === null) window.localStorage.removeItem(profileThemeStorageKey);
  else window.localStorage.setItem(profileThemeStorageKey, cached);
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({ matches: query === "(prefers-color-scheme: dark)" && systemDark })),
  );
  new Function(inlineScript)();
  return document.documentElement.classList.contains("dark");
}

describe("theme bootstrap script", () => {
  it("uses the cached storage key from apiProfiles", () => {
    expect(inlineScript).toContain(`"${profileThemeStorageKey}"`);
  });

  it("keeps an explicit light theme when the system is dark", () => {
    expect(runBootstrap({ path: "/en/ws-1/dashboard", cached: "light", systemDark: true })).toBe(false);
  });

  it("keeps an explicit dark theme when the system is light", () => {
    expect(runBootstrap({ path: "/en/ws-1/settings", cached: "dark", systemDark: false })).toBe(true);
  });

  it("follows the system for the system theme", () => {
    expect(runBootstrap({ path: "/en/ws-1/orders", cached: "system", systemDark: true })).toBe(true);
    expect(runBootstrap({ path: "/en/ws-1/orders", cached: "system", systemDark: false })).toBe(false);
  });

  it("does nothing without a valid cached theme", () => {
    expect(runBootstrap({ path: "/en/ws-1/orders", cached: null, systemDark: true })).toBe(false);
    expect(runBootstrap({ path: "/en/ws-1/orders", cached: "blue", systemDark: true })).toBe(false);
  });

  it("leaves auth pages light", () => {
    expect(runBootstrap({ path: "/en/login", cached: "dark", systemDark: true })).toBe(false);
    expect(runBootstrap({ path: "/en/register", cached: "dark", systemDark: true })).toBe(false);
  });
});

describe("cached profile theme", () => {
  it("stores only valid themes and resets on sign-out", () => {
    expect(readCachedProfileTheme()).toBeNull();
    cacheProfileTheme("dark");
    expect(readCachedProfileTheme()).toBe("dark");
    window.localStorage.setItem(profileThemeStorageKey, "blue");
    expect(readCachedProfileTheme()).toBeNull();

    cacheProfileTheme("dark");
    document.documentElement.classList.add("dark");
    resetProfileTheme();
    expect(readCachedProfileTheme()).toBeNull();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
