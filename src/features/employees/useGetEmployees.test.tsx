import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import useGetEmployees from "./useGetEmployees";

const mocks = vi.hoisted(() => ({
  getEmployees: vi.fn(),
  profile: { data: undefined as unknown, isLoading: false, error: null as Error | null },
}));

vi.mock("../../services/apiEmployees", () => ({ getEmployees: mocks.getEmployees }));
vi.mock("../profiles/useGetProfile", () => ({ useGetProfile: () => mocks.profile }));

function wrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/en/route-ws/settings"]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe("useGetEmployees", () => {
  beforeEach(() => {
    mocks.getEmployees.mockReset();
    mocks.profile = { data: undefined, isLoading: false, error: null };
  });

  it("loads employees for the profile's active workspace", async () => {
    mocks.profile.data = { id: "user-1", active_workspace_id: "ws-active" };
    mocks.getEmployees.mockResolvedValue([{ id: "emp-1", name: "Ada" }]);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(() => useGetEmployees(), { wrapper: wrapper(queryClient) });

    await waitFor(() => expect(result.current.employees).toEqual([{ id: "emp-1", name: "Ada" }]));
    expect(mocks.getEmployees).toHaveBeenCalledWith("", undefined, "ws-active");
    expect(queryClient.getQueryData(["employees", "ws-active", undefined, undefined])).toBeDefined();
  });

  it("stays loading and does not query while the profile is loading", () => {
    mocks.profile = { data: undefined, isLoading: true, error: null };
    const queryClient = new QueryClient();

    const { result } = renderHook(() => useGetEmployees(), { wrapper: wrapper(queryClient) });

    expect(result.current.isLoading).toBe(true);
    expect(mocks.getEmployees).not.toHaveBeenCalled();
  });

  it("does not query without an active workspace", () => {
    mocks.profile.data = { id: "user-1", active_workspace_id: null };
    const queryClient = new QueryClient();

    const { result } = renderHook(() => useGetEmployees(), { wrapper: wrapper(queryClient) });

    expect(result.current.isLoading).toBe(false);
    expect(mocks.getEmployees).not.toHaveBeenCalled();
  });
});
