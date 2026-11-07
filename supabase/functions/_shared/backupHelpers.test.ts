import { describe, expect, it } from "vitest";
import { oauthStateExpiresAt, signOAuthState, timingSafeEqual, verifyOAuthState } from "./crypto.ts";
import { buildBackupManifest } from "./manifest.ts";
import { backupFileName, isBackupZipName, workspaceSlug } from "./naming.ts";
import { backupNameTimestampMs, selectBackupFilesToDelete } from "./retention.ts";

describe("timingSafeEqual", () => {
  it("returns true for equal strings", () => {
    expect(timingSafeEqual("token-abc", "token-abc")).toBe(true);
  });

  it("returns false for unequal or different-length strings", () => {
    expect(timingSafeEqual("token-abc", "token-xyz")).toBe(false);
    expect(timingSafeEqual("short", "longer")).toBe(false);
  });
});

describe("OAuth state signing", () => {
  it("round-trips a valid state and rejects expired or tampered ones", async () => {
    const secret = "test-oauth-secret-value";
    const now = Date.UTC(2026, 10, 7, 12, 0, 0);
    const payload = {
      workspaceId: "ws-1",
      userId: "user-1",
      exp: oauthStateExpiresAt(now, 10),
      nonce: "nonce-1",
      locale: "ru",
    };
    const state = await signOAuthState(payload, secret);
    await expect(verifyOAuthState(state, secret, now)).resolves.toMatchObject(payload);
    await expect(verifyOAuthState(state, secret, now + 11 * 60_000)).resolves.toBeNull();
    await expect(verifyOAuthState(`${state}x`, secret, now)).resolves.toBeNull();
    await expect(verifyOAuthState(state, "other-secret", now)).resolves.toBeNull();
  });
});

describe("backup naming", () => {
  it("slugs workspace names and builds dated zip names", () => {
    expect(workspaceSlug("  My Garage #1 ")).toBe("my-garage-1");
    expect(workspaceSlug("")).toBe("workspace");
    const name = backupFileName("Alpha Shop", new Date("2026-11-07T14:05:00.000Z"));
    expect(name).toBe("core-app-backup-alpha-shop-2026-11-07_1405.zip");
    expect(isBackupZipName(name)).toBe(true);
    expect(isBackupZipName("notes.txt")).toBe(false);
  });
});

describe("retention selection", () => {
  it("keeps the newest N files and returns older names to delete", () => {
    const files = [
      { name: "a.zip", createdAtMs: 100 },
      { name: "b.zip", createdAtMs: 300 },
      { name: "c.zip", createdAtMs: 200 },
      { name: "d.zip", createdAtMs: 400 },
    ];
    expect(selectBackupFilesToDelete(files, 2)).toEqual(["c.zip", "a.zip"]);
    expect(selectBackupFilesToDelete(files, 10)).toEqual([]);
  });

  it("parses timestamps from backup file names", () => {
    expect(backupNameTimestampMs("core-app-backup-x-2026-11-07_1405.zip")).toBe(
      Date.UTC(2026, 10, 7, 14, 5),
    );
    expect(backupNameTimestampMs("other.zip")).toBe(0);
  });
});

describe("manifest", () => {
  it("builds a version-1 workspace backup manifest", () => {
    const manifest = buildBackupManifest({
      workspaceId: "ws-1",
      workspaceName: "Alpha",
      createdAt: "2026-11-07T12:00:00.000Z",
      tables: [{ name: "orders", rowCount: 3 }],
      files: 2,
      warnings: ["files capped"],
    });
    expect(manifest).toEqual({
      format: "core-app-workspace-backup",
      version: 1,
      workspaceId: "ws-1",
      workspaceName: "Alpha",
      createdAt: "2026-11-07T12:00:00.000Z",
      tables: [{ name: "orders", rowCount: 3 }],
      files: 2,
      appVersion: "1",
      warnings: ["files capped"],
    });
  });
});
