import { describe, expect, it } from "vitest";
import { LOGO_FILE_ERROR, workspaceLogoFileError, workspaceLogoObjectPath, workspaceLogoStoragePath } from "./workspaceAvatar";

const workspaceId = "4b8f0c3a-1111-4111-8111-111111111111";

describe("workspace logo path", () => {
  it("stores the logo under the workspace folder", () => {
    expect(workspaceLogoStoragePath(workspaceId)).toBe(`workspace/${workspaceId}/logo.webp`);
    expect(workspaceLogoObjectPath(`workspace/${workspaceId}/logo.webp`, workspaceId)).toBe(`${workspaceId}/logo.webp`);
  });

  it("rejects a path that points at another workspace", () => {
    expect(workspaceLogoObjectPath("workspace/aaaaaaaa-1111-4111-8111-111111111111/logo.webp", workspaceId)).toBeNull();
    expect(workspaceLogoObjectPath(`${workspaceId}/notes.txt`, workspaceId)).toBeNull();
  });
});

describe("workspace logo files", () => {
  it("accepts jpg, png, and webp images up to 5 MB", () => {
    expect(workspaceLogoFileError({ type: "image/jpeg", size: 1024 })).toBeNull();
    expect(workspaceLogoFileError({ type: "image/png", size: 1024 })).toBeNull();
    expect(workspaceLogoFileError({ type: "image/webp", size: 5 * 1024 * 1024 })).toBeNull();
  });

  it("rejects other types and oversized files", () => {
    expect(workspaceLogoFileError({ type: "image/gif", size: 1024 })).toBe(LOGO_FILE_ERROR);
    expect(workspaceLogoFileError({ type: "image/png", size: 5 * 1024 * 1024 + 1 })).toBe(LOGO_FILE_ERROR);
  });
});
