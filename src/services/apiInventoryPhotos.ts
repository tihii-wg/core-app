import i18n from "../i18n";
import supabase from "./supabase";
import { requireWorkspaceId } from "./missingTable";
import { functionsBaseUrl, REMOTE_FUNCTION, sessionAccessToken, workspaceRemoteMode } from "./apiOrderAttachments";

export const INVENTORY_PHOTOS_BUCKET = "inventory-photos";
export const INVENTORY_PHOTO_MAX_INPUT_BYTES = 25 * 1024 * 1024;
const FULL_MAX_PX = 1600;
const THUMB_MAX_PX = 240;
const SIGNED_URL_SECONDS = 60 * 60;

type RemoteProvider = "google_drive" | "nas";

/**
 * `inventory_items.photo_path`:
 * - app storage: "{ws}/{item}/{stamp}.webp" (thumbnail: same path with "_t.webp");
 * - Google Drive / NAS (the workspace's file storage, like order files): "<provider>:<ref>|{ws}/{item}/{stamp}_t.webp"
 *   — the photo lives in the chosen storage, the small list thumbnail stays in app storage so a list page needs one
 *   signed-URL request instead of one remote download per item.
 */
export type ParsedInventoryPhoto =
  | { kind: "app"; full: string; thumb: string }
  | { kind: "remote"; provider: RemoteProvider; ref: string; thumb: string };

export function parseInventoryPhotoPath(photoPath: string): ParsedInventoryPhoto {
  const remote = /^(google_drive|nas):(.+)\|([^|]+)$/.exec(photoPath);
  if (remote) return { kind: "remote", provider: remote[1] as RemoteProvider, ref: remote[2], thumb: remote[3] };
  return { kind: "app", full: photoPath, thumb: photoPath.replace(/\.webp$/i, "_t.webp") };
}

/** App-storage path of the list thumbnail. */
export function inventoryPhotoThumbPath(photoPath: string) {
  return parseInventoryPhotoPath(photoPath).thumb;
}

export type UploadInventoryPhotoResult = {
  photoPath: string;
  /** The workspace stores files on Drive / NAS but it failed: the photo was kept in app storage instead. */
  fallbackFrom?: RemoteProvider;
};

async function callRemote(path: string, init: RequestInit) {
  const token = await sessionAccessToken();
  const res = await fetch(`${functionsBaseUrl()}/${REMOTE_FUNCTION}/inventory-photo/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || "",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    let message = `${res.status}`;
    try {
      const json = (await res.json()) as { error?: { code?: string; message?: string } };
      message = json.error?.code || json.error?.message || message;
    } catch {
      // not JSON
    }
    throw new Error(message);
  }
  return res;
}

async function uploadRemote(workspaceId: string, itemId: string, file: Blob, fileName: string) {
  const form = new FormData();
  form.set("workspaceId", workspaceId);
  form.set("itemId", itemId);
  form.set("file", file, fileName);
  const res = await callRemote("upload", { method: "POST", body: form });
  const json = (await res.json()) as { provider?: string; ref?: string };
  if ((json.provider !== "google_drive" && json.provider !== "nas") || !json.ref) throw new Error("provider_error");
  return { provider: json.provider as RemoteProvider, ref: json.ref };
}

function deleteRemoteInBackground(workspaceId: string, provider: RemoteProvider, ref: string) {
  void callRemote("delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, provider, ref }),
  }).catch((error: unknown) => console.warn("[InventoryPhoto] remote cleanup failed", error));
}

function photoFileName(itemName: string | undefined, stamp: number) {
  const base = (itemName ?? "")
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|#%{}^~[\]`]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return `${base || "photo"}-${stamp}.webp`;
}

function isMissingPhotoColumn(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  return (error.code === "42703" || error.code === "PGRST204") && /photo_path/i.test(error.message ?? "");
}

function photoError(key: "notInstalled" | "invalidFile" | "uploadFailed" | "removeFailed") {
  return new Error(i18n.t(`inventory.photo.errors.${key}`));
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(photoError("invalidFile"));
    };
    image.src = url;
  });
}

function scaledWebp(image: HTMLImageElement, maxPx: number, quality: number): Promise<Blob> {
  const scale = Math.min(1, maxPx / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return Promise.reject(photoError("uploadFailed"));
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(photoError("uploadFailed"))), "image/webp", quality),
  );
}

/**
 * Phone photos are several MB: the photo is scaled down in the browser (max 1600 px, WebP) and a 240 px list
 * thumbnail is made from it, so the list never downloads full-size images.
 */
async function preparePhoto(file: File) {
  if (!file.type.startsWith("image/") || file.size <= 0 || file.size > INVENTORY_PHOTO_MAX_INPUT_BYTES) throw photoError("invalidFile");
  const image = await loadImage(file);
  const [full, thumb] = await Promise.all([scaledWebp(image, FULL_MAX_PX, 0.85), scaledWebp(image, THUMB_MAX_PX, 0.8)]);
  return { full, thumb };
}

function removeFilesInBackground(paths: string[]) {
  if (paths.length === 0) return;
  void supabase.storage
    .from(INVENTORY_PHOTOS_BUCKET)
    .remove(paths)
    .then(({ error }) => {
      if (error) console.warn("[InventoryPhoto] cleanup failed", error.message);
    });
}

/**
 * Stores the photo where the workspace keeps its files (app storage, Google Drive or NAS — the same setting as order
 * files) and links it to the item. The thumbnail always goes to app storage. A Drive / NAS failure keeps the photo in
 * app storage (never lost) and reports `fallbackFrom`.
 */
export async function uploadInventoryPhoto(
  workspaceId: string | undefined,
  itemId: string,
  file: File,
  previousPath?: string | null,
  itemName?: string,
): Promise<UploadInventoryPhotoResult> {
  const ws = requireWorkspaceId(workspaceId);
  const [{ full, thumb }, remoteMode] = await Promise.all([preparePhoto(file), workspaceRemoteMode(ws).catch(() => null)]);
  const stamp = Date.now();
  const appPath = `${ws}/${itemId}/${stamp}.webp`;
  const thumbPath = `${ws}/${itemId}/${stamp}_t.webp`;
  const bucket = supabase.storage.from(INVENTORY_PHOTOS_BUCKET);
  const options = { contentType: "image/webp", upsert: true, cacheControl: "31536000" };

  const thumbUpload = bucket.upload(thumbPath, thumb, options);
  let photoPath = appPath;
  let fallbackFrom: RemoteProvider | undefined;
  let fullError: { message: string } | null = null;
  if (remoteMode) {
    try {
      const remote = await uploadRemote(ws, itemId, full, photoFileName(itemName, stamp));
      photoPath = `${remote.provider}:${remote.ref}|${thumbPath}`;
    } catch (error) {
      console.warn("[InventoryPhoto] remote upload failed, keeping the photo in app storage", error);
      fallbackFrom = remoteMode;
    }
  }
  if (photoPath === appPath) fullError = (await bucket.upload(appPath, full, options)).error;
  const uploadError = fullError ?? (await thumbUpload).error;
  if (uploadError) {
    discardInventoryPhotoFiles(ws, photoPath);
    if (/bucket not found/i.test(uploadError.message)) throw photoError("notInstalled");
    throw new Error(`${i18n.t("inventory.photo.errors.uploadFailed")} (${uploadError.message})`);
  }
  const { data, error } = await supabase
    .from("inventory_items")
    .update({ photo_path: photoPath })
    .eq("id", itemId)
    .eq("workspace_id", ws)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    discardInventoryPhotoFiles(ws, photoPath);
    if (isMissingPhotoColumn(error)) throw photoError("notInstalled");
    throw new Error(error?.message || i18n.t("inventory.photo.errors.uploadFailed"));
  }
  if (previousPath && previousPath !== photoPath) discardInventoryPhotoFiles(ws, previousPath);
  return { photoPath, ...(fallbackFrom ? { fallbackFrom } : {}) };
}

export async function removeInventoryPhoto(workspaceId: string | undefined, itemId: string, photoPath: string) {
  const ws = requireWorkspaceId(workspaceId);
  const { error } = await supabase.from("inventory_items").update({ photo_path: null }).eq("id", itemId).eq("workspace_id", ws);
  if (error) throw isMissingPhotoColumn(error) ? photoError("notInstalled") : new Error(error.message);
  discardInventoryPhotoFiles(ws, photoPath);
}

/** Removes the files of a replaced / removed photo or a deleted item (best effort, in the background). */
export function discardInventoryPhotoFiles(workspaceId: string, photoPath: string | null | undefined) {
  if (!photoPath) return;
  const parsed = parseInventoryPhotoPath(photoPath);
  if (parsed.kind === "app") {
    removeFilesInBackground([parsed.full, parsed.thumb]);
    return;
  }
  removeFilesInBackground([parsed.thumb]);
  deleteRemoteInBackground(workspaceId, parsed.provider, parsed.ref);
}

/** Display URL of the full photo: a signed URL (app storage) or an object URL of the bytes read from Drive / NAS. */
export async function resolveInventoryPhotoUrl(workspaceId: string | undefined, photoPath: string): Promise<string | null> {
  const parsed = parseInventoryPhotoPath(photoPath);
  if (parsed.kind === "app") return (await getInventoryPhotoUrls([parsed.full]))[parsed.full] ?? null;
  const ws = requireWorkspaceId(workspaceId);
  const query = new URLSearchParams({ workspaceId: ws, provider: parsed.provider, ref: parsed.ref });
  const res = await callRemote(`content?${query.toString()}`, { method: "GET" });
  return URL.createObjectURL(await res.blob());
}

/** Signed URLs of many storage paths in one request (one list page of thumbnails). */
export async function getInventoryPhotoUrls(paths: readonly string[]): Promise<Record<string, string>> {
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length === 0) return {};
  const { data, error } = await supabase.storage.from(INVENTORY_PHOTOS_BUCKET).createSignedUrls(unique, SIGNED_URL_SECONDS);
  if (error) throw new Error(error.message);
  const urls: Record<string, string> = {};
  for (const entry of data ?? []) {
    if (entry.path && entry.signedUrl && !entry.error) urls[entry.path] = entry.signedUrl;
  }
  return urls;
}
