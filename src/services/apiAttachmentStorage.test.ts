import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
const getSession = vi.hoisted(() => vi.fn());
const from = vi.hoisted(() => vi.fn());

vi.mock("./supabase", () => ({
  default: { rpc, from, auth: { getSession } },
}));

vi.mock("../i18n", () => ({
  default: { t: (key: string) => key },
}));

import {
  attachmentStorageErrorKey,
  disconnectNasStorage,
  getWorkspaceAttachmentUsage,
  getWorkspaceNasStorage,
  nasErrorCode,
  saveNasConnection,
  setAttachmentStorage,
  testNasConnection,
} from "./apiAttachmentStorage";

describe("attachmentStorageErrorKey", () => {
  it("maps owner_only and google_drive_not_connected", () => {
    expect(attachmentStorageErrorKey("attachment_storage:owner_only")).toBe("ownerOnly");
    expect(attachmentStorageErrorKey("attachment_storage:google_drive_not_connected")).toBe("googleDriveNotConnected");
    expect(attachmentStorageErrorKey("attachment_storage:nas_not_connected")).toBe("nasNotConnected");
    expect(attachmentStorageErrorKey("attachment_storage:forbidden")).toBe("forbidden");
    expect(attachmentStorageErrorKey("something else")).toBeNull();
    expect(attachmentStorageErrorKey(undefined)).toBeNull();
  });
});

describe("setAttachmentStorage", () => {
  beforeEach(() => rpc.mockReset());

  it("calls crm_set_attachment_storage and returns the stored mode", async () => {
    rpc.mockResolvedValue({ data: "google_drive", error: null });
    await expect(setAttachmentStorage("ws-1", "google_drive")).resolves.toBe("google_drive");
    expect(rpc).toHaveBeenCalledWith("crm_set_attachment_storage", { p_workspace_id: "ws-1", p_mode: "google_drive" });
  });

  it("maps owner_only to a translated message", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "attachment_storage:owner_only" } });
    await expect(setAttachmentStorage("ws-1", "app")).rejects.toThrow("settings.storage.errors.ownerOnly");
  });

  it("maps google_drive_not_connected to a translated message", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "attachment_storage:google_drive_not_connected" },
    });
    await expect(setAttachmentStorage("ws-1", "google_drive")).rejects.toThrow(
      "settings.storage.errors.googleDriveNotConnected",
    );
  });

  it("returns nas and maps nas_not_connected", async () => {
    rpc.mockResolvedValue({ data: "nas", error: null });
    await expect(setAttachmentStorage("ws-1", "nas")).resolves.toBe("nas");
    expect(rpc).toHaveBeenCalledWith("crm_set_attachment_storage", { p_workspace_id: "ws-1", p_mode: "nas" });

    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "attachment_storage:nas_not_connected" } });
    await expect(setAttachmentStorage("ws-1", "nas")).rejects.toThrow("settings.storage.errors.nasNotConnected");
  });
});

describe("getWorkspaceAttachmentUsage", () => {
  beforeEach(() => rpc.mockReset());

  it("maps the first row of the RPC table result", async () => {
    rpc.mockResolvedValue({
      data: [{ app_bytes: "2048", app_files: 3, drive_bytes: 10, drive_files: "1", nas_bytes: "4096", nas_files: 5 }],
      error: null,
    });
    await expect(getWorkspaceAttachmentUsage("ws-1")).resolves.toEqual({
      appBytes: 2048,
      appFiles: 3,
      driveBytes: 10,
      driveFiles: 1,
      nasBytes: 4096,
      nasFiles: 5,
    });
  });

  it("returns zeros for an empty result", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await expect(getWorkspaceAttachmentUsage("ws-1")).resolves.toEqual({
      appBytes: 0,
      appFiles: 0,
      driveBytes: 0,
      driveFiles: 0,
      nasBytes: 0,
      nasFiles: 0,
    });
  });

  it("defaults nas_* to zero when the RPC does not return them yet", async () => {
    rpc.mockResolvedValue({ data: [{ app_bytes: 1, app_files: 1, drive_bytes: 0, drive_files: 0 }], error: null });
    const usage = await getWorkspaceAttachmentUsage("ws-1");
    expect(usage.nasBytes).toBe(0);
    expect(usage.nasFiles).toBe(0);
  });
});

describe("nasErrorCode", () => {
  it("maps known codes from codes or messages", () => {
    for (const code of ["unreachable", "tls", "auth_failed", "forbidden", "not_found", "timeout", "https_only", "ssrf_blocked"]) {
      expect(nasErrorCode(code)).toBe(code);
      expect(nasErrorCode(`nas_storage:${code}`)).toBe(code);
    }
    expect(nasErrorCode("boom")).toBeNull();
    expect(nasErrorCode(undefined)).toBeNull();
  });
});

describe("getWorkspaceNasStorage", () => {
  function mockRow(result: { data: unknown; error: unknown }) {
    const maybeSingle = vi.fn().mockResolvedValue(result);
    const eq = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn(() => ({ eq }));
    from.mockReturnValue({ select });
    return { select, eq };
  }

  it("maps the row and treats connected as a saved credential", async () => {
    const { eq } = mockRow({
      data: {
        workspace_id: "ws-1",
        protocol: "s3",
        base_url: "https://s3.example.com",
        root_path: "/CoreApp",
        username: null,
        bucket: "photos",
        region: "eu-west-1",
        status: "connected",
        last_error: null,
        last_checked_at: "2026-11-09T08:00:00Z",
      },
      error: null,
    });
    await expect(getWorkspaceNasStorage("ws-1")).resolves.toEqual({
      workspaceId: "ws-1",
      protocol: "s3",
      baseUrl: "https://s3.example.com",
      rootPath: "/CoreApp",
      username: null,
      bucket: "photos",
      region: "eu-west-1",
      status: "connected",
      lastError: null,
      lastCheckedAt: "2026-11-09T08:00:00Z",
      hasCredential: true,
    });
    expect(from).toHaveBeenCalledWith("workspace_nas_storage");
    expect(eq).toHaveBeenCalledWith("workspace_id", "ws-1");
  });

  it("returns null when there is no row or the table is missing", async () => {
    mockRow({ data: null, error: null });
    await expect(getWorkspaceNasStorage("ws-1")).resolves.toBeNull();
    mockRow({ data: null, error: { code: "42P01", message: "relation does not exist" } });
    await expect(getWorkspaceNasStorage("ws-1")).resolves.toBeNull();
  });
});

describe("nas-storage Edge Function calls", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    getSession.mockReset().mockResolvedValue({ data: { session: { access_token: "tok" } }, error: null });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("VITE_SUPABASE_URL", "https://proj.supabase.co");
  });

  const payload = { protocol: "webdav", baseUrl: "https://nas.example.com", rootPath: "/CoreApp", username: "u", password: "p" } as const;

  it("test/save/disconnect POST to nas-storage/<action> with the workspace id", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });

    await testNasConnection("ws-1", payload);
    await saveNasConnection("ws-1", { ...payload, keepExistingSecret: true });
    await disconnectNasStorage("ws-1");

    const calls = fetchMock.mock.calls as [string, RequestInit][];
    expect(calls.map(([url]) => url)).toEqual([
      "https://proj.supabase.co/functions/v1/nas-storage/test",
      "https://proj.supabase.co/functions/v1/nas-storage/save",
      "https://proj.supabase.co/functions/v1/nas-storage/disconnect",
    ]);
    expect(calls[0][1].method).toBe("POST");
    expect((calls[0][1].headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(calls[0][1].body as string)).toEqual({ workspaceId: "ws-1", ...payload });
    expect(JSON.parse(calls[1][1].body as string)).toMatchObject({ keepExistingSecret: true });
    expect(JSON.parse(calls[2][1].body as string)).toEqual({ workspaceId: "ws-1" });
  });

  it.each([
    ["unreachable", { code: "unreachable" }],
    ["tls", { code: "tls", message: "certificate expired" }],
    ["auth_failed", { message: "nas_storage:auth_failed" }],
    ["forbidden", { code: "forbidden" }],
    ["not_found", { code: "not_found" }],
    ["timeout", { code: "timeout" }],
    ["https_only", { code: "https_only" }],
    ["ssrf_blocked", { code: "ssrf_blocked" }],
  ])("maps %s to a translated message", async (code, error) => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ ok: false, error }) });
    await expect(testNasConnection("ws-1", payload)).rejects.toThrow(`settings.storage.nas.errors.${code}`);
  });

  it("maps owner_only and nas_not_connected from the function", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: { message: "attachment_storage:owner_only" } }) });
    await expect(saveNasConnection("ws-1", payload)).rejects.toThrow("settings.storage.errors.ownerOnly");
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: { message: "attachment_storage:nas_not_connected" } }) });
    await expect(saveNasConnection("ws-1", payload)).rejects.toThrow("settings.storage.errors.nasNotConnected");
  });

  it("treats ok:false on a 200 response as a failure and falls back to a generic message", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: false, error: {} }) });
    await expect(saveNasConnection("ws-1", payload)).rejects.toThrow("settings.storage.nas.errors.saveFailed");
    await expect(disconnectNasStorage("ws-1")).rejects.toThrow("settings.storage.nas.errors.disconnectFailed");
  });
});
