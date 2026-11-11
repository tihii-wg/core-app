import { describe, expect, it } from "vitest";
import { vehicleMakeModelMatches } from "./vehicleTextSearch";

describe("vehicleMakeModelMatches", () => {
  it("matches make, model, and combined tokens", () => {
    expect(vehicleMakeModelMatches("BMW", "X5", "BMW")).toBe(true);
    expect(vehicleMakeModelMatches("Toyota", "Camry", "Camry")).toBe(true);
    expect(vehicleMakeModelMatches("Toyota", "Camry", "Toyota Camry")).toBe(true);
    expect(vehicleMakeModelMatches("Toyota", "Camry", "camry toyota")).toBe(true);
    expect(vehicleMakeModelMatches("Toyota", "Camry", "Honda")).toBe(false);
    expect(vehicleMakeModelMatches("Toyota", "Camry", "Toyota Civic")).toBe(false);
  });

  it("requires tokens of length >= 2", () => {
    expect(vehicleMakeModelMatches("BMW", "X5", "B")).toBe(false);
    expect(vehicleMakeModelMatches(null, null, "BMW")).toBe(false);
  });
});
