import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const navigate = vi.fn();
const signOut = vi.fn(async () => ({ error: null }));
const markMutating = { count: 0 };

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigate };
});

vi.mock("../../services/supabase", () => ({
  default: {
    auth: {
      signOut: (...args: unknown[]) => (signOut as (...a: unknown[]) => unknown)(...args),
    },
  },
}));

vi.mock("./useUser", () => ({
  useUser: () => ({ user: { id: "user-1" } }),
}));

vi.mock("../workspaces/useGetWorkspaces", () => ({
  useGetWorkspaces: () => ({
    workspaces: [
      {
        role: "owner",
        workspaces: { id: "ws-1", name: "A", session_idle_timeout_minutes: 30 },
      },
      {
        role: "member",
        workspaces: { id: "ws-2", name: "B", session_idle_timeout_minutes: 120 },
      },
    ],
  }),
  listedWorkspaceIds: () => ["ws-1", "ws-2"],
}));

vi.mock("../../services/apiWorkspaces", async () => {
  const actual = await vi.importActual<typeof import("../../services/apiWorkspaces")>(
    "../../services/apiWorkspaces",
  );
  return {
    ...actual,
    readSessionIdleDevOverrideMinutes: () => null,
  };
});

import { SessionIdleGuard } from "./SessionIdleGuard";
import { SESSION_IDLE_LOGOUT_NOTICE_KEY, sessionIdleActivityStorageKey } from "./sessionIdleTimeout";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, String(value));
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    clear: () => map.clear(),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  };
}

function wrapper(client: QueryClient) {
  return function W({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe("SessionIdleGuard", () => {
  beforeEach(() => {
    navigate.mockReset();
    signOut.mockClear();
    markMutating.count = 0;
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("sessionStorage", memoryStorage());
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("shows warning at T-60s, continue resets activity, expiry signs out locally", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.spyOn(client, "isMutating").mockImplementation(() => markMutating.count);

    const start = Date.now();
    localStorage.setItem(sessionIdleActivityStorageKey("user-1"), String(start));

    render(<SessionIdleGuard />, { wrapper: wrapper(client) });

    // 30 min timeout → warn after 29 minutes
    await act(async () => {
      vi.setSystemTime(start + 29 * 60_000 + 500);
      vi.advanceTimersByTime(16_000);
    });

    expect(await screen.findByText(/Still there/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Continue working/i }));
    await waitFor(() => {
      expect(screen.queryByText(/Still there/i)).not.toBeInTheDocument();
    });

    const afterContinue = Date.now();
    await act(async () => {
      vi.setSystemTime(afterContinue + 30 * 60_000 + 1_000);
      vi.advanceTimersByTime(16_000);
    });

    await waitFor(() => {
      expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    });
    expect(sessionStorage.getItem(SESSION_IDLE_LOGOUT_NOTICE_KEY)).toBe("1");
    expect(navigate).toHaveBeenCalled();
  });

  it("storage activity from another tab prevents logout", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const start = Date.now();
    localStorage.setItem(sessionIdleActivityStorageKey("user-1"), String(start));

    render(<SessionIdleGuard />, { wrapper: wrapper(client) });

    await act(async () => {
      vi.setSystemTime(start + 29 * 60_000 + 500);
      vi.advanceTimersByTime(16_000);
    });
    expect(await screen.findByText(/Still there/i)).toBeInTheDocument();

    const refreshed = Date.now();
    await act(async () => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: sessionIdleActivityStorageKey("user-1"),
          newValue: String(refreshed),
        }),
      );
      vi.advanceTimersByTime(1_000);
    });

    await waitFor(() => {
      expect(screen.queryByText(/Still there/i)).not.toBeInTheDocument();
    });
    expect(signOut).not.toHaveBeenCalled();
  });

  it("logs out immediately on visibilitychange when already expired", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const start = Date.now();
    localStorage.setItem(sessionIdleActivityStorageKey("user-1"), String(start));

    render(<SessionIdleGuard />, { wrapper: wrapper(client) });

    await act(async () => {
      vi.setSystemTime(start + 31 * 60_000);
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => {
      expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    });
  });
});
