import { screen, waitFor } from "@testing-library/react";
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

async function openSettings(userId: string, tab?: string) {
  fake.signInAs(userId);
  return renderApp(`/en/${WS.A}/settings${tab ? `?tab=${tab}` : ""}`);
}

const workspaceUpdates = () => fake.requests.filter((request) => request.table === "workspaces" && request.op === "update");

describe("company settings", () => {
  it("lets the owner rename the company and refreshes the workspace selector", async () => {
    const { user } = await openSettings(USERS.owner.id);
    const name = await screen.findByLabelText("Company name");
    await waitFor(() => expect(name).toBeEnabled());
    await user.clear(name);
    await user.type(name, "Alpha Motors");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(await screen.findByText("Company updated")).toBeInTheDocument();
    expect(row("workspaces", WS.A)?.name).toBe("Alpha Motors");
    await waitFor(() => expect(screen.getByRole("button", { name: /Alpha Motors/ })).toBeInTheDocument());
  });

  it("keeps the typed values and shows the error when saving fails", async () => {
    const { user } = await openSettings(USERS.owner.id);
    const name = await screen.findByLabelText("Company name");
    await waitFor(() => expect(name).toBeEnabled());
    await user.clear(name);
    await user.type(name, "Alpha Motors");
    fake.failNext("workspaces", "update", { code: "PGRST000", message: "Network request failed" });

    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(await screen.findByText("Network request failed")).toBeInTheDocument();
    expect(screen.getByLabelText("Company name")).toHaveValue("Alpha Motors");
    expect(row("workspaces", WS.A)?.name).toBe("Alpha Garage");
    expect(unhandled.rejections).toEqual([]);
  });

  it("rejects an out-of-range markup before calling Supabase", async () => {
    const { user } = await openSettings(USERS.owner.id);
    const markup = await screen.findByLabelText("Inventory markup (%)");
    await waitFor(() => expect(markup).toBeEnabled());
    await user.clear(markup);
    await user.type(markup, "2000");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(markup).toBeInvalid();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(workspaceUpdates()).toHaveLength(0);
    expect(row("workspaces", WS.A)?.inventory_markup).toBe(20);
  });

  it.each([USERS.admin, USERS.manager, USERS.member])("is read-only for $email", async (viewer) => {
    await openSettings(viewer.id);
    expect(await screen.findByText("Only the workspace owner can change company settings.")).toBeInTheDocument();
    expect(screen.getByLabelText("Company name")).toBeDisabled();
    expect(screen.getByLabelText("Inventory markup (%)")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save Changes" })).not.toBeInTheDocument();
  });
});

describe("profile settings", () => {
  it("updates the signed-in user's own profile", async () => {
    const { user } = await openSettings(USERS.member.id, "profile");
    const name = await screen.findByLabelText("Full name");
    await user.clear(name);
    await user.type(name, "Max Mechanic");
    await user.type(screen.getByLabelText("Phone"), "+37369000000");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(await screen.findByText("Profile updated")).toBeInTheDocument();
    expect(row("profiles", USERS.member.id)).toMatchObject({ full_name: "Max Mechanic", phone: "+37369000000" });
    expect(row("profiles", USERS.owner.id)?.full_name).toBe(USERS.owner.name);
  });

  it("validates the phone format", async () => {
    const { user } = await openSettings(USERS.member.id, "profile");
    await user.type(await screen.findByLabelText("Phone"), "069000000");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(await screen.findByText("Phone must be in international format, such as +37300000000")).toBeInTheDocument();
    expect(fake.requests.filter((request) => request.table === "profiles" && request.op === "update")).toHaveLength(0);
  });
});

describe("appearance settings", () => {
  it("saves company preferences for the owner", async () => {
    const { user } = await openSettings(USERS.owner.id, "appearance");
    await screen.findByRole("button", { name: /Save Preferences/ });
    const selects = screen.getAllByRole("combobox");
    expect(selects[4]).toHaveTextContent("MDL");
    await user.click(selects[4]);
    await user.click(await screen.findByRole("option", { name: "USD ($)" }));
    await user.click(screen.getByRole("button", { name: /Save Preferences/ }));

    expect(await screen.findByText("Preferences saved")).toBeInTheDocument();
    expect(row("workspaces", WS.A)?.currency).toBe("USD");
  });

  it("lets a member change only the personal theme", async () => {
    const { user } = await openSettings(USERS.member.id, "appearance");
    expect(await screen.findByText(/can only be changed by the workspace owner/)).toBeInTheDocument();
    const selects = screen.getAllByRole("combobox");
    expect(selects.slice(1).every((select) => select.hasAttribute("disabled") || select.getAttribute("data-disabled") !== null)).toBe(true);

    await user.click(selects[0]);
    await user.click(await screen.findByRole("option", { name: "Dark" }));
    await user.click(screen.getByRole("button", { name: /Save Preferences/ }));

    expect(await screen.findByText("Preferences saved")).toBeInTheDocument();
    expect(row("profiles", USERS.member.id)?.theme).toBe("dark");
    expect(workspaceUpdates()).toHaveLength(0);
  });
});
