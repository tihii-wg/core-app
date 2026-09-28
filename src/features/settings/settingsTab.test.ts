import { describe, expect, it } from "vitest";
import { profileSettingsPath, replaceLocale, settingsTabFromSearch } from "./settingsTab";

describe("settings tabs", () => {
  it("opens the profile tab from the topbar path", () => {
    const path = profileSettingsPath("en", "ws-1");
    const tab = new URL(path, "http://localhost").searchParams.get("tab");

    expect(path).toBe("/en/ws-1/settings?tab=profile");
    expect(settingsTabFromSearch(tab)).toBe("profile");
  });

  it("switches the locale segment when the company language changes", () => {
    expect(replaceLocale("/en/ws-1/settings", "en", "de")).toBe("/de/ws-1/settings");
    expect(replaceLocale("/en/ws-1/settings", "en", "en")).toBe("/en/ws-1/settings");
  });

  it("keeps the company tab when no tab is requested", () => {
    expect(settingsTabFromSearch(null)).toBe("company");
    expect(settingsTabFromSearch("unknown")).toBe("company");
  });
});
