import { describe, expect, it } from "vitest";
import { toWorkspaceDetails, workspaceUpdateFields } from "./apiWorkspaces";

describe("workspace details", () => {
  it("reads the company name and business type from a membership", () => {
    expect(
      toWorkspaceDetails({
        role: "owner",
        workspaces: {
          id: "ws-1",
          name: "Inventory UI Co",
          owner_id: "user-1",
          deleted_at: null,
          industry_id: "industry-1",
          industry: { id: "industry-1", name: "Auto Repair & Service", slug: "auto_repair" },
        },
      }),
    ).toEqual({
      id: "ws-1",
      name: "Inventory UI Co",
      ownerId: "user-1",
      industryId: "industry-1",
      industryName: "Auto Repair & Service",
      role: "owner",
    });
  });

  it("ignores a workspace the user cannot access", () => {
    expect(toWorkspaceDetails(null)).toBeNull();
    expect(toWorkspaceDetails({ role: "owner", workspaces: { id: "ws-1", name: "Closed", deleted_at: "2026-01-01" } })).toBeNull();
  });
});

describe("workspace updates", () => {
  it("keeps the trimmed company name and business type", () => {
    expect(workspaceUpdateFields({ name: "  North Garage  ", industryId: " auto_repair " })).toEqual({
      name: "North Garage",
      industryId: "auto_repair",
    });
  });

  it("requires a company name and business type", () => {
    expect(() => workspaceUpdateFields({ name: "  ", industryId: "auto_repair" })).toThrow("Company name is required");
    expect(() => workspaceUpdateFields({ name: "North Garage", industryId: " " })).toThrow("Business type is required");
  });
});
