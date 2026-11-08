import { describe, expect, it } from "vitest";
import {
  allocatePaid,
  applyTemplateToStages,
  checkMinPaidForStatus,
  currentPaymentStage,
  parseMinPaidRequiredError,
  resolveStageAmounts,
  type PaymentStageInput,
} from "./paymentStages";

const stages = (rows: PaymentStageInput[]) => rows;

describe("resolveStageAmounts", () => {
  it("resolves percent with cent rounding", () => {
    const { stages: resolved } = resolveStageAmounts(
      stages([
        { position: 0, name: "A", mode: "percent", percent: 50 },
        { position: 1, name: "B", mode: "remainder" },
      ]),
      33140,
    );
    expect(resolved[0]!.due).toBe(16570);
    expect(resolved[1]!.due).toBe(16570);
  });

  it("resolves amount as-is and remainder of the rest", () => {
    const { stages: resolved } = resolveStageAmounts(
      stages([
        { position: 0, name: "A", mode: "amount", amount: 1000 },
        { position: 1, name: "B", mode: "remainder" },
      ]),
      2500.5,
    );
    expect(resolved[0]!.due).toBe(1000);
    expect(resolved[1]!.due).toBe(1500.5);
  });

  it("furniture 50/30/remainder of 33140", () => {
    const { stages: resolved, warning } = resolveStageAmounts(
      stages([
        { position: 0, name: "Pre", mode: "percent", percent: 50 },
        { position: 1, name: "Mid", mode: "percent", percent: 30 },
        { position: 2, name: "Rest", mode: "remainder" },
      ]),
      33140,
    );
    expect(resolved.map((s) => s.due)).toEqual([16570, 9942, 6628]);
    expect(warning).toBeNull();
  });

  it("warns when fixed sum exceeds total", () => {
    const { warning } = resolveStageAmounts(
      stages([
        { position: 0, name: "A", mode: "percent", percent: 60 },
        { position: 1, name: "B", mode: "percent", percent: 60 },
        { position: 2, name: "C", mode: "remainder" },
      ]),
      100,
    );
    expect(warning).toBe("over_total");
  });

  it("warns when no remainder and sum ≠ total", () => {
    const { warning } = resolveStageAmounts(
      stages([
        { position: 0, name: "A", mode: "percent", percent: 40 },
        { position: 1, name: "B", mode: "percent", percent: 40 },
      ]),
      100,
    );
    expect(warning).toBe("sum_mismatch");
  });

  it("clamps remainder at 0 when over-allocated", () => {
    const { stages: resolved } = resolveStageAmounts(
      stages([
        { position: 0, name: "A", mode: "amount", amount: 200 },
        { position: 1, name: "B", mode: "remainder" },
      ]),
      100,
    );
    expect(resolved[1]!.due).toBe(0);
  });
});

describe("allocatePaid", () => {
  const plan = stages([
    { position: 0, name: "Pre", mode: "percent", percent: 50, dueDate: "2026-01-01" },
    { position: 1, name: "Mid", mode: "percent", percent: 30, dueDate: "2026-02-01" },
    { position: 2, name: "Rest", mode: "remainder", dueDate: "2026-03-01" },
  ]);

  it("waterfalls paid across stages", () => {
    const allocated = allocatePaid(plan, 100, 60, { today: new Date("2026-01-15") });
    expect(allocated.map((s) => [s.paid, s.remaining, s.state])).toEqual([
      [50, 0, "paid"],
      [10, 20, "partial"],
      [0, 20, "pending"],
    ]);
    expect(currentPaymentStage(allocated)?.name).toBe("Mid");
  });

  it("marks overdue when due_date passed and unpaid", () => {
    const allocated = allocatePaid(plan, 100, 0, { today: new Date("2026-01-15") });
    expect(allocated[0]!.state).toBe("overdue");
    expect(allocated[1]!.state).toBe("pending");
  });

  it("handles overpayment on the last stage", () => {
    const allocated = allocatePaid(plan, 100, 150);
    expect(allocated[0]!.state).toBe("paid");
    expect(allocated[1]!.state).toBe("paid");
    expect(allocated[2]!.paid).toBe(70);
    expect(allocated[2]!.remaining).toBe(0);
  });

  it("refunds reduce net paid (caller passes net)", () => {
    const allocated = allocatePaid(plan, 100, 20);
    expect(currentPaymentStage(allocated)?.remaining).toBe(30);
  });
});

describe("applyTemplateToStages", () => {
  it("assigns positions and due dates from dueDays", () => {
    const rows = applyTemplateToStages(
      [
        { name: "A", mode: "percent", percent: 50, dueDays: 0 },
        { name: "B", mode: "remainder", dueDays: 10 },
      ],
      { fromDate: new Date(2026, 0, 1) },
    );
    expect(rows[0]).toMatchObject({ position: 0, dueDate: "2026-01-01", percent: 50 });
    expect(rows[1]).toMatchObject({ position: 1, mode: "remainder", dueDate: "2026-01-11" });
  });
});

describe("min paid status rule", () => {
  it("pre-checks required amount", () => {
    const check = checkMinPaidForStatus({
      statusName: "In production",
      minPaidPercent: 50,
      orderTotal: 33140,
      netPaid: 0,
    });
    expect(check).toEqual({
      ok: false,
      statusName: "In production",
      percent: 50,
      required: 16570,
      paid: 0,
    });
    expect(
      checkMinPaidForStatus({
        statusName: "In production",
        minPaidPercent: 50,
        orderTotal: 33140,
        netPaid: 16570,
      })?.ok,
    ).toBe(true);
  });

  it("parses DB error", () => {
    expect(
      parseMinPaidRequiredError(
        "order_status:min_paid_required status=В производстве percent=50 required=16570 paid=0",
      ),
    ).toEqual({
      ok: false,
      statusName: "В производстве",
      percent: 50,
      required: 16570,
      paid: 0,
    });
  });
});
