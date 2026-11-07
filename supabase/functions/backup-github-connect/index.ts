import { corsHeaders, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { validateGitHubRepo } from "../_shared/github.ts";
import { bearerToken, serviceClient, userClient } from "../_shared/supabase.ts";

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

Deno.serve(async (req) => {
  const appUrl = Deno.env.get("APP_URL") ?? undefined;
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(appUrl) });
  }
  if (req.method !== "POST") {
    return errorResponse("method_not_allowed", "POST required", 405, appUrl);
  }

  try {
    const jwt = bearerToken(req);
    if (!jwt) return errorResponse("unauthorized", "Missing bearer token", 401, appUrl);

    const body = (await req.json()) as {
      workspaceId?: string;
      repo?: string;
      branch?: string;
      path?: string;
      token?: string;
    };
    const workspaceId = body.workspaceId?.trim() ?? "";
    const repo = body.repo?.trim() ?? "";
    const token = body.token?.trim() ?? "";
    const branch = (body.branch?.trim() || "main").slice(0, 200);
    const path = (body.path?.trim() || "core-app-backups").replace(/^\/+|\/+$/g, "").slice(0, 200) || "core-app-backups";

    if (!workspaceId || !repo || !token) {
      return errorResponse("invalid_args", "workspaceId, repo, and token are required", 400, appUrl);
    }
    if (!REPO_RE.test(repo)) {
      return errorResponse("invalid_args", "Repository must be owner/name", 400, appUrl);
    }

    const user = userClient(jwt);
    const { data: isOwner } = await user.rpc("crm_is_workspace_owner_id", { p_workspace_id: workspaceId });
    if (isOwner !== true) {
      return errorResponse("owner_only", "Only the workspace owner can connect GitHub", 403, appUrl);
    }

    try {
      await validateGitHubRepo(token, repo);
    } catch (error) {
      if (error instanceof Error && error.name === "repo_not_private") {
        return errorResponse("repo_not_private", "Only private repositories are allowed", 400, appUrl);
      }
      if (error instanceof Error && error.name === "github_no_push") {
        return errorResponse("provider_error", "Token needs Contents: Read and write on this repository", 400, appUrl);
      }
      return errorResponse("provider_error", error instanceof Error ? error.message : "GitHub validation failed", 400, appUrl);
    }

    const admin = serviceClient();
    const secret = JSON.stringify({ type: "github", token });
    const { error: setError } = await admin.rpc("crm_backup_set_credential", {
      p_workspace_id: workspaceId,
      p_secret: secret,
    });
    if (setError) {
      return errorResponse("provider_error", setError.message, 500, appUrl);
    }

    const { error: updateError } = await admin.from("workspace_backup_settings").upsert(
      {
        workspace_id: workspaceId,
        provider: "github",
        github_repo: repo,
        github_branch: branch,
        github_path: path,
        google_account_email: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id" },
    );
    if (updateError) {
      return errorResponse("provider_error", updateError.message, 500, appUrl);
    }

    return jsonResponse(
      {
        ok: true,
        provider: "github",
        repo,
        branch,
        path,
      },
      200,
      appUrl,
    );
  } catch (error) {
    console.error("[backup-github-connect]", error instanceof Error ? error.message : error);
    return errorResponse("provider_error", error instanceof Error ? error.message : "Connect failed", 500, appUrl);
  }
});
