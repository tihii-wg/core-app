import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  fingerprintRefreshToken,
  invalidateWorkspaceCalendarAccessTokenCache,
  resetWorkspaceCalendarAccessTokenCacheForTests,
  workspaceCalendarAccessToken,
} from "./googleCalendar.ts";

type RpcResult = { data: string | null; error: null };

function mockAdmin(refreshToken: string) {
  return {
    rpc: (_name: string, _args: Record<string, unknown>): Promise<RpcResult> =>
      Promise.resolve({
        data: JSON.stringify({ type: "google", refresh_token: refreshToken }),
        error: null,
      }),
    from: () => ({
      update: () => ({
        eq: () => Promise.resolve({ error: null }),
      }),
    }),
  } as unknown as Parameters<typeof workspaceCalendarAccessToken>[0];
}

Deno.test("fingerprintRefreshToken is stable and distinct per token", () => {
  assertEquals(fingerprintRefreshToken("abc"), fingerprintRefreshToken("abc"));
  assertNotEquals(fingerprintRefreshToken("abc"), fingerprintRefreshToken("abd"));
});

Deno.test("workspaceCalendarAccessToken reuses cache within expiry window", async () => {
  resetWorkspaceCalendarAccessTokenCacheForTests();
  let exchanges = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("oauth2.googleapis.com/token")) {
      exchanges += 1;
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: `tok-${exchanges}`, expires_in: 3600 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  try {
    const admin = mockAdmin("refresh-a");
    const a = await workspaceCalendarAccessToken(admin, "ws-1", "cid", "sec");
    const b = await workspaceCalendarAccessToken(admin, "ws-1", "cid", "sec");
    assertEquals("error" in a, false);
    assertEquals("error" in b, false);
    if (!("error" in a) && !("error" in b)) {
      assertEquals(a.accessToken, "tok-1");
      assertEquals(b.accessToken, "tok-1");
    }
    assertEquals(exchanges, 1);
  } finally {
    globalThis.fetch = originalFetch;
    resetWorkspaceCalendarAccessTokenCacheForTests();
  }
});

Deno.test("workspaceCalendarAccessToken dedupes concurrent refreshes", async () => {
  resetWorkspaceCalendarAccessTokenCacheForTests();
  let exchanges = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("oauth2.googleapis.com/token")) {
      exchanges += 1;
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve(
            new Response(JSON.stringify({ access_token: "shared", expires_in: 3600 }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          );
        }, 30);
      });
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  try {
    const admin = mockAdmin("refresh-b");
    const results = await Promise.all([
      workspaceCalendarAccessToken(admin, "ws-2", "cid", "sec"),
      workspaceCalendarAccessToken(admin, "ws-2", "cid", "sec"),
      workspaceCalendarAccessToken(admin, "ws-2", "cid", "sec"),
    ]);
    assertEquals(exchanges, 1);
    for (const result of results) {
      assertEquals("error" in result, false);
      if (!("error" in result)) assertEquals(result.accessToken, "shared");
    }
  } finally {
    globalThis.fetch = originalFetch;
    resetWorkspaceCalendarAccessTokenCacheForTests();
  }
});

Deno.test("workspaceCalendarAccessToken isolates workspaces and invalidates on refresh change", async () => {
  resetWorkspaceCalendarAccessTokenCacheForTests();
  let exchanges = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("oauth2.googleapis.com/token")) {
      exchanges += 1;
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: `tok-${exchanges}`, expires_in: 3600 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  try {
    const a1 = await workspaceCalendarAccessToken(mockAdmin("rt-a"), "ws-a", "cid", "sec");
    const b1 = await workspaceCalendarAccessToken(mockAdmin("rt-b"), "ws-b", "cid", "sec");
    assertEquals(exchanges, 2);
    if (!("error" in a1) && !("error" in b1)) {
      assertNotEquals(a1.accessToken, b1.accessToken);
    }

    invalidateWorkspaceCalendarAccessTokenCache("ws-a");
    const a2 = await workspaceCalendarAccessToken(mockAdmin("rt-a-new"), "ws-a", "cid", "sec");
    assertEquals(exchanges, 3);
    if (!("error" in a2)) assertEquals(a2.accessToken, "tok-3");

    // Different refresh token for same workspace forces a new exchange even without explicit invalidate.
    const a3 = await workspaceCalendarAccessToken(mockAdmin("rt-a-newer"), "ws-a", "cid", "sec");
    assertEquals(exchanges, 4);
    if (!("error" in a3)) assertEquals(a3.accessToken, "tok-4");
  } finally {
    globalThis.fetch = originalFetch;
    resetWorkspaceCalendarAccessTokenCacheForTests();
  }
});

Deno.test("workspaceCalendarAccessToken forceRefresh bypasses cache", async () => {
  resetWorkspaceCalendarAccessTokenCacheForTests();
  let exchanges = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("oauth2.googleapis.com/token")) {
      exchanges += 1;
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: `tok-${exchanges}`, expires_in: 3600 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    return Promise.reject(new Error(`unexpected fetch ${url}`));
  }) as typeof fetch;

  try {
    await workspaceCalendarAccessToken(mockAdmin("rt"), "ws-f", "cid", "sec");
    await workspaceCalendarAccessToken(mockAdmin("rt"), "ws-f", "cid", "sec", { forceRefresh: true });
    assertEquals(exchanges, 2);
  } finally {
    globalThis.fetch = originalFetch;
    resetWorkspaceCalendarAccessTokenCacheForTests();
  }
});
