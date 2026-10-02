import { act, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fake, fakeClient } from "../fakeSupabase";
import { USERS, WS, row, seedCoreApp } from "../coreAppDb";
import { installDomStubs, renderApp, trackUnhandledRejections } from "../appHarness";
import { createHookWrapper } from "../hookHarness";
import { useGetWorkspace } from "../../features/workspaces/useGetWorkspace";
import { useGetWorkspaces } from "../../features/workspaces/useGetWorkspaces";
import { useRemoveWorkspaceAvatar, useUploadWorkspaceAvatar, useWorkspaceAvatar } from "../../features/workspaces/useWorkspaceAvatar";
import type { ListedWorkspaceMembership } from "../../services/apiWorkspaces";

vi.mock("../../services/supabase", async () => ({ default: (await import("../fakeSupabase")).fakeClient }));

const LOGO = `${WS.A}/logo.webp`;
let unhandled: ReturnType<typeof trackUnhandledRejections>;
let signed: string[];
let consoleError: ReturnType<typeof vi.spyOn>;

// Like hosted Storage, signing a path that has no object fails with "Object not found".
function signOnlyExistingObjects() {
  const from = fakeClient.storage.from;
  return vi.spyOn(fakeClient.storage, "from").mockImplementation((bucket: string) => {
    const api = from(bucket);
    return {
      ...api,
      createSignedUrl: async (path: string) => {
        signed.push(path);
        if (!fake.storageObjects.has(`${bucket}/${path}`)) return { data: null, error: { message: "Object not found", statusCode: "404" } };
        return api.createSignedUrl(path);
      },
    };
  });
}

function saveLogo() {
  fake.storageObjects.set(`workspace/${LOGO}`, new Blob(["logo"], { type: "image/webp" }));
  const workspace = row("workspaces", WS.A);
  if (workspace) workspace.avatar_path = LOGO;
}

function listedAvatar(memberships: ListedWorkspaceMembership[] | undefined) {
  const entry = memberships?.flatMap((item) => (Array.isArray(item.workspaces) ? item.workspaces : item.workspaces ? [item.workspaces] : [])).find((workspace) => workspace.id === WS.A);
  return entry?.avatar_path;
}

const signedUrlFailures = () => consoleError.mock.calls.filter((call) => String(call[0]).includes("[WorkspaceLogo] Signed URL failed"));

beforeEach(() => {
  seedCoreApp();
  installDomStubs();
  unhandled = trackUnhandledRejections();
  signed = [];
  signOnlyExistingObjects();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  unhandled.stop();
  vi.restoreAllMocks();
});

describe("workspace logo removal", () => {
  it("switches to the placeholder at once and never signs the deleted object", async () => {
    saveLogo();
    fake.signInAs(USERS.owner.id);
    const app = renderApp(`/en/${WS.A}/settings`);

    await screen.findByRole("button", { name: "Remove logo" });
    await waitFor(() => expect(signed).toContain(LOGO));
    await new Promise((resolve) => setTimeout(resolve, 30));
    const signedBefore = signed.length;

    await app.user.click(screen.getByRole("button", { name: "Remove logo" }));
    const dialog = await screen.findByRole("dialog");
    await app.user.click(within(dialog).getByRole("button", { name: "Remove" }));

    expect(await screen.findByRole("button", { name: "Upload logo" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove logo" })).not.toBeInTheDocument();
    expect(screen.queryByText("Unable to load company logo. Please try again.")).not.toBeInTheDocument();
    expect(fake.storageObjects.has(`workspace/${LOGO}`)).toBe(false);
    expect(row("workspaces", WS.A)?.avatar_path).toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(signed.slice(signedBefore)).toEqual([]);
    expect(signedUrlFailures()).toEqual([]);
    expect(unhandled.rejections).toEqual([]);

    app.unmount();
    signed = [];
    renderApp(`/en/${WS.A}/settings`);
    expect(await screen.findByRole("button", { name: "Upload logo" })).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(signed).toEqual([]);
    expect(signedUrlFailures()).toEqual([]);
  });
});

describe("workspace logo cache", () => {
  function setup() {
    fake.signInAs(USERS.owner.id);
    const harness = createHookWrapper(`/en/${WS.A}/settings`);
    const rendered = renderHook(
      () => {
        const workspace = useGetWorkspace(WS.A);
        const workspaces = useGetWorkspaces();
        const avatar = useWorkspaceAvatar(workspace.data?.id, workspace.data?.avatarPath);
        return { workspace, workspaces, avatar, upload: useUploadWorkspaceAvatar(), remove: useRemoveWorkspaceAvatar() };
      },
      { wrapper: harness.wrapper },
    );
    return { ...harness, ...rendered };
  }

  it("upload shows the logo, replace signs it again, remove clears avatar_path in both workspace caches", async () => {
    const { result, queryClient } = setup();
    await waitFor(() => expect(result.current.workspace.data?.avatarPath).toBeNull());

    await act(() => result.current.upload.mutateAsync({ workspaceId: WS.A, file: new Blob(["first"]) }));
    await waitFor(() => expect(result.current.avatar.data).toContain(LOGO));
    expect(result.current.workspace.data?.avatarPath).toBe(LOGO);
    await waitFor(() => expect(listedAvatar(result.current.workspaces.workspaces)).toBe(LOGO));

    const signedBeforeReplace = signed.length;
    const replacement = new Blob(["second"]);
    await act(() => result.current.upload.mutateAsync({ workspaceId: WS.A, file: replacement }));
    await waitFor(() => expect(signed.length).toBeGreaterThan(signedBeforeReplace));
    expect(fake.storageObjects.get(`workspace/${LOGO}`)).toBe(replacement);
    expect(result.current.avatar.data).toContain(LOGO);

    const signedBeforeRemove = signed.length;
    await act(() => result.current.remove.mutateAsync({ workspaceId: WS.A, avatarPath: LOGO }));
    expect(queryClient.getQueryData<{ avatarPath: string | null }>(["workspace", WS.A])?.avatarPath).toBeNull();
    expect(listedAvatar(queryClient.getQueryData(["workspaces"]))).toBeNull();
    await waitFor(() => expect(result.current.avatar.data).toBeUndefined());
    expect(queryClient.getQueryCache().find({ queryKey: ["workspace-avatar", WS.A, LOGO] })?.isActive()).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(signed.slice(signedBeforeRemove)).toEqual([]);
    expect(signedUrlFailures()).toEqual([]);
  });
});
