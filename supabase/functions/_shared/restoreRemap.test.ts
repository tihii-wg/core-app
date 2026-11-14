import { describe, expect, it } from "vitest";
import { remapBackup, remapString } from "./restoreRemap.ts";

const SRC = "11111111-1111-4111-8111-111111111111";
const DST = "22222222-2222-4222-8222-222222222222";
const ORDER = "33333333-3333-4333-8333-333333333333";
const CLIENT = "44444444-4444-4444-8444-444444444444";
const USER = "55555555-5555-4555-8555-555555555555";

function seq() {
  let n = 0;
  return () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++n).padStart(12, "0")}`;
}

describe("remapBackup", () => {
  it("gives every row a new id and rewrites references, workspace ids and storage paths", () => {
    const result = remapBackup({
      sourceWorkspaceId: SRC,
      targetWorkspaceId: DST,
      tables: {
        clients: [{ id: CLIENT, workspace_id: SRC, name: "A" }],
        orders: [{ id: ORDER, workspace_id: SRC, client_id: CLIENT, created_by: USER, meta: { refs: [CLIENT] } }],
        order_attachments: [{ id: "66666666-6666-4666-8666-666666666666", order_id: ORDER, path: `${SRC}/${ORDER}/a.jpg` }],
      },
      workspace: { name: "Old", currency: "MDL" },
      files: [`files/order-attachments/${SRC}/${ORDER}/a.jpg`, "files/other-bucket/x.jpg", `files/workspace/${USER}/evil.jpg`],
      newId: seq(),
    });

    const client = result.tables.clients[0] as Record<string, string>;
    const order = result.tables.orders[0] as Record<string, unknown>;
    const attachment = result.tables.order_attachments[0] as Record<string, string>;

    expect(client.id).not.toBe(CLIENT);
    expect(client.workspace_id).toBe(DST);
    expect(order.client_id).toBe(client.id);
    expect((order.meta as { refs: string[] }).refs[0]).toBe(client.id);
    expect(order.created_by).toBe(USER);
    expect(attachment.order_id).toBe(order.id);
    expect(attachment.path).toBe(`${DST}/${order.id}/a.jpg`);
    expect(result.foreignUuids).toEqual([USER]);
    expect(result.fileMap).toEqual({ [`order-attachments/${SRC}/${ORDER}/a.jpg`]: `${DST}/${order.id}/a.jpg` });
  });

  it("drops tables with unsafe names", () => {
    const result = remapBackup({
      sourceWorkspaceId: SRC,
      targetWorkspaceId: DST,
      tables: { "orders; drop table x": [{ id: ORDER }], clients: [] },
      workspace: null,
      files: [],
      newId: seq(),
    });
    expect(Object.keys(result.tables)).toEqual(["clients"]);
  });

  it("keeps references to skipped tables pointing at the original rows", () => {
    const TOKEN_ROW = "77777777-7777-4777-8777-777777777777";
    const result = remapBackup({
      sourceWorkspaceId: SRC,
      targetWorkspaceId: DST,
      tables: {
        orders: [{ id: ORDER, workspace_id: SRC, connection_id: TOKEN_ROW }],
        integration_connections: [{ id: TOKEN_ROW, workspace_id: SRC }],
      },
      workspace: null,
      files: [],
      newId: seq(),
      restorable: new Set(["orders"]),
    });
    expect(Object.keys(result.tables)).toEqual(["orders"]);
    expect((result.tables.orders[0] as Record<string, string>).connection_id).toBe(TOKEN_ROW);
    expect(result.foreignUuids).toEqual([TOKEN_ROW]);
  });

  it("matches uuids case-insensitively", () => {
    const map = new Map([[ORDER, DST]]);
    expect(remapString(`x/${ORDER.toUpperCase()}/y`, map)).toBe(`x/${DST}/y`);
  });
});
