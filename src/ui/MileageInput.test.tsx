import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MileageInput } from "./MileageInput";

describe("MileageInput", () => {
  it("reformats a valid value on blur", () => {
    const onChange = vi.fn();
    render(<MileageInput aria-label="mileage" defaultValue="100000" locale="ru-RU" onChange={onChange} />);
    const input = screen.getByLabelText("mileage");
    fireEvent.blur(input);
    expect(input).toHaveValue("100 000");
    expect(onChange).toHaveBeenCalled();
  });

  it("leaves invalid text unchanged on blur", () => {
    render(<MileageInput aria-label="mileage" defaultValue="100.5" locale="en-US" />);
    const input = screen.getByLabelText("mileage");
    fireEvent.blur(input);
    expect(input).toHaveValue("100.5");
  });
});
