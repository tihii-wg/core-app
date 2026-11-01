import { describe, expect, it } from "vitest";
import { isMissingRpcError, MissingRpcError } from "./missingRpc";

describe("isMissingRpcError", () => {
  it("detects an RPC absent from the schema cache or the catalog", () => {
    expect(isMissingRpcError({ code: "PGRST202", message: "Could not find the function public.x" })).toBe(true);
    expect(isMissingRpcError({ code: "42883", message: "function public.x(uuid) does not exist" })).toBe(true);
    expect(isMissingRpcError({ message: "Could not find the function public.issue_order_materials_from_warehouse" })).toBe(true);
  });

  it("does not treat errors raised inside an installed function as missing", () => {
    expect(isMissingRpcError({ code: "P0001", message: "insufficient_warehouse_stock" })).toBe(false);
    expect(isMissingRpcError({ code: "42501", message: "You do not have permission to issue warehouse materials." })).toBe(false);
    expect(isMissingRpcError({ code: "42P01", message: "warehouse_stock table is missing." })).toBe(false);
    expect(isMissingRpcError(null)).toBe(false);
  });

  it("can be scoped to one function name when only the message is available", () => {
    expect(isMissingRpcError({ message: "Could not find the function public.other" }, "crm_set_order_line_discounts")).toBe(false);
    expect(isMissingRpcError({ message: "Could not find the function public.crm_set_order_line_discounts" }, "crm_set_order_line_discounts")).toBe(true);
  });
});

describe("MissingRpcError", () => {
  it("carries the rpc name", () => {
    const error = new MissingRpcError("x", "msg");
    expect(error).toBeInstanceOf(Error);
    expect(error.rpcName).toBe("x");
  });
});
