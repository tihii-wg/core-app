import { describe, expect, it } from "vitest";
import { formatTeamNames, mergeOrderTeam, normalizeTeamRole, teamAvatarSlice, teamDiff } from "./orderTeam";

describe("normalizeTeamRole", () => {
  it("accepts lead and defaults everything else to helper", () => {
    expect(normalizeTeamRole("lead")).toBe("lead");
    expect(normalizeTeamRole("helper")).toBe("helper");
    expect(normalizeTeamRole("other")).toBe("helper");
    expect(normalizeTeamRole(null)).toBe("helper");
  });
});

describe("mergeOrderTeam", () => {
  it("makes the assignee lead and auto-adds line technicians", () => {
    expect(
      mergeOrderTeam({
        assignedEmployeeId: "ivan",
        team: [{ employeeId: "petr", role: "helper" }],
        lineTechnicianIds: ["ivan", "petr", "anna"],
      }),
    ).toEqual([
      { employeeId: "ivan", role: "lead" },
      { employeeId: "petr", role: "helper" },
      { employeeId: "anna", role: "helper" },
    ]);
  });

  it("preserves an explicit lead for a non-assignee member", () => {
    expect(
      mergeOrderTeam({
        assignedEmployeeId: "ivan",
        team: [{ employeeId: "petr", role: "lead" }],
      }),
    ).toEqual([
      { employeeId: "ivan", role: "lead" },
      { employeeId: "petr", role: "lead" },
    ]);
  });

  it("skips empty ids", () => {
    expect(mergeOrderTeam({ team: [{ employeeId: "  ", role: "helper" }], lineTechnicianIds: [null, ""] })).toEqual([]);
  });
});

describe("teamDiff", () => {
  it("computes inserts, role updates, and deletes", () => {
    expect(
      teamDiff(
        [
          { employeeId: "a", role: "lead" },
          { employeeId: "b", role: "helper" },
          { employeeId: "c", role: "helper" },
        ],
        [
          { employeeId: "a", role: "helper" },
          { employeeId: "b", role: "helper" },
          { employeeId: "d", role: "helper" },
        ],
      ),
    ).toEqual({
      toInsert: [{ employeeId: "d", role: "helper" }],
      toUpdate: [{ employeeId: "a", role: "helper" }],
      toDelete: ["c"],
    });
  });
});

describe("formatTeamNames / teamAvatarSlice", () => {
  it("joins names and slices avatars", () => {
    const team = [
      { employeeId: "1", name: "Ivan" },
      { employeeId: "2", name: "Petr" },
      { employeeId: "3", name: "Anna" },
      { employeeId: "4", name: "Oleg" },
    ];
    expect(formatTeamNames(team)).toBe("Ivan, Petr, Anna, Oleg");
    expect(teamAvatarSlice(team, 3)).toEqual({
      visible: team.slice(0, 3),
      overflow: 1,
    });
  });
});
