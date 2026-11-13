import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const getStatus = vi.fn();
const listEvents = vi.fn();
const listCalendars = vi.fn();

vi.mock("../../services/apiGoogleCalendar", () => ({
  getGoogleCalendarStatus: (...args: unknown[]) => getStatus(...args),
  listGoogleCalendarEvents: (...args: unknown[]) => listEvents(...args),
  listGoogleCalendars: (...args: unknown[]) => listCalendars(...args),
  createGoogleCalendarEvent: vi.fn(),
  deleteGoogleCalendarEvent: vi.fn(),
  disconnectGoogleCalendar: vi.fn(),
  moveGoogleCalendarEvent: vi.fn(),
  selectGoogleCalendar: vi.fn(),
  setVisibleGoogleCalendars: vi.fn(),
  startGoogleCalendarOAuth: vi.fn(),
  updateGoogleCalendarEvent: vi.fn(),
  updateGoogleCalendarSettings: vi.fn(),
}));

vi.mock("../profiles/useGetProfile", () => ({
  useActiveWorkspaceId: () => ({ workspaceId: "ws-1" }),
}));

import {
  useGoogleCalendarEvents,
  useGoogleCalendarList,
  useGoogleCalendarStatus,
} from "./useGoogleCalendar";

function wrapper(client: QueryClient) {
  return function W({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe("google calendar query order", () => {
  beforeEach(() => {
    getStatus.mockReset();
    listEvents.mockReset();
    listCalendars.mockReset();
    getStatus.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                connected: true,
                canAccess: true,
                teamAccess: true,
                reconnectRequired: false,
                visibleCalendars: [],
                mainCalendar: null,
                googleEmail: "a@b.c",
                calendarId: "cal",
                calendarSummary: "Main",
                calendarTimeZone: "UTC",
                connectedAt: null,
                lastError: null,
                syncOrders: false,
                syncMeasurement: false,
                syncInstallation: false,
              }),
            40,
          );
        }),
    );
    listEvents.mockResolvedValue({ events: [], calendarErrors: [] });
    listCalendars.mockResolvedValue([]);
  });

  it("starts status and events in parallel (events do not wait for status)", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const callOrder: string[] = [];
    getStatus.mockImplementation(async () => {
      callOrder.push("status-start");
      await new Promise((r) => setTimeout(r, 40));
      callOrder.push("status-done");
      return {
        connected: true,
        canAccess: true,
        teamAccess: true,
        reconnectRequired: false,
        visibleCalendars: [],
        mainCalendar: null,
        googleEmail: "a@b.c",
        calendarId: "cal",
        calendarSummary: "Main",
        calendarTimeZone: "UTC",
        connectedAt: null,
        lastError: null,
        syncOrders: false,
        syncMeasurement: false,
        syncInstallation: false,
      };
    });
    listEvents.mockImplementation(async () => {
      callOrder.push("events-start");
      return { events: [], calendarErrors: [] };
    });

    renderHook(
      () => {
        useGoogleCalendarStatus();
        useGoogleCalendarEvents("2026-11-10T00:00:00.000Z", "2026-11-17T00:00:00.000Z", true);
      },
      { wrapper: wrapper(client) },
    );

    await waitFor(() => {
      expect(callOrder).toContain("status-start");
      expect(callOrder).toContain("events-start");
      expect(callOrder).toContain("status-done");
    });
    // Events must start before status finishes (no waterfall).
    expect(callOrder.indexOf("events-start")).toBeLessThan(callOrder.indexOf("status-done"));
    expect(callOrder.indexOf("events-start")).toBeGreaterThanOrEqual(0);
  });

  it("keeps status cached across remounts (no spinner refetch within staleTime)", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { unmount } = renderHook(() => useGoogleCalendarStatus(), { wrapper: wrapper(client) });
    await waitFor(() => expect(getStatus).toHaveBeenCalledTimes(1));
    unmount();

    renderHook(() => useGoogleCalendarStatus(), { wrapper: wrapper(client) });
    await waitFor(() => expect(getStatus).toHaveBeenCalledTimes(1));
  });

  it("calendars list can start without waiting for status when enabled", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(
      () => {
        useGoogleCalendarStatus();
        useGoogleCalendarList(true);
      },
      { wrapper: wrapper(client) },
    );
    await waitFor(() => {
      expect(getStatus).toHaveBeenCalled();
      expect(listCalendars).toHaveBeenCalled();
    });
  });
});
