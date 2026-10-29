import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusBadge } from "./StatusBadge";

describe("StatusBadge", () => {
  it("allows long localized labels to wrap within a narrow container", () => {
    const { container } = render(
      <div className="w-40 overflow-hidden">
        <StatusBadge variant="warning">Старое (несверено)</StatusBadge>
      </div>,
    );

    const badge = screen.getByText("Старое (несверено)");
    expect(badge.className).toMatch(/max-w-full/);
    expect(badge.className).toMatch(/min-w-0/);
    expect(badge.className).toMatch(/\[overflow-wrap:anywhere\]/);
    expect(badge.className).not.toMatch(/whitespace-nowrap/);
    expect(badge.className).not.toMatch(/\bshrink-0\b/);
    expect(badge.className).toMatch(/min-h-5\.5/);
    expect(container.firstElementChild?.contains(badge)).toBe(true);
  });
});
