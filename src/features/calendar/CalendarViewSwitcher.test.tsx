import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CalendarViewSwitcher } from "./CalendarViewSwitcher";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe("CalendarViewSwitcher", () => {
  it("shows five options on phones including 3 days", () => {
    render(<CalendarViewSwitcher activeView="timeGridDay" isMobile onChange={vi.fn()} />);
    expect(screen.getByRole("tab", { name: "calendar.views.threeDays" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "calendar.views.day" })).toHaveAttribute("aria-selected", "true");
  });

  it("hides 3 days on desktop and calls onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CalendarViewSwitcher activeView="timeGridWeek" isMobile={false} onChange={onChange} />);
    expect(screen.queryByRole("tab", { name: "calendar.views.threeDays" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "calendar.views.month" }));
    expect(onChange).toHaveBeenCalledWith("dayGridMonth");
  });
});
