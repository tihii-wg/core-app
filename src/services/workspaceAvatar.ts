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
  if (!id) {
    console.error("[WorkspaceLogo] Invalid workspace id", { workspaceId });
    throw new Error("Invalid workspace ID");
  }
  return `${id}/logo.webp`;
}

export function workspaceLogoObjectPath(avatarPath: string, workspaceId: string) {
  const id = normalizeWorkspaceId(workspaceId);
  if (!id) return null;

  const objectPath = `${id}/logo.webp`;
  const storedPath = avatarPath.replace(/^workspace\//, "");
  if (storedPath !== objectPath) return null;
  return objectPath;
}

export function workspaceLogoFileError(file: { type: string; size: number }) {
  const type = file.type === "image/jpg" ? "image/jpeg" : file.type;
  if (!allowedTypes.has(type) || file.size <= 0 || file.size > WORKSPACE_LOGO_MAX_BYTES) return LOGO_FILE_ERROR;
  return null;
}

export async function cropImageToWebp(src: string, crop: { x: number; y: number; width: number; height: number }) {
  if (crop.width <= 0 || crop.height <= 0) failLogo("Image crop", LOGO_UPLOAD_ERROR, new Error("Crop area is empty"));

  const image = await loadImage(src).catch((error: unknown) => failLogo("Image conversion", LOGO_UPLOAD_ERROR, error));
  const canvas = document.createElement("canvas");
  canvas.width = WORKSPACE_LOGO_SIZE;
  canvas.height = WORKSPACE_LOGO_SIZE;
  const context = canvas.getContext("2d");
  if (!context) failLogo("Image conversion", LOGO_UPLOAD_ERROR, new Error("Canvas is unavailable"));

  context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, WORKSPACE_LOGO_SIZE, WORKSPACE_LOGO_SIZE);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.9));
  if (!blob) failLogo("Image conversion", LOGO_UPLOAD_ERROR, new Error("WebP conversion failed"));
  return blob;
}

export async function getWorkspaceLogoUrl(workspaceId: string, avatarPath: string | null | undefined) {
  if (!avatarPath) return null;

  const objectPath = workspaceLogoObjectPath(avatarPath, workspaceId);
  if (!objectPath) {
    console.error("[WorkspaceLogo] Signed URL failed", { workspaceId, avatarPath, reason: "invalid logo path" });
    throw new Error(LOGO_LOAD_ERROR);
  }

  const { data, error } = await supabase.storage.from(WORKSPACE_LOGO_BUCKET).createSignedUrl(objectPath, 3600);
  if (error || !data?.signedUrl) {
    failLogo("Signed URL", LOGO_LOAD_ERROR, error ?? new Error("Signed URL was empty"), {
      workspaceId,
      bucket: WORKSPACE_LOGO_BUCKET,
      path: objectPath,
    });
  }
  return data.signedUrl;
}

export async function uploadWorkspaceLogo(workspaceId: string, file: Blob) {
  const workspace = await resolveLogoWorkspace(workspaceId);
  const path = workspaceLogoStoragePath(workspace.id);

  console.info("[WorkspaceLogo] Upload", {
    workspaceId: workspace.id,
    activeWorkspaceId: workspace.activeWorkspaceId,
    bucket: WORKSPACE_LOGO_BUCKET,
    path,
  });

  const { error: uploadError } = await supabase.storage.from(WORKSPACE_LOGO_BUCKET).upload(path, file, {
    upsert: true,
    contentType: "image/webp",
    cacheControl: "0",
  });
  if (uploadError) {
    failLogo("Storage upload", LOGO_UPLOAD_ERROR, uploadError, {
      workspaceId: workspace.id,
      bucket: WORKSPACE_LOGO_BUCKET,
      path,
    });
  }

  const { data, error } = await supabase.from("workspaces").update({ avatar_path: path }).eq("id", workspace.id).select("id, avatar_path").maybeSingle();
  if (error) {
    failLogo("Database update", LOGO_UPLOAD_ERROR, error, {
      workspaceId: workspace.id,
      path,
    });
  }
  if (!data) {
    console.error("[WorkspaceLogo] Database update failed", {
      workspaceId: workspace.id,
      path,
      reason: "no row returned",
    });
    throw new Error("avatar_path update failed: no row was returned");
  }

  return path;
}

export async function removeWorkspaceLogo(workspaceId: string, avatarPath: string | null) {
  const workspace = await resolveLogoWorkspace(workspaceId);
  const objectPath = avatarPath ? workspaceLogoObjectPath(avatarPath, workspace.id) : null;
  if (!objectPath) failLogo("Storage delete", LOGO_REMOVE_ERROR, new Error("Invalid logo path"), { workspaceId: workspace.id, avatarPath });

  const { error: removeError } = await supabase.storage.from(WORKSPACE_LOGO_BUCKET).remove([objectPath]);
  if (removeError) {
    failLogo("Storage delete", LOGO_REMOVE_ERROR, removeError, {
      workspaceId: workspace.id,
      bucket: WORKSPACE_LOGO_BUCKET,
      path: objectPath,
    });
  }

  const { data, error } = await supabase.from("workspaces").update({ avatar_path: null }).eq("id", workspace.id).select("id, avatar_path").maybeSingle();
  if (error) failLogo("Database update", LOGO_REMOVE_ERROR, error, { workspaceId: workspace.id, path: objectPath });
  if (!data) {
    console.error("[WorkspaceLogo] Database update failed", {
      workspaceId: workspace.id,
      path: objectPath,
      reason: "no row returned",
    });
    throw new Error("avatar_path update failed: no row was returned");
  }
}

function normalizeWorkspaceId(workspaceId: string) {
  const id = workspaceId.trim().toLowerCase();
  return workspaceIdPattern.test(id) ? id : null;
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Image could not be read"));
    image.src = src;
  });
}

async function resolveLogoWorkspace(workspaceId: string) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Your session has expired. Please sign in again.");

  const { data: profile, error: profileError } = await supabase.from("profiles").select("active_workspace_id").eq("id", user.id).maybeSingle();
  if (profileError) failLogo("Active workspace lookup", LOGO_UPLOAD_ERROR, profileError, { userId: user.id });

  const activeWorkspaceId = typeof profile?.active_workspace_id === "string" ? profile.active_workspace_id : null;
  const id = normalizeWorkspaceId(workspaceId) ?? (activeWorkspaceId ? normalizeWorkspaceId(activeWorkspaceId) : null);
  if (!id || id === user.id) {
    console.error("[WorkspaceLogo] Invalid workspace id", { workspaceId, activeWorkspaceId, userId: user.id });
    throw new Error(id === user.id ? "Invalid workspace ID" : "No active workspace selected");
  }

  const { data, error } = await supabase.from("workspace_members").select("workspace_id").eq("workspace_id", id).eq("user_id", user.id).is("deleted_at", null).maybeSingle();
  if (error) failLogo("Membership check", "You do not have access to this workspace", error, { workspaceId: id, activeWorkspaceId });
  if (!data) throw new Error("You do not have access to this workspace");

  return { id, activeWorkspaceId };
}

function failLogo(operation: string, fallback: string, error: unknown, details: Record<string, unknown> = {}): never {
  const info = logoErrorInfo(error);
  console.error(`[WorkspaceLogo] ${operation} failed`, { operation, ...details, error: info });
  throw new Error(info.message || fallback);
}

function logoErrorInfo(error: unknown) {
  if (!error || typeof error !== "object") return { message: error == null ? undefined : String(error) };
  const record = error as { message?: string; name?: string; statusCode?: string | number; status?: string | number; code?: string; error?: string };
  return {
    message: record.message,
    name: record.name,
    statusCode: record.statusCode ?? record.status,
    code: record.code,
    error: record.error,
  };
}
