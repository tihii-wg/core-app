import { describe, expect, it } from "vitest";
import type { Order } from "../../lib/types";
import type { StatusDefinition } from "../../services/apiStatusDefinitions";
import {
  hasConfigurableOrderStatuses,
  resolveCurrentUnifiedStatus,
  resolveUnifiedStatusSelection,
  selectableOrderStatusDefinitions,
  unifiedStatusFilterOptions,
  unifiedStatusOptions,
} from "./unifiedOrderStatus";

const definition = (partial: Partial<StatusDefinition> & Pick<StatusDefinition, "id" | "name">): StatusDefinition => ({
  id: partial.id,
  workspaceId: "ws-1",
  entity: "order",
  name: partial.name,
  color: partial.color ?? "#2563EB",
  statusGroup: partial.statusGroup ?? "new",
  systemStatus: partial.systemStatus ?? null,
  code: partial.code ?? null,
  semanticAction: partial.semanticAction ?? "normal",
  sortOrder: partial.sortOrder ?? 0,
  isDefault: partial.isDefault ?? false,
  isActive: partial.isActive ?? true,
  showOverdueBadge: partial.showOverdueBadge ?? false,
  addsToBackorders: partial.addsToBackorders ?? false,
});

const order = (
  partial: Partial<Pick<Order, "status" | "customStatusId" | "closedAt">> = {},
): Pick<Order, "status" | "customStatusId" | "closedAt"> => ({
  status: partial.status ?? "new",
  customStatusId: partial.customStatusId ?? null,
  closedAt: partial.closedAt ?? null,
});

const label = (status: string) => status.toUpperCase();

describe("unifiedOrderStatus", () => {
  const defaults = [
    definition({ id: "d-new", name: "New", systemStatus: "new", statusGroup: "new", code: "new", sortOrder: 1, isDefault: true }),
    definition({
      id: "d-progress",
      name: "In Progress",
      systemStatus: "in-progress",
      statusGroup: "in_progress",
      code: "in_progress",
      sortOrder: 2,
    }),
    definition({
      id: "d-waiting",
      name: "Waiting for Parts",
      systemStatus: "waiting-parts",
      statusGroup: "pending",
      code: "waiting_parts",
      sortOrder: 3,
    }),
    definition({
      id: "d-closed",
      name: "Closed",
      systemStatus: "closed",
      statusGroup: "closed",
      code: "closed",
      semanticAction: "close",
      sortOrder: 4,
    }),
    definition({
      id: "d-cancelled",
      name: "Cancelled",
      systemStatus: "cancelled",
      statusGroup: "dropped_off",
      code: "cancelled",
      semanticAction: "cancel",
      sortOrder: 5,
    }),
  ];

  it("exposes one selector list of ordinary statuses (no close/cancel)", () => {
    const options = unifiedStatusOptions(defaults, label);
    expect(options.map((option) => option.name)).toEqual(["New", "In Progress", "Waiting for Parts"]);
    expect(options.every((option) => option.semanticAction === "normal")).toBe(true);
    expect(hasConfigurableOrderStatuses(defaults)).toBe(true);
  });

  it("includes custom statuses alongside the initial set without duplicates", () => {
    const withCustom = [
      ...defaults,
      definition({ id: "d-qa", name: "QA Hold", systemStatus: "in-progress", statusGroup: "in_progress", code: "qa_hold", sortOrder: 2.5 }),
    ];
    const options = unifiedStatusOptions(withCustom, label);
    expect(options.map((option) => option.id)).toEqual(["d-new", "d-progress", "d-qa", "d-waiting"]);
    expect(new Set(options.map((option) => option.id)).size).toBe(options.length);
  });

  it("filter options include close/cancel so those columns stay filterable", () => {
    const filters = unifiedStatusFilterOptions(defaults, label);
    expect(filters.map((option) => option.name)).toEqual([
      "New",
      "In Progress",
      "Waiting for Parts",
      "Closed",
      "Cancelled",
    ]);
  });

  it("falls back to system statuses when the workspace has no definitions", () => {
    const options = unifiedStatusOptions([], label);
    expect(options.every((option) => option.kind === "system")).toBe(true);
    expect(options.some((option) => option.systemStatus === "closed")).toBe(false);
    expect(options.some((option) => option.systemStatus === "cancelled")).toBe(false);
  });

  it("resolves the current status from customStatusId first", () => {
    const options = unifiedStatusOptions(defaults, label);
    expect(resolveCurrentUnifiedStatus(order({ status: "new", customStatusId: "d-waiting" }), options)?.id).toBe("d-waiting");
    expect(resolveCurrentUnifiedStatus(order({ status: "in-progress", customStatusId: null }), options)?.id).toBe("d-progress");
  });

  it("persists both system status and custom_status_id for definition picks", () => {
    const options = unifiedStatusOptions(defaults, label);
    const waiting = options.find((option) => option.id === "d-waiting")!;
    expect(resolveUnifiedStatusSelection(order({ status: "new", customStatusId: "d-new" }), waiting)).toEqual({
      status: "waiting-parts",
      customStatusId: "d-waiting",
    });
  });

  it("never treats close/cancel definitions as ordinary status selections", () => {
    const filters = unifiedStatusFilterOptions(defaults, label);
    const closed = filters.find((option) => option.id === "d-closed")!;
    const cancelled = filters.find((option) => option.id === "d-cancelled")!;
    expect(resolveUnifiedStatusSelection(order({ status: "new" }), closed)).toBeNull();
    expect(resolveUnifiedStatusSelection(order({ status: "new" }), cancelled)).toBeNull();
  });

  it("does not let a custom status named Closed close an order through selection", () => {
    const namedClosed = definition({
      id: "d-named-closed",
      name: "Closed",
      systemStatus: "in-progress",
      statusGroup: "in_progress",
      code: "looks_closed",
      semanticAction: "normal",
      sortOrder: 9,
    });
    const options = unifiedStatusOptions([namedClosed], label);
    expect(selectableOrderStatusDefinitions([namedClosed])).toHaveLength(1);
    expect(resolveUnifiedStatusSelection(order({ status: "new" }), options[0]!)).toEqual({
      status: "in-progress",
      customStatusId: "d-named-closed",
    });
  });

  it("does not let a custom status named Cancelled cancel an order through selection", () => {
    const namedCancelled = definition({
      id: "d-named-cancelled",
      name: "Cancelled",
      systemStatus: "waiting-parts",
      statusGroup: "pending",
      code: "looks_cancelled",
      semanticAction: "normal",
      sortOrder: 9,
    });
    const options = unifiedStatusOptions([namedCancelled], label);
    expect(resolveUnifiedStatusSelection(order({ status: "new" }), options[0]!)).toEqual({
      status: "waiting-parts",
      customStatusId: "d-named-cancelled",
    });
  });

  it("excludes closed and cancelled from selectable definitions even if mis-tagged normal", () => {
    const leaky = [
      definition({ id: "d-new", name: "New", systemStatus: "new", semanticAction: "normal" }),
      definition({ id: "d-closed-leak", name: "Done", systemStatus: "closed", semanticAction: "normal" }),
      definition({ id: "d-cancel-leak", name: "Drop", systemStatus: "cancelled", semanticAction: "normal" }),
    ];
    expect(selectableOrderStatusDefinitions(leaky).map((d) => d.id)).toEqual(["d-new"]);
    expect(unifiedStatusOptions(leaky, label).map((o) => o.id)).toEqual(["d-new"]);
  });

  it("rejects ordinary status selection on closed/cancelled orders", () => {
    const options = unifiedStatusOptions(defaults, label);
    const waiting = options.find((option) => option.id === "d-waiting")!;
    expect(
      resolveUnifiedStatusSelection(order({ status: "closed", closedAt: "2026-11-01T00:00:00.000Z", customStatusId: "d-new" }), waiting),
    ).toBeNull();
    expect(
      resolveUnifiedStatusSelection(order({ status: "cancelled", closedAt: null, customStatusId: null }), waiting),
    ).toBeNull();
  });

  it("allows closed-order status selection when owner manage-closed override is on", () => {
    const options = unifiedStatusOptions(defaults, label);
    const waiting = options.find((option) => option.id === "d-waiting")!;
    expect(
      resolveUnifiedStatusSelection(
        order({ status: "closed", closedAt: "2026-11-01T00:00:00.000Z", customStatusId: "d-new" }),
        waiting,
        { allowManageClosed: true },
      ),
    ).toEqual({ status: "waiting-parts", customStatusId: "d-waiting" });
    // manage-closed alone must not reopen cancelled — that needs allowReopenCancelled.
    expect(
      resolveUnifiedStatusSelection(
        order({ status: "cancelled", closedAt: null, customStatusId: null }),
        waiting,
        { allowManageClosed: true },
      ),
    ).toBeNull();
  });

  it("allows cancelled → open when owner reopen exception is on", () => {
    const options = unifiedStatusOptions(defaults, label);
    const waiting = options.find((option) => option.id === "d-waiting")!;
    expect(
      resolveUnifiedStatusSelection(
        order({ status: "cancelled", closedAt: "2026-11-01T00:00:00.000Z", customStatusId: null }),
        waiting,
        { allowReopenCancelled: true },
      ),
    ).toEqual({ status: "waiting-parts", customStatusId: "d-waiting" });
    expect(
      resolveUnifiedStatusSelection(
        order({ status: "cancelled", closedAt: null, customStatusId: null }),
        waiting,
        { allowReopenCancelled: true },
      ),
    ).toEqual({ status: "waiting-parts", customStatusId: "d-waiting" });
    expect(
      resolveUnifiedStatusSelection(
        order({ status: "cancelled", closedAt: "2026-11-01T00:00:00.000Z", customStatusId: null }),
        waiting,
        { allowReopenCancelled: false, allowManageClosed: true },
      ),
    ).toBeNull();
  });

  it("shows the live status when closed_at remains after an owner status change", () => {
    const options = unifiedStatusOptions(defaults, label);
    expect(
      resolveCurrentUnifiedStatus(
        order({ status: "in-progress", closedAt: "2026-11-01T00:00:00.000Z", customStatusId: "d-progress" }),
        options,
      )?.id,
    ).toBe("d-progress");
  });

  it("never lets a stale customStatusId override closed/cancelled in selectors", () => {
    const options = unifiedStatusOptions(defaults, label);
    // Selectors exclude lifecycle defs — current resolution must not fall back to a regular custom.
    expect(
      resolveCurrentUnifiedStatus(
        order({ status: "closed", closedAt: "2026-11-01T00:00:00.000Z", customStatusId: "d-progress" }),
        options,
      ),
    ).toBeNull();
    const filters = unifiedStatusFilterOptions(defaults, label);
    expect(
      resolveCurrentUnifiedStatus(
        order({ status: "cancelled", closedAt: null, customStatusId: "d-progress" }),
        filters,
      )?.id,
    ).toBe("d-cancelled");
  });

  it("board filter options keep closed/cancelled while selectors exclude them", () => {
    const selectable = unifiedStatusOptions(defaults, label).map((o) => o.id);
    const filters = unifiedStatusFilterOptions(defaults, label).map((o) => o.id);
    expect(selectable).not.toContain("d-closed");
    expect(selectable).not.toContain("d-cancelled");
    expect(filters).toEqual(expect.arrayContaining(["d-closed", "d-cancelled"]));
  });
});
