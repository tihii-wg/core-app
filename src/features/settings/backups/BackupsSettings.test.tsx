import { screen, waitFor, within } from "@testing-library/react";
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
  disconnectMutateAsync: vi.fn(),
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
    useDisconnectBackup: () => ({
      mutate: state.disconnectMutate,
      mutateAsync: state.disconnectMutateAsync,
      isPending: false,
    }),
    useConnectGoogleDrive: () => ({ mutate: state.connectGoogleMutate, isPending: false }),
    useConnectGitHub: () => ({ mutate: state.connectGitHubMutate, isPending: false }),
    useRunBackup: () => ({ mutate: state.runMutate, isPending: false }),
  };
});

function settings(overrides: Partial<WorkspaceBackupSettings> = {}): WorkspaceBackupSettings {
  return {
    workspaceId: "ws-1",
    provider: "google_drive",
    enabled: true,
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
    state.disconnectMutateAsync.mockReset().mockResolvedValue(undefined);
    state.connectGoogleMutate.mockReset();
    state.connectGitHubMutate.mockReset();
    state.runMutate.mockReset();
    state.refetchSettings.mockReset();
  });

  it("hides provider/schedule/actions when backups are OFF and shows collapsed history", () => {
    state.settings = settings({ enabled: false });
    state.runs = [run()];
    renderTab();

    expect(screen.getByRole("switch", { name: "Backups" })).not.toBeChecked();
    expect(screen.queryByText("Where to save")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back up now" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Backup history" })).toBeInTheDocument();
    expect(screen.queryByText("Manual")).not.toBeInTheDocument();
  });

  it("shows provider step when ON", () => {
    state.settings = settings({
      enabled: true,
      provider: null,
      credentialConnected: false,
      googleAccountEmail: null,
    });
    renderTab();

    expect(screen.getByText("Where to save")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Google Drive/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^GitHub$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back up now" })).not.toBeInTheDocument();
  });

  it("disables schedule and actions until the provider is connected", () => {
    state.settings = settings({
      enabled: true,
      provider: "google_drive",
      credentialConnected: false,
      googleAccountEmail: null,
    });
    renderTab();

    expect(screen.getAllByText(/Connect Google Drive first/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: "Back up now" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Download backup" })).toBeDisabled();
    const frequency = screen.getByText("Frequency").closest("div")?.querySelector('[role="combobox"]');
    expect(frequency).toHaveAttribute("data-disabled");
  });

  it("turning OFF asks for confirmation and does not disconnect", async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getByRole("switch", { name: "Backups" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Turn off automatic backups/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/storage connection will be kept/i)).toBeInTheDocument();
    expect(state.updateMutate).not.toHaveBeenCalled();
    expect(state.disconnectMutate).not.toHaveBeenCalled();
    expect(state.disconnectMutateAsync).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Turn off" }));
    await waitFor(() =>
      expect(state.updateMutate).toHaveBeenCalledWith(expect.objectContaining({ enabled: false })),
    );
    expect(state.disconnectMutate).not.toHaveBeenCalled();
    expect(state.disconnectMutateAsync).not.toHaveBeenCalled();
  });

  it("switching provider asks for confirmation and disconnects first", async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getByRole("button", { name: /^GitHub$/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Switch backup destination/i)).toBeInTheDocument();
    expect(state.disconnectMutateAsync).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Switch" }));
    await waitFor(() => expect(state.disconnectMutateAsync).toHaveBeenCalled());
    expect(state.updateMutate).toHaveBeenCalledWith(expect.objectContaining({ provider: "github" }));
  });

  it("shows a read-only master switch for non-owners", () => {
    state.role = "member";
    state.settings = settings({ enabled: false });
    renderTab();

    expect(screen.getByText(/Only the workspace owner can manage backups/i)).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Backups" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Back up now" })).not.toBeInTheDocument();
  });

  it("starts a manual backup run when connected", async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getByRole("button", { name: "Back up now" }));
    expect(state.runMutate).toHaveBeenCalledWith({ download: false });
  });

  it("renders history when enabled and connected", () => {
    state.runs = [run({ trigger: "schedule", status: "failed", error: "provider timeout", location: null })];
    renderTab();

    expect(screen.getByText("Scheduled")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("provider timeout")).toBeInTheDocument();
  });
});
