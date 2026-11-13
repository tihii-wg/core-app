import { useEffect, useState } from "react";
import { Check, Copy, LogOut, Share2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../ui/Dialog";
import Logo from "../../ui/Logo";
import { useLogOut } from "./useLogOut";
import { useUser } from "./useUser";
import { useGetProfile } from "../profiles/useGetProfile";
import AddNewWorkspaceForm from "../workspaces/AddNewWorkspaceForm";

type WaitingForInviteScreenProps = {
  email?: string | null;
};

async function copyText(value: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  throw new Error("clipboard unavailable");
}

export function WaitingForInviteScreen({ email }: WaitingForInviteScreenProps) {
  const { t } = useTranslation();
  const { user } = useUser();
  const { data: profile } = useGetProfile();
  const { logOut, isLoading: isLoggingOut } = useLogOut();
  const [createOpen, setCreateOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const displayEmail = (email || profile?.email || user?.email || "").trim();

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function onCopyEmail() {
    if (!displayEmail) return;
    try {
      await copyText(displayEmail);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  async function onShareEmail() {
    if (!displayEmail) return;
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: t("common.appName"),
          text: t("workspaces.redirect.shareEmailText", { email: displayEmail }),
        });
        return;
      } catch {
        // Fall through to copy when share is cancelled or unavailable.
      }
    }
    await onCopyEmail();
  }

  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-4 py-8 sm:px-6">
        <div className="mb-8 flex items-center justify-between gap-4">
          <Logo />
          <Button type="button" variant="ghost" onClick={() => void logOut()} disabled={isLoggingOut}>
            <LogOut className="size-4" aria-hidden="true" />
            {t("nav.userMenu.logOut")}
          </Button>
        </div>

        <div className="flex flex-1 flex-col justify-center">
          <div className="rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8">
            <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
              {t("workspaces.redirect.waitingTitle")}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">{t("workspaces.redirect.waitingDescription")}</p>

            <div className="mt-5 space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("workspaces.redirect.yourEmail")}
              </p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1 rounded-md border border-border bg-muted/40 px-3 py-2.5 font-mono text-sm text-foreground break-all">
                  {displayEmail || t("common.noValue")}
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button type="button" variant="outline" onClick={() => void onCopyEmail()} disabled={!displayEmail}>
                    {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
                    {copied ? t("workspaces.redirect.copied") : t("workspaces.redirect.copyEmail")}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => void onShareEmail()} disabled={!displayEmail}>
                    <Share2 className="size-4" aria-hidden="true" />
                    {t("workspaces.redirect.share")}
                  </Button>
                </div>
              </div>
            </div>

            <p className="mt-4 text-sm text-muted-foreground">{t("workspaces.redirect.waitingHint")}</p>

            <div className="mt-6 flex flex-col gap-3">
              <Button type="button" size="lg" className="w-full" onClick={() => setCreateOpen(true)}>
                {t("workspaces.redirect.createOwnWorkspace")}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("nav.workspace.addTitle")}</DialogTitle>
            <DialogDescription>{t("nav.workspace.addDescription")}</DialogDescription>
          </DialogHeader>
          <AddNewWorkspaceForm setCreateModalOpen={setCreateOpen} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
