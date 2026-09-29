import { act, renderHook, waitFor } from "@testing-library/react";
import toast from "react-hot-toast";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCreateNewClient } from "../../features/clients/useCreateNewClient";
import { useGetClients } from "../../features/clients/useGetClients";
import { useUpdateClient } from "../../features/clients/useUpdateClient";
import useCreateNewEmployee from "../../features/employees/useCreateNewEmployee";
import useGetEmployees from "../../features/employees/useGetEmployees";
import { useCreateInventoryItem } from "../../features/inventory/useCreateInventoryItem";
import { useDeleteInventoryItem } from "../../features/inventory/useDeleteInventoryItem";
import { useGetInventoryItem } from "../../features/inventory/useGetInventoryItem";
import { useGetInventoryItems } from "../../features/inventory/useGetInventoryItems";
import { useUpdateInventoryItem } from "../../features/inventory/useUpdateInventoryItem";
import { useCreateOrder } from "../../features/orders/useCreateOrder";
import { useGetOrders, useUpdateOrderStatus } from "../../features/orders/useGetOrders";
import { useUpdateOrder } from "../../features/orders/useUpdateOrder";
import { useGetProfile } from "../../features/profiles/useGetProfile";
import { useUpdateProfile, useUpdateProfileTheme } from "../../features/profiles/useUpdateProfile";
import useCreateNewService from "../../features/services/useCreateNewService";
import useDeleteService from "../../features/services/useDeleteService";
import useGetServices from "../../features/services/useGetServices";
import useUpdateService from "../../features/services/useUpdateService";
import { useCreateWorkspace } from "../../features/workspaces/useCreateWorkspace";
import { useDeleteWorkspace } from "../../features/workspaces/useDeleteWorkspace";
import { useGetWorkspace } from "../../features/workspaces/useGetWorkspace";
import { useGetWorkspaceMembers } from "../../features/workspaces/useGetWorkspaceMembers";
import { listedWorkspaceIds, useGetWorkspaces } from "../../features/workspaces/useGetWorkspaces";
import { useGetInventoryMarkup, useUpdateInventoryMarkup } from "../../features/workspaces/useInventoryMarkup";
import { useAddWorkspaceMember, useRemoveWorkspaceMember, useUpdateWorkspaceMemberRole } from "../../features/workspaces/useManageWorkspaceMembers";
import { useUpdateWorkspace, useUpdateWorkspacePreferences } from "../../features/workspaces/useUpdateWorkspace";
import { useDisableMfa, useEnrollMfa, useMfaStatus, useVerifyMfa } from "../../features/auth/useMfa";
import { useLogOut } from "../../features/auth/useLogOut";
import { useLogin } from "../../features/auth/useLogIn";
import { useChangePassword } from "../../features/auth/useChangePassword";
import { useUploadWorkspaceAvatar } from "../../features/workspaces/useWorkspaceAvatar";
import { fake } from "../fakeSupabase";
import { PASSWORD, USERS, WS, membership, row, seedCoreApp } from "../coreAppDb";
import { cachedKeys, createHookWrapper } from "../hookHarness";

vi.mock("../../services/supabase", async () => ({ default: (await import("../fakeSupabase")).fakeClient }));
vi.mock("react-hot-toast", () => {
  const toast = { loading: vi.fn(), success: vi.fn(), error: vi.fn() };
  return { default: toast, toast };
});

const clientForm = { clientType: "individual" as const, clientName: "Hook Client", taxId: "", contactPerson: "", email: "", phone: "+37360000000", address: "", notes: "" };
const inventoryForm = { name: "Wiper", sku: "WP-1", description: "", category: "", quantity: 3, minQuantity: 1, unit: "pcs", purchasePrice: 1, sellingPrice: 2, supplier: "", location: "", isActive: true };
const sortByName = { field: "name" as const, ascending: true };

beforeEach(() => {
  seedCoreApp();
  fake.signInAs(USERS.owner.id);
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.loading).mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

function setup<T>(hook: () => T, path = `/en/${WS.A}/dashboard`) {
  const harness = createHookWrapper(path);
  const rendered = renderHook(hook, { wrapper: harness.wrapper });
  return { ...harness, ...rendered };
}

async function settle<T>(run: () => Promise<T>) {
  let outcome: { value?: T; error?: Error } = {};
  await act(async () => {
    try {
      outcome = { value: await run() };
    } catch (error) {
      outcome = { error: error as Error };
    }
  });
  return outcome;
}

describe("client mutations", () => {
  it("creating a client refreshes the list and toasts success", async () => {
    const { result } = setup(() => ({ list: useGetClients(""), create: useCreateNewClient() }));
    await waitFor(() => expect(result.current.list.clients).toHaveLength(1));

    await settle(() => result.current.create.mutateAsync({ workspace_id: WS.A, ...clientForm }));

    await waitFor(() => expect(result.current.list.clients?.map((client) => client.name).sort()).toEqual(["Ada Alpha", "Hook Client"]));
    expect(toast.success).toHaveBeenCalledWith("Client created succesfully", { id: "create-client" });
  });

  it("a rejected create toasts the database error and leaves the list alone", async () => {
    const { result } = setup(() => ({ list: useGetClients(""), create: useCreateNewClient() }));
    await waitFor(() => expect(result.current.list.clients).toHaveLength(1));

    const { error } = await settle(() => result.current.create.mutateAsync({ workspace_id: WS.C, ...clientForm }));

    expect(error?.message).toMatch("row-level security");
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching("row-level security"), { id: "create-client" });
    expect(result.current.list.clients).toHaveLength(1);
  });

  it("updating a client uses the active workspace and refreshes the list", async () => {
    const { result } = setup(() => ({ list: useGetClients(""), update: useUpdateClient() }));
    await waitFor(() => expect(result.current.list.clients).toHaveLength(1));

    await settle(() => result.current.update.mutateAsync({ clientId: "client-a1", ...clientForm, clientName: "Ada Updated" }));

    await waitFor(() => expect(result.current.list.clients?.[0].name).toBe("Ada Updated"));
    expect(toast.success).toHaveBeenCalledWith("Client updated successfully", { id: "update-client" });
  });

  it("updating a client of another workspace fails with a toast", async () => {
    const { result } = setup(() => ({ list: useGetClients(""), update: useUpdateClient() }));
    await waitFor(() => expect(result.current.list.clients).toHaveLength(1));
    await settle(() => result.current.update.mutateAsync({ clientId: "client-c1", ...clientForm }));
    expect(toast.error).toHaveBeenCalledWith("Client was not found or you do not have permission to edit it.", { id: "update-client" });
  });
});

describe("employee mutations", () => {
  it("creating an employee refreshes the employees list", async () => {
    const { result } = setup(() => ({ list: useGetEmployees(), create: useCreateNewEmployee() }));
    await waitFor(() => expect(result.current.list.employees).toHaveLength(2));
    await settle(() => result.current.create.mutateAsync({ workspace_id: WS.A, profile_id: USERS.member.id, name: "Eve", email: "", phone: "", role: "technician", status: "active" }));
    await waitFor(() => expect(result.current.list.employees).toHaveLength(3));
  });

  it("a missing workspace is reported as an error toast", async () => {
    const { result } = setup(() => useCreateNewEmployee());
    await settle(() => result.current.mutateAsync({ name: "Eve", email: "", phone: "", role: "technician", status: "active" }));
    expect(toast.error).toHaveBeenCalledWith("No active workspace", { id: "create-employee" });
  });
});

describe("service mutations", () => {
  it("an owner creates, updates and deletes a service and the list follows", async () => {
    const { result } = setup(() => ({ list: useGetServices(), create: useCreateNewService(), update: useUpdateService(), remove: useDeleteService() }));
    await waitFor(() => expect(result.current.list.services).toHaveLength(2));

    const created = await settle(() => result.current.create.mutateAsync({ serviceName: "Tyres", status: "active", price: 10 }));
    await waitFor(() => expect(result.current.list.services).toHaveLength(3));

    const id = String(created.value?.[0].id);
    await settle(() => result.current.update.mutateAsync({ serviceId: id, serviceName: "Tyres XL", status: "active", price: 12 }));
    await waitFor(() => expect(result.current.list.services.some((service) => service.service_name === "Tyres XL")).toBe(true));

    await settle(() => result.current.remove.mutateAsync(id));
    await waitFor(() => expect(result.current.list.services).toHaveLength(2));
    expect(toast.success).toHaveBeenCalledWith("Service deleted", { id: "delete-service" });
  });

  it("a member gets permission errors as toasts and the list stays the same", async () => {
    fake.signInAs(USERS.member.id);
    const { result } = setup(() => ({ list: useGetServices(), create: useCreateNewService(), update: useUpdateService(), remove: useDeleteService() }));
    await waitFor(() => expect(result.current.list.services).toHaveLength(2));

    await settle(() => result.current.create.mutateAsync({ serviceName: "Tyres", status: "active", price: 10 }));
    await settle(() => result.current.update.mutateAsync({ serviceId: "service-a1", serviceName: "Oil change", status: "inactive", price: 0 }));
    await settle(() => result.current.remove.mutateAsync("service-a2"));

    expect(vi.mocked(toast.error).mock.calls.map((call) => call[0])).toEqual([
      "You do not have permission to create services in this workspace.",
      "You do not have permission to edit this service.",
      "You do not have permission to delete this service.",
    ]);
    expect(row("services", "service-a1")?.status).toBe("active");
    expect(result.current.list.services).toHaveLength(2);
  });

  it("a duplicate service name gets a readable toast", async () => {
    const { result } = setup(() => ({ profile: useGetProfile(), create: useCreateNewService() }));
    await waitFor(() => expect(result.current.profile.data).toBeTruthy());
    await settle(() => result.current.create.mutateAsync({ serviceName: "oil change", status: "active", price: 10 }));
    expect(toast.error).toHaveBeenCalledWith("Service with this name is already exists", { id: "create-service" });
  });
});

describe("order mutations", () => {
  const input = { clientName: "Brand New Client", device: "Car", services: [{ serviceId: "service-a1", serviceName: "Oil change", price: 40, quantity: 1 }] };

  it("creating an order refreshes orders and clients", async () => {
    const { result } = setup(() => ({ orders: useGetOrders(), clients: useGetClients(""), create: useCreateOrder() }));
    await waitFor(() => expect(result.current.orders.orders).toHaveLength(1));
    await waitFor(() => expect(result.current.clients.clients).toHaveLength(1));

    await settle(() => result.current.create.mutateAsync(input));

    await waitFor(() => expect(result.current.orders.orders).toHaveLength(2));
    await waitFor(() => expect(result.current.clients.clients).toHaveLength(2));
    expect(toast.success).toHaveBeenCalledWith("Order created successfully", { id: "create-order" });
  });

  it("an order status change refreshes the list; a foreign order fails with a toast", async () => {
    const { result } = setup(() => ({ orders: useGetOrders(), status: useUpdateOrderStatus() }));
    await waitFor(() => expect(result.current.orders.orders).toHaveLength(1));

    await settle(() => result.current.status.mutateAsync({ orderId: "order-a1", status: "paid" }));
    await waitFor(() => expect(result.current.orders.orders[0]).toMatchObject({ status: "paid", paymentStatus: "paid" }));

    await settle(() => result.current.status.mutateAsync({ orderId: "order-c1", status: "cancelled" }));
    expect(toast.error).toHaveBeenCalledWith("Order was not found or you do not have permission to change it.", { id: "update-order-status" });
  });

  it("updating an order refreshes the list with the new total", async () => {
    const { result } = setup(() => ({ orders: useGetOrders(), update: useUpdateOrder() }));
    await waitFor(() => expect(result.current.orders.orders).toHaveLength(1));

    const { value } = await settle(() =>
      result.current.update.mutateAsync({ orderId: "order-a1", device: "Van", carNumber: "X1", vin: "", description: "", assignedEmployeeId: "", deadline: "", services: [{ serviceId: "service-a1", serviceName: "Oil change", price: 40, quantity: 1 }, { serviceId: "service-a2", serviceName: "Brake check", price: 25, quantity: 1 }] }),
    );

    expect(value?.totalPrice).toBe(65);
    await waitFor(() => expect(result.current.orders.orders[0]).toMatchObject({ device: "Van", totalPrice: 65 }));
  });
});

describe("inventory mutations", () => {
  it("create, update and delete keep the list and the detail query in step", async () => {
    const { result } = setup(() => ({ list: useGetInventoryItems("", "all", sortByName), detail: useGetInventoryItem("item-a1"), create: useCreateInventoryItem(), update: useUpdateInventoryItem(), remove: useDeleteInventoryItem() }), `/en/${WS.A}/inventory`);
    await waitFor(() => expect(result.current.list.items).toHaveLength(1));
    await waitFor(() => expect(result.current.detail.item?.quantity).toBe(2));

    await settle(() => result.current.create.mutateAsync(inventoryForm));
    await waitFor(() => expect(result.current.list.items).toHaveLength(2));

    await settle(() => result.current.update.mutateAsync({ ...inventoryForm, id: "item-a1", name: "Alpha brake pads", sku: "AP-1", quantity: 50 }));
    await waitFor(() => expect(result.current.detail.item?.quantity).toBe(50));

    await settle(() => result.current.remove.mutateAsync("item-a1"));
    await waitFor(() => expect(result.current.list.items.map((item) => item.name)).toEqual(["Wiper"]));
  });

  it("a duplicate SKU shows a readable toast", async () => {
    const { result } = setup(() => ({ profile: useGetProfile(), create: useCreateInventoryItem() }));
    await waitFor(() => expect(result.current.profile.data).toBeTruthy());
    await settle(() => result.current.create.mutateAsync({ ...inventoryForm, sku: "AP-1" }));
    expect(toast.error).toHaveBeenCalledWith("An inventory item with this SKU already exists.", { id: "create-inventory" });
  });
});

describe("team mutations", () => {
  it("add, change role and remove refresh the team list", async () => {
    const { result } = setup(() => ({ team: useGetWorkspaceMembers(), add: useAddWorkspaceMember(), role: useUpdateWorkspaceMemberRole(), remove: useRemoveWorkspaceMember() }));
    await waitFor(() => expect(result.current.team.members).toHaveLength(4));

    await settle(() => result.current.add.mutateAsync({ workspaceId: WS.A, email: USERS.newbie.email, role: "member" }));
    await waitFor(() => expect(result.current.team.members).toHaveLength(5));

    await settle(() => result.current.role.mutateAsync({ workspaceId: WS.A, userId: USERS.newbie.id, role: "manager" }));
    await waitFor(() => expect(result.current.team.members?.find((member) => member.userId === USERS.newbie.id)?.role).toBe("manager"));

    await settle(() => result.current.remove.mutateAsync({ workspaceId: WS.A, userId: USERS.newbie.id }));
    await waitFor(() => expect(result.current.team.members).toHaveLength(4));
    expect(membership(WS.A, USERS.newbie.id)?.deleted_at).toBeTruthy();
  });

  it("a member's attempts are refused with toasts", async () => {
    fake.signInAs(USERS.member.id);
    const { result } = setup(() => ({ add: useAddWorkspaceMember(), role: useUpdateWorkspaceMemberRole(), remove: useRemoveWorkspaceMember() }));
    await settle(() => result.current.add.mutateAsync({ workspaceId: WS.A, email: USERS.newbie.email, role: "member" }));
    await settle(() => result.current.role.mutateAsync({ workspaceId: WS.A, userId: USERS.manager.id, role: "member" }));
    await settle(() => result.current.remove.mutateAsync({ workspaceId: WS.A, userId: USERS.manager.id }));
    expect(vi.mocked(toast.error).mock.calls.map((call) => call[0])).toEqual([
      "You do not have permission to add team members",
      "You do not have permission to change this member's role",
      "You do not have permission to remove this member",
    ]);
  });
});

describe("workspace and profile mutations", () => {
  it("updating company details refreshes the workspace query", async () => {
    const { result } = setup(() => ({ workspace: useGetWorkspace(WS.A), update: useUpdateWorkspace() }));
    await waitFor(() => expect(result.current.workspace.data?.name).toBe("Alpha Garage"));
    await settle(() => result.current.update.mutateAsync({ workspaceId: WS.A, name: "Alpha Prime", industryId: "auto_repair", inventoryMarkup: 25 }));
    await waitFor(() => expect(result.current.workspace.data).toMatchObject({ name: "Alpha Prime", inventoryMarkup: 25 }));
  });

  it("a non-owner's company update shows the owner-only toast", async () => {
    fake.signInAs(USERS.admin.id);
    const { result } = setup(() => useUpdateWorkspace());
    await settle(() => result.current.mutateAsync({ workspaceId: WS.A, name: "X", industryId: "auto_repair", inventoryMarkup: 1 }));
    expect(toast.error).toHaveBeenCalledWith("Only the workspace owner can change company settings.", { id: "update-workspace" });
  });

  it("updating preferences writes the returned workspace into the cache", async () => {
    const { result } = setup(() => ({ workspace: useGetWorkspace(WS.A), update: useUpdateWorkspacePreferences() }));
    await waitFor(() => expect(result.current.workspace.data?.currency).toBe("MDL"));
    await settle(() => result.current.update.mutateAsync({ workspaceId: WS.A, language: "ru", timezone: "UTC", dateFormat: "YYYY-MM-DD", currency: "EUR" }));
    await waitFor(() => expect(result.current.workspace.data).toMatchObject({ currency: "EUR", language: "ru" }));
  });

  it("updating the markup writes the new value into the cache", async () => {
    const { result } = setup(() => ({ markup: useGetInventoryMarkup(WS.A), update: useUpdateInventoryMarkup() }));
    await waitFor(() => expect(result.current.markup.data).toBe(20));
    await settle(() => result.current.update.mutateAsync({ workspaceId: WS.A, markupPercent: 40 }));
    await waitFor(() => expect(result.current.markup.data).toBe(40));
  });

  it("creating a workspace refreshes the workspace list", async () => {
    const { result } = setup(() => ({ list: useGetWorkspaces(), create: useCreateWorkspace() }));
    await waitFor(() => expect(listedWorkspaceIds(result.current.list.workspaces)).toHaveLength(2));
    await settle(() => result.current.create.mutateAsync({ name: "Third", role: "owner", industryId: "auto_repair" }));
    await waitFor(() => expect(listedWorkspaceIds(result.current.list.workspaces)).toHaveLength(3));
  });

  it("deleting the active workspace clears workspace data, moves to the next workspace and navigates", async () => {
    const { result, queryClient, location } = setup(() => ({ profile: useGetProfile(), clients: useGetClients(""), remove: useDeleteWorkspace() }), `/en/${WS.A}/clients`);
    await waitFor(() => expect(result.current.clients.clients?.[0].name).toBe("Ada Alpha"));

    act(() => result.current.remove.deleteWorkspace(WS.A));

    await waitFor(() => expect(location.pathname).toBe(`/en/${WS.B}/clients`));
    await waitFor(() => expect(result.current.profile.data?.active_workspace_id).toBe(WS.B));
    expect(cachedKeys(queryClient).some((key) => key[0] === "clients" && key[1] === WS.A)).toBe(false);
    await waitFor(() => expect(result.current.clients.clients?.[0].name).toBe("Bob Beta"));
  });

  it("a non-owner cannot delete a workspace and nothing is cleared", async () => {
    fake.signInAs(USERS.admin.id);
    const { result, location } = setup(() => ({ clients: useGetClients(""), remove: useDeleteWorkspace() }), `/en/${WS.A}/clients`);
    await waitFor(() => expect(result.current.clients.clients).toHaveLength(1));
    act(() => result.current.remove.deleteWorkspace(WS.A));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Only the workspace owner can delete this workspace", { id: "delete" }));
    expect(location.pathname).toBe(`/en/${WS.A}/clients`);
    expect(result.current.clients.clients).toHaveLength(1);
  });

  it("updating the profile and theme writes the new profile into the cache", async () => {
    const { result } = setup(() => ({ profile: useGetProfile(), update: useUpdateProfile(), theme: useUpdateProfileTheme() }));
    await waitFor(() => expect(result.current.profile.data?.full_name).toBe("Olga Owner"));
    await settle(() => result.current.update.mutateAsync({ fullName: "Olga O.", phone: "" }));
    await waitFor(() => expect(result.current.profile.data?.full_name).toBe("Olga O."));
    await settle(() => result.current.theme.mutateAsync("dark"));
    await waitFor(() => expect(result.current.profile.data?.theme).toBe("dark"));

    await settle(() => result.current.update.mutateAsync({ fullName: "", phone: "" }));
    expect(toast.error).toHaveBeenCalledWith("Full name is required", { id: "update-profile" });
  });

  it("a logo upload by a non-member shows the access error", async () => {
    fake.signInAs(USERS.member.id);
    const { result } = setup(() => useUploadWorkspaceAvatar());
    await settle(() => result.current.mutateAsync({ workspaceId: WS.C, file: new Blob(["x"]) }));
    expect(toast.error).toHaveBeenCalledWith("You do not have access to this workspace");
  });
});

describe("auth mutations", () => {
  it("login clears the previous user's cache, primes the profile and navigates to the dashboard", async () => {
    fake.signInAs(null);
    const { result, queryClient, location } = setup(() => useLogin(), "/en/login");
    queryClient.setQueryData(["clients", WS.C, "", "all"], [{ name: "Leftover" }]);

    await settle(() => result.current.login({ email: USERS.member.email, password: PASSWORD }));

    expect(queryClient.getQueryData(["clients", WS.C, "", "all"])).toBeUndefined();
    expect(queryClient.getQueryData<{ id: string }>(["profiles"])?.id).toBe(USERS.member.id);
    expect(location.pathname).toBe("/en/dashboard");
  });

  it("a failed login keeps the user signed out and does not navigate", async () => {
    fake.signInAs(null);
    const { result, location } = setup(() => useLogin(), "/en/login");
    const { error } = await settle(() => result.current.login({ email: USERS.member.email, password: "nope" }));
    expect(error?.message).toBe("Invalid login or password");
    expect(location.pathname).toBe("/en/login");
    expect(fake.uid).toBeNull();
  });

  it("logout clears the whole cache and returns to login", async () => {
    const { result, queryClient, location } = setup(() => ({ clients: useGetClients(""), logOut: useLogOut() }), `/en/${WS.A}/clients`);
    await waitFor(() => expect(result.current.clients.clients).toHaveLength(1));
    window.history.pushState({}, "", `/en/${WS.A}/clients`);

    await settle(() => result.current.logOut.logOut());

    expect(fake.uid).toBeNull();
    expect(cachedKeys(queryClient).filter((key) => key[0] === "clients" && queryClient.getQueryData(key) !== undefined)).toHaveLength(0);
    await waitFor(() => expect(location.pathname).toBe("/en/login"));
  });

  it("MFA enroll, verify and disable refresh the MFA status", async () => {
    const { result } = setup(() => ({ status: useMfaStatus(), enroll: useEnrollMfa(), verify: useVerifyMfa(), disable: useDisableMfa() }));
    await waitFor(() => expect(result.current.status.data?.enabled).toBe(false));

    const { value } = await settle(() => result.current.enroll.mutateAsync());
    await settle(() => result.current.verify.mutateAsync({ factorId: String(value?.factorId), code: "123456" }));
    await waitFor(() => expect(result.current.status.data?.enabled).toBe(true));

    await settle(() => result.current.disable.mutateAsync(String(value?.factorId)));
    await waitFor(() => expect(result.current.status.data?.enabled).toBe(false));
  });

  it("change password reports a wrong current password as a toast", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 400 })));
    const { result } = setup(() => useChangePassword());
    await settle(() => result.current.mutateAsync({ currentPassword: "bad", newPassword: "newsecret" }));
    expect(toast.error).toHaveBeenCalledWith("Current password is incorrect.");
    vi.unstubAllGlobals();
  });
});
