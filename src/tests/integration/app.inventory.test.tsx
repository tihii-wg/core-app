import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fake } from "../fakeSupabase";
import { USERS, WS, row, seedCoreApp, seedWarehouses } from "../coreAppDb";
import { installDomStubs, renderApp, trackUnhandledRejections } from "../appHarness";

vi.mock("../../services/supabase", async () => ({ default: (await import("../fakeSupabase")).fakeClient }));

let unhandled: ReturnType<typeof trackUnhandledRejections>;

beforeEach(() => {
  seedCoreApp();
  seedWarehouses();
  installDomStubs();
  unhandled = trackUnhandledRejections();
});

afterEach(() => unhandled.stop());

async function openInventory(userId = USERS.member.id) {
  fake.signInAs(userId);
  const app = renderApp(`/en/${WS.A}/inventory`);
  // Item names can appear in both the stock-attention preview and the table.
  await screen.findAllByText("Alpha brake pads");
  return app;
}

type User = ReturnType<typeof renderApp>["user"];

async function openCreate(user: User) {
  // Seeded workspace uses auto_repair industry copy ("Add Part").
  await user.click(screen.getByRole("button", { name: /Add Part/ }));
  const dialog = await screen.findByRole("dialog");
  await within(dialog).findByLabelText("Name *");
  return dialog;
}

describe("inventory page", () => {
  it("shows only items of the active workspace with the low-stock warning", async () => {
    await openInventory();
    expect(screen.getByText("1 part")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /1 items low on stock/i })).toBeInTheDocument();
    expect(screen.getByText("Stock needing attention")).toBeInTheDocument();
    expect(screen.queryByText("Beta filter")).not.toBeInTheDocument();
    expect(screen.queryByText("Gamma oil")).not.toBeInTheDocument();
  });

  it("creates an item in the active workspace at zero stock", async () => {
    const { user } = await openInventory();
    const dialog = await openCreate(user);
    expect(within(dialog).getByLabelText("Minimum Quantity *")).toHaveValue(10);
    await user.type(within(dialog).getByLabelText("Name *"), "Spark plug");
    await user.type(within(dialog).getByLabelText("SKU"), "SP-9");
    const quantity = within(dialog).getByLabelText("Quantity *");
    expect(quantity).toBeDisabled();
    expect(quantity).toHaveValue(0);

    await user.click(within(dialog).getByRole("button", { name: "Add Part" }));

    await waitFor(() => expect(fake.all("inventory_items").some((item) => item.name === "Spark plug")).toBe(true));
    // Optional follow-up receive dialog may open when warehouses exist — dismiss if present.
    const receiveDialog = screen.queryByRole("dialog", { name: /Receive into warehouse/i });
    if (receiveDialog) {
      await user.click(within(receiveDialog).getByRole("button", { name: /Cancel/i }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    }
    expect(screen.getAllByText("Spark plug").length).toBeGreaterThan(0);
    expect(fake.all("inventory_items").find((item) => item.name === "Spark plug")).toMatchObject({
      workspace_id: WS.A,
      sku: "SP-9",
      quantity: 0,
      min_quantity: 10,
    });
  });

  it("preserves a custom minimum quantity entered by the user", async () => {
    const { user } = await openInventory();
    const dialog = await openCreate(user);
    await user.type(within(dialog).getByLabelText("Name *"), "Custom min oil");
    await user.type(within(dialog).getByLabelText("SKU"), "OIL-MIN");
    const minQuantity = within(dialog).getByLabelText("Minimum Quantity *");
    await user.clear(minQuantity);
    await user.type(minQuantity, "3");
    expect(within(dialog).getByLabelText("Quantity *")).toBeDisabled();

    await user.click(within(dialog).getByRole("button", { name: "Add Part" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(fake.all("inventory_items").find((item) => item.sku === "OIL-MIN")).toMatchObject({ min_quantity: 3, quantity: 0 });
    // Seeded Alpha brake pads keep their original minimum.
    expect(row("inventory_items", "item-a1")?.min_quantity).toBe(5);
  });

  it("keeps the dialog open and explains a duplicate SKU", async () => {
    const { user } = await openInventory();
    const dialog = await openCreate(user);
    await user.type(within(dialog).getByLabelText("Name *"), "Other pads");
    await user.type(within(dialog).getByLabelText("SKU"), "AP-1");

    await user.click(within(dialog).getByRole("button", { name: "Add Part" }));

    expect(await screen.findByText("An inventory item with this SKU already exists.")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(fake.all("inventory_items").filter((item) => item.sku === "AP-1")).toHaveLength(1);
  });

  it("validates the name before calling Supabase", async () => {
    const { user } = await openInventory();
    const dialog = await openCreate(user);
    await user.click(within(dialog).getByRole("button", { name: "Add Part" }));

    expect(await within(dialog).findByText("Name is required")).toBeInTheDocument();
    expect(fake.requests.filter((request) => request.table === "inventory_items" && request.op === "insert")).toHaveLength(0);
  });

  it("edits an item and refreshes the list", async () => {
    const { user } = await openInventory();
    const padsRow = screen.getByRole("row", { name: /Alpha brake pads/ });
    expect(within(padsRow).getByText("Low Stock")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit Alpha brake pads" }));
    const dialog = await screen.findByRole("dialog");
    // Quantity is warehouse-owned (read-only here); lower the minimum so stock 2 is no longer "low".
    expect(within(dialog).getByLabelText("Quantity *")).toBeDisabled();
    const minimum = within(dialog).getByLabelText("Minimum Quantity *");
    await user.clear(minimum);
    await user.type(minimum, "1");

    await user.click(within(dialog).getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(row("inventory_items", "item-a1")).toMatchObject({ quantity: 2, min_quantity: 1 });
    await waitFor(() => expect(screen.queryByRole("button", { name: /1 items low on stock/i })).not.toBeInTheDocument());
    expect(await screen.findByText("Stock looks healthy")).toBeInTheDocument();
    const updatedRow = await screen.findByRole("row", { name: /Alpha brake pads/ });
    expect(within(updatedRow).getByText("In Stock")).toBeInTheDocument();
    expect(within(updatedRow).queryByText("Low Stock")).not.toBeInTheDocument();
  });

  it("keeps the edit dialog open when the update is rejected", async () => {
    const { user } = await openInventory();
    await user.click(screen.getByRole("button", { name: "Edit Alpha brake pads" }));
    const dialog = await screen.findByRole("dialog");
    // Quantity is warehouse-owned (read-only here); lower the minimum so stock 2 is no longer "low".
    expect(within(dialog).getByLabelText("Quantity *")).toBeDisabled();
    const minimum = within(dialog).getByLabelText("Minimum Quantity *");
    await user.clear(minimum);
    await user.type(minimum, "1");
    fake.failNext("inventory_items", "update", { code: "42501", message: 'new row violates row-level security policy for table "inventory_items"' });

    await user.click(within(dialog).getByRole("button", { name: "Save Changes" }));

    expect(await screen.findByText("You do not have permission to change inventory in this workspace.")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(row("inventory_items", "item-a1")).toMatchObject({ quantity: 2, min_quantity: 5 });
    expect(unhandled.rejections).toEqual([]);
  });

  it("deletes an item after confirmation", async () => {
    const { user } = await openInventory();
    await user.click(screen.getByRole("button", { name: "Delete Alpha brake pads" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(row("inventory_items", "item-a1")).toBeUndefined());
    expect(await screen.findByText("0 parts")).toBeInTheDocument();
  });

  it("shows the empty state for a workspace without items", async () => {
    fake.tables.inventory_items = fake.all("inventory_items").filter((item) => item.workspace_id !== WS.A);
    fake.signInAs(USERS.member.id);
    renderApp(`/en/${WS.A}/inventory`);
    expect(await screen.findByText("0 parts")).toBeInTheDocument();
  });
});
