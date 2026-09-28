import { describe, expect, it } from "vitest";
import { applyProfileTheme, normalizeProfileTheme } from "../services/apiProfiles";
import { formatWorkspaceDate, formatWorkspaceMoney, formatWorkspaceMoneyCompact } from "./workspaceFormat";

describe("workspace formatting", () => {
  it("formats money with the workspace currency", () => {
    expect(formatWorkspaceMoney(12.5, "USD")).toBe("$12.50");
    expect(formatWorkspaceMoney(12.5, "MDL")).toBe("MDL 12.50");
    expect(formatWorkspaceMoney(null, "EUR")).toBe("—");
    expect(formatWorkspaceMoneyCompact(45000, "USD")).toBe("$45k");
    expect(formatWorkspaceMoneyCompact(45000, "MDL")).toBe("MDL 45k");
  });

  it("formats a timestamp with the workspace date pattern and time zone", () => {
    expect(formatWorkspaceDate("2026-09-28T12:00:00.000Z", "DD.MM.YYYY", "Europe/Chisinau")).toBe("28.09.2026");
    expect(formatWorkspaceDate("2026-09-28T12:00:00.000Z", "MM/DD/YYYY", "Europe/Chisinau")).toBe("09/28/2026");
    expect(formatWorkspaceDate("2026-10-01", "YYYY-MM-DD", "America/New_York")).toBe("2026-10-01");
  });
});

describe("profile theme", () => {
  it("keeps light, dark, and system and falls back to system", () => {
    expect(normalizeProfileTheme("dark")).toBe("dark");
    expect(normalizeProfileTheme("nope")).toBe("system");
  });

  it("applies the dark class for dark and for system when the device prefers dark", () => {
    applyProfileTheme("dark", false);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    applyProfileTheme("light", true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    applyProfileTheme("system", true);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});
