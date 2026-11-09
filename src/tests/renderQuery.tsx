import type { ReactElement, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, renderHook, type RenderHookOptions } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ConfirmProvider } from "../ui/ConfirmProvider";

function createQueryWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <ConfirmProvider>
          <MemoryRouter>{children}</MemoryRouter>
        </ConfirmProvider>
      </QueryClientProvider>
    );
  }

  return { client, Wrapper };
}

export function renderWithQuery(ui: ReactElement) {
  const { Wrapper } = createQueryWrapper();
  return render(ui, { wrapper: Wrapper });
}

export function renderHookWithQuery<TResult, TProps>(
  hook: (props: TProps) => TResult,
  options?: Omit<RenderHookOptions<TProps>, "wrapper">,
) {
  const { Wrapper } = createQueryWrapper();
  return renderHook(hook, { ...options, wrapper: Wrapper });
}
