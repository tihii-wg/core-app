import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClipboardList, FileText, Package, UserPlus } from "lucide-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { DashboardQuickActions, type DashboardQuickAction } from "./DashboardQuickActions";

const longestRussianLabels = {
  createOrder: "Создать заказ",
  addClient: "Добавить клиента",
  addInventory: "Добавить запчасть",
  createInvoice: "Создать счёт",
} as const;

function russianActions(onClick = vi.fn()): DashboardQuickAction[] {
  return [
    { key: "order", label: longestRussianLabels.createOrder, icon: ClipboardList, onClick },
    { key: "client", label: longestRussianLabels.addClient, icon: UserPlus, onClick },
    { key: "inventory", label: longestRussianLabels.addInventory, icon: Package, onClick },
    { key: "invoice", label: longestRussianLabels.createInvoice, icon: FileText, onClick },
  ];
}

function renderAtWidth(width: number, actions = russianActions()) {
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
  return render(
    <div style={{ width }}>
      <DashboardQuickActions actions={actions} />
    </div>,
  );
}

beforeEach(async () => {
  await act(async () => {
    await i18n.changeLanguage("ru");
  });
});

afterEach(async () => {
  await act(async () => {
    await i18n.changeLanguage("en");
  });
});

describe("DashboardQuickActions mobile layout", () => {
  it("uses a 2-column grid that lets children shrink and wrap long Russian labels", () => {
    const { container } = renderAtWidth(360);
    const section = screen.getByRole("region", { name: "Быстрые действия" });
    const grid = section.querySelector(".grid");
    expect(grid?.className).toContain("grid-cols-2");
    expect(grid?.className).toContain("md:grid-cols-4");

    const buttons = within(section).getAllByRole("button");
    expect(buttons).toHaveLength(4);

    for (const button of buttons) {
      expect(button.className).toContain("min-w-0");
      expect(button.className).toContain("w-full");
      expect(button.className).toContain("whitespace-normal");
      expect(button.className).toContain("min-h-10");
      expect(button.className).not.toMatch(/(?:^|\s)whitespace-nowrap(?:\s|$)/);
      // Label can wrap on small screens; truncate only from sm up.
      const label = button.querySelector("span.min-w-0");
      expect(label?.className).toContain("min-w-0");
      expect(label?.className).toContain("[overflow-wrap:anywhere]");
      expect(label?.className).toContain("sm:truncate");
    }

    expect(within(section).getByRole("button", { name: longestRussianLabels.addClient })).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: longestRussianLabels.addInventory })).toBeInTheDocument();
    expect(container.querySelector("[style]")).not.toBeNull();
  });

  it.each([320, 360, 375, 390, 414, 440])("keeps all Russian quick-action labels visible at %ipx", (width) => {
    renderAtWidth(width);
    const section = screen.getByRole("region", { name: "Быстрые действия" });

    for (const label of Object.values(longestRussianLabels)) {
      const button = within(section).getByRole("button", { name: label });
      expect(button).toBeInTheDocument();
      expect(button.className).toContain("whitespace-normal");
      expect(button.className).toContain("min-w-0");
    }
  });

  it("preserves readable English labels and still fires clicks", async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
    const onClick = vi.fn();
    const user = userEvent.setup();
    renderAtWidth(375, [
      { key: "order", label: "Create Order", icon: ClipboardList, onClick },
      { key: "client", label: "Add Client", icon: UserPlus, onClick },
      { key: "inventory", label: "Add Inventory", icon: Package, onClick },
      { key: "invoice", label: "Create Invoice", icon: FileText, onClick },
    ]);

    await user.click(screen.getByRole("button", { name: "Add Client" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("keeps Romanian labels usable in the same mobile grid", async () => {
    await act(async () => {
      await i18n.changeLanguage("ro");
    });
    render(
      <div style={{ width: 360 }}>
        <DashboardQuickActions
          actions={[
            { key: "order", label: "Creează comandă", icon: ClipboardList, onClick: vi.fn() },
            { key: "client", label: "Adaugă client", icon: UserPlus, onClick: vi.fn() },
            { key: "inventory", label: "Adaugă în stoc", icon: Package, onClick: vi.fn() },
            { key: "invoice", label: "Creează factură", icon: FileText, onClick: vi.fn() },
          ]}
        />
      </div>,
    );

    const section = screen.getByRole("region", { name: "Acțiuni rapide" });
    expect(within(section).getByRole("button", { name: "Creează comandă" })).toHaveClass("whitespace-normal");
    expect(within(section).getByRole("button", { name: "Adaugă în stoc" })).toBeInTheDocument();
  });
});
