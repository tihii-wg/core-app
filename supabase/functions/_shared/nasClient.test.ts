import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  joinNasPath,
  NasClientError,
  normalizeRootPath,
  s3DeleteObject,
  s3PutObject,
  webdavDelete,
  webdavPut,
} from "./nasClient.ts";

describe("nas path helpers", () => {
  it("normalizes root path", () => {
    expect(normalizeRootPath(undefined)).toBe("/CoreApp");
    expect(normalizeRootPath("photos")).toBe("/photos");
    expect(normalizeRootPath("/CoreApp/")).toBe("/CoreApp");
  });

  it("joins NAS path segments", () => {
    expect(joinNasPath("/CoreApp", "ORD-1 — Client", "a.jpg")).toBe("/CoreApp/ORD-1 — Client/a.jpg");
  });
});

describe("WebDAV adapter (mocked fetch)", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("PUTs a file with basic auth", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201 });
    const base = new URL("https://nas.example.com:5006/dav");
    await webdavPut(base, "/CoreApp/probe.txt", new TextEncoder().encode("ok"), "text/plain", "user", "secret");
    expect(fetchMock).toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("https://nas.example.com:5006/dav/CoreApp/probe.txt");
    expect(init.method).toBe("PUT");
    expect(String(init.headers && (init.headers as Record<string, string>).Authorization)).toMatch(/^Basic /);
  });

  it("maps 401 to auth_failed", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401 });
    await expect(
      webdavDelete(new URL("https://nas.example.com/dav"), "/CoreApp/x", "u", "p"),
    ).rejects.toMatchObject({ code: "auth_failed" } satisfies Partial<NasClientError>);
  });
});

describe("S3 adapter (mocked fetch)", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("PUTs and DELETEs an object with SigV4 Authorization", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const base = new URL("https://s3.nas.example.com");
    await s3PutObject({
      base,
      bucket: "photos",
      region: "us-east-1",
      key: "CoreApp/probe.txt",
      bytes: new TextEncoder().encode("ok"),
      mimeType: "text/plain",
      accessKeyId: "AKIAEXAMPLE",
      secretAccessKey: "secretsecretsecretsecretsecret12",
    });
    const [, putInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(putInit.method).toBe("PUT");
    const headers = putInit.headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 /);

    await s3DeleteObject({
      base,
      bucket: "photos",
      region: "us-east-1",
      key: "CoreApp/probe.txt",
      accessKeyId: "AKIAEXAMPLE",
      secretAccessKey: "secretsecretsecretsecretsecret12",
    });
    const [, delInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(delInit.method).toBe("DELETE");
  });
});
