import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteOrderAttachment, listOrderAttachments, toOrderAttachment, uploadOrderAttachment } from "./apiOrderAttachments";

const getUser = vi.hoisted(() => vi.fn());
const getSession = vi.hoisted(() =>
  vi.fn(async () => {
    const result = await getUser();
    return {
      data: { session: result?.data?.user ? { access_token: "tok", user: result.data.user } : null },
      error: result?.error ?? null,
    };
  }),
);
const from = vi.hoisted(() => vi.fn());
const storageFrom = vi.hoisted(() => vi.fn());
const assertClosedOrderMutableOnServer = vi.hoisted(() => vi.fn(async () => undefined));
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("./supabase", () => ({
  default: {
    auth: { getUser, getSession },
    from,
    storage: { from: storageFrom },
  },
}));

vi.mock("./apiOrders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./apiOrders")>();
  return {
    ...actual,
    assertClosedOrderMutableOnServer,
  };
});

vi.stubGlobal("fetch", fetchMock);

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

const appRow = {
  id: "att-1",
  workspace_id: "ws-1",
  order_id: "ord-1",
  uploaded_by: "user-1",
  file_name: "a.jpg",
  storage_path: "ws-1/ord-1/x-a.jpg",
  storage_provider: "app",
  drive_file_id: null,
  drive_folder_id: null,
  nas_path: null,
  mime_type: "image/jpeg",
  file_size: 4,
  created_at: "2026-10-01T10:00:00.000Z",
};

describe("toOrderAttachment", () => {
  it("maps app and Drive rows and rejects incomplete rows", () => {
    expect(toOrderAttachment(appRow)).toMatchObject({
      id: "att-1",
      storageProvider: "app",
      storagePath: "ws-1/ord-1/x-a.jpg",
    });
    expect(
      toOrderAttachment({
        ...appRow,
        storage_path: null,
        storage_provider: "google_drive",
        drive_file_id: "drv-1",
        drive_folder_id: "fld-1",
      }),
    ).toMatchObject({
      storageProvider: "google_drive",
      storagePath: null,
      driveFileId: "drv-1",
      driveFolderId: "fld-1",
    });
    expect(
      toOrderAttachment({
        ...appRow,
        storage_path: null,
        storage_provider: "nas",
        nas_path: "/CoreApp/a.jpg",
      }),
    ).toMatchObject({ storageProvider: "nas", nasPath: "/CoreApp/a.jpg" });
    expect(toOrderAttachment({ id: "att-1" })).toBeNull();
    expect(toOrderAttachment({ ...appRow, storage_path: null, storage_provider: "app" })).toBeNull();
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
      is: () => chain,
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
    getSession.mockClear();
    from.mockReset();
    storageFrom.mockReset();
    fetchMock.mockReset();
    assertClosedOrderMutableOnServer.mockReset();
    assertClosedOrderMutableOnServer.mockResolvedValue(undefined);
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  });

  it("uploads to storage then inserts metadata when mode is app", async () => {
    const upload = vi.fn().mockResolvedValue({ data: { path: "ws-1/ord-1/x-a.jpg" }, error: null });
    storageFrom.mockReturnValue({ upload, remove: vi.fn() });

    const insertPayloads: unknown[] = [];
    from.mockImplementation((tableName: string) => {
      if (tableName === "workspaces") {
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: () => Promise.resolve({ data: { attachment_storage: "app" }, error: null }),
        };
        return chain;
      }
      const attachments = tableChain({ data: appRow, error: null });
      attachments.insert = (payload: unknown) => {
        insertPayloads.push(payload);
        return attachments;
      };
      return attachments;
    });

    const file = new File([new Uint8Array([1, 2, 3, 4])], "a.jpg", { type: "image/jpeg" });
    const saved = await uploadOrderAttachment("ws-1", "ord-1", file);

    expect(upload).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(insertPayloads[0]).toEqual(
      expect.objectContaining({
        workspace_id: "ws-1",
        order_id: "ord-1",
        uploaded_by: "user-1",
        mime_type: "image/jpeg",
        storage_provider: "app",
      }),
    );
    expect(saved.attachment.id).toBe("att-1");
    expect(saved.fallbackFrom).toBeUndefined();
  });

  it("routes to Drive when attachment_storage is google_drive", async () => {
    from.mockImplementation((table: string) => {
      if (table === "workspaces") {
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: () => Promise.resolve({ data: { attachment_storage: "google_drive" }, error: null }),
        };
        return chain;
      }
      return tableChain({ data: null, error: null });
    });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        attachment: {
          ...appRow,
          storage_path: null,
          storage_provider: "google_drive",
          drive_file_id: "drv-1",
          drive_folder_id: "fld-1",
        },
      }),
    });

    const file = new File([new Uint8Array([1, 2, 3, 4])], "a.jpg", { type: "image/jpeg" });
    const saved = await uploadOrderAttachment("ws-1", "ord-1", file);
    expect(fetchMock).toHaveBeenCalled();
    expect(String(fetchMock.mock.calls[0][0])).toContain("order-attachment-remote/upload");
    expect(saved.attachment.storageProvider).toBe("google_drive");
    expect(saved.fallbackFrom).toBeUndefined();
  });

  it("routes to NAS when attachment_storage is nas", async () => {
    from.mockImplementation((table: string) => {
      if (table === "workspaces") {
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: () => Promise.resolve({ data: { attachment_storage: "nas" }, error: null }),
        };
        return chain;
      }
      return tableChain({ data: null, error: null });
    });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        attachment: {
          ...appRow,
          storage_path: null,
          storage_provider: "nas",
          drive_file_id: null,
          drive_folder_id: null,
          nas_path: "/CoreApp/ORD-1/a.jpg",
        },
      }),
    });

    const file = new File([new Uint8Array([1, 2, 3, 4])], "a.jpg", { type: "image/jpeg" });
    const saved = await uploadOrderAttachment("ws-1", "ord-1", file);
    expect(saved.attachment.storageProvider).toBe("nas");
    expect(saved.attachment.nasPath).toBe("/CoreApp/ORD-1/a.jpg");
  });

  it("falls back to app storage when Drive returns gdrive_reconnect_required", async () => {
    const upload = vi.fn().mockResolvedValue({ data: { path: "ws-1/ord-1/x-a.jpg" }, error: null });
    storageFrom.mockReturnValue({ upload, remove: vi.fn() });
    const insertPayloads: unknown[] = [];

    from.mockImplementation((table: string) => {
      if (table === "workspaces") {
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: () => Promise.resolve({ data: { attachment_storage: "google_drive" }, error: null }),
        };
        return chain;
      }
      const tableQ = tableChain({ data: appRow, error: null });
      tableQ.insert = (payload: unknown) => {
        insertPayloads.push(payload);
        return tableQ;
      };
      return tableQ;
    });

    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: { code: "gdrive_reconnect_required", message: "reconnect" } }),
    });

    const file = new File([new Uint8Array([1, 2, 3, 4])], "a.jpg", { type: "image/jpeg" });
    const saved = await uploadOrderAttachment("ws-1", "ord-1", file);
    expect(saved.fallbackFrom).toBe("google_drive");
    expect(saved.attachment.storageProvider).toBe("app");
    expect(upload).toHaveBeenCalled();
    expect(insertPayloads[0]).toEqual(expect.objectContaining({ storage_provider: "app" }));
  });

  it("falls back to app storage when NAS returns nas_reconnect_required", async () => {
    const upload = vi.fn().mockResolvedValue({ data: { path: "ws-1/ord-1/x-a.jpg" }, error: null });
    storageFrom.mockReturnValue({ upload, remove: vi.fn() });

    from.mockImplementation((tableName: string) => {
      if (tableName === "workspaces") {
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: () => Promise.resolve({ data: { attachment_storage: "nas" }, error: null }),
        };
        return chain;
      }
      const attachments = tableChain({ data: appRow, error: null });
      attachments.insert = () => attachments;
      return attachments;
    });

    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: { code: "nas_reconnect_required", message: "NAS down" } }),
    });

    const file = new File([new Uint8Array([1, 2, 3, 4])], "a.jpg", { type: "image/jpeg" });
    const saved = await uploadOrderAttachment("ws-1", "ord-1", file);
    expect(saved.fallbackFrom).toBe("nas");
    expect(saved.attachment.storageProvider).toBe("app");
  });

  it("cleans up the storage object when metadata insert fails", async () => {
    const remove = vi.fn().mockResolvedValue({ data: [], error: null });
    storageFrom.mockReturnValue({
      upload: vi.fn().mockResolvedValue({ data: { path: "path" }, error: null }),
      remove,
    });

    from.mockImplementation((table: string) => {
      if (table === "workspaces") {
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: () => Promise.resolve({ data: { attachment_storage: "app" }, error: null }),
        };
        return chain;
      }
      const tableQ = tableChain({ data: null, error: { message: "insert failed" } });
      tableQ.insert = () => tableQ;
      return tableQ;
    });

    const file = new File([new Uint8Array([1])], "a.png", { type: "image/png" });
    await expect(uploadOrderAttachment("ws-1", "ord-1", file)).rejects.toThrow(/insert failed|saving file details/i);
    expect(remove).toHaveBeenCalled();
  });

  it("reports orphan cleanup failure when both metadata insert and storage cleanup fail", async () => {
    storageFrom.mockReturnValue({
      upload: vi.fn().mockResolvedValue({ data: { path: "path" }, error: null }),
      remove: vi.fn().mockResolvedValue({ data: null, error: { message: "cleanup boom" } }),
    });
    from.mockImplementation((table: string) => {
      if (table === "workspaces") {
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: () => Promise.resolve({ data: { attachment_storage: "app" }, error: null }),
        };
        return chain;
      }
      const tableQ = tableChain({ data: null, error: { message: "insert failed" } });
      tableQ.insert = () => tableQ;
      return tableQ;
    });

    const file = new File([new Uint8Array([1])], "a.png", { type: "image/png" });
    await expect(uploadOrderAttachment("ws-1", "ord-1", file)).rejects.toThrow(/cleanup boom/i);
  });
});

describe("deleteOrderAttachment", () => {
  beforeEach(() => {
    from.mockReset();
    storageFrom.mockReset();
    fetchMock.mockReset();
    assertClosedOrderMutableOnServer.mockReset();
    assertClosedOrderMutableOnServer.mockResolvedValue(undefined);
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
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
          data: {
            id: "att-1",
            workspace_id: "ws-1",
            order_id: "ord-1",
            storage_path: "ws-1/ord-1/x.jpg",
            storage_provider: "app",
            drive_file_id: null,
          },
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

  it("routes Drive deletes through the Edge Function", async () => {
    const selectChain: Record<string, unknown> = {
      select: () => selectChain,
      eq: () => selectChain,
      maybeSingle: () =>
        Promise.resolve({
          data: {
            id: "att-d",
            workspace_id: "ws-1",
            order_id: "ord-1",
            storage_path: null,
            storage_provider: "google_drive",
            drive_file_id: "drv-1",
          },
          error: null,
        }),
    };
    from.mockReturnValue(selectChain);
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });

    await deleteOrderAttachment("ws-1", "ord-1", "att-d");
    expect(fetchMock).toHaveBeenCalled();
    expect(String(fetchMock.mock.calls[0][0])).toContain("order-attachment-remote/delete");
  });

  it("does not claim success when metadata delete fails after storage removal", async () => {
    const selectChain: Record<string, unknown> = {
      select: () => selectChain,
      eq: () => selectChain,
      maybeSingle: () =>
        Promise.resolve({
          data: {
            id: "att-1",
            workspace_id: "ws-1",
            order_id: "ord-1",
            storage_path: "path",
            storage_provider: "app",
            drive_file_id: null,
          },
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
