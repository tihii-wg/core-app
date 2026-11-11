import { describe, expect, it } from "vitest";
import { clientVehicleMatchesQuery, filterClientVehiclesByQuery } from "./clientVehicleSearch";

const chevroletTrax = {
  make: "Chevrolet",
  model: "Trax",
  licensePlate: "B123ABC",
};

const toyotaCorolla = {
  make: "Toyota",
  model: "Corolla",
  licensePlate: "AB-12-CD",
};

const vwGolf = {
  make: "VW",
  model: "Golf",
  licensePlate: "B 456 XYZ",
};

describe("clientVehicleMatchesQuery", () => {
  it("matches by make", () => {
    expect(clientVehicleMatchesQuery(chevroletTrax, "Chevrolet")).toBe(true);
    expect(clientVehicleMatchesQuery(toyotaCorolla, "Chevrolet")).toBe(false);
  });

  it("matches by model", () => {
    expect(clientVehicleMatchesQuery(chevroletTrax, "Trax")).toBe(true);
    expect(clientVehicleMatchesQuery(toyotaCorolla, "Trax")).toBe(false);
  });

  it("matches by combined make and model", () => {
    expect(clientVehicleMatchesQuery(chevroletTrax, "Chevrolet Trax")).toBe(true);
    expect(clientVehicleMatchesQuery(chevroletTrax, "trax chevrolet")).toBe(true);
    expect(clientVehicleMatchesQuery(chevroletTrax, "Chevrolet Civic")).toBe(false);
  });

  it("matches full and partial license plate", () => {
    expect(clientVehicleMatchesQuery(chevroletTrax, "B123ABC")).toBe(true);
    expect(clientVehicleMatchesQuery(chevroletTrax, "123AB")).toBe(true);
    expect(clientVehicleMatchesQuery(chevroletTrax, "ZZZ999")).toBe(false);
  });

  it("normalizes plates with spaces and hyphens", () => {
    expect(clientVehicleMatchesQuery(chevroletTrax, "B 123 ABC")).toBe(true);
    expect(clientVehicleMatchesQuery(chevroletTrax, "B-123-ABC")).toBe(true);
    expect(clientVehicleMatchesQuery(vwGolf, "B456XYZ")).toBe(true);
    expect(clientVehicleMatchesQuery(toyotaCorolla, "AB12CD")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(clientVehicleMatchesQuery(chevroletTrax, "chevrolet")).toBe(true);
    expect(clientVehicleMatchesQuery(chevroletTrax, "TRAX")).toBe(true);
    expect(clientVehicleMatchesQuery(chevroletTrax, "b123abc")).toBe(true);
  });

  it("treats empty query as match-all", () => {
    expect(clientVehicleMatchesQuery(chevroletTrax, "")).toBe(true);
    expect(clientVehicleMatchesQuery(chevroletTrax, "   ")).toBe(true);
  });
});

describe("filterClientVehiclesByQuery", () => {
  const fleet = [chevroletTrax, toyotaCorolla, vwGolf];

  it("returns all vehicles when query is empty", () => {
    expect(filterClientVehiclesByQuery(fleet, "")).toEqual(fleet);
  });

  it("filters the list locally", () => {
    expect(filterClientVehiclesByQuery(fleet, "Chevrolet")).toEqual([chevroletTrax]);
    expect(filterClientVehiclesByQuery(fleet, "Golf")).toEqual([vwGolf]);
    expect(filterClientVehiclesByQuery(fleet, "nope")).toEqual([]);
  });
});
