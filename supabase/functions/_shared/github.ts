import { backupNameTimestampMs, selectBackupFilesToDelete, type RetentionFile } from "./retention.ts";

export type GitHubCredential = { type: "github"; token: string };

const GITHUB_API = "https://api.github.com";
/** Soft cap for Git Data API blobs (~100 MB hard limit; stay under). */
export const GITHUB_MAX_ARCHIVE_BYTES = 95 * 1024 * 1024;

type GhRepo = {
  private?: boolean;
  permissions?: { push?: boolean };
  default_branch?: string;
};

export async function validateGitHubRepo(token: string, repo: string): Promise<GhRepo> {
  const res = await fetch(`${GITHUB_API}/repos/${repo}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "core-app-backup",
    },
  });
  const json = (await res.json()) as GhRepo & { message?: string };
  if (!res.ok) {
    throw new Error(json.message || `github_repo_lookup_${res.status}`);
  }
  if (json.private !== true) {
    const err = new Error("repo_not_private");
    err.name = "repo_not_private";
    throw err;
  }
  if (json.permissions?.push !== true) {
    const err = new Error("github_no_push");
    err.name = "github_no_push";
    throw err;
  }
  return json;
}

function ghHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "core-app-backup",
    "Content-Type": "application/json",
  };
}

async function ghJson<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${GITHUB_API}${path}`, { ...init, headers: { ...ghHeaders(token), ...(init?.headers ?? {}) } });
  const json = (await res.json()) as T & { message?: string };
  if (!res.ok) throw new Error(json.message || `github_http_${res.status}`);
  return json;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function uploadZipToGitHub(input: {
  token: string;
  repo: string;
  branch: string;
  pathPrefix: string;
  fileName: string;
  bytes: Uint8Array;
  retentionCount: number;
}): Promise<{ path: string; htmlUrl: string }> {
  if (input.bytes.byteLength > GITHUB_MAX_ARCHIVE_BYTES) {
    const err = new Error("too_large");
    err.name = "too_large";
    throw err;
  }

  const prefix = input.pathPrefix.replace(/^\/+|\/+$/g, "") || "core-app-backups";
  const newPath = `${prefix}/${input.fileName}`;

  const ref = await ghJson<{ object: { sha: string } }>(
    input.token,
    `/repos/${input.repo}/git/ref/heads/${encodeURIComponent(input.branch)}`,
  );
  const baseCommitSha = ref.object.sha;
  const baseCommit = await ghJson<{ tree: { sha: string } }>(
    input.token,
    `/repos/${input.repo}/git/commits/${baseCommitSha}`,
  );

  const blob = await ghJson<{ sha: string }>(input.token, `/repos/${input.repo}/git/blobs`, {
    method: "POST",
    body: JSON.stringify({ content: bytesToBase64(input.bytes), encoding: "base64" }),
  });

  // List existing backups in the folder via contents API (flat listing).
  let existing: { name: string; path: string; sha: string }[] = [];
  try {
    const listed = await ghJson<{ name: string; path: string; sha: string; type: string }[] | { message?: string }>(
      input.token,
      `/repos/${input.repo}/contents/${encodeURIComponent(prefix)}?ref=${encodeURIComponent(input.branch)}`,
    );
    if (Array.isArray(listed)) {
      existing = listed.filter((entry) => entry.type === "file" && entry.name.endsWith(".zip"));
    }
  } catch {
    existing = [];
  }

  const retentionFiles: RetentionFile[] = [
    ...existing.map((entry) => ({ name: entry.name, createdAtMs: backupNameTimestampMs(entry.name) })),
    { name: input.fileName, createdAtMs: Date.now() },
  ];
  const deleteNames = new Set(selectBackupFilesToDelete(retentionFiles, input.retentionCount));

  const treeItems: { path: string; mode: string; type: string; sha: string | null }[] = [
    { path: newPath, mode: "100644", type: "blob", sha: blob.sha },
  ];
  for (const entry of existing) {
    if (deleteNames.has(entry.name)) {
      treeItems.push({ path: entry.path, mode: "100644", type: "blob", sha: null });
    }
  }

  const tree = await ghJson<{ sha: string }>(input.token, `/repos/${input.repo}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree: treeItems }),
  });

  const commit = await ghJson<{ sha: string }>(input.token, `/repos/${input.repo}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message: `chore(backup): ${input.fileName}`,
      tree: tree.sha,
      parents: [baseCommitSha],
    }),
  });

  await ghJson(input.token, `/repos/${input.repo}/git/refs/heads/${encodeURIComponent(input.branch)}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: commit.sha }),
  });

  const htmlUrl = `https://github.com/${input.repo}/blob/${encodeURIComponent(input.branch)}/${newPath}`;
  return { path: newPath, htmlUrl };
}
