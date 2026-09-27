import supabase from "./supabase";

export const WORKSPACE_LOGO_BUCKET = "workspace";
export const WORKSPACE_LOGO_MAX_BYTES = 5 * 1024 * 1024;
export const WORKSPACE_LOGO_SIZE = 512;

export const LOGO_FILE_ERROR = "Please select a JPG, PNG, or WebP image smaller than 5 MB.";
export const LOGO_UPLOAD_ERROR = "Unable to upload company logo. Please try again.";
export const LOGO_REMOVE_ERROR = "Unable to remove company logo. Please try again.";
export const LOGO_LOAD_ERROR = "Unable to load company logo. Please try again.";

const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const workspaceIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function workspaceLogoStoragePath(workspaceId: string) {
  const id = normalizeWorkspaceId(workspaceId);
  if (!id) throw new Error(LOGO_UPLOAD_ERROR);
  return `workspace/${id}/logo.webp`;
}

export function workspaceLogoObjectPath(avatarPath: string, workspaceId: string) {
  const id = normalizeWorkspaceId(workspaceId);
  if (!id) return null;

  const objectPath = `${id}/logo.webp`;
  if (avatarPath !== `workspace/${objectPath}`) return null;
  return objectPath;
}

export function workspaceLogoFileError(file: { type: string; size: number }) {
  const type = file.type === "image/jpg" ? "image/jpeg" : file.type;
  if (!allowedTypes.has(type) || file.size <= 0 || file.size > WORKSPACE_LOGO_MAX_BYTES) return LOGO_FILE_ERROR;
  return null;
}

export async function cropImageToWebp(src: string, crop: { x: number; y: number; width: number; height: number }) {
  if (crop.width <= 0 || crop.height <= 0) throw new Error(LOGO_UPLOAD_ERROR);

  const image = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = WORKSPACE_LOGO_SIZE;
  canvas.height = WORKSPACE_LOGO_SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error(LOGO_UPLOAD_ERROR);

  context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, WORKSPACE_LOGO_SIZE, WORKSPACE_LOGO_SIZE);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.9));
  if (!blob) throw new Error(LOGO_UPLOAD_ERROR);
  return blob;
}

export async function getWorkspaceLogoUrl(workspaceId: string, avatarPath: string | null | undefined) {
  if (!avatarPath) return null;

  const objectPath = workspaceLogoObjectPath(avatarPath, workspaceId);
  if (!objectPath) throw new Error(LOGO_LOAD_ERROR);

  const { data, error } = await supabase.storage.from(WORKSPACE_LOGO_BUCKET).createSignedUrl(objectPath, 3600);
  if (error || !data?.signedUrl) throw new Error(LOGO_LOAD_ERROR);
  return data.signedUrl;
}

export async function uploadWorkspaceLogo(workspaceId: string, file: Blob) {
  const path = workspaceLogoStoragePath(workspaceId);
  const objectPath = workspaceLogoObjectPath(path, workspaceId);
  if (!objectPath) throw new Error(LOGO_UPLOAD_ERROR);

  await requireWorkspaceMember(workspaceId);

  const { error: uploadError } = await supabase.storage.from(WORKSPACE_LOGO_BUCKET).upload(objectPath, file, {
    upsert: true,
    contentType: "image/webp",
    cacheControl: "0",
  });
  if (uploadError) throw new Error(LOGO_UPLOAD_ERROR);

  const { data, error } = await supabase.from("workspaces").update({ avatar_path: path }).eq("id", workspaceId).select("id, avatar_path").maybeSingle();
  if (error || !data) throw new Error(LOGO_UPLOAD_ERROR);

  return path;
}

export async function removeWorkspaceLogo(workspaceId: string, avatarPath: string | null) {
  const objectPath = avatarPath ? workspaceLogoObjectPath(avatarPath, workspaceId) : null;
  if (!objectPath) throw new Error(LOGO_REMOVE_ERROR);

  await requireWorkspaceMember(workspaceId);

  const { error: removeError } = await supabase.storage.from(WORKSPACE_LOGO_BUCKET).remove([objectPath]);
  if (removeError) throw new Error(LOGO_REMOVE_ERROR);

  const { data, error } = await supabase.from("workspaces").update({ avatar_path: null }).eq("id", workspaceId).select("id, avatar_path").maybeSingle();
  if (error || !data) throw new Error(LOGO_REMOVE_ERROR);
}

function normalizeWorkspaceId(workspaceId: string) {
  const id = workspaceId.trim().toLowerCase();
  return workspaceIdPattern.test(id) ? id : null;
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(LOGO_UPLOAD_ERROR));
    image.src = src;
  });
}

async function requireWorkspaceMember(workspaceId: string) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Your session has expired. Please sign in again.");

  const { data, error } = await supabase.from("workspace_members").select("workspace_id").eq("workspace_id", workspaceId).eq("user_id", user.id).is("deleted_at", null).maybeSingle();

  if (error || !data) throw new Error("You do not have access to this workspace");
}
