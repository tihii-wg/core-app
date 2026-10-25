import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "../../tests/renderQuery";
import type { OrderAttachment } from "./orderAttachments";
import OrderAttachmentsSection from "./OrderAttachmentsSection";

const attachmentsState = vi.hoisted(() => ({
  list: [] as OrderAttachment[],
  isLoading: false,
  error: null as Error | null,
  canMutate: true,
  uploadPending: false,
  deletePending: false,
  mutateUpload: vi.fn(),
  mutateDelete: vi.fn(),
}));

vi.mock("./useOrderAttachments", () => ({
  useCanMutateOrderAttachments: () => attachmentsState.canMutate,
  useOrderAttachments: () => ({
    attachments: attachmentsState.list,
    isLoading: attachmentsState.isLoading,
    isFetching: false,
    error: attachmentsState.error,
    refetch: vi.fn(),
  }),
  useUploadOrderAttachment: () => ({
    mutateAsync: attachmentsState.mutateUpload,
    isPending: attachmentsState.uploadPending,
  }),
  useDeleteOrderAttachment: () => ({
    mutateAsync: attachmentsState.mutateDelete,
    isPending: attachmentsState.deletePending,
  }),
  useOrderAttachmentSignedUrl: () => ({
    data: "https://storage.test/signed",
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("../../services/apiOrderAttachments", () => ({
  createOrderAttachmentSignedUrl: vi.fn(async () => "https://storage.test/signed"),
}));

const sample: OrderAttachment = {
  id: "att-1",
  workspaceId: "ws-1",
  orderId: "order-1",
  uploadedBy: "user-1",
  fileName: "bumper-damage.jpg",
  storagePath: "ws-1/order-1/uuid-bumper-damage.jpg",
  mimeType: "image/jpeg",
  fileSize: 2048,
  createdAt: "2026-10-01T12:00:00.000Z",
};

beforeEach(() => {
  attachmentsState.list = [];
  attachmentsState.isLoading = false;
  attachmentsState.error = null;
  attachmentsState.canMutate = true;
  attachmentsState.uploadPending = false;
  attachmentsState.deletePending = false;
  attachmentsState.mutateUpload.mockReset().mockResolvedValue(sample);
  attachmentsState.mutateDelete.mockReset().mockResolvedValue(undefined);
});

describe("OrderAttachmentsSection", () => {
  it("shows the empty state and upload controls when the user can mutate", () => {
    renderWithQuery(<OrderAttachmentsSection orderId="order-1" />);
    expect(screen.getByRole("heading", { name: "Photos & Files" })).toBeInTheDocument();
    expect(screen.getByText("No attachments yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Take photo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add files" })).toBeInTheDocument();
  });

  it("hides mutation controls for view-only (no active subscription) users", () => {
    attachmentsState.canMutate = false;
    attachmentsState.list = [sample];
    renderWithQuery(<OrderAttachmentsSection orderId="order-1" />);

    expect(screen.queryByRole("button", { name: "Add files" })).not.toBeInTheDocument();
    expect(screen.getByText(/view-only/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(screen.getByText("bumper-damage.jpg")).toBeInTheDocument();
  });

  it("lists attachment metadata with wrap-friendly classes for narrow phones", () => {
    attachmentsState.list = [
      {
        ...sample,
        fileName: "very-long-order-photo-name-that-should-wrap-on-narrow-phones.jpg",
      },
    ];
    const { container } = renderWithQuery(
      <div style={{ width: 320 }}>
        <OrderAttachmentsSection orderId="order-1" />
      </div>,
    );

    expect(screen.getByText(/very-long-order-photo-name/)).toBeInTheDocument();
    expect(container.querySelector(".break-all")).not.toBeNull();
    expect(container.querySelector(".min-w-0")).not.toBeNull();
  });

  it("asks for confirmation before deleting", async () => {
    const user = userEvent.setup();
    attachmentsState.list = [sample];
    renderWithQuery(<OrderAttachmentsSection orderId="order-1" />);

    await user.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Remove “bumper-damage.jpg”/i)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(attachmentsState.mutateDelete).toHaveBeenCalledWith("att-1");
  });
});
