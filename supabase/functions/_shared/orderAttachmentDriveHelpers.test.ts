import { describe, expect, it } from "vitest";
import {
  assertDriveConnectionReady,
  assertOrderMutableForAttachments,
  buildOrderFolderLabel,
  validateDriveUploadFile,
} from "./orderAttachmentDriveHelpers.ts";

describe("assertOrderMutableForAttachments", () => {
  it("allows open orders", () => {
    expect(assertOrderMutableForAttachments({ status: "in-progress", closedAt: null, isOwner: false })).toBe("ok");
  });

  it("rejects closed non-cancelled for everyone", () => {
    expect(
      assertOrderMutableForAttachments({ status: "closed", closedAt: "2026-01-01", isOwner: true }),
    ).toBe("closed_immutable");
  });

  it("allows cancelled only for owner", () => {
    expect(
      assertOrderMutableForAttachments({ status: "cancelled", closedAt: "2026-01-01", isOwner: true }),
    ).toBe("ok");
    expect(
      assertOrderMutableForAttachments({ status: "cancelled", closedAt: "2026-01-01", isOwner: false }),
    ).toBe("cancelled_owner_only");
  });
});

describe("validateDriveUploadFile", () => {
  it("enforces mime and size limits", () => {
    expect(validateDriveUploadFile({ mimeType: "image/jpeg", size: 1000 })).toBeNull();
    expect(validateDriveUploadFile({ mimeType: "image/jpeg", size: 6 * 1024 * 1024 })).toBe("tooLarge");
    expect(validateDriveUploadFile({ mimeType: "application/pdf", size: 21 * 1024 * 1024 })).toBe("tooLarge");
    expect(validateDriveUploadFile({ mimeType: "application/zip", size: 100 })).toBe("unsupportedType");
    expect(validateDriveUploadFile({ mimeType: "image/png", size: 0 })).toBe("empty");
  });
});

describe("folder naming", () => {
  it("builds «{orderNumber} — {clientName}»", () => {
    expect(buildOrderFolderLabel("ORD-100", "Ada Lovelace")).toBe("ORD-100 — Ada Lovelace");
    expect(buildOrderFolderLabel("A/B", "X\\Y")).toContain("—");
  });
});

describe("assertDriveConnectionReady", () => {
  it("requires connected status and root folder", () => {
    expect(assertDriveConnectionReady(null)).toBe("not_connected");
    expect(assertDriveConnectionReady({ status: "disconnected", root_folder_id: null })).toBe("not_connected");
    expect(assertDriveConnectionReady({ status: "error", root_folder_id: "x" })).toBe("error");
    expect(assertDriveConnectionReady({ status: "connected", root_folder_id: "folder" })).toBe("ok");
  });
});
