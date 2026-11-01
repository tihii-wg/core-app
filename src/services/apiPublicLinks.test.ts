import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("./supabase", () => ({ default: { rpc: (...args: unknown[]) => rpc(...args) } }));

import {
  CREATE_PUBLIC_ORDER_LINK_RPC,
  createPublicOrderLink,
  getPublicOrderStatus,
  isPlausiblePublicToken,
  parsePublicOrderStatus,
  publicOrderStatusUrl,
} from "./apiPublicLinks";
import { MissingRpcError } from "./missingRpc";

const TOKEN = "a".repeat(32) + "b".repeat(32);

describe("public order status lookup", () => {
  beforeEach(() => rpc.mockReset());

  it("accepts only plausible alphanumeric tokens", () => {
    expect(isPlausiblePublicToken(TOKEN)).toBe(true);
    expect(isPlausiblePublicToken("short")).toBe(false);
    expect(isPlausiblePublicToken("a/../b".padEnd(40, "x"))).toBe(false);
    expect(isPlausiblePublicToken(undefined)).toBe(false);
  });

  it("does not call the server for a malformed token", async () => {
    await expect(getPublicOrderStatus("nope")).resolves.toEqual({ kind: "notFound" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("whitelists the public fields and drops anything private from the payload", () => {
    const order = parsePublicOrderStatus({
      entity_type: "order",
      number: "ORD-2026-1",
      status: "in-progress",
      status_name: "Ready",
      status_color: "#22aa66",
      service_type: "LPG install",
      deadline: "2026-11-05T10:00:00Z",
      created_at: "2026-11-01T08:00:00Z",
      updated_at: "2026-11-02T08:00:00Z",
      client_name: "SECRET",
      client_phone: "SECRET",
      total_price: 1234,
      manager_notes: "SECRET",
      comments: [{ body: "SECRET" }],
    });
    expect(order).toEqual({
      number: "ORD-2026-1",
      status: "in-progress",
      statusName: "Ready",
      statusColor: "#22aa66",
      serviceType: "LPG install",
      deadline: "2026-11-05T10:00:00Z",
      createdAt: "2026-11-01T08:00:00Z",
      updatedAt: "2026-11-02T08:00:00Z",
    });
    expect(JSON.stringify(order)).not.toContain("SECRET");
  });

  it("rejects payloads that are not an order", () => {
    expect(parsePublicOrderStatus(null)).toBeNull();
    expect(parsePublicOrderStatus([])).toBeNull();
    expect(parsePublicOrderStatus({ entity_type: "estimate" })).toBeNull();
  });

  it("returns notFound when the RPC returns null", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(getPublicOrderStatus(TOKEN)).resolves.toEqual({ kind: "notFound" });
    expect(rpc).toHaveBeenCalledWith("crm_public_order_status", { p_token: TOKEN });
  });

  it("returns unavailable when the RPC or table is not applied", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
    await expect(getPublicOrderStatus(TOKEN)).resolves.toEqual({ kind: "unavailable" });
    rpc.mockResolvedValue({ data: null, error: { code: "42P01", message: 'relation "public.public_links" does not exist' } });
    await expect(getPublicOrderStatus(TOKEN)).resolves.toEqual({ kind: "unavailable" });
  });

  it("throws other database errors", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "boom" } });
    await expect(getPublicOrderStatus(TOKEN)).rejects.toThrow("boom");
  });

  it("returns the whitelisted order on success", async () => {
    rpc.mockResolvedValue({ data: { entity_type: "order", number: "ORD-1", status: "new" }, error: null });
    const result = await getPublicOrderStatus(TOKEN);
    expect(result).toMatchObject({ kind: "ok", order: { number: "ORD-1", status: "new", statusName: null } });
  });
});

describe("createPublicOrderLink", () => {
  beforeEach(() => rpc.mockReset());

  it("returns the token once from the create RPC", async () => {
    rpc.mockResolvedValue({ data: { id: "link-1", token: TOKEN, expires_at: null, created_at: "2026-11-01T00:00:00Z" }, error: null });
    await expect(createPublicOrderLink("order-1")).resolves.toEqual({
      id: "link-1",
      token: TOKEN,
      expiresAt: null,
      createdAt: "2026-11-01T00:00:00Z",
    });
    expect(rpc).toHaveBeenCalledWith(CREATE_PUBLIC_ORDER_LINK_RPC, { p_order_id: "order-1", p_expires_at: null });
  });

  it("throws MissingRpcError when the create SQL is not applied", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
    await expect(createPublicOrderLink("order-1")).rejects.toBeInstanceOf(MissingRpcError);
  });

  it("rejects an empty or non-plausible token from the RPC", async () => {
    rpc.mockResolvedValue({ data: { id: "link-1", token: "short" }, error: null });
    await expect(createPublicOrderLink("order-1")).rejects.toThrow(/public status link/i);
  });

  it("builds a locale-scoped public URL", () => {
    expect(publicOrderStatusUrl(TOKEN, "en")).toMatch(new RegExp(`/en/public/${TOKEN}$`));
  });
});
