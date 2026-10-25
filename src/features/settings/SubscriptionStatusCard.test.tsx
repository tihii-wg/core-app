import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "../../tests/renderQuery";
import { SubscriptionStatusCard } from "./SubscriptionStatusCard";

const subscriptionState = vi.hoisted(() => ({
  canWrite: true,
  status: "active" as string | null,
  expiresAt: null as string | null,
  isLoading: false,
  error: null as Error | null,
}));

vi.mock("../workspaces/useWorkspaceSubscription", () => ({
  useWorkspaceSubscription: () => ({
    canWrite: subscriptionState.canWrite,
    status: subscriptionState.status,
    expiresAt: subscriptionState.expiresAt,
    startedAt: null,
    updatedAt: null,
    isLoading: subscriptionState.isLoading,
    isFetching: false,
    isFetched: true,
    error: subscriptionState.error,
    refetch: vi.fn(),
    workspaceId: "ws-1",
    subscription: null,
  }),
}));

describe("SubscriptionStatusCard", () => {
  beforeEach(() => {
    subscriptionState.canWrite = true;
    subscriptionState.status = "active";
    subscriptionState.expiresAt = null;
    subscriptionState.isLoading = false;
    subscriptionState.error = null;
  });

  it("shows active status without a self-service activate control", () => {
    renderWithQuery(<SubscriptionStatusCard />);
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText(/cannot be activated or renewed/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /activate/i })).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("shows a read-only notice when write entitlement is denied", () => {
    subscriptionState.canWrite = false;
    subscriptionState.status = "expired";
    subscriptionState.expiresAt = "2025-01-01T00:00:00.000Z";
    renderWithQuery(<SubscriptionStatusCard />);
    expect(screen.getByText("Expired")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/view-only|browse existing data/i);
  });
});
