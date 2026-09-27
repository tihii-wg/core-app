import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import ProtectedRoute from "./ProtectedRoute";

const authState = {
  isAuthenticated: false,
  isLoadingSession: false,
};

vi.mock("../features/auth/useUser", () => ({
  useUser: () => authState,
}));

vi.mock("../features/auth/useMfa", () => ({
  useSessionMfa: () => ({ needsMfa: false, isLoading: false }),
}));

function renderRoute() {
  return render(
    <MemoryRouter initialEntries={["/en/ws-1/orders"]}>
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/en/:workspaceId/orders" element={<h1>Orders</h1>} />
        </Route>
        <Route path="/en/login" element={<h1>Login</h1>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("ProtectedRoute", () => {
  it("waits while the Supabase session is still loading", () => {
    authState.isLoadingSession = true;
    authState.isAuthenticated = false;
    renderRoute();

    expect(screen.queryByRole("heading", { name: "Login" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Orders" })).not.toBeInTheDocument();
  });

  it("sends a signed-out visitor to login", () => {
    authState.isLoadingSession = false;
    authState.isAuthenticated = false;
    renderRoute();

    expect(screen.getByRole("heading", { name: "Login" })).toBeInTheDocument();
  });

  it("shows the protected page for an authenticated session", () => {
    authState.isLoadingSession = false;
    authState.isAuthenticated = true;
    renderRoute();

    expect(screen.getByRole("heading", { name: "Orders" })).toBeInTheDocument();
  });
});
