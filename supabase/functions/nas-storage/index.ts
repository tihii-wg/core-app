import { corsHeaders, errorResponse, jsonResponse } from "../_shared/cors.ts";
import {
  NasClientError,
  normalizeRootPath,
  parseNasCredential,
  testNasConnection,
  type NasConnectionConfig,
  type NasCredential,
  type NasProtocol,
} from "../_shared/nasClient.ts";
import { bearerToken, serviceClient, userClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  const appUrl = (Deno.env.get("APP_URL") ?? "").replace(/\/$/, "");
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(appUrl) });
  }

  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "");

  try {
    if (path.endsWith("/test") && req.method === "POST") {
      return await handleTest(req, appUrl, false);
    }
    if (path.endsWith("/save") && req.method === "POST") {
      return await handleTest(req, appUrl, true);
    }
    if (path.endsWith("/disconnect") && req.method === "POST") {
      return await handleDisconnect(req, appUrl);
    }
    return errorResponse("not_found", "Unknown route", 404, appUrl);
  } catch (error) {
    console.error("[nas-storage]", error instanceof Error ? error.message : error);
    if (error instanceof NasClientError) {
      return errorResponse(error.code, error.message, 400, appUrl);
    }
    return errorResponse("provider_error", error instanceof Error ? error.message : "NAS request failed", 500, appUrl);
  }
});

type Body = {
  workspaceId?: string;
  protocol?: string;
  baseUrl?: string;
  rootPath?: string;
  username?: string;
  password?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  bucket?: string;
  region?: string;
  keepExistingSecret?: boolean;
};

async function requireOwner(req: Request, workspaceId: string, appUrl: string) {
  const jwt = bearerToken(req);
  if (!jwt) return { error: errorResponse("unauthorized", "Missing bearer token", 401, appUrl) } as const;
  const user = userClient(jwt);
  const { data: userData, error: userError } = await user.auth.getUser(jwt);
  if (userError || !userData.user) {
    return { error: errorResponse("unauthorized", "Invalid session", 401, appUrl) } as const;
  }
  const { data: isOwner } = await user.rpc("crm_is_workspace_owner_id", { p_workspace_id: workspaceId });
  if (isOwner !== true) {
    return { error: errorResponse("attachment_storage:owner_only", "Only the workspace owner can manage NAS", 403, appUrl) } as const;
  }
  return { jwt, user, userId: userData.user.id } as const;
}

function parseBodyConfig(body: Body): NasConnectionConfig {
  const protocol = (body.protocol === "s3" ? "s3" : body.protocol === "webdav" ? "webdav" : "") as NasProtocol | "";
  if (!protocol) throw new NasClientError("invalid_args", "protocol must be webdav or s3");
  const baseUrl = (body.baseUrl ?? "").trim();
  if (!baseUrl) throw new NasClientError("invalid_args", "baseUrl required");
  return {
    protocol,
    baseUrl,
    rootPath: normalizeRootPath(body.rootPath),
    username: body.username?.trim() || null,
    bucket: body.bucket?.trim() || null,
    region: body.region?.trim() || null,
  };
}

async function resolveCredential(
  admin: ReturnType<typeof serviceClient>,
  workspaceId: string,
  config: NasConnectionConfig,
  body: Body,
): Promise<NasCredential> {
  const keep = body.keepExistingSecret === true;
  if (config.protocol === "webdav") {
    if (body.password) return { type: "webdav", password: body.password };
    if (keep) {
      const { data: secret, error } = await admin.rpc("crm_nas_get_credential", { p_workspace_id: workspaceId });
      if (error || typeof secret !== "string" || !secret) {
        throw new NasClientError("invalid_args", "No saved WebDAV password; enter the password");
      }
      const parsed = parseNasCredential(secret);
      if (parsed.type !== "webdav") throw new NasClientError("invalid_args", "Saved credential is not WebDAV");
      return parsed;
    }
    throw new NasClientError("invalid_args", "WebDAV password required");
  }

  if (body.accessKeyId && body.secretAccessKey) {
    return { type: "s3", access_key_id: body.accessKeyId, secret_access_key: body.secretAccessKey };
  }
  if (keep) {
    const { data: secret, error } = await admin.rpc("crm_nas_get_credential", { p_workspace_id: workspaceId });
    if (error || typeof secret !== "string" || !secret) {
      throw new NasClientError("invalid_args", "No saved S3 credentials; enter access keys");
    }
    const parsed = parseNasCredential(secret);
    if (parsed.type !== "s3") throw new NasClientError("invalid_args", "Saved credential is not S3");
    // Allow rotating only one half if provided
    return {
      type: "s3",
      access_key_id: body.accessKeyId || parsed.access_key_id,
      secret_access_key: body.secretAccessKey || parsed.secret_access_key,
    };
  }
  throw new NasClientError("invalid_args", "S3 access key and secret required");
}

async function handleTest(req: Request, appUrl: string, persist: boolean): Promise<Response> {
  const body = (await req.json()) as Body;
  const workspaceId = body.workspaceId?.trim() ?? "";
  if (!workspaceId) return errorResponse("invalid_args", "workspaceId required", 400, appUrl);

  const auth = await requireOwner(req, workspaceId, appUrl);
  if ("error" in auth) return auth.error;

  const admin = serviceClient();
  let config: NasConnectionConfig;
  let credential: NasCredential;
  try {
    config = parseBodyConfig(body);
    credential = await resolveCredential(admin, workspaceId, config, body);
  } catch (error) {
    if (error instanceof NasClientError) {
      return errorResponse(error.code, error.message, 400, appUrl);
    }
    throw error;
  }

  try {
    await testNasConnection(config, credential);
  } catch (error) {
    const code = error instanceof NasClientError ? error.code : "unreachable";
    const message = error instanceof Error ? error.message : "NAS test failed";
    if (persist) {
      await admin.from("workspace_nas_storage").upsert(
        {
          workspace_id: workspaceId,
          protocol: config.protocol,
          base_url: config.baseUrl.replace(/\/$/, ""),
          root_path: config.rootPath,
          username: config.protocol === "webdav" ? config.username : null,
          bucket: config.protocol === "s3" ? config.bucket : null,
          region: config.protocol === "s3" ? (config.region || "us-east-1") : null,
          status: "error",
          last_error: `${code}: ${message}`.slice(0, 500),
          last_checked_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "workspace_id" },
      );
    }
    return errorResponse(code, message, 400, appUrl);
  }

  if (!persist) {
    return jsonResponse({ ok: true }, 200, appUrl);
  }

  const secretJson =
    credential.type === "webdav"
      ? JSON.stringify({ type: "webdav", password: credential.password })
      : JSON.stringify({
          type: "s3",
          access_key_id: credential.access_key_id,
          secret_access_key: credential.secret_access_key,
        });

  const { error: vaultError } = await admin.rpc("crm_nas_set_credential", {
    p_workspace_id: workspaceId,
    p_secret: secretJson,
  });
  if (vaultError) {
    return errorResponse("provider_error", vaultError.message, 500, appUrl);
  }

  const now = new Date().toISOString();
  const { error: upsertError } = await admin.from("workspace_nas_storage").upsert(
    {
      workspace_id: workspaceId,
      protocol: config.protocol,
      base_url: config.baseUrl.replace(/\/$/, ""),
      root_path: config.rootPath,
      username: config.protocol === "webdav" ? config.username : null,
      bucket: config.protocol === "s3" ? config.bucket : null,
      region: config.protocol === "s3" ? (config.region || "us-east-1") : null,
      status: "connected",
      last_error: null,
      last_checked_at: now,
      connected_by: auth.userId,
      connected_at: now,
      updated_at: now,
    },
    { onConflict: "workspace_id" },
  );
  if (upsertError) {
    return errorResponse("provider_error", upsertError.message, 500, appUrl);
  }

  return jsonResponse({ ok: true, status: "connected" }, 200, appUrl);
}

async function handleDisconnect(req: Request, appUrl: string): Promise<Response> {
  const body = (await req.json()) as { workspaceId?: string };
  const workspaceId = body.workspaceId?.trim() ?? "";
  if (!workspaceId) return errorResponse("invalid_args", "workspaceId required", 400, appUrl);

  const auth = await requireOwner(req, workspaceId, appUrl);
  if ("error" in auth) return auth.error;

  const admin = serviceClient();
  const { error } = await admin.rpc("crm_nas_clear_credential", { p_workspace_id: workspaceId });
  if (error) return errorResponse("provider_error", error.message, 500, appUrl);

  await admin
    .from("workspace_nas_storage")
    .update({
      status: "disconnected",
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspaceId);

  return jsonResponse({ ok: true }, 200, appUrl);
}
