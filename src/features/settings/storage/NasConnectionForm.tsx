import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../../ui/Button";
import { useConfirm } from "../../../ui/ConfirmProvider";
import { Input } from "../../../ui/Input";
import { Label } from "../../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../ui/Select";
import { StatusBadge } from "../../../ui/StatusBadge";
import type {
  NasConnectionPayload,
  NasProtocol,
  WorkspaceNasStorage,
} from "../../../services/apiAttachmentStorage";
import { useDisconnectNasStorage, useSaveNasConnection, useTestNasConnection } from "./useAttachmentStorage";

const DEFAULT_ROOT_PATH = "/CoreApp";

type FieldName = "baseUrl" | "username" | "password" | "bucket" | "accessKeyId" | "secretAccessKey";
type FieldErrors = Partial<Record<FieldName, string>>;

function normalizeUrl(value: string) {
  return value.trim().replace(/\/+$/, "").toLowerCase();
}

function normalizeRootPath(value: string) {
  const cleaned = value.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (!cleaned) return DEFAULT_ROOT_PATH;
  return cleaned.startsWith("/") ? cleaned : `/${cleaned}`;
}

function formatChecked(value: string | null, locale: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(locale);
}

const STATUS_VARIANT = { connected: "success", error: "danger", disconnected: "muted" } as const;

export type NasConnectionFormProps = {
  nas: WorkspaceNasStorage | null;
  isOwner: boolean;
  /** Called after the connection was saved successfully (e.g. to make NAS the active destination). */
  onSaved?: () => void;
};

export function NasConnectionForm({ nas, isOwner, onSaved }: NasConnectionFormProps) {
  const { t, i18n } = useTranslation();
  const confirm = useConfirm();
  const baseId = useId();
  const testNas = useTestNasConnection();
  const saveNas = useSaveNasConnection();
  const disconnectNas = useDisconnectNasStorage();

  const [protocol, setProtocol] = useState<NasProtocol>(nas?.protocol ?? "webdav");
  const [baseUrl, setBaseUrl] = useState(nas?.baseUrl ?? "");
  const [rootPath, setRootPath] = useState(nas?.rootPath ?? DEFAULT_ROOT_PATH);
  const [username, setUsername] = useState(nas?.username ?? "");
  const [password, setPassword] = useState("");
  const [bucket, setBucket] = useState(nas?.bucket ?? "");
  const [region, setRegion] = useState(nas?.region ?? "");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [changeSecret, setChangeSecret] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const busy = testNas.isPending || saveNas.isPending || disconnectNas.isPending;
  const editable = isOwner && !busy;

  // A saved secret can only be kept for the same protocol and server; otherwise it must be re-entered,
  // so stored credentials are never silently sent to a different host.
  const hasSecret = nas?.status === "connected" && nas.hasCredential !== false;
  const secretReusable = Boolean(
    hasSecret && nas && protocol === nas.protocol && normalizeUrl(baseUrl) === normalizeUrl(nas.baseUrl),
  );
  const secretLocked = secretReusable && !changeSecret;
  const secretPlaceholder = secretLocked || (!isOwner && hasSecret) ? t("settings.storage.nas.savedPlaceholder") : "";

  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    const required = t("settings.storage.nas.validation.required");
    const url = baseUrl.trim();
    if (!url) {
      errors.baseUrl = required;
    } else if (!/^https:\/\//i.test(url)) {
      errors.baseUrl = t("settings.storage.nas.validation.httpsRequired");
    } else {
      let host = "";
      try {
        host = new URL(url).hostname;
      } catch {
        host = "";
      }
      if (!host) errors.baseUrl = t("settings.storage.nas.validation.urlInvalid");
    }

    const secretMissing = t(hasSecret ? "settings.storage.nas.validation.secretRequired" : "settings.storage.nas.validation.required");
    if (protocol === "webdav") {
      if (!username.trim()) errors.username = required;
      if (!secretLocked && !password) errors.password = secretMissing;
    } else {
      if (!bucket.trim()) errors.bucket = required;
      if (!secretLocked && !accessKeyId.trim()) errors.accessKeyId = secretMissing;
      if (!secretLocked && !secretAccessKey) errors.secretAccessKey = secretMissing;
    }
    return errors;
  }

  const errors = submitted ? validate() : {};

  function buildPayload(): NasConnectionPayload | null {
    setSubmitted(true);
    if (Object.keys(validate()).length > 0) return null;
    const payload: NasConnectionPayload = {
      protocol,
      baseUrl: baseUrl.trim(),
      rootPath: normalizeRootPath(rootPath),
    };
    if (protocol === "webdav") {
      payload.username = username.trim();
      if (!secretLocked) payload.password = password;
    } else {
      payload.bucket = bucket.trim();
      if (region.trim()) payload.region = region.trim();
      if (!secretLocked) {
        payload.accessKeyId = accessKeyId.trim();
        payload.secretAccessKey = secretAccessKey;
      }
    }
    if (secretLocked) payload.keepExistingSecret = true;
    return payload;
  }

  function onTest() {
    if (!editable) return;
    const payload = buildPayload();
    if (payload) testNas.mutate(payload);
  }

  function onSave() {
    if (!editable) return;
    const payload = buildPayload();
    if (!payload) return;
    saveNas.mutate(payload, {
      onSuccess: () => {
        setPassword("");
        setAccessKeyId("");
        setSecretAccessKey("");
        setChangeSecret(false);
        setSubmitted(false);
        onSaved?.();
      },
    });
  }

  async function onDisconnect() {
    if (!editable) return;
    const ok = await confirm({
      title: t("settings.storage.nas.confirmDisconnect.title"),
      description: t("settings.storage.nas.confirmDisconnect.description"),
      confirmLabel: t("settings.storage.nas.confirmDisconnect.confirm"),
      tone: "destructive",
      icon: "warning",
    });
    if (!ok) return;
    disconnectNas.mutate();
  }

  function fieldError(name: FieldName) {
    const message = errors[name];
    return message ? (
      <p id={`${baseId}-${name}-error`} className="text-xs text-destructive">
        {message}
      </p>
    ) : null;
  }

  function describedBy(name: FieldName) {
    return errors[name] ? `${baseId}-${name}-error` : undefined;
  }

  const checkedAt = nas ? formatChecked(nas.lastCheckedAt, i18n.language || "en") : null;
  const status = nas?.status ?? "disconnected";
  const showDisconnect = isOwner && nas !== null && nas.status !== "disconnected";

  const secretUnlockButton =
    isOwner && secretReusable && !changeSecret ? (
      <Button
        type="button"
        variant="outline"
        className="w-full sm:w-auto"
        disabled={busy}
        onClick={() => setChangeSecret(true)}
      >
        {t("settings.storage.nas.changeSecret")}
      </Button>
    ) : null;

  return (
    <form
      className="space-y-4 rounded-lg border border-border p-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <p className="text-sm font-medium">{t("settings.storage.nas.title")}</p>
        <StatusBadge variant={STATUS_VARIANT[status]} dot>
          {t(`settings.storage.nas.status.${status}`)}
        </StatusBadge>
      </div>
      {nas ? (
        <div className="min-w-0 space-y-1 text-sm text-muted-foreground">
          {checkedAt ? <p>{t("settings.storage.nas.lastChecked", { date: checkedAt })}</p> : null}
          {nas.lastError ? (
            <p className="text-destructive [overflow-wrap:anywhere]">
              {t("settings.storage.nas.lastError", { error: nas.lastError })}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("settings.storage.nas.disconnectedHint")}</p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor={`${baseId}-protocol`}>{t("settings.storage.nas.protocolLabel")}</Label>
          <Select value={protocol} disabled={!editable} onValueChange={(value) => setProtocol(value as NasProtocol)}>
            <SelectTrigger id={`${baseId}-protocol`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="webdav">{t("settings.storage.nas.protocol.webdav")}</SelectItem>
              <SelectItem value="s3">{t("settings.storage.nas.protocol.s3")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="min-w-0 space-y-1.5">
          <Label htmlFor={`${baseId}-rootPath`}>{t("settings.storage.nas.rootPathLabel")}</Label>
          <Input
            id={`${baseId}-rootPath`}
            value={rootPath}
            disabled={!editable}
            placeholder={t("settings.storage.nas.rootPathPlaceholder")}
            autoComplete="off"
            onChange={(event) => setRootPath(event.target.value)}
          />
        </div>

        <div className="min-w-0 space-y-1.5 sm:col-span-2">
          <Label htmlFor={`${baseId}-baseUrl`}>{t("settings.storage.nas.baseUrlLabel")}</Label>
          <Input
            id={`${baseId}-baseUrl`}
            type="url"
            inputMode="url"
            value={baseUrl}
            disabled={!editable}
            placeholder={t("settings.storage.nas.baseUrlPlaceholder")}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={Boolean(errors.baseUrl)}
            aria-describedby={describedBy("baseUrl")}
            onChange={(event) => setBaseUrl(event.target.value)}
          />
          {fieldError("baseUrl")}
        </div>

        {protocol === "webdav" ? (
          <>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor={`${baseId}-username`}>{t("settings.storage.nas.usernameLabel")}</Label>
              <Input
                id={`${baseId}-username`}
                value={username}
                disabled={!editable}
                autoComplete="off"
                autoCapitalize="none"
                aria-invalid={Boolean(errors.username)}
                aria-describedby={describedBy("username")}
                onChange={(event) => setUsername(event.target.value)}
              />
              {fieldError("username")}
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor={`${baseId}-password`}>{t("settings.storage.nas.passwordLabel")}</Label>
              <Input
                id={`${baseId}-password`}
                type="password"
                value={password}
                disabled={!editable || secretLocked}
                placeholder={secretPlaceholder}
                autoComplete="new-password"
                aria-invalid={Boolean(errors.password)}
                aria-describedby={describedBy("password")}
                onChange={(event) => setPassword(event.target.value)}
              />
              {fieldError("password")}
            </div>
          </>
        ) : (
          <>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor={`${baseId}-bucket`}>{t("settings.storage.nas.bucketLabel")}</Label>
              <Input
                id={`${baseId}-bucket`}
                value={bucket}
                disabled={!editable}
                autoComplete="off"
                autoCapitalize="none"
                aria-invalid={Boolean(errors.bucket)}
                aria-describedby={describedBy("bucket")}
                onChange={(event) => setBucket(event.target.value)}
              />
              {fieldError("bucket")}
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor={`${baseId}-region`}>{t("settings.storage.nas.regionLabel")}</Label>
              <Input
                id={`${baseId}-region`}
                value={region}
                disabled={!editable}
                autoComplete="off"
                autoCapitalize="none"
                onChange={(event) => setRegion(event.target.value)}
              />
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor={`${baseId}-accessKeyId`}>{t("settings.storage.nas.accessKeyIdLabel")}</Label>
              <Input
                id={`${baseId}-accessKeyId`}
                value={accessKeyId}
                disabled={!editable || secretLocked}
                placeholder={secretPlaceholder}
                autoComplete="off"
                autoCapitalize="none"
                aria-invalid={Boolean(errors.accessKeyId)}
                aria-describedby={describedBy("accessKeyId")}
                onChange={(event) => setAccessKeyId(event.target.value)}
              />
              {fieldError("accessKeyId")}
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor={`${baseId}-secretAccessKey`}>{t("settings.storage.nas.secretAccessKeyLabel")}</Label>
              <Input
                id={`${baseId}-secretAccessKey`}
                type="password"
                value={secretAccessKey}
                disabled={!editable || secretLocked}
                placeholder={secretPlaceholder}
                autoComplete="new-password"
                aria-invalid={Boolean(errors.secretAccessKey)}
                aria-describedby={describedBy("secretAccessKey")}
                onChange={(event) => setSecretAccessKey(event.target.value)}
              />
              {fieldError("secretAccessKey")}
            </div>
          </>
        )}
      </div>

      {secretUnlockButton}

      <div className="space-y-1 rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">{t("settings.storage.nas.help.title")}</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>{t("settings.storage.nas.help.https")}</li>
          <li>{t("settings.storage.nas.help.ddns")}</li>
          <li>{t("settings.storage.nas.help.letsEncrypt")}</li>
          <li>{t("settings.storage.nas.help.tunnel")}</li>
          <li>{t("settings.storage.nas.help.noQuickConnect")}</li>
        </ul>
      </div>

      {isOwner ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button type="button" variant="outline" className="w-full sm:w-auto" disabled={busy} onClick={onTest}>
            {testNas.isPending ? t("settings.storage.nas.testing") : t("settings.storage.nas.testConnection")}
          </Button>
          <Button type="submit" className="w-full sm:w-auto" disabled={busy}>
            {saveNas.isPending ? t("settings.storage.nas.saving") : t("settings.storage.nas.save")}
          </Button>
          {showDisconnect ? (
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              disabled={busy}
              onClick={() => {
                void onDisconnect();
              }}
            >
              {t("settings.storage.nas.disconnect")}
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("settings.storage.nas.ownerConnectHint")}</p>
      )}
    </form>
  );
}
