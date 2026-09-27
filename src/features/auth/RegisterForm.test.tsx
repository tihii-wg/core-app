import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import RegisterForm from "./RegisterForm";

const mutateAsync = vi.fn();

vi.mock("./useSignUp", () => ({
  useSignUp: () => ({ mutateAsync, error: null }),
}));

vi.mock("../industries/useGetIndustries", () => ({
  useGetIndustries: () => ({
    industries: [
      { id: "industry-auto", name: "Auto Repair & Service", slug: "auto_repair" },
      { id: "industry-other", name: "Other", slug: "other" },
    ],
    isLoading: false,
  }),
}));

describe("RegisterForm", () => {
  it("requires a business type before creating an account", async () => {
    const user = userEvent.setup();
    render(<RegisterForm />);

    await user.type(screen.getByLabelText("Company Name"), "Core Garage");
    await user.type(screen.getByLabelText("Owner Name"), "Ada Lovelace");
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Phone"), "+37360000000");
    await user.type(screen.getByLabelText("Password"), "secret1");
    await user.type(screen.getByLabelText("Confirm Password"), "secret1");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(screen.getByText("Business type is required")).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});
