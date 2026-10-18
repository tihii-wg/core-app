import { describe, expect, it } from "vitest";
import type { Employee } from "../../lib/types";
import { assignableTechnicians } from "./assignableTechnicians";

const employee = (overrides: Partial<Employee> & Pick<Employee, "id" | "name">): Employee => ({
  email: "",
  phone: "",
  role: "technician",
  assignedTasks: 0,
  completedTasks: 0,
  status: "active",
  profile_id: null,
  ...overrides,
});

describe("assignableTechnicians", () => {
  it("lists an active technician by employees.name even when they are not a workspace member", () => {
    const options = assignableTechnicians([
      employee({ id: "emp-alexander", name: "Alexander", profile_id: null }),
      employee({ id: "emp-owner", name: "Owner Name", role: "admin", profile_id: "owner-1" }),
    ]);

    expect(options).toEqual([{ id: "emp-alexander", name: "Alexander" }]);
  });

  it("never substitutes the owner name for another employee", () => {
    const options = assignableTechnicians([
      employee({ id: "emp-alexander", name: "Alexander", profile_id: "user-alexander" }),
      employee({ id: "emp-owner", name: "Owner Name", profile_id: "owner-1" }),
    ]);

    expect(options).toEqual([
      { id: "emp-alexander", name: "Alexander" },
      { id: "emp-owner", name: "Owner Name" },
    ]);
  });

  it("uses employees.id as the option value for order assignment", () => {
    const options = assignableTechnicians([employee({ id: "emp-uuid", name: "Tina", profile_id: "auth-user-9" })]);

    expect(options).toEqual([{ id: "emp-uuid", name: "Tina" }]);
  });

  it("excludes inactive technicians unless they are the current assignee", () => {
    const inactive = employee({ id: "emp-old", name: "Old Tech", status: "inactive", profile_id: "user-old" });
    const active = employee({ id: "emp-new", name: "New Tech", profile_id: "user-new" });

    expect(assignableTechnicians([inactive, active])).toEqual([{ id: "emp-new", name: "New Tech" }]);
    expect(assignableTechnicians([inactive, active], "emp-old")).toEqual([
      { id: "emp-new", name: "New Tech" },
      { id: "emp-old", name: "Old Tech" },
    ]);
  });

  it("keeps only the current workspace employees passed in (caller scopes the query)", () => {
    const options = assignableTechnicians([employee({ id: "emp-a", name: "Ada", profile_id: null })]);

    expect(options.map((option) => option.id)).toEqual(["emp-a"]);
  });
});
