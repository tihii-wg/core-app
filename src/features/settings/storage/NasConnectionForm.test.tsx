import type { ReactNode } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmProvider } from "../../../ui/ConfirmProvider";
import type { WorkspaceNasStorage } from "../../../services/apiAttachmentStorage";
import { NasConnectionForm } from "./NasConnectionForm";

const state = vi.hoisted(() => ({
  testMutate: vi.fn(),
  saveMutate: vi.fn(),
  disconnectMutate: vi.fn(),
}));

vi.mock("./useAttachmentStorage", () => ({
  useTestNasConnection: () => ({ mutate: state.testMutate, isPending: false }),
  useSaveNasConnection: () => ({ mutate: state.saveMutate, isPending: false }),
  useDisconnectNasStorage: () => ({ mutate: state.disconnectMutate, isPending: false }),
}));

function nas(overrides: Partial<WorkspaceNasStorage> = {}): WorkspaceNasStorage {
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
    lastCheckedAt: "2026-11-09T08:00:00.000Z",
    hasCredential: true,
    ...overrides,
  };
}

function renderForm(props: Partial<React.ComponentProps<typeof NasConnectionForm>> = {}) {
  function Wrapper({ children }: { children: ReactNode }) {
    return <ConfirmProvider>{children}</ConfirmProvider>;
  }
  return render(<NasConnectionForm nas={null} isOwner onSaved={undefined} {...props} />, { wrapper: Wrapper });
}

describe("NasConnectionForm", () => {
  beforeEach(() => {
    state.testMutate.mockReset();
    state.saveMutate.mockReset();
    state.disconnectMutate.mockReset();
  });

  it("starts as WebDAV with the default folder and shows the HTTPS/DDNS help", () => {
    renderForm();

    expect(screen.getByLabelText("Folder")).toHaveValue("/CoreApp");
    expect(screen.getByLabelText("Username")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.queryByLabelText("Bucket")).not.toBeInTheDocument();
    expect(screen.getByText(/Let's Encrypt/)).toBeInTheDocument();
    expect(screen.getByText(/Cloudflare Tunnel/)).toBeInTheDocument();
    expect(screen.getByText(/QuickConnect does not work/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Disconnect" })).not.toBeInTheDocument();
  });

  it("requires an https:// address and does not submit otherwise", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText("Server address"), "http://nas.example.com");
    await user.type(screen.getByLabelText("Username"), "owner");
    await user.type(screen.getByLabelText("Password"), "secret");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByText("The address must start with https://")).toBeInTheDocument();
    expect(state.saveMutate).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Test connection" }));
    expect(state.testMutate).not.toHaveBeenCalled();
  });

  it("flags missing required WebDAV fields", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getAllByText("Required")).toHaveLength(3);
    expect(state.saveMutate).not.toHaveBeenCalled();
  });

  it("saves a WebDAV connection with a normalized folder", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    state.saveMutate.mockImplementation((_payload, options) => options?.onSuccess?.());
    renderForm({ onSaved });

    await user.type(screen.getByLabelText("Server address"), "https://nas.example.com");
    await user.clear(screen.getByLabelText("Folder"));
    await user.type(screen.getByLabelText("Folder"), "Photos/");
    await user.type(screen.getByLabelText("Username"), "owner");
    await user.type(screen.getByLabelText("Password"), "secret");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(state.saveMutate).toHaveBeenCalledWith(
      {
        protocol: "webdav",
        baseUrl: "https://nas.example.com",
        rootPath: "/Photos",
        username: "owner",
        password: "secret",
      },
      expect.any(Object),
    );
    expect(onSaved).toHaveBeenCalled();
  });

  it("test connection posts the current values", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText("Server address"), "https://nas.example.com");
    await user.type(screen.getByLabelText("Username"), "owner");
    await user.type(screen.getByLabelText("Password"), "secret");
    await user.click(screen.getByRole("button", { name: "Test connection" }));

    expect(state.testMutate).toHaveBeenCalledWith({
      protocol: "webdav",
      baseUrl: "https://nas.example.com",
      rootPath: "/CoreApp",
      username: "owner",
      password: "secret",
    });
  });

  it("switching to S3 swaps the credential fields and sends S3 values", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole("combobox", { name: "Protocol" }));
    await user.click(await screen.findByRole("option", { name: "S3-compatible" }));

    expect(screen.queryByLabelText("Username")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    for (const label of ["Bucket", "Region (optional)", "Access key ID", "Secret access key"]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }

    await user.type(screen.getByLabelText("Server address"), "https://s3.example.com");
    await user.type(screen.getByLabelText("Bucket"), "photos");
    await user.type(screen.getByLabelText("Region (optional)"), "eu-west-1");
    await user.type(screen.getByLabelText("Access key ID"), "AKIA123");
    await user.type(screen.getByLabelText("Secret access key"), "s3cret");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(state.saveMutate).toHaveBeenCalledWith(
      {
        protocol: "s3",
        baseUrl: "https://s3.example.com",
        rootPath: "/CoreApp",
        bucket: "photos",
        region: "eu-west-1",
        accessKeyId: "AKIA123",
        secretAccessKey: "s3cret",
      },
      expect.any(Object),
    );
  });

  it("connected: keeps the saved password unless the owner changes the secret", async () => {
    const user = userEvent.setup();
    renderForm({ nas: nas() });

    const password = screen.getByLabelText("Password");
    expect(password).toBeDisabled();
    expect(password).toHaveAttribute("placeholder", "Saved");
    expect(screen.getByText("Connected")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(state.saveMutate).toHaveBeenCalledWith(
      {
        protocol: "webdav",
        baseUrl: "https://nas.example.com",
        rootPath: "/CoreApp",
        username: "owner",
        keepExistingSecret: true,
      },
      expect.any(Object),
    );

    state.saveMutate.mockReset();
    await user.click(screen.getByRole("button", { name: "Change secret" }));
    expect(screen.getByLabelText("Password")).toBeEnabled();
    await user.type(screen.getByLabelText("Password"), "new-secret");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(state.saveMutate).toHaveBeenCalledWith(
      {
        protocol: "webdav",
        baseUrl: "https://nas.example.com",
        rootPath: "/CoreApp",
        username: "owner",
        password: "new-secret",
      },
      expect.any(Object),
    );
  });

  it("requires re-entering the secret when the server address changes", async () => {
    const user = userEvent.setup();
    renderForm({ nas: nas() });

    await user.clear(screen.getByLabelText("Server address"));
    await user.type(screen.getByLabelText("Server address"), "https://other.example.com");
    expect(screen.getByLabelText("Password")).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Change secret" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Enter the secret again")).toBeInTheDocument();
    expect(state.saveMutate).not.toHaveBeenCalled();
  });

  it("shows the last error as plain text", () => {
    renderForm({ nas: nas({ status: "error", lastError: "auth_failed", hasCredential: false }) });

    expect(screen.getByText("Connection problem")).toBeInTheDocument();
    expect(screen.getByText("Last error: auth_failed")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeEnabled();
  });

  it("disconnect asks for confirmation first", async () => {
    const user = userEvent.setup();
    renderForm({ nas: nas() });

    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    const dialog = await screen.findByRole("dialog");
    expect(state.disconnectMutate).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(state.disconnectMutate).toHaveBeenCalled());
  });

  it("non-owners get a read-only form without actions", () => {
    renderForm({ nas: nas(), isOwner: false });

    expect(screen.getByLabelText("Server address")).toBeDisabled();
    expect(screen.getByLabelText("Username")).toBeDisabled();
    expect(screen.getByLabelText("Password")).toBeDisabled();
    expect(screen.getByLabelText("Password")).toHaveAttribute("placeholder", "Saved");
    expect(screen.getByRole("combobox", { name: "Protocol" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Test connection" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Disconnect" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change secret" })).not.toBeInTheDocument();
    expect(screen.getByText("Only the workspace owner can connect or change the NAS.")).toBeInTheDocument();
  });
});
