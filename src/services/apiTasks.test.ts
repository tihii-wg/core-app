import { describe, expect, it } from "vitest";
import { buildTaskRow, isTaskOverdue, sortTasks, type TaskRecord } from "./apiTasks";

function task(partial: Partial<TaskRecord>): TaskRecord {
  return {
    id: partial.id ?? "t",
    title: "x",
    description: null,
    priority: "medium",
    statusId: null,
    dueAt: null,
    createdAt: "2026-11-01T10:00:00.000Z",
    completedAt: null,
    createdBy: "author",
    assignedTo: "worker",
    ...partial,
  };
}

describe("buildTaskRow with assignment", () => {
  it("adds description and assignee only when the form provides them", () => {
    expect(buildTaskRow({ title: "Measure", priority: "high", dueAt: null, description: "  door 2  ", assignedTo: "u-1" })).toEqual({
      title: "Measure",
      priority: "high",
      due_at: null,
      description: "door 2",
      assigned_to: "u-1",
    });
    expect(buildTaskRow({ title: "Measure", priority: "low", dueAt: null, description: "  ", assignedTo: "" })).toMatchObject({
      description: null,
      assigned_to: null,
    });
  });

  it("rejects overly long details", () => {
    expect(() => buildTaskRow({ title: "x", priority: "low", dueAt: null, description: "a".repeat(4001) })).toThrow();
  });
});

describe("sortTasks", () => {
  it("puts open tasks first by due date (no date last), then completed newest first", () => {
    const rows = sortTasks([
      task({ id: "done-old", completedAt: "2026-11-02T00:00:00.000Z" }),
      task({ id: "no-due" }),
      task({ id: "due-late", dueAt: "2026-11-20T00:00:00.000Z" }),
      task({ id: "done-new", completedAt: "2026-11-05T00:00:00.000Z" }),
      task({ id: "due-soon", dueAt: "2026-11-15T00:00:00.000Z" }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["due-soon", "due-late", "no-due", "done-new", "done-old"]);
  });
});

describe("isTaskOverdue", () => {
  const now = new Date("2026-11-14T12:00:00.000Z");
  it("is true only for open tasks past their due date", () => {
    expect(isTaskOverdue(task({ dueAt: "2026-11-14T11:00:00.000Z" }), now)).toBe(true);
    expect(isTaskOverdue(task({ dueAt: "2026-11-14T13:00:00.000Z" }), now)).toBe(false);
    expect(isTaskOverdue(task({ dueAt: null }), now)).toBe(false);
    expect(isTaskOverdue(task({ dueAt: "2026-11-01T00:00:00.000Z", completedAt: "2026-11-02T00:00:00.000Z" }), now)).toBe(false);
  });
});
