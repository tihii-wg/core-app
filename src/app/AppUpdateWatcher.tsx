import { useEffect, useRef } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { isNewVersionDeployed } from "../lib/appVersion";
import { Button } from "../ui/Button";

const CHECK_EVERY_MS = 5 * 60_000;
const TOAST_ID = "app-update-available";

/**
 * Notices a new deployment while the app is open (on returning to the tab and every 5 minutes) and offers a
 * reload. No automatic reload here: the user may be in the middle of an unsaved form.
 */
export function AppUpdateWatcher() {
  const { t } = useTranslation();
  const shownRef = useRef(false);

  useEffect(() => {
    if (import.meta.env.DEV) return;
    let cancelled = false;
    let checking = false;

    const check = async () => {
      if (checking || shownRef.current || document.visibilityState !== "visible") return;
      checking = true;
      try {
        if (!(await isNewVersionDeployed()) || cancelled) return;
        shownRef.current = true;
        toast(
          (item) => (
            <div className="flex items-center gap-3">
              <span className="text-sm">{t("common.appUpdate.available")}</span>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  toast.dismiss(item.id);
                  window.location.reload();
                }}
              >
                <RefreshCw className="size-4" aria-hidden />
                {t("common.appUpdate.reload")}
              </Button>
            </div>
          ),
          { id: TOAST_ID, duration: Infinity },
        );
      } finally {
        checking = false;
      }
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    void check();
    const timer = window.setInterval(() => void check(), CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [t]);

  return null;
}
