/**
 * Fields editable in EditOrderForm (and industry sub-blocks).
 * Intentionally omits client / clientType / status / discount / vatRate —
 * those are not edited by the form.
 */
export const ORDER_EDIT_FIELDS = [
  "vehicle",
  "mileage",
  "device",
  "carNumber",
  "vin",
  "deviceSerial",
  "deviceImei",
  "deviceCondition",
  "deviceCompleteness",
  "devicePasscode",
  "siteAddress",
  "productDimensions",
  "measurementAt",
  "installationAt",
  "assignedEmployee",
  "team",
  "services",
  "materials",
  "description",
  "deadline",
] as const;

export type OrderEditField = (typeof ORDER_EDIT_FIELDS)[number];

const FOCUSABLE =
  'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])';

const HIGHLIGHT_MS = 1500;

/**
 * Scroll to `[data-edit-field]` and focus the first focusable control inside it.
 * Does not click/open Radix selects or date pickers — focus only.
 */
export function focusOrderEditField(root: ParentNode, field: OrderEditField) {
  const target = root.querySelector<HTMLElement>(`[data-edit-field="${field}"]`);
  if (!target) return;

  target.scrollIntoView({ block: "center", behavior: "smooth" });

  const focusable = target.matches(FOCUSABLE)
    ? target
    : target.querySelector<HTMLElement>(FOCUSABLE);

  // Prefer text-like controls; fall back to the first focusable (e.g. combobox trigger).
  const preferred =
    target.querySelector<HTMLElement>('textarea, input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])') ??
    focusable;

  preferred?.focus({ preventScroll: true });

  target.classList.add("ring-2", "ring-primary/40", "rounded-md", "transition-shadow");
  window.setTimeout(() => {
    target.classList.remove("ring-2", "ring-primary/40", "rounded-md", "transition-shadow");
  }, HIGHLIGHT_MS);
}
