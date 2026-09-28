import { describe, expect, it } from "vitest";
import { toWorkspaceDetails, workspacePreferenceFields, workspaceUpdateFields } from "./apiWorkspaces";

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
          avatar_path: "ws-1/logo.webp",
          inventory_markup: 25,
          language: "de",
          timezone: "Europe/Chisinau",
          date_format: "DD.MM.YYYY",
          currency: "MDL",
        },
      }),
    ).toEqual({
      id: "ws-1",
      name: "Inventory UI Co",
      ownerId: "user-1",
      industryId: "industry-1",
      industryName: "Auto Repair & Service",
      avatarPath: "ws-1/logo.webp",
      inventoryMarkup: 25,
      language: "de",
      timezone: "Europe/Chisinau",
      dateFormat: "DD.MM.YYYY",
      currency: "MDL",
      role: "owner",
    });
  });

  it("ignores a workspace the user cannot access", () => {
    expect(toWorkspaceDetails(null)).toBeNull();
    expect(toWorkspaceDetails({ role: "owner", workspaces: { id: "ws-1", name: "Closed", deleted_at: "2026-01-01" } })).toBeNull();
  });
});

describe("workspace preferences", () => {
  it("keeps the trimmed language, time zone, date format, and currency", () => {
    expect(workspacePreferenceFields({ language: " de ", timezone: " Europe/Berlin ", dateFormat: " DD.MM.YYYY ", currency: " eur " })).toEqual({
      language: "de",
      timezone: "Europe/Berlin",
      date_format: "DD.MM.YYYY",
      currency: "eur",
    });
  });

  it("requires every preference", () => {
    expect(() => workspacePreferenceFields({ language: " ", timezone: "Europe/Chisinau", dateFormat: "DD.MM.YYYY", currency: "MDL" })).toThrow("Language is required");
  });
});

describe("workspace updates", () => {
  it("keeps the trimmed company name and business type", () => {
    expect(workspaceUpdateFields({ name: "  North Garage  ", industryId: " auto_repair ", inventoryMarkup: 25 })).toEqual({
      name: "North Garage",
      industryId: "auto_repair",
      inventoryMarkup: 25,
    });
  });

  it("requires a company name and business type", () => {
    expect(() => workspaceUpdateFields({ name: "  ", industryId: "auto_repair", inventoryMarkup: 25 })).toThrow("Company name is required");
    expect(() => workspaceUpdateFields({ name: "North Garage", industryId: " ", inventoryMarkup: 25 })).toThrow("Business type is required");
    expect(() => workspaceUpdateFields({ name: "North Garage", industryId: "auto_repair", inventoryMarkup: -1 })).toThrow("Markup percentage cannot be negative");
    expect(() => workspaceUpdateFields({ name: "North Garage", industryId: "auto_repair", inventoryMarkup: Number.NaN })).toThrow("Markup percentage must be a number");
  });
});
