import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import RegisterForm from "./RegisterForm";

const mutateAsync = vi.fn();

vi.mock("./useSignUp", () => ({
  useSignUp: () => ({ mutateAsync, error: null, data: null }),
}));

function renderForm(path = "/en/register") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/:locale/register" element={<RegisterForm />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("RegisterForm", () => {
  it("asks for registration mode before the form", async () => {
    const user = userEvent.setup();
    renderForm();

    expect(screen.getByText("How will you use Core App?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create my own workspace/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Join a team/i })).toBeInTheDocument();
    expect(screen.queryByLabelText("Company Name")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Create my own workspace/i }));
    expect(screen.getByLabelText("Company Name")).toBeInTheDocument();
  });

  it("creates an own-workspace account with company name required", async () => {
    const user = userEvent.setup();
    mutateAsync.mockClear();
    renderForm();

    await user.click(screen.getByRole("button", { name: /Create my own workspace/i }));
    await user.type(screen.getByLabelText("Company Name"), "Core Garage");
    await user.type(screen.getByLabelText("Owner Name"), "Ada Lovelace");
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText(/Phone/), "+37360000000");
    await user.type(screen.getByLabelText("Password"), "secret1");
    await user.type(screen.getByLabelText("Confirm Password"), "secret1");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(mutateAsync).toHaveBeenCalledWith({
      mode: "create",
      companyName: "Core Garage",
      ownerName: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+37360000000",
      password: "secret1",
    });
  });

  it("join mode hides company name and allows optional phone", async () => {
    const user = userEvent.setup();
    mutateAsync.mockClear();
    renderForm();

    await user.click(screen.getByRole("button", { name: /Join a team/i }));
    expect(screen.queryByLabelText("Company Name")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Your name")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Your name"), "Max Member");
    await user.type(screen.getByLabelText("Email"), "max@example.com");
    await user.type(screen.getByLabelText("Password"), "secret1");
    await user.type(screen.getByLabelText("Confirm Password"), "secret1");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(mutateAsync).toHaveBeenCalledWith({
      mode: "join",
      companyName: undefined,
      ownerName: "Max Member",
      email: "max@example.com",
      phone: undefined,
      password: "secret1",
    });
  });

  it("preselects join mode and prefills email from URL params", async () => {
    renderForm("/en/register?mode=join&email=invitee%40example.com");

    expect(screen.getByLabelText("Your name")).toBeInTheDocument();
    expect(screen.queryByLabelText("Company Name")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveValue("invitee@example.com");
  });
});
