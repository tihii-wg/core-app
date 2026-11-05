import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "../../i18n";
import { renderWithQuery } from "../../tests/renderQuery";
import {
  formatWarrantyEndsOn,
  formatWarrantyKm,
  OrderWarrantyIndicator,
  remainingDurationLabel,
} from "./OrderWarrantyIndicator";
import { buildOrderWarrantyIndicator, type WarrantySnapshot } from "./warranty";

function snapshot(partial: Partial<WarrantySnapshot> & Pick<WarrantySnapshot, "id" | "endsOn" | "expiresAtMileage" | "durationMonths" | "mileageLimit">): WarrantySnapshot {
  return {
    orderId: "order-1",
    itemKind: "service",
    itemName: "Oil change",
    orderServiceId: "svc-1",
    orderMaterialId: null,
    startsAt: "2026-11-04T12:00:00.000Z",
    startMileage: 80000,
    ...partial,
  };
}

const now = "2026-11-04T12:00:00.000Z";

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("OrderWarrantyIndicator", () => {
  it("renders nothing for non-warranty orders without coverage", () => {
    const model = buildOrderWarrantyIndicator({ snapshots: [], isWarrantyOrder: false, nowIso: now });
    const { container } = renderWithQuery(<OrderWarrantyIndicator model={model} />);
    expect(container.querySelector("[data-warranty-indicator]")).toBeNull();
  });

  it("shows active time-only warranty under the order number pattern", () => {
    const model = buildOrderWarrantyIndicator({
      snapshots: [
        snapshot({
          id: "r1",
          endsOn: "2027-07-04",
          expiresAtMileage: null,
          durationMonths: 8,
          mileageLimit: null,
        }),
      ],
      isWarrantyOrder: false,
      nowIso: now,
    });
    const { container } = renderWithQuery(<OrderWarrantyIndicator model={model} />);
    expect(screen.getByText("Warranty · 8 months remaining")).toBeInTheDocument();
    expect(screen.getByText(/Until 04\.07\.2027/)).toBeInTheDocument();
    const el = container.querySelector("[data-warranty-indicator]");
    expect(el?.className).toContain("text-success");
    expect(el?.getAttribute("data-warranty-status")).toBe("active");
  });

  it("shows active mileage-only remaining on the primary line", () => {
    const model = buildOrderWarrantyIndicator({
      snapshots: [
        snapshot({
          id: "r1",
          endsOn: null,
          expiresAtMileage: 90000,
          durationMonths: null,
          mileageLimit: 10000,
        }),
      ],
      isWarrantyOrder: false,
      nowIso: now,
      currentMileage: 82500,
    });
    const { container } = renderWithQuery(<OrderWarrantyIndicator model={model} />);
    expect(screen.getByText(/Warranty · 7,500 km remaining/)).toBeInTheDocument();
    expect(container.querySelector("[data-warranty-indicator]")?.className).toContain("text-success");
  });

  it("shows both limits when active", () => {
    const model = buildOrderWarrantyIndicator({
      snapshots: [
        snapshot({
          id: "r1",
          endsOn: "2027-07-04",
          expiresAtMileage: 90000,
          durationMonths: 8,
          mileageLimit: 10000,
        }),
      ],
      isWarrantyOrder: true,
      nowIso: now,
      currentMileage: 82500,
    });
    renderWithQuery(<OrderWarrantyIndicator model={model} />);
    expect(screen.getByText("Warranty order · 8 months remaining")).toBeInTheDocument();
    expect(screen.getByText(/Until 04\.07\.2027 · 7,500 km remaining/)).toBeInTheDocument();
  });

  it("shows expired-by-date state without negative remaining", () => {
    const model = buildOrderWarrantyIndicator({
      snapshots: [
        snapshot({
          id: "r1",
          endsOn: "2026-10-01",
          expiresAtMileage: null,
          durationMonths: 12,
          mileageLimit: null,
        }),
      ],
      isWarrantyOrder: false,
      nowIso: now,
    });
    const { container } = renderWithQuery(<OrderWarrantyIndicator model={model} />);
    expect(screen.getByText("Warranty expired")).toBeInTheDocument();
    expect(screen.getByText(/Expired by date/)).toBeInTheDocument();
    expect(screen.getByText(/01\.10\.2026/)).toBeInTheDocument();
    const el = container.querySelector("[data-warranty-indicator]");
    expect(el?.className).toContain("text-muted-foreground");
    expect(el?.className).not.toContain("text-success");
    expect(el?.className).not.toContain("text-destructive");
    expect(el?.getAttribute("data-warranty-expired")).toBe("true");
    expect(el?.getAttribute("data-warranty-status")).toBe("expired_date");
    expect(screen.queryByText(/remaining/i)).toBeNull();
  });

  it("shows expired-by-mileage state with the mileage limit", () => {
    const model = buildOrderWarrantyIndicator({
      snapshots: [
        snapshot({
          id: "r1",
          endsOn: "2027-11-04",
          expiresAtMileage: 90000,
          durationMonths: 12,
          mileageLimit: 10000,
        }),
      ],
      isWarrantyOrder: false,
      nowIso: now,
      currentMileage: 95000,
    });
    const { container } = renderWithQuery(<OrderWarrantyIndicator model={model} />);
    expect(screen.getByText("Warranty expired")).toBeInTheDocument();
    expect(screen.getByText(/Expired by mileage/)).toBeInTheDocument();
    expect(screen.getByText(/90,000 km/)).toBeInTheDocument();
    const el = container.querySelector("[data-warranty-indicator]");
    expect(el?.className).toContain("text-muted-foreground");
    expect(el?.getAttribute("data-warranty-status")).toBe("expired_mileage");
  });

  it("keeps pending (not-yet-closed) warranty label neutral gray", () => {
    const model = buildOrderWarrantyIndicator({
      snapshots: [
        snapshot({
          id: "r1",
          endsOn: "2027-11-04",
          expiresAtMileage: 90000,
          durationMonths: 12,
          mileageLimit: 10000,
          startsAt: "2026-12-01T00:00:00.000Z",
        }),
      ],
      isWarrantyOrder: false,
      nowIso: now,
      currentMileage: 80000,
    });
    expect(model.status).toBe("pending");
    const { container } = renderWithQuery(<OrderWarrantyIndicator model={model} />);
    const el = container.querySelector("[data-warranty-indicator]");
    expect(el).not.toBeNull();
    expect(el?.className).toContain("text-muted-foreground");
    expect(el?.className).not.toContain("text-success");
    expect(el?.getAttribute("data-warranty-status")).toBe("pending");
  });

  it("shows covered item count when multiple items differ", () => {
    const model = buildOrderWarrantyIndicator({
      snapshots: [
        snapshot({
          id: "a",
          endsOn: "2027-01-04",
          expiresAtMileage: null,
          durationMonths: 2,
          mileageLimit: null,
        }),
        snapshot({
          id: "b",
          endsOn: "2027-11-04",
          expiresAtMileage: null,
          durationMonths: 12,
          mileageLimit: null,
        }),
      ],
      isWarrantyOrder: true,
      nowIso: now,
    });
    renderWithQuery(<OrderWarrantyIndicator model={model} />);
    expect(screen.getByText("Warranty order · 2 months remaining")).toBeInTheDocument();
    expect(screen.getByText(/2 covered items/)).toBeInTheDocument();
  });

  it("localizes remaining phrases in Romanian and Russian", async () => {
    const remaining = { months: 8, days: 0, totalDays: 242 };

    await i18n.changeLanguage("ro");
    expect(remainingDurationLabel(remaining, (key, options) => String(i18n.t(key as never, options as never)))).toBe(
      "8 luni rămase",
    );
    expect(i18n.t("orders.warranty.indicator.expired")).toBe("Garanție expirată");
    expect(i18n.t("orders.warranty.indicator.remainingDays", { count: 12 })).toBe("12 zile rămase");
    expect(i18n.t("orders.warranty.indicator.remainingDays", { count: 1 })).toBe("1 zi rămasă");

    await i18n.changeLanguage("ru");
    expect(remainingDurationLabel(remaining, (key, options) => String(i18n.t(key as never, options as never)))).toBe(
      "Осталось 8 месяцев",
    );
    expect(i18n.t("orders.warranty.indicator.remainingDays", { count: 12 })).toBe("Осталось 12 дней");
    expect(i18n.t("orders.warranty.indicator.remainingDays", { count: 1 })).toBe("Осталось 1 день");
    expect(i18n.t("orders.warranty.indicator.remainingKm", { value: formatWarrantyKm(7500, "ru") })).toBe(
      "Осталось 7\u00A0500 км",
    );
    expect(i18n.t("orders.warranty.indicator.expired")).toBe("Гарантия истекла");
  });

  it("formats ends-on dates as DD.MM.YYYY", () => {
    expect(formatWarrantyEndsOn("2027-07-04")).toBe("04.07.2027");
  });
});
