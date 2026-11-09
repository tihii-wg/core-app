import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Button } from "../../../ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../ui/Dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../../../ui/Sheet";
import { useIsMobile } from "../../../ui/use-mobile";
import { getWorkspaceMembers } from "../../../services/apiWorkspaces";
import { useActiveWorkspaceId } from "../../profiles/useGetProfile";
import { useGetWorkspace } from "../../workspaces/useGetWorkspace";
import { useIsWorkspaceOwnerId } from "../../workspaces/useIsWorkspaceOwnerId";

export type GoogleDriveHelpScrollTarget = "top" | "troubleshooting";

type GoogleDriveHelpDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When true, step 1 shows a button that opens Settings → Storage. */
  showOpenStorageButton?: boolean;
  /** Scroll to troubleshooting when opened from the error badge. */
  scrollTo?: GoogleDriveHelpScrollTarget;
};

const STEP_KEYS = ["1", "2", "3", "4", "5", "6"] as const;
const USEFUL_KEYS = ["1", "2", "3", "4", "5"] as const;
const TROUBLE_KEYS = ["1", "2", "3"] as const;

function ownerDisplayName(
  members: Awaited<ReturnType<typeof getWorkspaceMembers>> | undefined,
  ownerId: string | null | undefined,
  fallback: string,
) {
  if (!ownerId || !members?.length) return fallback;
  const owner = members.find((m) => m.userId === ownerId);
  const name = owner?.fullName?.trim() || owner?.email?.trim();
  return name || fallback;
}

function HelpBody({
  workspaceName,
  ownerName,
  isOwner,
  showOpenStorageButton,
  onOpenStorage,
  scrollTo,
}: {
  workspaceName: string;
  ownerName: string;
  isOwner: boolean;
  showOpenStorageButton: boolean;
  onOpenStorage: () => void;
  scrollTo: GoogleDriveHelpScrollTarget;
}) {
  const { t } = useTranslation();
  const troubleRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (scrollTo !== "troubleshooting") return;
    const id = window.requestAnimationFrame(() => {
      troubleRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(id);
  }, [scrollTo]);

  return (
    <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-1 pb-2">
      {!isOwner ? (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-foreground">
          {t("settings.storage.googleDriveHelp.nonOwnerBanner", { ownerName })}
        </p>
      ) : null}

      <section className="space-y-3" aria-labelledby="gdrive-help-steps">
        <h3 id="gdrive-help-steps" className="text-sm font-semibold text-foreground">
          {t("settings.storage.googleDriveHelp.stepsTitle")}
        </h3>
        <ol className="list-decimal space-y-3 pl-5 text-sm text-foreground">
          {STEP_KEYS.map((key) => (
            <li key={key} className="[overflow-wrap:anywhere]">
              <span>
                {t(`settings.storage.googleDriveHelp.steps.${key}`, { workspaceName })}
              </span>
              {key === "1" && showOpenStorageButton ? (
                <div className="mt-2">
                  <Button type="button" variant="outline" size="sm" onClick={onOpenStorage}>
                    {t("settings.storage.googleDriveHelp.openStorageSettings")}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      </section>

      <section className="space-y-3" aria-labelledby="gdrive-help-useful">
        <h3 id="gdrive-help-useful" className="text-sm font-semibold text-foreground">
          {t("settings.storage.googleDriveHelp.usefulTitle")}
        </h3>
        <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
          {USEFUL_KEYS.map((key) => (
            <li key={key} className="[overflow-wrap:anywhere]">
              {t(`settings.storage.googleDriveHelp.useful.${key}`)}
            </li>
          ))}
        </ul>
      </section>

      <section
        ref={troubleRef}
        className="space-y-3 scroll-mt-4"
        aria-labelledby="gdrive-help-trouble"
        data-testid="gdrive-help-troubleshooting"
      >
        <h3 id="gdrive-help-trouble" className="text-sm font-semibold text-foreground">
          {t("settings.storage.googleDriveHelp.troubleshootingTitle")}
        </h3>
        <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
          {TROUBLE_KEYS.map((key) => (
            <li key={key} className="[overflow-wrap:anywhere]">
              {t(`settings.storage.googleDriveHelp.troubleshooting.${key}`)}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function GoogleDriveHelpDialog({
  open,
  onOpenChange,
  showOpenStorageButton = false,
  scrollTo = "top",
}: GoogleDriveHelpDialogProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const [, setSearchParams] = useSearchParams();
  const isOwner = useIsWorkspaceOwnerId();
  const { workspaceId } = useActiveWorkspaceId();
  const { data: workspace } = useGetWorkspace(workspaceId);

  const membersQuery = useQuery({
    queryKey: ["workspace-members", workspaceId, "gdrive-help"],
    queryFn: () => getWorkspaceMembers(workspaceId!),
    enabled: Boolean(workspaceId) && open && !isOwner,
    staleTime: 60_000,
  });

  const workspaceName = workspace?.name?.trim() || t("settings.storage.googleDriveHelp.workspaceFallback");
  const ownerName = ownerDisplayName(
    membersQuery.data,
    workspace?.ownerId,
    t("settings.storage.googleDriveHelp.ownerFallback"),
  );

  function openStorageSettings() {
    onOpenChange(false);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", "storage");
        return next;
      },
      { replace: true },
    );
  }

  const body = (
    <HelpBody
      workspaceName={workspaceName}
      ownerName={ownerName}
      isOwner={isOwner}
      showOpenStorageButton={showOpenStorageButton}
      onOpenStorage={openStorageSettings}
      scrollTo={open ? scrollTo : "top"}
    />
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="flex max-h-[min(92dvh,720px)] w-full flex-col gap-0 rounded-t-xl p-0 sm:max-w-none"
        >
          <SheetHeader className="shrink-0">
            <SheetTitle>{t("settings.storage.googleDriveHelp.title")}</SheetTitle>
            <SheetDescription className="sr-only">{t("settings.storage.googleDriveHelp.description")}</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 px-5 pt-2">{body}</div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(90dvh,720px)] w-full max-w-[calc(100vw-2rem)] flex-col gap-4 overflow-hidden sm:max-w-lg">
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle>{t("settings.storage.googleDriveHelp.title")}</DialogTitle>
          <DialogDescription className="sr-only">{t("settings.storage.googleDriveHelp.description")}</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}
