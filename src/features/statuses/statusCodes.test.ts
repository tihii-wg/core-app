import { describe, expect, it } from "vitest";
import {
  allocateStatusCode,
  backfillStatusCodes,
  fallbackCodeFromStatusId,
  isStatusCodeUniqueViolation,
  nextAvailableCode,
  preferredCodeFromSystemStatus,
} from "./statusCodes";

/** Confirmed MAIN IDs that share system_status = in-progress. */
const WS_A = {
  inWork: "7a79eccc-7013-4b09-9a45-428e4f8cd8da",
  approval: "3353cfaa-1122-48ba-942f-1888809f4c4d",
  waitingPay: "6a79c44c-13a2-4d27-a91a-00031aac21ce",
} as const;

describe("statusCodes", () => {
  it("maps preferred codes from system_status without treating them as unique", () => {
    expect(preferredCodeFromSystemStatus("in-progress")).toBe("in_progress");
    expect(preferredCodeFromSystemStatus("waiting-parts")).toBe("waiting_parts");
    expect(preferredCodeFromSystemStatus("unknown")).toBeNull();
  });

  it("builds deterministic UUID fallback codes", () => {
    expect(fallbackCodeFromStatusId(WS_A.approval)).toBe(
      `s_${WS_A.approval.replace(/-/g, "").toLowerCase()}`,
    );
  });

  it("nextAvailableCode uses base then _2,_3 when collisions exist", () => {
    const base = fallbackCodeFromStatusId(WS_A.inWork);
    expect(nextAvailableCode(base, new Set())).toBe(base);
    expect(nextAvailableCode(base, new Set([base]))).toBe(`${base}_2`);
    expect(nextAvailableCode(base, new Set([base, `${base}_2`]))).toBe(`${base}_3`);
  });

  it("keeps an existing code even when preferred is free", () => {
    expect(
      allocateStatusCode({
        statusId: WS_A.inWork,
        systemStatus: "in-progress",
        existingCode: "custom_keep",
        takenCodes: new Set(),
      }),
    ).toBe("custom_keep");
  });

  it("assigns preferred only when free; otherwise collision-safe UUID fallback", () => {
    expect(
      allocateStatusCode({
        statusId: WS_A.inWork,
        systemStatus: "in-progress",
        existingCode: null,
        takenCodes: new Set(),
      }),
    ).toBe("in_progress");

    const taken = new Set(["in_progress", fallbackCodeFromStatusId(WS_A.approval)]);
    expect(
      allocateStatusCode({
        statusId: WS_A.approval,
        systemStatus: "in-progress",
        existingCode: null,
        takenCodes: taken,
      }),
    ).toBe(`${fallbackCodeFromStatusId(WS_A.approval)}_2`);
  });

  it("backfills duplicate system_status rows with unique stable codes", () => {
    const rows = [
      { id: WS_A.inWork, systemStatus: "in-progress", sortOrder: 1, createdAt: "2024-01-01", code: null },
      { id: WS_A.approval, systemStatus: "in-progress", sortOrder: 2, createdAt: "2024-01-02", code: null },
      { id: WS_A.waitingPay, systemStatus: "in-progress", sortOrder: 3, createdAt: "2024-01-03", code: null },
      { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", systemStatus: "new", sortOrder: 0, createdAt: "2024-01-01", code: null },
    ];

    const codes = backfillStatusCodes(rows);
    expect(codes.get("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")).toBe("new");
    expect(codes.get(WS_A.inWork)).toBe("in_progress");
    expect(codes.get(WS_A.approval)).toBe(fallbackCodeFromStatusId(WS_A.approval));
    expect(codes.get(WS_A.waitingPay)).toBe(fallbackCodeFromStatusId(WS_A.waitingPay));
    expect(new Set(codes.values()).size).toBe(codes.size);
  });

  it("repairs duplicate existing codes by keeping the earliest and reallocating losers", () => {
    const rows = [
      { id: WS_A.inWork, systemStatus: "in-progress", code: "in_progress", sortOrder: 1, createdAt: "2024-01-01" },
      { id: WS_A.approval, systemStatus: "in-progress", code: "in_progress", sortOrder: 2, createdAt: "2024-01-02" },
      { id: WS_A.waitingPay, systemStatus: "in-progress", code: "in_progress", sortOrder: 3, createdAt: "2024-01-03" },
    ];
    const codes = backfillStatusCodes(rows);
    expect(codes.get(WS_A.inWork)).toBe("in_progress");
    expect(codes.get(WS_A.approval)).toBe(fallbackCodeFromStatusId(WS_A.approval));
    expect(codes.get(WS_A.waitingPay)).toBe(fallbackCodeFromStatusId(WS_A.waitingPay));
    expect(new Set(codes.values()).size).toBe(3);
  });

  it("is idempotent when existing codes are already unique", () => {
    const rows = [
      { id: WS_A.inWork, systemStatus: "in-progress", code: "in_progress", sortOrder: 1 },
      { id: WS_A.approval, systemStatus: "in-progress", code: fallbackCodeFromStatusId(WS_A.approval), sortOrder: 2 },
      { id: WS_A.waitingPay, systemStatus: "in-progress", code: fallbackCodeFromStatusId(WS_A.waitingPay), sortOrder: 3 },
    ];
    const first = backfillStatusCodes(rows);
    const second = backfillStatusCodes(rows.map((row) => ({ ...row, code: first.get(row.id) ?? null })));
    expect(Object.fromEntries(second)).toEqual(Object.fromEntries(first));
  });

  it("does not overwrite established codes when peers share system_status", () => {
    const rows = [
      { id: WS_A.approval, systemStatus: "in-progress", code: "in_progress", sortOrder: 2 },
      { id: WS_A.inWork, systemStatus: "in-progress", code: null, sortOrder: 1 },
    ];
    const codes = backfillStatusCodes(rows);
    expect(codes.get(WS_A.approval)).toBe("in_progress");
    expect(codes.get(WS_A.inWork)).toBe(fallbackCodeFromStatusId(WS_A.inWork));
  });

  it("never derives codes from display names", () => {
    const rows = [
      { id: WS_A.inWork, systemStatus: "in-progress", code: null, sortOrder: 1, name: "В работе" },
      { id: WS_A.approval, systemStatus: "in-progress", code: null, sortOrder: 2, name: "На согласовании" },
    ];
    const codes = backfillStatusCodes(rows);
    expect([...codes.values()].join(",")).not.toMatch(/согласован|работе|оплат/i);
  });

  it("detects only status-code unique violations for concurrent create retry", () => {
    expect(
      isStatusCodeUniqueViolation({
        code: "23505",
        message: 'duplicate key value violates unique constraint "status_definitions_code_uidx"',
      }),
    ).toBe(true);
    expect(
      isStatusCodeUniqueViolation({
        code: "23505",
        message: 'duplicate key value violates unique constraint "status_definitions_name_idx"',
      }),
    ).toBe(false);
    expect(isStatusCodeUniqueViolation({ code: "23503", message: "fk" })).toBe(false);
  });
});
