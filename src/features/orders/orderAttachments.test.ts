import { describe, expect, it } from "vitest";
import {
  buildOrderAttachmentStoragePath,
  canMutateOrderAttachments,
  formatAttachmentBytes,
  isImageMimeType,
  orderAttachmentsQueryKey,
  resolveAttachmentMimeType,
  sanitizeAttachmentFileName,
  validateOrderAttachmentFile,
  ORDER_ATTACHMENT_MAX_BYTES,
} from "./orderAttachments";

function file(partial: Partial<File> & Pick<File, "name">): Pick<File, "name" | "type" | "size"> {
  return {
    name: partial.name,
    type: partial.type ?? "",
    size: partial.size ?? 1024,
  };
}

describe("orderAttachments validation", () => {
  it("accepts supported images and office documents under 20 MiB", () => {
    expect(validateOrderAttachmentFile(file({ name: "a.jpg", type: "image/jpeg", size: 100 }))).toBeNull();
    expect(validateOrderAttachmentFile(file({ name: "a.HEIC", type: "", size: 100 }))).toBeNull();
    expect(validateOrderAttachmentFile(file({ name: "spec.docx", type: "", size: 2048 }))).toBeNull();
    expect(validateOrderAttachmentFile(file({ name: "notes.txt", type: "text/plain", size: 10 }))).toBeNull();
  });

  it("rejects empty, oversized, and unsupported files", () => {
    expect(validateOrderAttachmentFile(file({ name: "a.jpg", type: "image/jpeg", size: 0 }))).toBe("empty");
    expect(validateOrderAttachmentFile(file({ name: "a.jpg", type: "image/jpeg", size: ORDER_ATTACHMENT_MAX_BYTES + 1 }))).toBe(
      "tooLarge",
    );
    expect(validateOrderAttachmentFile(file({ name: "malware.exe", type: "application/octet-stream", size: 10 }))).toBe(
      "unsupportedType",
    );
  });

  it("resolves MIME types from extensions when the browser omits type", () => {
    expect(resolveAttachmentMimeType(file({ name: "photo.heif", type: "" }))).toBe("image/heif");
    expect(resolveAttachmentMimeType(file({ name: "sheet.xlsx", type: "" }))).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
  });
});

describe("orderAttachments path helpers", () => {
  it("sanitizes filenames and never trusts path segments from the client", () => {
    expect(sanitizeAttachmentFileName("../../etc/passwd.jpg")).toBe("passwd.jpg");
    expect(sanitizeAttachmentFileName("My  Invoice   #1.PDF")).toMatch(/\.pdf$/i);
    expect(sanitizeAttachmentFileName("!!!")).toBe("file");
  });

  it("builds storage paths as workspace/order/uuid-sanitized-name", () => {
    const path = buildOrderAttachmentStoragePath("ws-1", "order-1", "Door photo.JPG", "11111111-1111-4111-8111-111111111111");
    expect(path).toBe("ws-1/order-1/11111111-1111-4111-8111-111111111111-Door-photo.jpg");
  });

  it("scopes the React Query key by workspace and order", () => {
    expect(orderAttachmentsQueryKey("ws-a", "ord-1")).toEqual(["order-attachments", "ws-a", "ord-1"]);
    expect(orderAttachmentsQueryKey("ws-a", "ord-1")).not.toEqual(orderAttachmentsQueryKey("ws-b", "ord-1"));
  });

  it("detects image MIME types for thumbnails", () => {
    expect(isImageMimeType("image/png")).toBe(true);
    expect(isImageMimeType("application/pdf")).toBe(false);
  });

  it("formats byte sizes for the UI", () => {
    expect(formatAttachmentBytes(512)).toBe("512 B");
    expect(formatAttachmentBytes(2048)).toMatch(/KB/);
  });
});

describe("orderAttachments permissions", () => {
  it("allows known workspace roles to mutate when subscribed", () => {
    expect(canMutateOrderAttachments("owner")).toBe(true);
    expect(canMutateOrderAttachments("member")).toBe(true);
    expect(canMutateOrderAttachments("guest")).toBe(false);
  });

  it("keeps users without an active subscription view-only", () => {
    expect(canMutateOrderAttachments("owner", { hasActiveSubscription: false })).toBe(false);
    expect(canMutateOrderAttachments("member", { hasActiveSubscription: false })).toBe(false);
  });
});
