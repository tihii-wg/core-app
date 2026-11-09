import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CircleHelp, Cloud, ExternalLink, HardDrive, Server } from "lucide-react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { Button } from "../../../ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../ui/Card";
import { useConfirm } from "../../../ui/ConfirmProvider";
import type { AttachmentStorageMode } from "../../../services/apiAttachmentStorage";
import { formatAttachmentBytes } from "../../orders/orderAttachments";
import { GoogleDriveHelpDialog, type GoogleDriveHelpScrollTarget } from "./GoogleDriveHelpDialog";
import { NasConnectionForm } from "./NasConnectionForm";
import { useActiveWorkspaceId } from "../../profiles/useGetProfile";
import { useGetWorkspace } from "../../workspaces/useGetWorkspace";
import { useIsWorkspaceOwnerId } from "../../workspaces/useIsWorkspaceOwnerId";
import {
  useAttachmentUsage,
  useConnectPhotosGoogleDrive,
  useDisconnectPhotosGoogleDrive,
  useRefreshAttachmentStorage,
  useSetAttachmentStorage,
  useWorkspaceGoogleDrive,
  useWorkspaceNasStorage,
} from "./useAttachmentStorage";

function driveFolderUrl(rootFolderId: string) {
  return `https://drive.google.com/drive/folders/${encodeURIComponent(rootFolderId)}`;
}

const MODE_OPTIONS = [
  { mode: "app", titleKey: "settings.storage.modes.app.title", descriptionKey: "settings.storage.modes.app.description", Icon: HardDrive },
  {
    mode: "google_drive",
    titleKey: "settings.storage.modes.googleDrive.title",
    descriptionKey: "settings.storage.modes.googleDrive.description",
    Icon: Cloud,
  },
  { mode: "nas", titleKey: "settings.storage.modes.nas.title", descriptionKey: "settings.storage.modes.nas.description", Icon: Server },
] as const satisfies readonly {
  mode: AttachmentStorageMode;
  titleKey: string;
  descriptionKey: string;
  Icon: typeof HardDrive;
}[];

export function StorageSettings() {
  const { t, i18n } = useTranslation();
  const confirm = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();
  const isOwner = useIsWorkspaceOwnerId();
  const { workspaceId } = useActiveWorkspaceId();
  const { data: workspace } = useGetWorkspace(workspaceId);

  const driveQuery = useWorkspaceGoogleDrive(true);
  const nasQuery = useWorkspaceNasStorage(true);
  const usageQuery = useAttachmentUsage(true);
  const refresh = useRefreshAttachmentStorage();
  const setStorage = useSetAttachmentStorage();
  const connect = useConnectPhotosGoogleDrive();
  const disconnect = useDisconnectPhotosGoogleDrive();

  const savedMode: AttachmentStorageMode = workspace?.attachmentStorage ?? "app";
  // `draft` lets the owner open the Drive/NAS card (and connect) before the stored mode switches.
  const [draft, setDraft] = useState<AttachmentStorageMode | null>(null);
  const [driveHelpOpen, setDriveHelpOpen] = useState(false);
  const [driveHelpScrollTo, setDriveHelpScrollTo] = useState<GoogleDriveHelpScrollTarget>("top");
  const view = draft ?? savedMode;

  function openDriveHelp(scrollTo: GoogleDriveHelpScrollTarget = "top") {
    setDriveHelpScrollTo(scrollTo);
    setDriveHelpOpen(true);
  }

  const drive = driveQuery.data ?? null;
  const driveStatus = drive?.status ?? "disconnected";
  const driveConnected = driveStatus === "connected" && Boolean(drive?.rootFolderId);
  const nas = nasQuery.data ?? null;
  const nasConnected = nas?.status === "connected";
  const busy = setStorage.isPending || connect.isPending || disconnect.isPending;
  const locale = i18n.language || "en";

  // Handle the redirect back from Google OAuth: ?gdrive=connected|error[&reason=…].
  const handledGdrive = useRef<string | null>(null);
  useEffect(() => {
    const gdrive = searchParams.get("gdrive");
    if (gdrive !== "connected" && gdrive !== "error") return;
    const marker = `${gdrive}:${searchParams.get("reason") ?? ""}`;
    if (handledGdrive.current !== marker) {
      handledGdrive.current = marker;
      if (gdrive === "connected") {
        toast.success(t("settings.storage.toast.connected"));
        // Make the freshly connected Drive the active destination (server re-validates the connection).
        if (isOwner && savedMode !== "google_drive") setStorage.mutate("google_drive");
      } else {
        const reason = searchParams.get("reason");
        toast.error(
          reason ? t("settings.storage.errors.oauth", { code: reason }) : t("settings.storage.errors.oauthGeneric"),
        );
      }
      void refresh();
    }
    const next = new URLSearchParams(searchParams);
    next.delete("gdrive");
    next.delete("reason");
    if (!next.get("tab")) next.set("tab", "storage");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  function selectMode(mode: AttachmentStorageMode) {
    if (!isOwner || busy || mode === view) return;
    if (mode === "google_drive" && !driveConnected) {
      // Nothing to switch to yet: show the connect card first.
      setDraft("google_drive");
      return;
    }
    if (mode === "nas" && !nasConnected) {
      // Same as Drive: show the connection form first, switch once it is saved.
      setDraft("nas");
      return;
    }
    setDraft(mode);
    if (mode === savedMode) {
      setDraft(null);
      return;
    }
    setStorage.mutate(mode, { onSettled: () => setDraft(null) });
  }

  async function onDisconnect() {
    if (!isOwner || busy) return;
    const ok = await confirm({
      title: t("settings.storage.confirmDisconnect.title"),
      description: t("settings.storage.confirmDisconnect.description"),
      confirmLabel: t("settings.storage.confirmDisconnect.confirm"),
      tone: "destructive",
      icon: "warning",
    });
    if (!ok) return;
    disconnect.mutate();
  }

  function onNasSaved() {
    // Make the freshly saved NAS the active destination (server re-validates the connection).
    if (savedMode !== "nas") {
      setStorage.mutate("nas", { onSettled: () => setDraft(null) });
    } else {
      setDraft(null);
    }
  }

  function usageLine(kind: "app" | "drive" | "nas") {
    const usage = usageQuery.data;
    if (!usage) return null;
    const bytes = kind === "app" ? usage.appBytes : kind === "drive" ? usage.driveBytes : usage.nasBytes;
    const files = kind === "app" ? usage.appFiles : kind === "drive" ? usage.driveFiles : usage.nasFiles;
    return t(`settings.storage.${kind}.usage`, {
      size: formatAttachmentBytes(bytes, locale),
      count: files,
    });
  }

  const usageRows = usageQuery.data
    ? ([
        { kind: "app", bytes: usageQuery.data.appBytes, files: usageQuery.data.appFiles },
        { kind: "drive", bytes: usageQuery.data.driveBytes, files: usageQuery.data.driveFiles },
        { kind: "nas", bytes: usageQuery.data.nasBytes, files: usageQuery.data.nasFiles },
      ] as const)
    : [];
  const hasAnyUsage = usageRows.some((row) => row.bytes > 0 || row.files > 0);

  function renderNasCard() {
    const nasUsage = usageLine("nas");
    return (
      <div className="space-y-3">
        {nasConnected && nasUsage ? <p className="text-sm text-muted-foreground">{nasUsage}</p> : null}
        <NasConnectionForm
          key={
            nas
              ? [nas.status, nas.protocol, nas.baseUrl, nas.rootPath, nas.username, nas.bucket, nas.region, nas.lastCheckedAt].join("|")
              : "new"
          }
          nas={nas}
          isOwner={isOwner}
          onSaved={onNasSaved}
        />
      </div>
    );
  }

  function driveGuideButton(opts?: { fromError?: boolean }) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-auto px-0 text-muted-foreground hover:text-foreground"
        onClick={() => openDriveHelp(opts?.fromError ? "troubleshooting" : "top")}
      >
        <CircleHelp className="size-3.5" aria-hidden />
        {t("settings.storage.drive.openGuide")}
      </Button>
    );
  }

  function connectArea(label: string) {
    return (
      <div className="space-y-2">
        {isOwner ? (
          <Button
            type="button"
            className="w-full sm:w-auto"
            disabled={busy}
            onClick={() => connect.mutate(locale)}
          >
            {label}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">{t("settings.storage.drive.ownerConnectHint")}</p>
        )}
        <p className="text-xs text-muted-foreground">{t("settings.storage.drive.connectHint")}</p>
        <button
          type="button"
          className="text-xs text-primary underline-offset-2 hover:underline"
          onClick={() => openDriveHelp("top")}
        >
          {t("settings.storage.drive.howItWorks")}
        </button>
      </div>
    );
  }

  function renderDriveCard() {
    if (driveStatus === "error") {
      return (
        <div
          role="alert"
          className="space-y-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4"
        >
          <div className="flex items-start gap-2 text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div className="min-w-0 space-y-1">
              <button
                type="button"
                className="text-left text-sm font-medium underline-offset-2 hover:underline"
                onClick={() => openDriveHelp("troubleshooting")}
              >
                {t("settings.storage.drive.errorTitle")}
              </button>
              <p className="text-sm">{t("settings.storage.drive.errorHint")}</p>
              {drive?.lastError ? (
                <p className="text-xs opacity-80 [overflow-wrap:anywhere]">{drive.lastError}</p>
              ) : null}
            </div>
          </div>
          {connectArea(t("settings.storage.drive.reconnect"))}
          {driveGuideButton({ fromError: true })}
        </div>
      );
    }

    if (driveConnected && drive) {
      return (
        <div className="space-y-3 rounded-lg border border-border p-4">
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium">{t("settings.storage.drive.connectedStatus")}</p>
            <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
              {t("settings.storage.drive.connectedAs", { email: drive.googleAccountEmail || "Google" })}
            </p>
            {usageLine("drive") ? (
              <p className="text-sm text-muted-foreground">{usageLine("drive")}</p>
            ) : null}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <a href={driveFolderUrl(drive.rootFolderId!)} target="_blank" rel="noreferrer">
                <ExternalLink aria-hidden />
                {t("settings.storage.drive.openFolder")}
              </a>
            </Button>
            {isOwner ? (
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                disabled={busy}
                onClick={() => {
                  void onDisconnect();
                }}
              >
                {t("settings.storage.drive.disconnect")}
              </Button>
            ) : null}
          </div>
          {driveGuideButton()}
        </div>
      );
    }

    return (
      <div className="space-y-3 rounded-lg border border-border p-4">
        <p className="text-sm text-muted-foreground">{t("settings.storage.drive.disconnectedHint")}</p>
        {connectArea(t("settings.storage.drive.connect"))}
        {driveGuideButton()}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <GoogleDriveHelpDialog
        open={driveHelpOpen}
        onOpenChange={setDriveHelpOpen}
        showOpenStorageButton={false}
        scrollTo={driveHelpScrollTo}
      />
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.storage.title")}</CardTitle>
          <CardDescription>{t("settings.storage.description")}</CardDescription>
          {!isOwner ? (
            <p className="text-sm text-muted-foreground">{t("settings.storage.ownerOnlyNote")}</p>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-5">
          <div
            role="radiogroup"
            aria-label={t("settings.storage.modeLabel")}
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          >
            {MODE_OPTIONS.map(({ mode, titleKey, descriptionKey, Icon }) => {
              const checked = view === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  disabled={!isOwner || busy}
                  className={`w-full rounded-lg border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                    checked ? "border-primary bg-primary/5" : "border-border"
                  }`}
                  onClick={() => selectMode(mode)}
                >
                  <div className="flex items-start gap-3">
                    <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
                    <div className="min-w-0 space-y-1">
                      <p className="font-medium">{t(titleKey)}</p>
                      <p className="text-sm text-muted-foreground">{t(descriptionKey)}</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {view === "app" ? (
            <div className="space-y-2 rounded-lg border border-border p-4">
              <p className="text-sm font-medium">{t("settings.storage.app.usageTitle")}</p>
              {usageQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">{t("settings.storage.loading")}</p>
              ) : usageQuery.isError ? (
                <p className="text-sm text-destructive">{usageQuery.error.message}</p>
              ) : (
                <p className="text-sm tabular-nums">{usageLine("app")}</p>
              )}
              <p className="text-sm text-muted-foreground">{t("settings.storage.app.limitedNote")}</p>
            </div>
          ) : view === "nas" ? (
            nasQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">{t("settings.storage.loading")}</p>
            ) : nasQuery.isError ? (
              <p className="text-sm text-destructive">{nasQuery.error.message}</p>
            ) : (
              renderNasCard()
            )
          ) : driveQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">{t("settings.storage.loading")}</p>
          ) : driveQuery.isError ? (
            <p className="text-sm text-destructive">{driveQuery.error.message}</p>
          ) : (
            renderDriveCard()
          )}

          {hasAnyUsage ? (
            <div className="space-y-2 rounded-lg border border-border p-4">
              <p className="text-sm font-medium">{t("settings.storage.usageSummary.title")}</p>
              <ul className="space-y-1 text-sm">
                {usageRows.map((row) => (
                  <li key={row.kind} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                    <span className="text-muted-foreground">{t(`settings.storage.usageSummary.${row.kind}`)}</span>
                    <span className="tabular-nums">
                      {t("settings.storage.usageSummary.value", {
                        size: formatAttachmentBytes(row.bytes, locale),
                        count: row.files,
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
