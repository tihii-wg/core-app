import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../../i18n";
import { GoogleDriveHelpDialog } from "./GoogleDriveHelpDialog";

const state = vi.hoisted(() => ({
  isOwner: true,
  workspaceId: "ws-1" as string | undefined,
  workspaceName: "Alpha Garage",
  ownerId: "owner-1",
  ownerName: "Ada Owner",
}));

vi.mock("../../workspaces/useIsWorkspaceOwnerId", () => ({
  useIsWorkspaceOwnerId: () => state.isOwner,
}));

vi.mock("../../profiles/useGetProfile", () => ({
  useActiveWorkspaceId: () => ({ workspaceId: state.workspaceId }),
}));

vi.mock("../../workspaces/useGetWorkspace", () => ({
  useGetWorkspace: () => ({
    data: {
      name: state.workspaceName,
      ownerId: state.ownerId,
      attachmentStorage: "app",
    },
  }),
}));

vi.mock("../../../services/apiWorkspaces", () => ({
  getWorkspaceMembers: vi.fn(async () => [
    {
      userId: state.ownerId,
      role: "owner",
      createdAt: null,
      fullName: state.ownerName,
      email: "owner@example.com",
      isCurrentUser: false,
    },
  ]),
}));

vi.mock("../../../ui/use-mobile", () => ({
  useIsMobile: () => false,
}));

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  state.isOwner = true;
  state.workspaceName = "Alpha Garage";
  state.ownerName = "Ada Owner";
  await i18n.changeLanguage("en");
});

describe("GoogleDriveHelpDialog", () => {
  it("renders steps with the workspace name for the owner", async () => {
    wrap(<GoogleDriveHelpDialog open onOpenChange={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: /How to connect Google Drive/i })).toBeInTheDocument();
    expect(screen.getByText(/Core App — Alpha Garage/i)).toBeInTheDocument();
    expect(screen.queryByText(/Only the company owner can connect Drive:/i)).not.toBeInTheDocument();
  });

  it("shows the non-owner banner with the owner name", async () => {
    state.isOwner = false;
    wrap(<GoogleDriveHelpDialog open onOpenChange={vi.fn()} />);
    expect(await screen.findByText(/Only the company owner can connect Drive: Ada Owner/i)).toBeInTheDocument();
  });

  it("shows the open-storage button when requested", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    wrap(<GoogleDriveHelpDialog open onOpenChange={onOpenChange} showOpenStorageButton />);
    expect(await screen.findByRole("button", { name: /Open storage settings/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Open storage settings/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("scrolls to troubleshooting when scrollTo is troubleshooting", async () => {
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    wrap(<GoogleDriveHelpDialog open onOpenChange={vi.fn()} scrollTo="troubleshooting" />);
    const section = await screen.findByTestId("gdrive-help-troubleshooting");
    expect(within(section).getByText(/If something went wrong/i)).toBeInTheDocument();
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
  });

  it("has ru / ro / en translations for the guide title and steps", async () => {
    for (const lng of ["ru", "ro", "en"] as const) {
      await i18n.changeLanguage(lng);
      expect(i18n.exists("settings.storage.googleDriveHelp.title")).toBe(true);
      expect(i18n.exists("settings.storage.googleDriveHelp.steps.5")).toBe(true);
      expect(i18n.exists("settings.storage.googleDriveHelp.useful.1")).toBe(true);
      expect(i18n.exists("settings.storage.googleDriveHelp.troubleshooting.1")).toBe(true);
      const step5 = i18n.t("settings.storage.googleDriveHelp.steps.5", { workspaceName: "Test Co" });
      expect(step5).toContain("Core App — Test Co");
    }
  });
});
