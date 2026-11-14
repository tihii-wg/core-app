import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fake } from "../fakeSupabase";
import { USERS, WS, row, seedCoreApp } from "../coreAppDb";
import { installDomStubs, renderApp, trackUnhandledRejections } from "../appHarness";

vi.mock("../../services/supabase", async () => ({ default: (await import("../fakeSupabase")).fakeClient }));

const servicesPath = `/en/${WS.A}/services`;
const orderNumber = `ORD-${new Date().getFullYear()}-001`;
const searchedTables = ["orders", "clients", "inventory_items_with_status"];
let unhandled: ReturnType<typeof trackUnhandledRejections>;

beforeEach(() => {
  seedCoreApp();
  installDomStubs();
  unhandled = trackUnhandledRejections();
});

afterEach(() => unhandled.stop());

type User = ReturnType<typeof renderApp>["user"];

const searchInputName = /Search orders, clients and (inventory|parts)/i;

async function openApp(path = servicesPath) {
  fake.signInAs(USERS.owner.id);
  const app = renderApp(path);
  await screen.findByRole("combobox", { name: searchInputName });
  return app;
}

async function search(user: User, text: string) {
  await user.type(screen.getByRole("combobox", { name: searchInputName }), text);
  return screen.findByRole("listbox", { name: "Search results" });
}

function group(listbox: HTMLElement, name: string) {
  return within(listbox).getByRole("group", { name: new RegExp(`^${name}`) });
}

function groupLabels(listbox: HTMLElement) {
  return within(listbox)
    .getAllByRole("group")
    .map((element) => document.getElementById(element.getAttribute("aria-labelledby") ?? "")?.firstElementChild?.textContent);
}

function searchRequests() {
  return fake.requests.filter((request) => searchedTables.includes(request.table) && request.filters.some((filter) => filter.includes("ilike")));
}

describe("global search", () => {
  it("groups matching orders, clients and inventory items by entity type", async () => {
    const { user } = await openApp();
    const listbox = await search(user, "alpha");

    // Auto-repair workspaces label the inventory module "Parts".
    expect(groupLabels(listbox)).toEqual(["Orders", "Clients", "Parts"]);
    expect(within(group(listbox, "Orders")).getByRole("option", { name: new RegExp(orderNumber) })).toBeInTheDocument();
    expect(within(group(listbox, "Clients")).getByRole("option", { name: /Ada Alpha/ })).toBeInTheDocument();
    expect(within(group(listbox, "Parts")).getByRole("option", { name: /Alpha brake pads/ })).toBeInTheDocument();
  });

  it.each([
    // The plate also matches the client who owns that vehicle (client search includes vehicle registrations).
    ["an order's car number", () => String(row("orders", "order-a1")!.car_number), ["Orders", "Clients"]],
    ["an order's description", () => "Noise", ["Orders"]],
    ["a client's phone, which also finds that client's orders", () => "+3736111", ["Orders", "Clients"]],
    ["a client's email", () => "ada@example", ["Orders", "Clients"]],
    ["an inventory SKU", () => "AP-1", ["Parts"]],
    ["an inventory category", () => "Parts", ["Parts"]],
  ])("searches beyond the name: %s", async (_label, term, groups) => {
    const { user } = await openApp();
    const listbox = await search(user, term());

    expect(groupLabels(listbox)).toEqual(groups);
  });

  it("only searches the active workspace", async () => {
    const { user } = await openApp();
    await user.type(screen.getByRole("combobox", { name: searchInputName }), "Beta");

    expect(await screen.findByText('No results for "Beta"')).toBeInTheDocument();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    const requests = searchRequests();
    expect(requests.map((request) => request.table).sort()).toEqual(expect.arrayContaining(searchedTables));
    for (const request of requests) expect(request.filters).toContain(`workspace_id=eq.${WS.A}`);
  });

  it("debounces typing into a single database search per entity", async () => {
    const { user } = await openApp();
    await search(user, "brake");

    const terms = searchRequests().flatMap((request) => request.filters.filter((filter) => filter.startsWith("name=ilike.")));
    expect(new Set(terms)).toEqual(new Set(["name=ilike.%brake%"]));
    expect(searchRequests().filter((request) => request.table === "inventory_items_with_status")).toHaveLength(1);
  });

  it("waits for at least two characters before querying", async () => {
    const { user } = await openApp();
    await user.type(screen.getByRole("combobox", { name: searchInputName }), "a");

    expect(screen.getByText("Type at least 2 characters to search.")).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(searchRequests()).toEqual([]);
  });

  it("opens the Order Details panel for an order result without leaving the page", async () => {
    const { user, location } = await openApp();
    const listbox = await search(user, "Noise");

    await user.click(within(listbox).getByRole("option", { name: new RegExp(orderNumber) }));

    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByText(orderNumber)).toBeInTheDocument();
    expect(within(panel).getByTestId("order-client-card-shell")).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(location.pathname).toBe(servicesPath);
  });

  it("opens the client panel with the client's order history", async () => {
    const { user, location } = await openApp();
    const listbox = await search(user, "ada@example");

    await user.click(within(group(listbox, "Clients")).getByRole("option", { name: /Ada Alpha/ }));

    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByText("Ada Alpha")).toBeInTheDocument();
    // Order history lives on the "Orders" tab (the panel opens on "General").
    await user.click(await within(panel).findByRole("tab", { name: /^Orders/ }));
    expect(await within(panel).findByText(orderNumber)).toBeInTheDocument();
    expect(location.pathname).toBe(servicesPath);
  });

  it("opens the inventory panel and edits the item with the inventory edit form", async () => {
    const { user, location } = await openApp();
    const listbox = await search(user, "AP-1");

    await user.click(within(listbox).getByRole("option", { name: /Alpha brake pads/ }));
    const panel = await screen.findByRole("dialog");
    await user.click(await within(panel).findByRole("button", { name: "Edit" }));

    const dialog = await screen.findByRole("dialog", { name: /Edit (Inventory Item|Part)/i });
    // Quantity is warehouse-owned (read-only here); lower the minimum so stock 2 is no longer "low".
    expect(within(dialog).getByLabelText("Quantity *")).toBeDisabled();
    const minimum = within(dialog).getByLabelText("Minimum Quantity *");
    await user.clear(minimum);
    await user.type(minimum, "1");
    await user.click(within(dialog).getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(row("inventory_items", "item-a1")).toMatchObject({ quantity: 2, min_quantity: 1 });
    expect(location.pathname).toBe(servicesPath);
    expect(unhandled.rejections).toEqual([]);
  });

  it("opens the highlighted result with the keyboard", async () => {
    const { user } = await openApp();
    await search(user, "AP-1");

    await user.keyboard("{ArrowDown}{Enter}");

    const panel = await screen.findByRole("dialog");
    expect(await within(panel).findByText("Alpha brake pads")).toBeInTheDocument();
  });

  it("works from the Dashboard as well", async () => {
    const { user, location } = await openApp(`/en/${WS.A}/dashboard`);
    const listbox = await search(user, "alpha");

    await user.click(within(group(listbox, "Orders")).getByRole("option", { name: new RegExp(orderNumber) }));

    expect(within(await screen.findByRole("dialog")).getByText(orderNumber)).toBeInTheDocument();
    expect(location.pathname).toBe(`/en/${WS.A}/dashboard`);
  });
});
