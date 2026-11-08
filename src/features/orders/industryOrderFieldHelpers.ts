/**
 * Helpers for industry-specific order columns (device / site / project).
 * Visibility is driven by IndustryOrderFieldBlocks — no industry slug checks here.
 */

import type { IndustryOrderFieldBlocks } from "../industries/industryProfile";
import type { Order } from "../../lib/types";

export type OrderIndustryFormFields = {
  deviceSerial: string;
  deviceImei: string;
  deviceCondition: string;
  deviceCompleteness: string;
  devicePasscode: string;
  siteAddress: string;
  productDimensions: string;
  measurementDate: string;
  measurementTime: string;
  installationDate: string;
  installationTime: string;
};

export const emptyOrderIndustryFormFields = (): OrderIndustryFormFields => ({
  deviceSerial: "",
  deviceImei: "",
  deviceCondition: "",
  deviceCompleteness: "",
  devicePasscode: "",
  siteAddress: "",
  productDimensions: "",
  measurementDate: "",
  measurementTime: "",
  installationDate: "",
  installationTime: "",
});

/** True when the profile shows any of the industry-specific intake fields. */
export function hasVisibleIndustryOrderFields(blocks: IndustryOrderFieldBlocks): boolean {
  return (
    blocks.deviceSerial ||
    blocks.deviceImei ||
    blocks.deviceCondition ||
    blocks.deviceCompleteness ||
    blocks.devicePasscode ||
    blocks.siteAddress ||
    blocks.productDimensions ||
    blocks.measurementAt ||
    blocks.installationAt
  );
}

/** Split an ISO timestamptz into local date (YYYY-MM-DD) and time (HH:mm) for form inputs. */
export function splitDateTimeLocal(iso: string | null | undefined): { date: string; time: string } {
  const trimmed = (iso ?? "").trim();
  if (!trimmed) return { date: "", time: "" };
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return { date: "", time: "" };
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`,
    time: `${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`,
  };
}

/** Combine local date + time into an ISO timestamptz; empty date → null. */
export function combineDateTimeLocal(date: string | null | undefined, time: string | null | undefined): string | null {
  const d = (date ?? "").trim();
  if (!d) return null;
  const t = (time ?? "").trim() || "00:00";
  const normalizedTime = t.length === 5 ? `${t}:00` : t;
  const parsed = new Date(`${d}T${normalizedTime}`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export function orderIndustryFormFieldsFromOrder(order: Pick<
  Order,
  | "deviceSerial"
  | "deviceImei"
  | "deviceCondition"
  | "deviceCompleteness"
  | "devicePasscode"
  | "siteAddress"
  | "productDimensions"
  | "measurementAt"
  | "installationAt"
>): OrderIndustryFormFields {
  const measurement = splitDateTimeLocal(order.measurementAt);
  const installation = splitDateTimeLocal(order.installationAt);
  return {
    deviceSerial: order.deviceSerial ?? "",
    deviceImei: order.deviceImei ?? "",
    deviceCondition: order.deviceCondition ?? "",
    deviceCompleteness: order.deviceCompleteness ?? "",
    devicePasscode: order.devicePasscode ?? "",
    siteAddress: order.siteAddress ?? "",
    productDimensions: order.productDimensions ?? "",
    measurementDate: measurement.date,
    measurementTime: measurement.time,
    installationDate: installation.date,
    installationTime: installation.time,
  };
}

export type OrderIndustryApiFields = {
  deviceSerial: string | null;
  deviceImei: string | null;
  deviceCondition: string | null;
  deviceCompleteness: string | null;
  devicePasscode: string | null;
  siteAddress: string | null;
  productDimensions: string | null;
  measurementAt: string | null;
  installationAt: string | null;
};

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : null;
}

/** Form (or raw) values → API payload; empty strings become null. */
export function orderIndustryFieldsToApi(fields: Partial<OrderIndustryFormFields>): OrderIndustryApiFields {
  return {
    deviceSerial: emptyToNull(fields.deviceSerial),
    deviceImei: emptyToNull(fields.deviceImei),
    deviceCondition: emptyToNull(fields.deviceCondition),
    deviceCompleteness: emptyToNull(fields.deviceCompleteness),
    devicePasscode: emptyToNull(fields.devicePasscode),
    siteAddress: emptyToNull(fields.siteAddress),
    productDimensions: emptyToNull(fields.productDimensions),
    measurementAt: combineDateTimeLocal(fields.measurementDate, fields.measurementTime),
    installationAt: combineDateTimeLocal(fields.installationDate, fields.installationTime),
  };
}

/** Client-side check matching DB constraint orders_install_after_measure. */
export function isInstallationBeforeMeasurement(measurementAt: string | null, installationAt: string | null): boolean {
  if (!measurementAt || !installationAt) return false;
  const measure = new Date(measurementAt).getTime();
  const install = new Date(installationAt).getTime();
  if (Number.isNaN(measure) || Number.isNaN(install)) return false;
  return install < measure;
}

/**
 * Secondary line under the asset name on cards/lists:
 * plate/VIN for vehicles, serial for devices, site address for site/project.
 */
export function orderAssetSecondaryLine(
  order: Pick<Order, "carNumber" | "vin" | "deviceSerial" | "siteAddress">,
  blocks: IndustryOrderFieldBlocks,
): string {
  if (blocks.vehicleGrid) {
    return order.carNumber?.trim() || order.vin?.trim() || "";
  }
  if (blocks.deviceSerial) {
    return order.deviceSerial?.trim() || "";
  }
  if (blocks.siteAddress) {
    return order.siteAddress?.trim() || "";
  }
  return "";
}
