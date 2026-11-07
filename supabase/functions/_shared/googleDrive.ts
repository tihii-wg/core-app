import { selectBackupFilesToDelete, backupNameTimestampMs, type RetentionFile } from "./retention.ts";

export type GoogleCredential = { type: "google"; refresh_token: string };

export async function googleAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const json = (await res.json()) as { access_token?: string; error?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(json.error || "google_token_exchange_failed");
  }
  return json.access_token;
}

async function driveJson<T>(accessToken: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`https://www.googleapis.com/drive/v3${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {}),
    },
  });
  const json = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) {
    throw new Error(json.error?.message || `google_drive_http_${res.status}`);
  }
  return json;
}

export async function ensureDriveBackupFolder(
  accessToken: string,
  workspaceName: string,
  existingFolderId: string | null,
): Promise<string> {
  if (existingFolderId) {
    try {
      await driveJson(accessToken, `/files/${encodeURIComponent(existingFolderId)}?fields=id,trashed`);
      return existingFolderId;
    } catch {
      // recreate below
    }
  }

  const root = await findOrCreateFolder(accessToken, "Core App Backups", null);
  return findOrCreateFolder(accessToken, workspaceName.trim() || "Workspace", root);
}

async function findOrCreateFolder(accessToken: string, name: string, parentId: string | null): Promise<string> {
  const safeName = name.replace(/'/g, "\\'");
  const parentClause = parentId
    ? ` and '${parentId}' in parents`
    : " and 'root' in parents";
  const q = encodeURIComponent(
    `name='${safeName}' and mimeType='application/vnd.google-apps.folder' and trashed=false${parentClause}`,
  );
  const listed = await driveJson<{ files?: { id: string }[] }>(
    accessToken,
    `/files?q=${q}&fields=files(id)&pageSize=1`,
  );
  const existing = listed.files?.[0]?.id;
  if (existing) return existing;

  const created = await driveJson<{ id: string }>(accessToken, "/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: parentId ? [parentId] : undefined,
    }),
  });
  return created.id;
}

export async function uploadZipToDrive(
  accessToken: string,
  folderId: string,
  fileName: string,
  bytes: Uint8Array,
): Promise<{ fileId: string; webViewLink: string | null }> {
  const metadata = {
    name: fileName,
    parents: [folderId],
  };
  const boundary = `coreapp_${crypto.randomUUID().replace(/-/g, "")}`;
  const metaPart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`;
  const binHeader = `--${boundary}\r\nContent-Type: application/zip\r\n\r\n`;
  const footer = `\r\n--${boundary}--`;
  const metaBytes = new TextEncoder().encode(metaPart + binHeader);
  const footerBytes = new TextEncoder().encode(footer);
  const body = new Uint8Array(metaBytes.length + bytes.length + footerBytes.length);
  body.set(metaBytes, 0);
  body.set(bytes, metaBytes.length);
  body.set(footerBytes, metaBytes.length + bytes.length);

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );
  const json = (await res.json()) as { id?: string; webViewLink?: string; error?: { message?: string } };
  if (!res.ok || !json.id) {
    throw new Error(json.error?.message || `google_upload_failed_${res.status}`);
  }
  return { fileId: json.id, webViewLink: json.webViewLink ?? null };
}

export async function enforceDriveRetention(
  accessToken: string,
  folderId: string,
  retentionCount: number,
): Promise<void> {
  const listed = await driveJson<{ files?: { id: string; name: string; createdTime?: string }[] }>(
    accessToken,
    `/files?q=${encodeURIComponent(`'${folderId}' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'`)}&fields=files(id,name,createdTime)&pageSize=100`,
  );
  const files = listed.files ?? [];
  const retentionFiles: RetentionFile[] = files.map((file) => ({
    name: file.name,
    createdAtMs: file.createdTime ? Date.parse(file.createdTime) : backupNameTimestampMs(file.name),
  }));
  const toDeleteNames = new Set(selectBackupFilesToDelete(retentionFiles, retentionCount));
  for (const file of files) {
    if (!toDeleteNames.has(file.name)) continue;
    await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  }
}
