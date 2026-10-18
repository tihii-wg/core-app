import { describe, expect, it } from "vitest";
import { ORDER_UNASSIGNED_VALUE, fromAssigneeSelectValue, toAssigneeSelectValue } from "./orderAssignee";

describe("orderAssignee select values", () => {
  it("maps empty assignee ids to the unassigned sentinel for Radix Select", () => {
    expect(toAssigneeSelectValue("")).toBe(ORDER_UNASSIGNED_VALUE);
    expect(toAssigneeSelectValue("   ")).toBe(ORDER_UNASSIGNED_VALUE);
    expect(toAssigneeSelectValue(null)).toBe(ORDER_UNASSIGNED_VALUE);
    expect(toAssigneeSelectValue(undefined)).toBe(ORDER_UNASSIGNED_VALUE);
    expect(toAssigneeSelectValue("emp-1")).toBe("emp-1");
  });

  it("maps the unassigned sentinel back to an empty assignee id", () => {
    expect(fromAssigneeSelectValue(ORDER_UNASSIGNED_VALUE)).toBe("");
    expect(fromAssigneeSelectValue("emp-1")).toBe("emp-1");
  });
});
