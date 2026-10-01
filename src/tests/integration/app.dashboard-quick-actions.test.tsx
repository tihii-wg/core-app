import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fake } from "../fakeSupabase";
import { USERS, WS, seedCoreApp } from "../coreAppDb";
import { installDomStubs, renderApp, trackUnhandledRejections } from "../appHarness";

vi.mock("../../services/supabase", async () => ({ default: (await import("../fakeSupabase")).fakeClient }));

let unhandled: ReturnType<typeof trackUnhandledRejections>;

beforeEach(() => {
  seedCoreApp();
  installDomStubs();
  unhandled = trackUnhandledRejections();
});

afterEach(() => unhandled.stop());

async function openDashboard() {
  fake.signInAs(USERS.owner.id);
  const app = renderApp(`/en/${WS.A}/dashboard`);
  await screen.findByText("Quick Actions");
  return app;
}

describe("dashboard quick actions", () => {
  it.each([
    ["Create Order", "orders", "Create New Order"],
    ["Add Client", "clients", "Add New Client"],
    ["Add Inventory", "inventory", "Add Inventory Item"],
  ])("%s opens the existing create dialog on its page", async (button, page, dialogTitle) => {
    const { user, location } = await openDashboard();

    await user.click(screen.getByRole("button", { name: button }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(dialogTitle)).toBeInTheDocument();
    expect(location.pathname).toBe(`/en/${WS.A}/${page}`);

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(unhandled.rejections).toEqual([]);
  });

  it("Create Invoice stays on the dashboard because invoices are not backed by the database yet", async () => {
    const { user, location } = await openDashboard();

    await user.click(screen.getByRole("button", { name: "Create Invoice" }));

    expect(location.pathname).toBe(`/en/${WS.A}/dashboard`);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opening a page normally does not open its create dialog", async () => {
    fake.signInAs(USERS.owner.id);
    renderApp(`/en/${WS.A}/clients`);
    await screen.findByText("Ada Alpha");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
