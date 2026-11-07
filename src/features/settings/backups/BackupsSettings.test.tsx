import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "../../../tests/renderQuery";
import type { WorkspaceBackupRun, WorkspaceBackupSettings } from "../../../services/apiBackups";
import { BackupsSettings } from "./BackupsSettings";

const state = vi.hoisted(() => ({
  role: "owner" as string | null,
  workspaceId: "ws-1" as string | undefined,
  timezone: "Europe/Chisinau",
  settings: null as WorkspaceBackupSettings | null,
  runs: [] as WorkspaceBackupRun[],
  settingsLoading: false,
  settingsError: null as Error | null,
  updateMutate: vi.fn(),
  disconnectMutate: vi.fn(),
  connectGoogleMutate: vi.fn(),
  connectGitHubMutate: vi.fn(),
  runMutate: vi.fn(),
  refetchSettings: vi.fn(),
  runsRefetchInterval: false as number | false,
}));

vi.mock("../../profiles/useGetProfile", () => ({
  useActiveWorkspaceId: () => ({ workspaceId: state.workspaceId }),
}));

vi.mock("../../workspaces/useGetWorkspace", () => ({
  useGetWorkspace: () => ({ data: { timezone: state.timezone } }),
}));

vi.mock("../../workspaces/useActiveWorkspaceRole", () => ({
  useActiveWorkspaceRole: () => state.role,
}));

vi.mock("./useBackups", async () => {
  const actual = await vi.importActual<typeof import("./useBackups")>("./useBackups");
  return {
    ...actual,
    useBackupSettings: () => ({
      data: state.settings,
      isLoading: state.settingsLoading,
      isError: Boolean(state.settingsError),
      error: state.settingsError,
      refetch: state.refetchSettings,
    }),
    useBackupRuns: (_enabled: boolean, refetchInterval?: number | false) => {
      state.runsRefetchInterval = refetchInterval ?? false;
      return { data: state.runs, isLoading: false };
    },
    useUpdateBackupSettings: () => ({ mutate: state.updateMutate, isPending: false }),
    useDisconnectBackup: () => ({ mutate: state.disconnectMutate, isPending: false }),
    useConnectGoogleDrive: () => ({ mutate: state.connectGoogleMutate, isPending: false }),
    useConnectGitHub: () => ({ mutate: state.connectGitHubMutate, isPending: false }),
    useRunBackup: () => ({ mutate: state.runMutate, isPending: false }),
  };
});

function settings(overrides: Partial<WorkspaceBackupSettings> = {}): WorkspaceBackupSettings {
  return {
    workspaceId: "ws-1",
    provider: "google_drive",
    enabled: false,
    frequency: "daily",
    hourUtc: 1,
    weekday: 0,
    retentionCount: 14,
    includeFiles: true,
    githubRepo: null,
    githubBranch: "main",
    githubPath: "core-app-backups",
    googleFolderId: null,
    googleAccountEmail: "owner@example.com",
    lastRunAt: null,
    lastStatus: null,
    lastError: null,
    updatedAt: null,
    credentialConnected: true,
    ...overrides,
  };
}

function run(overrides: Partial<WorkspaceBackupRun> = {}): WorkspaceBackupRun {
  return {
    id: "run-1",
    workspaceId: "ws-1",
    status: "success",
    trigger: "manual",
    provider: "google_drive",
    startedAt: "2026-11-07T10:00:00.000Z",
    finishedAt: "2026-11-07T10:01:00.000Z",
    sizeBytes: 2048,
    fileName: "core-app-backup-ws-2026-11-07_1000.zip",
    location: "https://drive.google.com/file/d/abc/view",
    error: null,
    createdAt: "2026-11-07T10:00:00.000Z",
    ...overrides,
  };
}

function renderTab() {
  return renderWithQuery(<BackupsSettings />);
}

describe("BackupsSettings", () => {
  beforeEach(() => {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.scrollIntoView = () => {};
    state.role = "owner";
    state.workspaceId = "ws-1";
    state.settings = settings();
    state.runs = [];
    state.settingsLoading = false;
    state.settingsError = null;
    state.runsRefetchInterval = false;
    state.updateMutate.mockReset();
    state.disconnectMutate.mockReset();
    state.connectGoogleMutate.mockReset();
    state.connectGitHubMutate.mockReset();
    state.runMutate.mockReset();
    state.refetchSettings.mockReset();
  });

  it("renders owner actions and history", () => {
    state.runs = [
      run(),
      run({
        id: "run-2",
        trigger: "schedule",
        status: "failed",
        error: "provider timeout",
        location: null,
        sizeBytes: null,
      }),
    ];
    renderTab();

    expect(screen.getByRole("button", { name: "Back up now" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download backup" })).toBeInTheDocument();
    expect(screen.getByText("Manual")).toBeInTheDocument();
    expect(screen.getByText("Scheduled")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("provider timeout")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open/i })).toHaveAttribute(
      "href",
      "https://drive.google.com/file/d/abc/view",
    );
  });

  it("shows a read-only note for non-owners and hides actions", () => {
    state.role = "member";
    renderTab();

    expect(screen.getByText(/Only the workspace owner can manage backups/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back up now" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connect Google Drive" })).not.toBeInTheDocument();
  });

  it("switches provider cards between Google Drive and GitHub", async () => {
    const user = userEvent.setup();
    state.settings = settings({ credentialConnected: false, provider: null, googleAccountEmail: null });
    renderTab();

    expect(screen.getByRole("button", { name: "Connect Google Drive" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "GitHub" }));
    expect(screen.getByLabelText("Repository")).toBeInTheDocument();
    expect(screen.getByLabelText("Fine-grained token")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument();
  });

  it("saves schedule with local hour converted to hour_utc", async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getByRole("switch", { name: "Automatic backups" }));
    expect(state.updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        hourUtc: 1,
      }),
    );
  });

  it("starts a manual backup run", async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getByRole("button", { name: "Back up now" }));
    expect(state.runMutate).toHaveBeenCalledWith({ download: false });

    await user.click(screen.getByRole("button", { name: "Download backup" }));
    expect(state.runMutate).toHaveBeenCalledWith({ download: true });
  });

  it("disables run actions while a run is queued or running and polls until finished", async () => {
    state.runs = [run({ status: "running" })];
    const { rerender } = renderTab();

    expect(screen.getByRole("button", { name: "Back up now" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Download backup" })).toBeDisabled();
    expect(state.runsRefetchInterval).toBe(2500);

    state.runs = [run({ status: "success" })];
    rerender(<BackupsSettings />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Back up now" })).not.toBeDisabled();
    });
    expect(state.runsRefetchInterval).toBe(false);
  });

  it("renders connected Google state with disconnect", () => {
    renderTab();
    expect(screen.getByText(/Connected as owner@example.com/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
  });

  it("connects GitHub with repo details", async () => {
    const user = userEvent.setup();
    state.settings = settings({
      provider: null,
      credentialConnected: false,
      googleAccountEmail: null,
    });
    renderTab();

    await user.click(screen.getByRole("button", { name: "GitHub" }));
    await user.type(screen.getByLabelText("Repository"), "acme/private-backups");
    await user.type(screen.getByLabelText("Fine-grained token"), "ghp_test_token");
    await user.click(screen.getByRole("button", { name: "Connect" }));

    expect(state.connectGitHubMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: "acme/private-backups",
        token: "ghp_test_token",
      }),
    );
  });
});
