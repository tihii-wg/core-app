import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceDetails } from "../../services/apiWorkspaces";

const save = vi.fn(async () => undefined);
const subscriptionState = { canWrite: true };

vi.mock("../workspaces/useWorkspaceSubscription", () => ({
  useWorkspaceSubscription: () => subscriptionState,
  useCanEditWorkspaceSettings: () => true,
  useGuardSubscriptionWrite: () => () => undefined,
}));

vi.mock("../workspaces/useUpdateWorkspace", () => ({
  useUpdateWorkspaceSessionIdleTimeout: () => ({
    mutateAsync: save,
    isPending: false,
  }),
}));

vi.mock("../profiles/useGetProfile", () => ({
  useActiveWorkspaceId: () => ({ workspaceId: "ws-1" }),
}));

const workspaceBase = {
  id: "ws-1",
  name: "Core",
  role: "owner",
  sessionIdleTimeoutMinutes: null,
} as WorkspaceDetails;

vi.mock("../workspaces/useGetWorkspace", () => ({
  useGetWorkspace: () => ({ data: workspaceBase }),
}));

vi.mock("../../services/apiWorkspaces", async () => {
  const actual = await vi.importActual<typeof import("../../services/apiWorkspaces")>(
    "../../services/apiWorkspaces",
  );
  return {
    ...actual,
    isSessionIdleTimeoutColumnSupported: () => true,
    readSessionIdleDevOverrideMinutes: () => null,
  };
});

vi.mock("./ChangePasswordForm", () => ({ ChangePasswordForm: () => null }));
vi.mock("./TwoFactorSettings", () => ({ TwoFactorSettings: () => null }));

import { SecuritySettings } from "./SecuritySettings";

function renderSettings() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SecuritySettings />
    </QueryClientProvider>,
  );
}

describe("SecuritySettings idle timeout", () => {
  beforeEach(() => {
    save.mockReset();
    subscriptionState.canWrite = true;
    workspaceBase.role = "owner";
    workspaceBase.sessionIdleTimeoutMinutes = null;
  });

  it("lets owner/admin change and saves the selected value", async () => {
    const user = userEvent.setup();
    renderSettings();
    expect(screen.getByText(/Automatic logout on inactivity/i)).toBeInTheDocument();
    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: /12 h/i }));
    await waitFor(() => {
      expect(save).toHaveBeenCalledWith({ workspaceId: "ws-1", minutes: 720 });
    });
  });

  it("is read-only for members", async () => {
    workspaceBase.role = "member";
    renderSettings();
    expect(screen.getByRole("combobox")).toBeDisabled();
    expect(screen.getByText(/Only the workspace owner or admin/i)).toBeInTheDocument();
  });
});
