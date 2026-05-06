import type { PropsWithChildren, ReactElement } from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { AppProvider, type AppContextValue } from "../features/app/AppProvider";

type RenderWithAppOptions = Omit<RenderOptions, "wrapper"> & {
  withRouter?: boolean;
  withAppProvider?: boolean;
  appProviderProps?: {
    initialValue?: Partial<AppContextValue>;
    bootstrapValue?: Partial<AppContextValue>;
  };
};

export function renderWithApp(
  ui: ReactElement,
  options?: RenderWithAppOptions,
) {
  const {
    withRouter = true,
    withAppProvider = true,
    appProviderProps,
    ...renderOptions
  } = options ?? {};

  return render(ui, {
    wrapper: ({ children }) => (
      <Wrapper
        withRouter={withRouter}
        withAppProvider={withAppProvider}
        appProviderProps={appProviderProps}
      >
        {children}
      </Wrapper>
    ),
    ...renderOptions,
  });
}

function Wrapper({
  children,
  withRouter,
  withAppProvider,
  appProviderProps,
}: PropsWithChildren<{
  withRouter: boolean;
  withAppProvider: boolean;
  appProviderProps?: {
    initialValue?: Partial<AppContextValue>;
    bootstrapValue?: Partial<AppContextValue>;
  };
}>) {
  let tree = children;

  if (withAppProvider) {
    tree = <AppProvider {...appProviderProps}>{tree}</AppProvider>;
  }

  if (withRouter) {
    tree = <MemoryRouter>{tree}</MemoryRouter>;
  }

  return tree;
}
