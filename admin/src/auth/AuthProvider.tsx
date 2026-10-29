import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { useI18n } from "@/i18n/I18nProvider";
import { getSupabase, getSupabaseConfig } from "@/lib/supabase";

const DEMO_SESSION_KEY = "core-app-admin-demo-mode";

type AuthState = {
  loading: boolean;
  session: Session | null;
  user: User | null;
  configured: boolean;
  demoMode: boolean;
  /** True only when a verified backend platform-owner check exists (currently false). */
  isPlatformOwner: boolean;
  platformOwnerReason: string;
  enterDemoMode: () => void;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

function readDemoMode() {
  try {
    return sessionStorage.getItem(DEMO_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const configured = getSupabaseConfig().configured;
  const [loading, setLoading] = useState(configured);
  const [session, setSession] = useState<Session | null>(null);
  const [demoMode, setDemoMode] = useState(readDemoMode);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setLoading(false);
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const enterDemoMode = useCallback(() => {
    try {
      sessionStorage.setItem(DEMO_SESSION_KEY, "1");
    } catch {
      // ignore storage failures; in-memory flag still works for this tab session
    }
    setDemoMode(true);
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const supabase = getSupabase();
      if (!supabase) {
        throw new Error(t("login.supabaseMissing"));
      }
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      try {
        sessionStorage.removeItem(DEMO_SESSION_KEY);
      } catch {
        // ignore
      }
      setDemoMode(false);
    },
    [t],
  );

  const signOut = useCallback(async () => {
    try {
      sessionStorage.removeItem(DEMO_SESSION_KEY);
    } catch {
      // ignore
    }
    setDemoMode(false);
    const supabase = getSupabase();
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      loading,
      session,
      user: session?.user ?? null,
      configured,
      demoMode,
      isPlatformOwner: false,
      platformOwnerReason: t("auth.platformOwnerReason"),
      enterDemoMode,
      signIn,
      signOut,
    }),
    [configured, demoMode, enterDemoMode, loading, session, signIn, signOut, t],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
