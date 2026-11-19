/**
 * Deployment check. The app is a single-page app: a tab keeps running the code it loaded, even across
 * logout / login, until the page itself is reloaded. Each build ships its id (VITE_APP_VERSION) and a
 * /version.json with the same id; a different id on the server means a newer deployment is live.
 */
export const APP_VERSION: string = String(import.meta.env.VITE_APP_VERSION ?? "dev");

const VERSION_URL = "/version.json";

/** Id of the deployment currently served, or null (dev server, offline, file missing). */
export async function fetchDeployedVersion(timeoutMs = 4000): Promise<string | null> {
  if (import.meta.env.DEV) return null;
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? window.setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(`${VERSION_URL}?t=${Date.now()}`, { cache: "no-store", signal: controller?.signal });
    if (!response.ok) return null;
    const body = (await response.json()) as { version?: unknown };
    return typeof body.version === "string" && body.version.trim() ? body.version.trim() : null;
  } catch {
    return null;
  } finally {
    if (timer != null) window.clearTimeout(timer);
  }
}

/** True when the server serves another build than the one running in this tab. */
export async function isNewVersionDeployed(timeoutMs?: number): Promise<boolean> {
  const deployed = await fetchDeployedVersion(timeoutMs);
  return deployed != null && deployed !== APP_VERSION;
}

const PRELOAD_RELOAD_KEY = "core-app:preload-reload-at";

/**
 * After a deployment an open tab may ask for a code chunk of its old build that no longer exists
 * (Vite "preloadError"): reload once to get the new build. Guarded so a real outage cannot loop.
 */
export function installChunkErrorReload() {
  window.addEventListener("vite:preloadError", (event) => {
    let last = 0;
    try {
      last = Number(window.sessionStorage.getItem(PRELOAD_RELOAD_KEY) ?? 0);
    } catch {
      // Storage unavailable: still reload once (no loop guard needed beyond this page load).
    }
    if (Date.now() - last < 60_000) return;
    try {
      window.sessionStorage.setItem(PRELOAD_RELOAD_KEY, String(Date.now()));
    } catch {
      // ignore
    }
    event.preventDefault();
    window.location.reload();
  });
}
