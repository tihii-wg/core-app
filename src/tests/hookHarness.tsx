import type { PropsWithChildren } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { fake } from "./fakeSupabase";

export function createTestQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
}

/** Wraps hooks in a fresh QueryClient and a router matching the app's /:locale/:workspaceId/* shape. */
export function createHookWrapper(initialPath: string) {
  const queryClient = createTestQueryClient();
  const location = { pathname: initialPath };

  function LocationProbe() {
    location.pathname = useLocation().pathname;
    return null;
  }

  function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialPath]}>
          <LocationProbe />
          <Routes>
            <Route path="/:locale/:workspaceId/*" element={children} />
            <Route path="/:locale/*" element={children} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  return { queryClient, wrapper: Wrapper, location };
}

export function requestsTo(table: string, op: string = "select") {
  return fake.requests.filter((request) => request.table === table && request.op === op);
}

export function cachedKeys(queryClient: QueryClient) {
  return queryClient
    .getQueryCache()
    .getAll()
    .map((query) => query.queryKey);
}
