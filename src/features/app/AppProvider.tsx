import type { Session } from "@supabase/supabase-js";
import {
  createContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import type { Company, Profile } from "../../types/app";

type AppStatus = "loading" | "ready";
type AuthState = "unknown" | "signed_out" | "authenticated";
type OnboardingState = "unknown" | "pending" | "complete";

export type AppContextValue = {
  status: AppStatus;
  authState: AuthState;
  onboardingState: OnboardingState;
  session: Session | null;
  profile: Profile | null;
  company: Company | null;
  error: string | null;
};

export const initialAppContextValue: AppContextValue = {
  status: "loading",
  authState: "unknown",
  onboardingState: "unknown",
  session: null,
  profile: null,
  company: null,
  error: null,
};

async function bootstrapAppState(current: AppContextValue): Promise<AppContextValue> {
  return {
    ...current,
    status: "ready",
    authState: current.session ? "authenticated" : "signed_out",
    onboardingState: current.company ? "complete" : "pending",
  };
}

export const AppContext = createContext<AppContextValue | null>(null);

type AppProviderProps = PropsWithChildren<{
  initialValue?: Partial<AppContextValue>;
  bootstrapValue?: Partial<AppContextValue>;
}>;

export function AppProvider({
  children,
  initialValue,
  bootstrapValue,
}: AppProviderProps) {
  const baseValue = useMemo<AppContextValue>(
    () => ({
      ...initialAppContextValue,
      ...initialValue,
    }),
    [initialValue],
  );
  const nextBootstrapValue = useMemo<AppContextValue>(
    () => ({
      ...baseValue,
      ...bootstrapValue,
    }),
    [baseValue, bootstrapValue],
  );
  const [value, setValue] = useState<AppContextValue>(baseValue);

  useEffect(() => {
    let active = true;

    void bootstrapAppState(nextBootstrapValue).then((nextValue) => {
      if (active) {
        setValue(nextValue);
      }
    });

    return () => {
      active = false;
    };
  }, [nextBootstrapValue]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
