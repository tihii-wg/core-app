import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import toast, { Toaster } from "react-hot-toast";
import { MemoryRouter, useLocation } from "react-router-dom";
import { AppRoutes } from "../App";
import { AuthSession } from "../features/auth/AuthSession";
import { AppProvider } from "../lib/appContext";
import { createTestQueryClient } from "./hookHarness";

/** Browser APIs jsdom lacks that the layout, Radix menus and charts call. */
export function installDomStubs() {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
}

/** Renders the real route tree (guards, layout, pages) the way App does, on a memory router. */
export function renderApp(path: string) {
  toast.remove();
  const queryClient = createTestQueryClient();
  const location = { pathname: path, search: "" };

  function LocationProbe() {
    const current = useLocation();
    location.pathname = current.pathname;
    location.search = current.search;
    return null;
  }

  const utils = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AppProvider>
          <AuthSession />
          <LocationProbe />
          <AppRoutes />
          <Toaster />
        </AppProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

  return { ...utils, queryClient, location, user: userEvent.setup() };
}

/** Collects promise rejections nobody handled (e.g. a form awaiting a failed mutation). */
export function trackUnhandledRejections() {
  const rejections: unknown[] = [];
  const listener = (reason: unknown) => rejections.push(reason);
  process.on("unhandledRejection", listener);
  return {
    rejections,
    stop: () => process.off("unhandledRejection", listener),
  };
}
