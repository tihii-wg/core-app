import { describe, expect, it } from "vitest";
import { backupErrorKey, formatBackupSize } from "./apiBackups";

describe("backupErrorKey", () => {
  it("maps known provider and RPC error codes", () => {
    expect(backupErrorKey("workspace_backup:owner_only")).toBe("ownerOnly");
    expect(backupErrorKey("workspace_backup:already_running")).toBe("alreadyRunning");
    expect(backupErrorKey("repo_not_private")).toBe("repoNotPrivate");
    expect(backupErrorKey("too_large for github")).toBe("tooLarge");
    expect(backupErrorKey("not_connected")).toBe("notConnected");
    expect(backupErrorKey("something else")).toBeNull();
  });
});

describe("formatBackupSize", () => {
  it("formats bytes for the history table", () => {
    expect(formatBackupSize(null)).toBe("—");
    expect(formatBackupSize(512)).toBe("512 B");
    expect(formatBackupSize(2048)).toBe("2.0 KB");
    expect(formatBackupSize(2.5 * 1024 * 1024)).toBe("2.5 MB");
  });
});
