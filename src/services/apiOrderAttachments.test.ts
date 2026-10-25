import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteOrderAttachment, listOrderAttachments, toOrderAttachment, uploadOrderAttachment } from "./apiOrderAttachments";

const getUser = vi.hoisted(() => vi.fn());
const from = vi.hoisted(() => vi.fn());
const storageFrom = vi.hoisted(() => vi.fn());

vi.mock("./supabase", () => ({
  default: {
    auth: { getUser },
    from,
    storage: { from: storageFrom },
  },
}));

function tableChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    order: () => Promise.resolve(result),
    insert: () => chain,
    delete: () => chain,
    maybeSingle: () => Promise.resolve(result),
    then: (resolve: (value: { data: unknown; error: unknown }) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

describe("toOrderAttachment", () => {
  it("maps database rows and rejects incomplete rows", () => {
    expect(
      toOrderAttachment({
        id: "att-1",
        workspace_id: "ws-1",
        order_id: "ord-1",
        uploaded_by: "user-1",
        file_name: "a.jpg",
        storage_path: "ws-1/ord-1/uuid-a.jpg",
        mime_type: "image/jpeg",
        file_size: 12,
        created_at: "2026-10-01T10:00:00.000Z",
      }),
    ).toMatchObject({ id: "att-1", workspaceId: "ws-1", orderId: "ord-1", fileName: "a.jpg" });
    expect(toOrderAttachment({ id: "att-1" })).toBeNull();
  });
});

describe("listOrderAttachments", () => {
  beforeEach(() => {
    from.mockReset();
  });

  it("queries by both workspace and order", async () => {
    const eqs: Array<[string, string]> = [];
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (column: string, value: string) => {
        eqs.push([column, value]);
        return chain;
      },
      order: () => Promise.resolve({ data: [], error: null }),
    };
    from.mockImplementation((table: string) => {
      expect(table).toBe("order_attachments");
      return chain;
    });

    await expect(listOrderAttachments("ws-1", "ord-9")).resolves.toEqual([]);
    expect(eqs).toEqual([
      ["workspace_id", "ws-1"],
      ["order_id", "ord-9"],
    ]);
  });
});

describe("uploadOrderAttachment", () => {
  beforeEach(() => {
    getUser.mockReset();
    from.mockReset();
    storageFrom.mockReset();
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  });

  it("uploads to storage then inserts metadata", async () => {
    const upload = vi.fn().mockResolvedValue({ data: { path: "ws-1/ord-1/x-a.jpg" }, error: null });
    storageFrom.mockReturnValue({ upload, remove: vi.fn() });

    const insertPayloads: unknown[] = [];
    const table = tableChain({
      data: {
        id: "att-1",
        workspace_id: "ws-1",
        order_id: "ord-1",
        uploaded_by: "user-1",
        file_name: "a.jpg",
        storage_path: "ws-1/ord-1/x-a.jpg",
        mime_type: "image/jpeg",
        file_size: 4,
        created_at: "2026-10-01T10:00:00.000Z",
      },
      error: null,
    });
    table.insert = (payload: unknown) => {
      insertPayloads.push(payload);
      return table;
    };
    from.mockReturnValue(table);

    const file = new File([new Uint8Array([1, 2, 3, 4])], "a.jpg", { type: "image/jpeg" });
    const saved = await uploadOrderAttachment("ws-1", "ord-1", file);

    expect(upload).toHaveBeenCalled();
    expect(insertPayloads[0]).toEqual(
      expect.objectContaining({
        workspace_id: "ws-1",
        order_id: "ord-1",
        uploaded_by: "user-1",
        mime_type: "image/jpeg",
        file_size: 4,
      }),
    );
    expect(saved.id).toBe("att-1");
  });

  it("cleans up the storage object when metadata insert fails", async () => {
    const remove = vi.fn().mockResolvedValue({ data: [], error: null });
    storageFrom.mockReturnValue({
      upload: vi.fn().mockResolvedValue({ data: { path: "path" }, error: null }),
      remove,
    });

    const table = tableChain({ data: null, error: { message: "insert failed" } });
    table.insert = () => table;
    from.mockReturnValue(table);

    const file = new File([new Uint8Array([1])], "a.png", { type: "image/png" });
    await expect(uploadOrderAttachment("ws-1", "ord-1", file)).rejects.toThrow(/insert failed|saving file details/i);
    expect(remove).toHaveBeenCalled();
  });

  it("reports orphan cleanup failure when both metadata insert and storage cleanup fail", async () => {
    storageFrom.mockReturnValue({
      upload: vi.fn().mockResolvedValue({ data: { path: "path" }, error: null }),
      remove: vi.fn().mockResolvedValue({ data: null, error: { message: "cleanup boom" } }),
    });
    const table = tableChain({ data: null, error: { message: "insert failed" } });
    table.insert = () => table;
    from.mockReturnValue(table);

    const file = new File([new Uint8Array([1])], "a.png", { type: "image/png" });
    await expect(uploadOrderAttachment("ws-1", "ord-1", file)).rejects.toThrow(/cleanup boom/i);
  });
});

describe("deleteOrderAttachment", () => {
  beforeEach(() => {
    from.mockReset();
    storageFrom.mockReset();
  });

  it("requires the attachment to belong to the workspace and order before deleting", async () => {
    const eqs: Array<[string, string]> = [];
    const selectChain: Record<string, unknown> = {
      select: () => selectChain,
      eq: (column: string, value: string) => {
        eqs.push([column, value]);
        return selectChain;
      },
      maybeSingle: () =>
        Promise.resolve({
          data: { id: "att-1", workspace_id: "ws-1", order_id: "ord-1", storage_path: "ws-1/ord-1/x.jpg" },
          error: null,
        }),
    };
    const deleteChain: Record<string, unknown> = {
      delete: () => deleteChain,
      eq: () => deleteChain,
      select: () => Promise.resolve({ data: [{ id: "att-1" }], error: null }),
    };
    let call = 0;
    from.mockImplementation(() => {
      call += 1;
      return call === 1 ? selectChain : deleteChain;
    });
    const remove = vi.fn().mockResolvedValue({ data: [], error: null });
    storageFrom.mockReturnValue({ remove });

    await deleteOrderAttachment("ws-1", "ord-1", "att-1");
    expect(eqs).toEqual([
      ["id", "att-1"],
      ["workspace_id", "ws-1"],
      ["order_id", "ord-1"],
    ]);
    expect(remove).toHaveBeenCalledWith(["ws-1/ord-1/x.jpg"]);
  });

  it("does not claim success when metadata delete fails after storage removal", async () => {
    const selectChain: Record<string, unknown> = {
      select: () => selectChain,
      eq: () => selectChain,
      maybeSingle: () =>
        Promise.resolve({
          data: { id: "att-1", workspace_id: "ws-1", order_id: "ord-1", storage_path: "path" },
          error: null,
        }),
    };
    const deleteChain: Record<string, unknown> = {
      delete: () => deleteChain,
      eq: () => deleteChain,
      select: () => Promise.resolve({ data: null, error: { message: "rls blocked" } }),
    };
    let call = 0;
    from.mockImplementation(() => {
      call += 1;
      return call === 1 ? selectChain : deleteChain;
    });
    storageFrom.mockReturnValue({ remove: vi.fn().mockResolvedValue({ data: [], error: null }) });

    await expect(deleteOrderAttachment("ws-1", "ord-1", "att-1")).rejects.toThrow(/rls blocked|record could not be deleted/i);
  });
});
