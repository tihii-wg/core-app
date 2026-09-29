import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGetClients } from "../../features/clients/useGetClients";
import useGetEmployees from "../../features/employees/useGetEmployees";
import { useGetInventoryItem } from "../../features/inventory/useGetInventoryItem";
import { useGetInventoryItems } from "../../features/inventory/useGetInventoryItems";
import { useGetOrders } from "../../features/orders/useGetOrders";
import { useActiveWorkspaceId, useGetProfile } from "../../features/profiles/useGetProfile";
import useGetServices from "../../features/services/useGetServices";
import { useActiveWorkspaceRole } from "../../features/workspaces/useActiveWorkspaceRole";
import { useGetWorkspace } from "../../features/workspaces/useGetWorkspace";
import { useGetWorkspaceMembers } from "../../features/workspaces/useGetWorkspaceMembers";
import { listedWorkspaceIds, useGetWorkspaces } from "../../features/workspaces/useGetWorkspaces";
import { useGetInventoryMarkup } from "../../features/workspaces/useInventoryMarkup";
import { useSetActiveWorkspace } from "../../features/workspaces/useSetActiveWorkspace";
import { useWorkspaceMoney } from "../../features/workspaces/useWorkspaceMoney";
import { useUser } from "../../features/auth/useUser";
import { useGetIndustries } from "../../features/industries/useGetIndustries";
import { fake } from "../fakeSupabase";
import { USERS, WS, seedCoreApp } from "../coreAppDb";
import { createHookWrapper, requestsTo } from "../hookHarness";

vi.mock("../../services/supabase", async () => ({ default: (await import("../fakeSupabase")).fakeClient }));
vi.mock("react-hot-toast", () => {
  const toast = { loading: vi.fn(), success: vi.fn(), error: vi.fn() };
  return { default: toast, toast };
});

type ScopedQuery = {
  name: string;
  key: string;
  table: string;
  use: () => unknown;
  read: (result: never) => unknown;
  a: unknown;
  b: unknown;
  clear?: () => void;
};

const byName = (items: { name: string }[] | undefined) => items?.map((item) => item.name).sort();

const scopedQueries: ScopedQuery[] = [
  { name: "useGetClients", key: "clients", table: "clients", use: () => useGetClients(""), read: (r: ReturnType<typeof useGetClients>) => byName(r.clients), a: ["Ada Alpha"], b: ["Bob Beta"] },
  {
    name: "useGetServices",
    key: "services",
    table: "services",
    use: () => useGetServices(),
    read: (r: ReturnType<typeof useGetServices>) => (r.isPending ? undefined : r.services.map((item) => item.service_name).sort()),
    a: ["Brake check", "Oil change"],
    b: ["Beta wash"],
  },
  { name: "useGetOrders", key: "orders", table: "orders", use: () => useGetOrders(), read: (r: ReturnType<typeof useGetOrders>) => (r.isLoading ? undefined : r.orders.map((item) => item.device)), a: ["Alpha Garage car"], b: ["Beta Service car"] },
  { name: "useGetEmployees", key: "employees", table: "employees", use: () => useGetEmployees(), read: (r: ReturnType<typeof useGetEmployees>) => byName(r.employees as { name: string }[] | undefined), a: ["Tina Tech", "Tom Tech"], b: ["Bert Beta"] },
  {
    name: "useGetInventoryItems",
    key: "inventory",
    table: "inventory_items_with_status",
    use: () => useGetInventoryItems("", "all", { field: "name", ascending: true }),
    read: (r: ReturnType<typeof useGetInventoryItems>) => (r.isLoading ? undefined : r.items.map((item) => item.name)),
    a: ["Alpha brake pads"],
    b: ["Beta filter"],
    clear: () => (fake.tables.inventory_items = []),
  },
  {
    name: "useGetWorkspaceMembers",
    key: "workspace-members",
    table: "workspace_members",
    use: () => useGetWorkspaceMembers(),
    read: (r: ReturnType<typeof useGetWorkspaceMembers>) => r.members?.map((member) => member.fullName),
    a: ["Olga Owner", "Adam Admin", "Mia Manager", "Max Member"],
    b: ["Olga Owner", "Adam Admin"],
  },
];

beforeEach(() => {
  seedCoreApp();
  fake.signInAs(USERS.owner.id);
});

describe.each(scopedQueries)("$name", (query) => {
  it("loads the active workspace's rows under a workspace-scoped key", async () => {
    const { wrapper, queryClient } = createHookWrapper(`/en/${WS.A}/dashboard`);
    const { result } = renderHook(() => query.read(query.use() as never), { wrapper });

    await waitFor(() => expect(result.current).toEqual(query.a));
    expect(queryClient.getQueryCache().findAll({ queryKey: [query.key, WS.A] }).length).toBeGreaterThan(0);
    expect(requestsTo(query.table).every((request) => request.filters.includes(`workspace_id=eq.${WS.A}`))).toBe(true);
  });

  it("stays idle without an active workspace", async () => {
    fake.signInAs(USERS.newbie.id);
    const { wrapper, queryClient } = createHookWrapper("/en/dashboard");
    renderHook(() => ({ profile: useGetProfile(), value: query.use() }), { wrapper });

    await waitFor(() => expect(queryClient.getQueryState(["profiles"])?.status).toBe("success"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(requestsTo(query.table)).toHaveLength(0);
    expect(queryClient.getQueryCache().findAll({ queryKey: [query.key] }).every((item) => item.state.fetchStatus === "idle" && item.state.data === undefined)).toBe(true);
  });

  it("exposes the Supabase error", async () => {
    fake.failNext(query.table, "select", { code: "PGRST000", message: `${query.table} is down` }, 5);
    const { wrapper } = createHookWrapper(`/en/${WS.A}/dashboard`);
    const { result } = renderHook(() => query.use() as { error: Error | null }, { wrapper });

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.error?.message).toMatch(query.table === "inventory_items_with_status" ? "Could not load inventory. Please try again." : `${query.table} is down`);
  });

  if (query.key !== "workspace-members") {
    it("returns an empty list when the workspace has no rows", async () => {
      if (query.clear) query.clear();
      else fake.tables[query.table] = fake.all(query.table).filter((row) => row.workspace_id !== WS.A);
      const { wrapper } = createHookWrapper(`/en/${WS.A}/dashboard`);
      const { result } = renderHook(() => query.read(query.use() as never), { wrapper });
      await waitFor(() => expect(result.current).toEqual([]));
    });
  }

  it("never shows the previous workspace's rows after switching workspace", async () => {
    const { wrapper, queryClient, location } = createHookWrapper(`/en/${WS.A}/dashboard`);
    const renders: { workspaceId: string | undefined; value: unknown }[] = [];
    const { result } = renderHook(
      () => {
        const { workspaceId } = useActiveWorkspaceId();
        const value = query.read(query.use() as never);
        renders.push({ workspaceId, value });
        return { value, switcher: useSetActiveWorkspace() };
      },
      { wrapper },
    );

    await waitFor(() => expect(result.current.value).toEqual(query.a));
    await act(() => result.current.switcher.updateWorkspace(WS.B));
    await waitFor(() => expect(result.current.value).toEqual(query.b));

    expect(renders.filter((entry) => entry.workspaceId === WS.B).some((entry) => JSON.stringify(entry.value) === JSON.stringify(query.a))).toBe(false);
    expect(queryClient.getQueryCache().findAll({ queryKey: [query.key, WS.A] })).toHaveLength(0);
    expect(location.pathname).toBe(`/en/${WS.B}/dashboard`);
  });
});

describe("single-record and global queries", () => {
  it("useGetInventoryItem needs both a workspace and an id, and does not read across workspaces", async () => {
    const { wrapper } = createHookWrapper(`/en/${WS.A}/inventory`);
    const { result, rerender } = renderHook(({ id }) => useGetInventoryItem(id), { wrapper, initialProps: { id: null as string | null } });
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(requestsTo("inventory_items_with_status")).toHaveLength(0);

    rerender({ id: "item-a1" });
    await waitFor(() => expect(result.current.item?.name).toBe("Alpha brake pads"));
    rerender({ id: "item-c1" });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.item).toBeNull();
  });

  it("useGetWorkspace, useActiveWorkspaceRole and useWorkspaceMoney follow the active workspace", async () => {
    fake.signInAs(USERS.admin.id);
    const { wrapper } = createHookWrapper(`/en/${WS.A}/dashboard`);
    const { result } = renderHook(() => ({ role: useActiveWorkspaceRole(), money: useWorkspaceMoney(), switcher: useSetActiveWorkspace() }), { wrapper });

    await waitFor(() => expect(result.current.role).toBe("admin"));
    expect(result.current.money.currency).toBe("MDL");
    await act(() => result.current.switcher.updateWorkspace(WS.B));
    await waitFor(() => expect(result.current.role).toBe("member"));
  });

  it("useGetWorkspace returns null for a workspace the user cannot access", async () => {
    const { wrapper } = createHookWrapper(`/en/${WS.A}/dashboard`);
    const { result } = renderHook(() => useGetWorkspace(WS.C), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("useGetWorkspaces lists the user's workspaces", async () => {
    const { wrapper } = createHookWrapper(`/en/${WS.A}/dashboard`);
    const { result } = renderHook(() => useGetWorkspaces(), { wrapper });
    await waitFor(() => expect(listedWorkspaceIds(result.current.workspaces).sort()).toEqual([WS.A, WS.B]));
  });

  it("useGetInventoryMarkup reads the markup for the given workspace only when one is given", async () => {
    const { wrapper } = createHookWrapper(`/en/${WS.A}/dashboard`);
    const { result, rerender } = renderHook(({ id }) => useGetInventoryMarkup(id), { wrapper, initialProps: { id: undefined as string | undefined } });
    expect(result.current.fetchStatus).toBe("idle");
    rerender({ id: WS.A });
    await waitFor(() => expect(result.current.data).toBe(20));
  });

  it("useUser reflects the session", async () => {
    const { wrapper } = createHookWrapper(`/en/${WS.A}/dashboard`);
    const { result } = renderHook(() => useUser(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
    expect(result.current.user?.id).toBe(USERS.owner.id);

    fake.signInAs(null);
    const signedOut = createHookWrapper("/en/login");
    const { result: anonymous } = renderHook(() => useUser(), { wrapper: signedOut.wrapper });
    await waitFor(() => expect(anonymous.current.isReady).toBe(true));
    expect(anonymous.current.isAuthenticated).toBe(false);
  });

  it("useGetIndustries falls back to the built-in catalogue when the table is empty", async () => {
    fake.tables.industries = [];
    const { wrapper } = createHookWrapper("/en/register");
    const { result } = renderHook(() => useGetIndustries(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.industries.map((item) => item.slug)).toContain("auto_repair");
  });
});
