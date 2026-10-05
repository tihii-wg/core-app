import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
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

describe("language from the URL", () => {
  it.each([
    ["en", "Log in"],
    ["ro", "Autentificare"],
    ["ru", "Войти"],
  ])("renders the public login page in %s", async (language, submit) => {
    renderApp(`/${language}/login`);

    expect(await screen.findByRole("button", { name: submit })).toBeInTheDocument();
    expect(i18n.language).toBe(language);
    expect(document.documentElement.lang).toBe(language);
  });

  it("falls back to English for an unsupported language segment", async () => {
    renderApp("/de/login");

    expect(await screen.findByRole("button", { name: "Log in" })).toBeInTheDocument();
    expect(i18n.language).toBe("en");
  });

  it("loads a workspace page directly in the saved workspace language", async () => {
    row("workspaces", WS.A)!.language = "ru";
    fake.signInAs(USERS.owner.id);
    const { location } = renderApp(`/ru/${WS.A}/orders`);

    expect(await screen.findByRole("heading", { name: "Заказы" })).toBeInTheDocument();
    expect(location.pathname).toBe(`/ru/${WS.A}/orders`);
  });

  it("moves the URL to the saved workspace language when the segment differs", async () => {
    row("workspaces", WS.A)!.language = "ro";
    fake.signInAs(USERS.owner.id);
    const { location } = renderApp(`/en/${WS.A}/orders?search=brake`);

    await waitFor(() => expect(location.pathname).toBe(`/ro/${WS.A}/orders`));
    expect(location.search).toBe("?search=brake");
    expect(await screen.findByRole("heading", { name: "Comenzi" })).toBeInTheDocument();
  });
});

describe("switching language in settings", () => {
  it("changes the URL segment and UI text while keeping the page and query", async () => {
    fake.signInAs(USERS.owner.id);
    const { user, location } = renderApp(`/en/${WS.A}/settings?tab=appearance`);
    await screen.findByRole("button", { name: /Save Preferences/ });

    const selects = within(screen.getByRole("main")).getAllByRole("combobox");
    await user.click(selects[1]);
    await user.click(await screen.findByRole("option", { name: "Română" }));
    await user.click(screen.getByRole("button", { name: /Save Preferences/ }));

    await waitFor(() => expect(location.pathname).toBe(`/ro/${WS.A}/settings`));
    expect(location.search).toBe("?tab=appearance");
    expect(row("workspaces", WS.A)?.language).toBe("ro");
    expect(await screen.findByRole("button", { name: /Salvați preferințele/ })).toBeInTheDocument();
    expect(i18n.language).toBe("ro");
    expect(document.documentElement.lang).toBe("ro");

    await user.click(screen.getByRole("button", { name: "Comenzi" }));
    await waitFor(() => expect(location.pathname).toBe(`/ro/${WS.A}/orders`));
    expect(await screen.findByRole("heading", { name: "Comenzi" })).toBeInTheDocument();
    expect(unhandled.rejections).toEqual([]);
  });
});
