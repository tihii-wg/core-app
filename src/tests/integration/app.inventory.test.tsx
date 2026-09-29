import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fake } from "../fakeSupabase";
import { USERS, WS, row, seedCoreApp } from "../coreAppDb";
import { installDomStubs, renderApp, trackUnhandledRejections } from "../appHarness";

vi.mock("../../services/supabase", async () => ({ default: (await import("../fakeSupabase")).fakeClient }));

let unhandled: ReturnType<typeof trackUnhandledRejections>;

beforeEach(() => {
  seedCoreApp();
  installDomStubs();
  unhandled = trackUnhandledRejections();
});

afterEach(() => unhandled.stop());

async function openInventory(userId = USERS.member.id) {
  fake.signInAs(userId);
  const app = renderApp(`/en/${WS.A}/inventory`);
  await screen.findByText("Alpha brake pads");
  return app;
}

type User = ReturnType<typeof renderApp>["user"];

async function openCreate(user: User) {
  await user.click(screen.getByRole("button", { name: /Add Item/ }));
  const dialog = await screen.findByRole("dialog");
  await within(dialog).findByLabelText("Name *");
  return dialog;
}

describe("inventory page", () => {
  it("shows only items of the active workspace with the low-stock warning", async () => {
    await openInventory();
    expect(screen.getByText("1 item")).toBeInTheDocument();
    expect(screen.getByText("1 items low on stock")).toBeInTheDocument();
    expect(screen.queryByText("Beta filter")).not.toBeInTheDocument();
    expect(screen.queryByText("Gamma oil")).not.toBeInTheDocument();
  });

  it("creates an item in the active workspace", async () => {
    const { user } = await openInventory();
    const dialog = await openCreate(user);
    await user.type(within(dialog).getByLabelText("Name *"), "Spark plug");
    await user.type(within(dialog).getByLabelText("SKU"), "SP-9");
    const quantity = within(dialog).getByLabelText("Quantity *");
    await user.clear(quantity);
    await user.type(quantity, "12");

    await user.click(within(dialog).getByRole("button", { name: "Add Item" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText("Spark plug")).toBeInTheDocument();
    expect(fake.all("inventory_items").find((item) => item.name === "Spark plug")).toMatchObject({ workspace_id: WS.A, sku: "SP-9", quantity: 12 });
  });

  it("keeps the dialog open and explains a duplicate SKU", async () => {
    const { user } = await openInventory();
    const dialog = await openCreate(user);
    await user.type(within(dialog).getByLabelText("Name *"), "Other pads");
    await user.type(within(dialog).getByLabelText("SKU"), "AP-1");

    await user.click(within(dialog).getByRole("button", { name: "Add Item" }));

    expect(await screen.findByText("An inventory item with this SKU already exists.")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(fake.all("inventory_items").filter((item) => item.sku === "AP-1")).toHaveLength(1);
  });

  it("validates the name before calling Supabase", async () => {
    const { user } = await openInventory();
    const dialog = await openCreate(user);
    await user.click(within(dialog).getByRole("button", { name: "Add Item" }));

    expect(await within(dialog).findByText("Name is required")).toBeInTheDocument();
    expect(fake.requests.filter((request) => request.table === "inventory_items" && request.op === "insert")).toHaveLength(0);
  });

  it("edits an item and refreshes the list", async () => {
    const { user } = await openInventory();
    await user.click(screen.getByRole("button", { name: "Edit Alpha brake pads" }));
    const dialog = await screen.findByRole("dialog");
    const quantity = await within(dialog).findByLabelText("Quantity *");
    await user.clear(quantity);
    await user.type(quantity, "30");

    await user.click(within(dialog).getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(row("inventory_items", "item-a1")?.quantity).toBe(30);
    await waitFor(() => expect(screen.queryByText("1 items low on stock")).not.toBeInTheDocument());
  });

  it("keeps the edit dialog open when the update is rejected", async () => {
    const { user } = await openInventory();
    await user.click(screen.getByRole("button", { name: "Edit Alpha brake pads" }));
    const dialog = await screen.findByRole("dialog");
    const quantity = await within(dialog).findByLabelText("Quantity *");
    await user.clear(quantity);
    await user.type(quantity, "30");
    fake.failNext("inventory_items", "update", { code: "42501", message: 'new row violates row-level security policy for table "inventory_items"' });

    await user.click(within(dialog).getByRole("button", { name: "Save Changes" }));

    expect(await screen.findByText("You do not have permission to change inventory in this workspace.")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(row("inventory_items", "item-a1")?.quantity).toBe(2);
    expect(unhandled.rejections).toEqual([]);
  });

  it("deletes an item after confirmation", async () => {
    const { user } = await openInventory();
    await user.click(screen.getByRole("button", { name: "Delete Alpha brake pads" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(row("inventory_items", "item-a1")).toBeUndefined());
    expect(await screen.findByText("0 items")).toBeInTheDocument();
  });

  it("shows the empty state for a workspace without items", async () => {
    fake.tables.inventory_items = fake.all("inventory_items").filter((item) => item.workspace_id !== WS.A);
    fake.signInAs(USERS.member.id);
    renderApp(`/en/${WS.A}/inventory`);
    expect(await screen.findByText("0 items")).toBeInTheDocument();
  });
});
