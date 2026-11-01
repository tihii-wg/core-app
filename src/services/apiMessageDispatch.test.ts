import { describe, expect, it } from "vitest";
import { buildDryRunLogRow, DRY_RUN_PROVIDER, DRY_RUN_STATUS } from "./apiMessageDispatch";

describe("message dry-run", () => {
  it("builds a non-queued, provider-tagged log row", () => {
    const row = buildDryRunLogRow({
      workspaceId: "ws",
      ruleId: " rule-1 ",
      channel: "sms",
      recipient: " +37300000000 ",
      body: " hello ",
      entityType: "order",
      entityId: "order-1",
    });
    expect(row).toMatchObject({
      workspace_id: "ws",
      rule_id: "rule-1",
      channel: "sms",
      recipient: "+37300000000",
      body: "hello",
      order_id: "order-1",
      client_id: null,
      provider: DRY_RUN_PROVIDER,
      status: DRY_RUN_STATUS,
      sent_at: null,
    });
    expect(row.status).not.toBe("queued");
    expect(row.status).not.toBe("sent");
  });

  it("maps client entities and ignores unknown entity types", () => {
    const base = { workspaceId: "ws", channel: "email" as const, recipient: "a@b.c", body: "x", entityId: "e1" };
    expect(buildDryRunLogRow({ ...base, entityType: "client" })).toMatchObject({ client_id: "e1", order_id: null });
    expect(buildDryRunLogRow({ ...base, entityType: "lead" })).toMatchObject({ client_id: null, order_id: null });
  });

  it("rejects empty recipient or body", () => {
    expect(() => buildDryRunLogRow({ workspaceId: "ws", channel: "sms", recipient: " ", body: "x" })).toThrow();
    expect(() => buildDryRunLogRow({ workspaceId: "ws", channel: "sms", recipient: "r", body: "" })).toThrow();
  });
});
