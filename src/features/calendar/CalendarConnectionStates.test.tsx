import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@fullcalendar/react", () => ({
  default: () => <div data-testid="fullcalendar-mock" />,
}));
vi.mock("@fullcalendar/daygrid", () => ({ default: {} }));
vi.mock("@fullcalendar/timegrid", () => ({ default: {} }));
vi.mock("@fullcalendar/interaction", () => ({ default: {} }));
vi.mock("@fullcalendar/list", () => ({ default: {} }));
vi.mock("@fullcalendar/core/locales/ru", () => ({ default: {} }));
vi.mock("@fullcalendar/core/locales/ro", () => ({ default: {} }));
vi.mock("@fullcalendar/core/locales/en-gb", () => ({ default: {} }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

vi.mock("../workspaces/useIsWorkspaceOwnerId", () => ({
  useIsWorkspaceOwnerId: () => mockIsOwner(),
}));

vi.mock("../profiles/useGetProfile", () => ({
  useActiveWorkspaceId: () => ({ workspaceId: "ws-test-12345678" }),
}));

vi.mock("../workspaces/useGetWorkspace", () => ({
  useGetWorkspace: () => ({ data: { timezone: "Europe/Chisinau" } }),
}));

vi.mock("../industries/useIndustryWorkflow", () => ({
  useIndustryWorkflow: () => ({ profile: { orderFieldBlocks: {} } }),
}));

vi.mock("../orders/useGetOrders", () => ({
  useGetOrders: () => ({ orders: [], isLoading: false, error: null, refetch: vi.fn() }),
}));

vi.mock("../../ui/ConfirmProvider", () => ({
  useConfirm: () => async () => false,
}));

const mockIsOwner = vi.fn(() => true);
const mockStatus = vi.fn();

vi.mock("./useGoogleCalendar", () => ({
  useGoogleCalendarStatus: () => ({ data: mockStatus(), isLoading: false, isError: false }),
  useGoogleCalendarEvents: () => ({ data: { events: [], calendarErrors: [] } }),
  useGoogleCalendarList: () => ({ data: [], refetch: vi.fn() }),
  useConnectGoogleCalendar: () => ({ mutate: vi.fn(), isPending: false }),
  useDisconnectGoogleCalendar: () => ({ mutate: vi.fn(), isPending: false }),
  useSelectGoogleCalendar: () => ({ mutate: vi.fn(), isPending: false }),
  useSetVisibleGoogleCalendars: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateGoogleCalendarEvent: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateGoogleCalendarEvent: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteGoogleCalendarEvent: () => ({ mutate: vi.fn(), isPending: false }),
  useMoveGoogleCalendarEvent: () => ({ mutate: vi.fn(), isPending: false }),
  useRefreshGoogleCalendar: () => async () => undefined,
  useUpdateGoogleCalendarSettings: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("../../hooks/useMediaQuery", () => ({
  useMediaQuery: (query: string) => {
    if (query.includes("min-width: 1024")) return true;
    return false;
  },
}));

vi.mock("../orders/useOrderDetails", () => ({
  useOrderDetails: () => ({
    openOrder: vi.fn(),
    panelProps: { selectedOrder: null },
  }),
}));

vi.mock("../orders/OrderDetailPanel", () => ({ default: () => null }));

vi.mock("../../services/apiOrders", () => ({
  getOrder: vi.fn(),
}));

import { CalendarPage } from "./CalendarPage";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/en/ws-test-12345678/calendar"]}>
        <CalendarPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("CalendarPage connection states", () => {
  it("shows connect CTA for owner when disconnected", () => {
    mockIsOwner.mockReturnValue(true);
    mockStatus.mockReturnValue({ connected: false, reconnectRequired: false });
    renderPage();
    expect(screen.getAllByText("calendar.connect").length).toBeGreaterThan(0);
    expect(screen.getByText("calendar.connectHint")).toBeInTheDocument();
  });

  it("shows waiting message for member when disconnected", () => {
    mockIsOwner.mockReturnValue(false);
    mockStatus.mockReturnValue({ connected: false, reconnectRequired: false });
    renderPage();
    expect(screen.getByText("calendar.waitingOwner")).toBeInTheDocument();
  });

  it("shows reconnect when required", () => {
    mockIsOwner.mockReturnValue(true);
    mockStatus.mockReturnValue({ connected: false, reconnectRequired: true, lastError: "invalid_grant" });
    renderPage();
    expect(screen.getByText("calendar.reconnectRequired")).toBeInTheDocument();
  });

  it("shows connected header with email and calendar name", () => {
    mockIsOwner.mockReturnValue(true);
    mockStatus.mockReturnValue({
      connected: true,
      googleEmail: "owner@example.com",
      calendarSummary: "Workshop",
      calendarId: "cal-1",
      canAccess: true,
      visibleCalendars: [],
      mainCalendar: { id: "cal-1", summary: "Workshop", backgroundColor: "#039be5" },
      reconnectRequired: false,
    });
    renderPage();
    expect(screen.getByText("Workshop")).toBeInTheDocument();
    expect(screen.getByText("owner@example.com")).toBeInTheDocument();
    expect(screen.getByText("calendar.changeCalendar")).toBeInTheDocument();
    expect(screen.getByText("calendar.disconnect")).toBeInTheDocument();
  });
});
