import { describe, expect, it } from "vitest";
import { assertHttpsUrl, isBlockedIp, isPrivateIpv4, SsrfBlockedError } from "./ssrfGuard.ts";

describe("ssrfGuard", () => {
  it("blocks private IPv4 ranges, loopback, and link-local", () => {
    expect(isPrivateIpv4("10.0.0.1")).toBe(true);
    expect(isPrivateIpv4("192.168.1.1")).toBe(true);
    expect(isPrivateIpv4("172.16.5.5")).toBe(true);
    expect(isPrivateIpv4("127.0.0.1")).toBe(true);
    expect(isPrivateIpv4("169.254.169.254")).toBe(true);
    expect(isPrivateIpv4("8.8.8.8")).toBe(false);
    expect(isPrivateIpv4("1.1.1.1")).toBe(false);
  });

  it("blocks IPv6 loopback, ULA, and link-local", () => {
    expect(isBlockedIp("::1")).toBe(true);
    expect(isBlockedIp("fc00::1")).toBe(true);
    expect(isBlockedIp("fe80::1")).toBe(true);
    expect(isBlockedIp("2001:4860:4860::8888")).toBe(false);
  });

  it("rejects http://, localhost, and private literal hosts", () => {
    expect(() => assertHttpsUrl("http://example.com/dav")).toThrow(SsrfBlockedError);
    expect(() => assertHttpsUrl("https://localhost/dav")).toThrow(SsrfBlockedError);
    expect(() => assertHttpsUrl("https://127.0.0.1/dav")).toThrow(SsrfBlockedError);
    expect(() => assertHttpsUrl("https://192.168.0.10/dav")).toThrow(SsrfBlockedError);
    expect(() => assertHttpsUrl("https://user:pass@example.com/dav")).toThrow(SsrfBlockedError);
    expect(assertHttpsUrl("https://nas.example.com:5006/dav").hostname).toBe("nas.example.com");
  });
});
