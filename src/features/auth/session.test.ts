import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { finishSignOut, isPublicAuthPath } from "./session";
import { isInvalidSessionError } from "../../services/apiAuth";
import { stubLocalStorage } from "../../tests/memoryStorage";

describe("auth session", () => {
  it("recognizes public auth routes", () => {
    expect(isPublicAuthPath("/en/login")).toBe(true);
    expect(isPublicAuthPath("/en/register")).toBe(true);
    expect(isPublicAuthPath("/en/ws-1/orders")).toBe(false);
  });

  it("recognizes an expired Supabase session", () => {
    expect(isInvalidSessionError({ message: "JWT expired", status: 401 })).toBe(true);
    expect(isInvalidSessionError({ message: "new row violates row-level security policy" })).toBe(false);
  });

  it("clears the query cache and replaces the protected page with login", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["orders", "ws-a"], [{ id: "order-a" }]);
    const navigate = vi.fn();
    window.history.pushState({}, "", "/en/ws-a/orders");

    finishSignOut(queryClient, navigate);

    expect(queryClient.getQueryData(["orders", "ws-a"])).toBeUndefined();
    expect(navigate).toHaveBeenCalledWith("/en/login", { replace: true });
  });

  it("clears the cached theme so the next user does not inherit it", () => {
    const storage = stubLocalStorage();
    storage.setItem("coreapp-theme", "dark");
    document.documentElement.classList.add("dark");
    window.history.pushState({}, "", "/en/ws-a/orders");

    finishSignOut(new QueryClient(), vi.fn());

    expect(storage.getItem("coreapp-theme")).toBeNull();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    vi.unstubAllGlobals();
  });

  it("does not redirect again when logout already reached login", () => {
    const queryClient = new QueryClient();
    const navigate = vi.fn();
    window.history.pushState({}, "", "/en/login");

    finishSignOut(queryClient, navigate);

    expect(navigate).not.toHaveBeenCalled();
  });
});
