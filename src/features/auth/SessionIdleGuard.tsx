import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import supabase from "../../services/supabase";
import { listedWorkspaceIds, useGetWorkspaces } from "../workspaces/useGetWorkspaces";
import {
  readSessionIdleDevOverrideMinutes,
  type ListedWorkspaceMembership,
} from "../../services/apiWorkspaces";
import { useUser } from "./useUser";
import { finishSignOut } from "./session";
import { SessionIdleWarningDialog } from "./SessionIdleWarningDialog";
import {
  SESSION_IDLE_ACTIVITY_THROTTLE_MS,
  SESSION_IDLE_CHECK_INTERVAL_MS,
  SESSION_IDLE_LOGOUT_NOTICE_KEY,
  effectiveSessionIdleTimeoutMinutes,
  isSessionIdleExpired,
  sessionIdleActivityStorageKey,
  sessionIdleBroadcastChannelName,
  sessionIdleCountdownSeconds,
  sessionIdleRemainingMs,
  shouldShowSessionIdleWarning,
} from "./sessionIdleTimeout";

function timeoutsFromMemberships(memberships: ListedWorkspaceMembership[] | undefined): Array<number | null> {
  const out: Array<number | null> = [];
  for (const item of memberships ?? []) {
    const workspace = item.workspaces;
    if (!workspace) continue;
    const entries = Array.isArray(workspace) ? workspace : [workspace];
    for (const entry of entries) {
      const raw = entry.session_idle_timeout_minutes;
      if (raw == null) out.push(null);
      else {
        const n = typeof raw === "number" ? raw : Number(raw);
        out.push(Number.isFinite(n) ? n : null);
      }
    }
  }
  return out;
}

function readStoredActivity(userId: string): number | null {
  try {
    const raw = localStorage.getItem(sessionIdleActivityStorageKey(userId));
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeStoredActivity(userId: string, at: number) {
  try {
    localStorage.setItem(sessionIdleActivityStorageKey(userId), String(at));
  } catch {
    // private mode
  }
}

type BroadcastMessage =
  | { type: "activity"; at: number }
  | { type: "logout" };

/**
 * Global idle-timeout enforcer for the authenticated app shell (AppLayout).
 * Not mounted on login / register / reset-password / MFA / onboarding / public routes.
 */
export function SessionIdleGuard() {
  const { user } = useUser();
  const userId = user?.id ?? null;
  const { workspaces } = useGetWorkspaces();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const lastActivityRef = useRef<number>(Date.now());
  const lastWriteRef = useRef(0);
  const loggingOutRef = useRef(false);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const [warningOpen, setWarningOpen] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(0);

  const membershipCount = listedWorkspaceIds(workspaces).length;
  const fromMemberships = effectiveSessionIdleTimeoutMinutes(timeoutsFromMemberships(workspaces));
  const devOverride = readSessionIdleDevOverrideMinutes();
  const timeoutMinutes =
    membershipCount === 0
      ? null
      : effectiveSessionIdleTimeoutMinutes([fromMemberships, devOverride]);

  const markActivity = useCallback(
    (source: "local" | "remote" = "local", at = Date.now()) => {
      if (!userId || loggingOutRef.current) return;
      lastActivityRef.current = Math.max(lastActivityRef.current, at);
      if (source === "local") {
        const now = Date.now();
        if (now - lastWriteRef.current >= SESSION_IDLE_ACTIVITY_THROTTLE_MS) {
          lastWriteRef.current = now;
          writeStoredActivity(userId, lastActivityRef.current);
          try {
            channelRef.current?.postMessage({ type: "activity", at: lastActivityRef.current } satisfies BroadcastMessage);
          } catch {
            // ignore
          }
        }
      }
      setWarningOpen(false);
    },
    [userId],
  );

  const performIdleLogout = useCallback(async () => {
    if (!userId || loggingOutRef.current) return;
    loggingOutRef.current = true;
    setWarningOpen(false);
    try {
      sessionStorage.setItem(SESSION_IDLE_LOGOUT_NOTICE_KEY, "1");
    } catch {
      // ignore
    }
    try {
      channelRef.current?.postMessage({ type: "logout" } satisfies BroadcastMessage);
    } catch {
      // ignore
    }
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      // still clear local UI
    }
    finishSignOut(queryClient, navigate);
  }, [navigate, queryClient, userId]);

  const evaluate = useCallback(() => {
    if (!userId || timeoutMinutes == null || loggingOutRef.current) {
      setWarningOpen(false);
      return;
    }
    // Skip expiry while a user-initiated mutation is in flight (uploads, saves).
    if (queryClient.isMutating() > 0) {
      markActivity("local");
      return;
    }
    const now = Date.now();
    const last = lastActivityRef.current;
    if (isSessionIdleExpired(last, now, timeoutMinutes)) {
      void performIdleLogout();
      return;
    }
    if (shouldShowSessionIdleWarning(last, now, timeoutMinutes)) {
      setWarningOpen(true);
      setSecondsRemaining(sessionIdleCountdownSeconds(sessionIdleRemainingMs(last, now, timeoutMinutes)));
    } else {
      setWarningOpen(false);
    }
  }, [markActivity, performIdleLogout, queryClient, timeoutMinutes, userId]);

  // Seed activity + cross-tab sync when user is known.
  useEffect(() => {
    if (!userId) return;
    loggingOutRef.current = false;
    const stored = readStoredActivity(userId);
    const now = Date.now();
    // Use the real last activity (shared across tabs and browser restarts) so an app reopened
    // after the timeout logs out immediately. Login writes a fresh value; sign-out clears it.
    lastActivityRef.current = stored != null && stored <= now + 60_000 ? stored : now;
    writeStoredActivity(userId, lastActivityRef.current);
    lastWriteRef.current = now;

    let channel: BroadcastChannel | null = null;
    try {
      if (typeof BroadcastChannel !== "undefined") {
        channel = new BroadcastChannel(sessionIdleBroadcastChannelName(userId));
        channel.onmessage = (event: MessageEvent<BroadcastMessage>) => {
          const data = event.data;
          if (!data || typeof data !== "object") return;
          if (data.type === "activity" && typeof data.at === "number") {
            markActivity("remote", data.at);
            evaluate();
          } else if (data.type === "logout") {
            void performIdleLogout();
          }
        };
        channelRef.current = channel;
      }
    } catch {
      channel = null;
    }

    const onStorage = (event: StorageEvent) => {
      if (event.key !== sessionIdleActivityStorageKey(userId)) return;
      if (!event.newValue) return;
      const at = Number(event.newValue);
      if (!Number.isFinite(at)) return;
      markActivity("remote", at);
      evaluate();
    };
    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener("storage", onStorage);
      try {
        channel?.close();
      } catch {
        // ignore
      }
      if (channelRef.current === channel) channelRef.current = null;
    };
  }, [evaluate, markActivity, performIdleLogout, userId]);

  // Activity listeners (throttled writes).
  useEffect(() => {
    if (!userId || timeoutMinutes == null) return;

    const onActivity = () => markActivity("local");
    const opts: AddEventListenerOptions = { capture: true, passive: true };
    window.addEventListener("pointerdown", onActivity, opts);
    window.addEventListener("keydown", onActivity, opts);
    window.addEventListener("wheel", onActivity, opts);
    window.addEventListener("scroll", onActivity, opts);
    window.addEventListener("touchstart", onActivity, opts);

    return () => {
      window.removeEventListener("pointerdown", onActivity, opts);
      window.removeEventListener("keydown", onActivity, opts);
      window.removeEventListener("wheel", onActivity, opts);
      window.removeEventListener("scroll", onActivity, opts);
      window.removeEventListener("touchstart", onActivity, opts);
    };
  }, [markActivity, timeoutMinutes, userId]);

  // Interval + visibility/focus/pageshow checks (visibility is check-only, not activity).
  useEffect(() => {
    if (!userId || timeoutMinutes == null) {
      setWarningOpen(false);
      return;
    }

    evaluate();
    const intervalId = window.setInterval(evaluate, SESSION_IDLE_CHECK_INTERVAL_MS);

    const onVisibility = () => {
      if (document.visibilityState === "visible") evaluate();
    };
    const onFocus = () => evaluate();
    const onPageShow = () => evaluate();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onPageShow);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [evaluate, timeoutMinutes, userId]);

  // Live countdown while warning is open.
  useEffect(() => {
    if (!warningOpen || timeoutMinutes == null || !userId) return;
    const tick = () => {
      const now = Date.now();
      const remaining = sessionIdleRemainingMs(lastActivityRef.current, now, timeoutMinutes);
      setSecondsRemaining(sessionIdleCountdownSeconds(remaining));
      if (remaining <= 0) void performIdleLogout();
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [performIdleLogout, timeoutMinutes, userId, warningOpen]);

  if (!userId || timeoutMinutes == null) return null;

  return (
    <SessionIdleWarningDialog
      open={warningOpen}
      secondsRemaining={secondsRemaining}
      onContinue={() => {
        lastWriteRef.current = 0;
        markActivity("local");
        evaluate();
      }}
      onSignOut={() => {
        void performIdleLogout();
      }}
    />
  );
}
