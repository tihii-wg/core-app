import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "../../tests/renderQuery";
import { SubscriptionReadOnlyNotice } from "./SubscriptionReadOnlyNotice";

const subscriptionState = vi.hoisted(() => ({
  canWrite: false,
  status: "expired" as string | null,
  expiresAt: "2025-01-01T00:00:00.000Z" as string | null,
  isEntitlementPending: false,
  error: null as Error | null,
  refetch: vi.fn(),
}));

vi.mock("./useWorkspaceSubscription", () => ({
  useWorkspaceSubscription: () => ({
    canWrite: subscriptionState.canWrite,
    status: subscriptionState.status,
    expiresAt: subscriptionState.expiresAt,
    isEntitlementPending: subscriptionState.isEntitlementPending,
    isLoading: subscriptionState.isEntitlementPending,
    error: subscriptionState.error,
    refetch: subscriptionState.refetch,
    workspaceId: "ws-1",
  }),
}));

describe("SubscriptionReadOnlyNotice", () => {
  beforeEach(() => {
    subscriptionState.canWrite = false;
    subscriptionState.status = "expired";
    subscriptionState.expiresAt = "2025-01-01T00:00:00.000Z";
    subscriptionState.isEntitlementPending = false;
    subscriptionState.error = null;
    subscriptionState.refetch.mockReset();
  });

  it("renders nothing while subscription entitlement is still loading", () => {
    subscriptionState.isEntitlementPending = true;
    const { container } = renderWithQuery(<SubscriptionReadOnlyNotice />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByText(/view-only/i)).not.toBeInTheDocument();
  });

  it("renders nothing for an active subscription after entitlement resolves", () => {
    subscriptionState.canWrite = true;
    subscriptionState.status = "active";
    subscriptionState.expiresAt = null;
    const { container } = renderWithQuery(<SubscriptionReadOnlyNotice />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the read-only notice once an expired subscription is resolved", () => {
    renderWithQuery(<SubscriptionReadOnlyNotice />);
    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent(/view-only/i);
    expect(notice).toHaveTextContent(/Expired/i);
  });

  it("shows a localized load error with retry instead of an expired notice", async () => {
    const user = userEvent.setup();
    subscriptionState.error = new Error("offline");
    subscriptionState.status = null;
    subscriptionState.expiresAt = null;

    renderWithQuery(<SubscriptionReadOnlyNotice />);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/could not load subscription/i);
    await user.click(screen.getByRole("button", { name: /try again|retry/i }));
    expect(subscriptionState.refetch).toHaveBeenCalled();
  });
});
