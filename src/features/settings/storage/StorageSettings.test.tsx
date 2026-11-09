import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmProvider } from "../../../ui/ConfirmProvider";
import type {
  AttachmentStorageMode,
  WorkspaceAttachmentUsage,
  WorkspaceGoogleDrive,
  WorkspaceNasStorage,
} from "../../../services/apiAttachmentStorage";
import { StorageSettings } from "./StorageSettings";

const state = vi.hoisted(() => ({
  isOwner: true,
  workspaceId: "ws-1" as string | undefined,
  mode: "app" as AttachmentStorageMode,
  drive: null as WorkspaceGoogleDrive | null,
  nas: null as WorkspaceNasStorage | null,
  usage: { appBytes: 0, appFiles: 0, driveBytes: 0, driveFiles: 0, nasBytes: 0, nasFiles: 0 } as WorkspaceAttachmentUsage,
  setMutate: vi.fn(),
  connectMutate: vi.fn(),
  disconnectMutate: vi.fn(),
  refresh: vi.fn(),
}));

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("react-hot-toast", () => ({ default: toastMock }));

vi.mock("../../profiles/useGetProfile", () => ({
  useActiveWorkspaceId: () => ({ workspaceId: state.workspaceId }),
}));

vi.mock("../../workspaces/useGetWorkspace", () => ({
  useGetWorkspace: () => ({
    data: { attachmentStorage: state.mode, name: "Alpha Garage", ownerId: "owner-1" },
  }),
}));

vi.mock("../../../services/apiWorkspaces", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../services/apiWorkspaces")>();
  return {
    ...actual,
    getWorkspaceMembers: vi.fn(async () => [
      {
        userId: "owner-1",
        role: "owner",
        createdAt: null,
        fullName: "Ada Owner",
        email: "owner@example.com",
        isCurrentUser: false,
      },
    ]),
  };
});

vi.mock("../../../ui/use-mobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("../../workspaces/useIsWorkspaceOwnerId", () => ({
  useIsWorkspaceOwnerId: () => state.isOwner,
}));

vi.mock("./useAttachmentStorage", () => ({
  useWorkspaceGoogleDrive: () => ({ data: state.drive, isLoading: false, isError: false, error: null }),
  useWorkspaceNasStorage: () => ({ data: state.nas, isLoading: false, isError: false, error: null }),
  useTestNasConnection: () => ({ mutate: vi.fn(), isPending: false }),
  useSaveNasConnection: () => ({ mutate: vi.fn(), isPending: false }),
  useDisconnectNasStorage: () => ({ mutate: vi.fn(), isPending: false }),
  useAttachmentUsage: () => ({ data: state.usage, isLoading: false, isError: false, error: null }),
  useRefreshAttachmentStorage: () => state.refresh,
  useSetAttachmentStorage: () => ({ mutate: state.setMutate, isPending: false }),
  useConnectPhotosGoogleDrive: () => ({ mutate: state.connectMutate, isPending: false }),
  useDisconnectPhotosGoogleDrive: () => ({ mutate: state.disconnectMutate, isPending: false }),
}));

function drive(overrides: Partial<WorkspaceGoogleDrive> = {}): WorkspaceGoogleDrive {
  return {
    workspaceId: "ws-1",
    googleAccountEmail: "owner@example.com",
    rootFolderId: "folder-123",
    status: "connected",
    lastError: null,
    ...overrides,
  };
}

function nasRow(overrides: Partial<WorkspaceNasStorage> = {}): WorkspaceNasStorage {
  return {
    workspaceId: "ws-1",
    protocol: "webdav",
    baseUrl: "https://nas.example.com",
    rootPath: "/CoreApp",
    username: "owner",
    bucket: null,
    region: null,
    status: "connected",
    lastError: null,
    lastCheckedAt: null,
    hasCredential: true,
    ...overrides,
  };
}

function renderTab(entry = "/en/ws-1/settings?tab=storage") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <ConfirmProvider>
          <MemoryRouter initialEntries={[entry]}>{children}</MemoryRouter>
        </ConfirmProvider>
      </QueryClientProvider>
    );
  }
  return render(<StorageSettings />, { wrapper: Wrapper });
}

describe("StorageSettings", () => {
  beforeEach(() => {
    state.isOwner = true;
    state.workspaceId = "ws-1";
    state.mode = "app";
    state.drive = null;
    state.nas = null;
    state.usage = { appBytes: 0, appFiles: 0, driveBytes: 0, driveFiles: 0, nasBytes: 0, nasFiles: 0 };
    state.setMutate.mockReset();
    state.connectMutate.mockReset();
    state.disconnectMutate.mockReset();
    state.refresh.mockReset().mockResolvedValue(undefined);
    toastMock.success.mockReset();
    toastMock.error.mockReset();
  });

  it("shows formatted app usage and the limited-storage note in app mode", () => {
    state.usage = { appBytes: 5 * 1024 * 1024, appFiles: 12, driveBytes: 0, driveFiles: 0, nasBytes: 0, nasFiles: 0 };
    renderTab();

    expect(screen.getByRole("radio", { name: /In the app/i })).toBeChecked();
    expect(screen.getByText("Used 5 MB · 12 files")).toBeInTheDocument();
    expect(screen.getByText(/App storage is limited/i)).toBeInTheDocument();
  });

  it("uses the singular form for one file", () => {
    state.usage = { appBytes: 512, appFiles: 1, driveBytes: 0, driveFiles: 0, nasBytes: 0, nasFiles: 0 };
    renderTab();
    expect(screen.getByText("Used 512 B · 1 file")).toBeInTheDocument();
  });

  it("owner switching back to app calls setAttachmentStorage", async () => {
    const user = userEvent.setup();
    state.mode = "google_drive";
    state.drive = drive();
    renderTab();

    await user.click(screen.getByRole("radio", { name: /In the app/i }));
    expect(state.setMutate).toHaveBeenCalledWith("app", expect.any(Object));
  });

  it("owner selecting Drive when disconnected shows Connect without switching", async () => {
    const user = userEvent.setup();
    state.drive = drive({ status: "disconnected", rootFolderId: null, googleAccountEmail: null });
    renderTab();

    await user.click(screen.getByRole("radio", { name: /Google Drive/i }));
    expect(state.setMutate).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Connect Google Drive" }));
    expect(state.connectMutate).toHaveBeenCalledWith("en");
  });

  it("owner selecting a connected Drive switches the mode", async () => {
    const user = userEvent.setup();
    state.drive = drive();
    renderTab();

    await user.click(screen.getByRole("radio", { name: /Google Drive/i }));
    expect(state.setMutate).toHaveBeenCalledWith("google_drive", expect.any(Object));
  });

  it("connected state shows email, folder link and confirmed disconnect", async () => {
    const user = userEvent.setup();
    state.mode = "google_drive";
    state.drive = drive();
    state.usage = { appBytes: 0, appFiles: 0, driveBytes: 2048, driveFiles: 4, nasBytes: 0, nasFiles: 0 };
    renderTab();

    expect(screen.getByText(/owner@example.com/)).toBeInTheDocument();
    expect(screen.getByText("In Drive: 2 KB · 4 files")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open folder/i })).toHaveAttribute(
      "href",
      "https://drive.google.com/drive/folders/folder-123",
    );

    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    const dialog = await screen.findByRole("dialog");
    expect(state.disconnectMutate).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(state.disconnectMutate).toHaveBeenCalled());
  });

  it("error state shows a red reconnect-needed card with a reconnect button", async () => {
    const user = userEvent.setup();
    state.mode = "google_drive";
    state.drive = drive({ status: "error", lastError: "invalid_grant" });
    renderTab();

    const alert = screen.getByRole("alert");
    expect(within(alert).getByRole("button", { name: "Reconnect needed" })).toBeInTheDocument();
    expect(within(alert).getByText("invalid_grant")).toBeInTheDocument();
    await user.click(within(alert).getByRole("button", { name: "Reconnect Google Drive" }));
    expect(state.connectMutate).toHaveBeenCalledWith("en");
  });

  it("shows the connection guide for owner and non-owner in every Drive state", async () => {
    const user = userEvent.setup();
    state.mode = "google_drive";
    state.drive = drive({ status: "disconnected", rootFolderId: null, googleAccountEmail: null });
    renderTab();
    expect(screen.getByRole("button", { name: /Connection guide/i })).toBeInTheDocument();
    expect(screen.getByText(/You only need to sign in to Google/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /How does it work/i })).toBeInTheDocument();

    state.isOwner = false;
    state.drive = drive();
    renderTab();
    expect(screen.getAllByRole("button", { name: /Connection guide/i }).length).toBeGreaterThan(0);

    state.isOwner = true;
    state.drive = drive({ status: "error", lastError: "invalid_grant" });
    renderTab();
    await user.click(screen.getByRole("button", { name: "Reconnect needed" }));
    expect(await screen.findByRole("heading", { name: /How to connect Google Drive/i })).toBeInTheDocument();
    expect(screen.getByTestId("gdrive-help-troubleshooting")).toBeInTheDocument();
  });

  it("non-owners get a read-only view with the owner-only note", () => {
    state.isOwner = false;
    state.mode = "google_drive";
    state.drive = drive();
    renderTab();

    expect(screen.getByText("Only the workspace owner can change this.")).toBeInTheDocument();
    for (const radio of screen.getAllByRole("radio")) expect(radio).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Disconnect" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open folder/i })).toBeInTheDocument();
  });

  it("non-owners cannot connect when Drive is disconnected", () => {
    state.isOwner = false;
    state.mode = "google_drive";
    state.drive = drive({ status: "disconnected", rootFolderId: null });
    renderTab();

    expect(screen.queryByRole("button", { name: "Connect Google Drive" })).not.toBeInTheDocument();
  });

  it("handles ?gdrive=connected: toast, refresh and switch to Drive", async () => {
    state.drive = drive();
    renderTab("/en/ws-1/settings?tab=storage&gdrive=connected");

    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Google Drive connected"));
    expect(state.refresh).toHaveBeenCalled();
    expect(state.setMutate).toHaveBeenCalledWith("google_drive");
  });

  it("handles ?gdrive=error with a reason toast", async () => {
    renderTab("/en/ws-1/settings?tab=storage&gdrive=error&reason=access_denied");

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith("Could not connect Google Drive (access_denied)"),
    );
    expect(state.refresh).toHaveBeenCalled();
    expect(state.setMutate).not.toHaveBeenCalled();
  });
  it("owner selecting NAS when disconnected shows the form without switching", async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getByRole("radio", { name: /NAS/i }));
    expect(state.setMutate).not.toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: /NAS/i })).toBeChecked();
    expect(screen.getByLabelText("Server address")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("owner selecting a connected NAS switches the mode", async () => {
    const user = userEvent.setup();
    state.nas = nasRow();
    renderTab();

    await user.click(screen.getByRole("radio", { name: /NAS/i }));
    expect(state.setMutate).toHaveBeenCalledWith("nas", expect.any(Object));
  });

  it("NAS mode shows status, usage and a saved password placeholder", () => {
    state.mode = "nas";
    state.nas = nasRow();
    state.usage = { appBytes: 0, appFiles: 0, driveBytes: 0, driveFiles: 0, nasBytes: 3 * 1024, nasFiles: 2 };
    renderTab();

    expect(screen.getByRole("radio", { name: /NAS/i })).toBeChecked();
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("On NAS: 3 KB · 2 files")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toHaveAttribute("placeholder", "Saved");
  });

  it("non-owners see the NAS read-only", () => {
    state.isOwner = false;
    state.mode = "nas";
    state.nas = nasRow();
    renderTab();

    expect(screen.getByText("Only the workspace owner can change this.")).toBeInTheDocument();
    for (const radio of screen.getAllByRole("radio")) expect(radio).toBeDisabled();
    expect(screen.getByLabelText("Server address")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Disconnect" })).not.toBeInTheDocument();
  });

  it("usage summary lists all three providers when any has files", () => {
    state.usage = { appBytes: 1024, appFiles: 1, driveBytes: 0, driveFiles: 0, nasBytes: 2048, nasFiles: 3 };
    renderTab();

    const summary = screen.getByText("Stored photos").parentElement as HTMLElement;
    expect(within(summary).getByText("In the app")).toBeInTheDocument();
    expect(within(summary).getByText("Google Drive")).toBeInTheDocument();
    expect(within(summary).getByText("0 B · 0 files")).toBeInTheDocument();
    expect(within(summary).getByText("NAS")).toBeInTheDocument();
    expect(within(summary).getByText("2 KB · 3 files")).toBeInTheDocument();
  });

  it("hides the usage summary when nothing is stored", () => {
    renderTab();
    expect(screen.queryByText("Stored photos")).not.toBeInTheDocument();
  });
});
