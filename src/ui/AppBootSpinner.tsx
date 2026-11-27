import { Loader2Icon } from "lucide-react";
import { useState } from "react";

import i18n from "../i18n";

/** One rotation of Tailwind's `animate-spin`, in ms. */
const SPIN_MS = 1000;

/**
 * The single full-screen spinner shown while the app starts (index.html placeholder →
 * session check → workspace redirect). Every boot step renders this same element in the
 * same place, and the rotation is phase-locked to the page clock, so switching between
 * steps looks like one continuous spinner instead of several different ones.
 * Keep the markup in sync with the #boot-spinner placeholder in index.html.
 */
export function AppBootSpinner() {
  // Read once on mount: where the spinner already is in its turn.
  const [phase] = useState(() => (typeof performance === "undefined" ? 0 : performance.now() % SPIN_MS));
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-background">
      <Loader2Icon
        role="status"
        aria-label={i18n.t("common.loading")}
        className="size-10 animate-spin text-primary"
        style={{ animationDelay: `-${Math.round(phase)}ms` }}
      />
    </div>
  );
}
