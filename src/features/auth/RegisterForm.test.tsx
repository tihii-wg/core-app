import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import RegisterForm from "./RegisterForm";

const mutateAsync = vi.fn();

vi.mock("./useSignUp", () => ({
  useSignUp: () => ({ mutateAsync, error: null, data: null }),
}));

describe("RegisterForm", () => {
  it("creates an account without asking for a business type", async () => {
    const user = userEvent.setup();
    render(<RegisterForm />);

    expect(screen.queryByRole("combobox", { name: "What type of business do you run?" })).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Company Name"), "Core Garage");
    await user.type(screen.getByLabelText("Owner Name"), "Ada Lovelace");
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Phone"), "+37360000000");
    await user.type(screen.getByLabelText("Password"), "secret1");
    await user.type(screen.getByLabelText("Confirm Password"), "secret1");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(mutateAsync).toHaveBeenCalledWith({
      companyName: "Core Garage",
      ownerName: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+37360000000",
      password: "secret1",
    });
  });
});
