import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Session, User } from "@supabase/supabase-js";
import { AdminApiError, checkPlatformOwner } from "@/data/adminApi";
import { useI18n } from "@/i18n/I18nProvider";
import { getSupabase, getSupabaseConfig } from "@/lib/supabase";

type AuthState = {
  loading: boolean;
  session: Session | null;
  user: User | null;
  configured: boolean;
  /** Server-verified via `admin_is_platform_owner()` RPC. */
  isPlatformOwner: boolean;
  ownerCheckLoading: boolean;
  /** i18n key when the owner check failed (e.g. SQL not applied). */
  ownerCheckErrorKey: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const configured = getSupabaseConfig().configured;
  const [loading, setLoading] = useState(configured);
  const [session, setSession] = useState<Session | null>(null);

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

  const userId = session?.user?.id ?? null;
  const ownerQuery = useQuery({
    queryKey: ["admin", "is-owner", userId],
    queryFn: checkPlatformOwner,
    enabled: Boolean(userId),
    staleTime: 5 * 60_000,
  });

  const signIn = useCallback(
    async (email: string, password: string) => {
      const supabase = getSupabase();
      if (!supabase) throw new Error(t("errors.notConfigured"));
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
    [t],
  );

  const signOut = useCallback(async () => {
    const supabase = getSupabase();
    queryClient.removeQueries({ queryKey: ["admin"] });
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }, [queryClient]);

  const ownerError = ownerQuery.error;
  const value = useMemo<AuthState>(
    () => ({
      loading,
      session,
      user: session?.user ?? null,
      configured,
      isPlatformOwner: ownerQuery.data === true,
      ownerCheckLoading: Boolean(userId) && ownerQuery.isPending,
      ownerCheckErrorKey: ownerError
        ? ownerError instanceof AdminApiError
          ? ownerError.messageKey
          : "errors.generic"
        : null,
      signIn,
      signOut,
    }),
    [configured, loading, ownerError, ownerQuery.data, ownerQuery.isPending, session, signIn, signOut, userId],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
