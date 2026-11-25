import type { Vehicle } from "../../lib/types";

export type VehicleDuplicateReason = "vin" | "plate" | "model";

export type VehicleDuplicateGroup = {
  /** Strongest reason that joined the group (VIN > plate > make/model). */
  reason: VehicleDuplicateReason;
  /** The shared value (VIN, plate or «make model year»). */
  value: string;
  vehicles: Vehicle[];
};

function normVin(value: string | null | undefined) {
  const vin = (value ?? "").replace(/[\s-]+/g, "").toUpperCase();
  return vin.length >= 5 ? vin : "";
}

function normPlate(value: string | null | undefined) {
  return (value ?? "").replace(/[\s\-_.]+/g, "").toUpperCase();
}

function normText(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function modelKey(vehicle: Vehicle) {
  const make = normText(vehicle.make);
  const model = normText(vehicle.model);
  if (!make || !model) return "";
  return [make, model, vehicle.year != null ? String(vehicle.year) : ""].join("|");
}

/**
 * Likely duplicates among one client's vehicles (no network):
 * - same VIN, or the same licence plate → certainly the same car;
 * - same make + model (+ year) where the VINs do not contradict (at most one distinct VIN) → probably.
 * Vehicles linked through any of these end up in one group (union–find). Groups of one are dropped.
 */
export function findVehicleDuplicateGroups(vehicles: readonly Vehicle[]): VehicleDuplicateGroup[] {
  const parent = new Map<string, string>(vehicles.map((vehicle) => [vehicle.id, vehicle.id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root) as string;
    parent.set(id, root);
    return root;
  };
  const reasonOf = new Map<string, { reason: VehicleDuplicateReason; value: string }>();
  const rank: Record<VehicleDuplicateReason, number> = { vin: 3, plate: 2, model: 1 };
  const union = (a: string, b: string, reason: VehicleDuplicateReason, value: string) => {
    const rootA = find(a);
    const rootB = find(b);
    const merged = rootA === rootB ? rootA : (parent.set(rootB, rootA), rootA);
    const previous = [reasonOf.get(rootA), reasonOf.get(rootB)].filter(Boolean) as Array<{
      reason: VehicleDuplicateReason;
      value: string;
    }>;
    const best = [...previous, { reason, value }].sort((x, y) => rank[y.reason] - rank[x.reason])[0];
    reasonOf.delete(rootB);
    if (best) reasonOf.set(merged, best);
  };

  const byKey = (key: (vehicle: Vehicle) => string, reason: VehicleDuplicateReason, label: (vehicle: Vehicle) => string) => {
    const seen = new Map<string, Vehicle>();
    for (const vehicle of vehicles) {
      const value = key(vehicle);
      if (!value) continue;
      const first = seen.get(value);
      if (first) union(first.id, vehicle.id, reason, label(vehicle));
      else seen.set(value, vehicle);
    }
  };

  byKey((vehicle) => normVin(vehicle.vin), "vin", (vehicle) => normVin(vehicle.vin));
  byKey((vehicle) => normPlate(vehicle.licensePlate), "plate", (vehicle) => (vehicle.licensePlate ?? "").trim().toUpperCase());

  // Same make/model/year: only when that does not join two different VINs.
  const byModel = new Map<string, Vehicle[]>();
  for (const vehicle of vehicles) {
    const key = modelKey(vehicle);
    if (!key) continue;
    byModel.set(key, [...(byModel.get(key) ?? []), vehicle]);
  }
  for (const group of byModel.values()) {
    if (group.length < 2) continue;
    const vins = new Set(group.map((vehicle) => normVin(vehicle.vin)).filter(Boolean));
    if (vins.size > 1) continue;
    const label = [group[0]?.make, group[0]?.model, group[0]?.year].filter(Boolean).join(" ");
    for (let index = 1; index < group.length; index += 1) {
      union((group[0] as Vehicle).id, (group[index] as Vehicle).id, "model", label);
    }
  }

  const groups = new Map<string, Vehicle[]>();
  for (const vehicle of vehicles) {
    const root = find(vehicle.id);
    groups.set(root, [...(groups.get(root) ?? []), vehicle]);
  }
  const out: VehicleDuplicateGroup[] = [];
  for (const [root, members] of groups) {
    if (members.length < 2) continue;
    const info = reasonOf.get(root) ?? { reason: "model" as const, value: "" };
    out.push({ reason: info.reason, value: info.value, vehicles: members });
  }
  return out.sort((a, b) => rank[b.reason] - rank[a.reason] || b.vehicles.length - a.vehicles.length);
}
