import i18n from "../i18n";
import supabase from "./supabase";
import { requireWorkspaceId } from "./missingTable";

export const INVENTORY_PHOTOS_BUCKET = "inventory-photos";
export const INVENTORY_PHOTO_MAX_INPUT_BYTES = 25 * 1024 * 1024;
const FULL_MAX_PX = 1600;
const THUMB_MAX_PX = 240;
const SIGNED_URL_SECONDS = 60 * 60;

/** List thumbnail stored next to the photo: `…/123.webp` → `…/123_t.webp`. */
export function inventoryPhotoThumbPath(photoPath: string) {
  return photoPath.replace(/\.webp$/i, "_t.webp");
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

/** Stores the photo (photo + thumbnail in parallel), links it to the item and drops the previous files. */
export async function uploadInventoryPhoto(workspaceId: string | undefined, itemId: string, file: File, previousPath?: string | null) {
  const ws = requireWorkspaceId(workspaceId);
  const { full, thumb } = await preparePhoto(file);
  const path = `${ws}/${itemId}/${Date.now()}.webp`;
  const bucket = supabase.storage.from(INVENTORY_PHOTOS_BUCKET);
  const [fullUpload, thumbUpload] = await Promise.all([
    bucket.upload(path, full, { contentType: "image/webp", upsert: true, cacheControl: "31536000" }),
    bucket.upload(inventoryPhotoThumbPath(path), thumb, { contentType: "image/webp", upsert: true, cacheControl: "31536000" }),
  ]);
  const uploadError = fullUpload.error ?? thumbUpload.error;
  if (uploadError) {
    removeFilesInBackground([path, inventoryPhotoThumbPath(path)]);
    if (/bucket not found/i.test(uploadError.message)) throw photoError("notInstalled");
    throw new Error(`${i18n.t("inventory.photo.errors.uploadFailed")} (${uploadError.message})`);
  }
  const { data, error } = await supabase
    .from("inventory_items")
    .update({ photo_path: path })
    .eq("id", itemId)
    .eq("workspace_id", ws)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    removeFilesInBackground([path, inventoryPhotoThumbPath(path)]);
    if (isMissingPhotoColumn(error)) throw photoError("notInstalled");
    throw new Error(error?.message || i18n.t("inventory.photo.errors.uploadFailed"));
  }
  if (previousPath && previousPath !== path) removeFilesInBackground([previousPath, inventoryPhotoThumbPath(previousPath)]);
  return path;
}

export async function removeInventoryPhoto(workspaceId: string | undefined, itemId: string, photoPath: string) {
  const ws = requireWorkspaceId(workspaceId);
  const { error } = await supabase.from("inventory_items").update({ photo_path: null }).eq("id", itemId).eq("workspace_id", ws);
  if (error) throw isMissingPhotoColumn(error) ? photoError("notInstalled") : new Error(error.message);
  removeFilesInBackground([photoPath, inventoryPhotoThumbPath(photoPath)]);
}

/** Removes the files of a deleted item (best effort, in the background). */
export function discardInventoryPhotoFiles(photoPath: string | null | undefined) {
  if (photoPath) removeFilesInBackground([photoPath, inventoryPhotoThumbPath(photoPath)]);
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
