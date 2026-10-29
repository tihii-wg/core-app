import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "../../tests/renderQuery";
import AddNewClientForm from "./AddNewClienForm";

const createClientMock = vi.hoisted(() => vi.fn());
const createVehicleMock = vi.hoisted(() => vi.fn());
const industrySlug = vi.hoisted(() => ({ current: "auto_repair" as string | null }));

vi.mock("./useCreateNewClient", () => ({
  useCreateNewClient: () => ({
    mutateAsync: createClientMock,
  }),
}));

vi.mock("../../services/apiVehicles", async () => {
  const actual = await vi.importActual<typeof import("../../services/apiVehicles")>("../../services/apiVehicles");
  return {
    ...actual,
    createVehicle: (...args: unknown[]) => createVehicleMock(...args),
  };
});

vi.mock("../profiles/useGetProfile", () => ({
  useActiveWorkspaceId: () => ({ workspaceId: "ws-1", isLoading: false, error: null }),
}));

vi.mock("../workspaces/useGetWorkspace", () => ({
  useGetWorkspace: () => ({
    data: { defaultPhoneConsent: false, defaultEmailConsent: false, showClientMiddleName: false },
  }),
}));

vi.mock("../workspaces/useWorkspaceSubscription", () => ({
  useGuardSubscriptionWrite: () => () => {},
  useWorkspaceSubscription: () => ({ canWrite: true }),
}));

vi.mock("../industries/useIndustryWorkflow", async () => {
  const { industryWorkflow, industryOrderCopy } = await import("../industries/industryWorkflow");
  return {
    useIndustryWorkflow: () => {
      const workflow = industryWorkflow(industrySlug.current);
      return { workflow, copy: industryOrderCopy(workflow), industrySlug: industrySlug.current, industryId: null, isLoading: false, error: null };
    },
  };
});

describe("AddNewClientForm optional vehicle", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    createVehicleMock.mockReset();
    createClientMock.mockResolvedValue([{ id: "client-1", name: "Ada" }]);
    createVehicleMock.mockResolvedValue({ id: "veh-1" });
    industrySlug.current = "auto_repair";
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.scrollIntoView = () => {};
  });

  it("hides vehicle fields by default and creates a client without a vehicle", async () => {
    const user = userEvent.setup();
    const setCreateModalOpen = vi.fn();
    renderWithQuery(<AddNewClientForm setCreateModalOpen={setCreateModalOpen} />);

    expect(screen.getByLabelText("Add a vehicle")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Make$/)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(/^Full name/i), "Ada Lovelace");
    await user.type(screen.getByLabelText(/^Email \*$/), "ada@example.com");
    await user.type(screen.getByLabelText(/^Phone \*$/), "+37369123456");
    await user.click(screen.getByRole("button", { name: /Add Client/i }));

    await vi.waitFor(() => expect(createClientMock).toHaveBeenCalledTimes(1));
    expect(createVehicleMock).not.toHaveBeenCalled();
    expect(setCreateModalOpen).toHaveBeenCalledWith(false);
  });

  it("creates a vehicle when the toggle is enabled", async () => {
    const user = userEvent.setup();
    renderWithQuery(<AddNewClientForm setCreateModalOpen={() => {}} />);

    await user.click(screen.getByLabelText("Add a vehicle"));
    expect(screen.getByLabelText(/^Make$/)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/^Full name/i), "Ada Lovelace");
    await user.type(screen.getByLabelText(/^Email \*$/), "ada@example.com");
    await user.type(screen.getByLabelText(/^Phone \*$/), "+37369123456");
    await user.type(screen.getByLabelText(/^Make$/), "Toyota");
    await user.type(screen.getByLabelText(/^VIN$/), "1HGBH41JXMN109186");
    await user.click(screen.getByRole("button", { name: /Add Client/i }));

    await vi.waitFor(() => expect(createVehicleMock).toHaveBeenCalledTimes(1));
    expect(createVehicleMock).toHaveBeenCalledWith(
      "ws-1",
      "client-1",
      expect.objectContaining({
        make: "Toyota",
        vin: "1HGBH41JXMN109186",
      }),
    );
  });

  it("does not show the vehicle toggle for non-automotive industries", () => {
    industrySlug.current = "home_services";
    renderWithQuery(<AddNewClientForm setCreateModalOpen={() => {}} />);
    expect(screen.queryByLabelText("Add a vehicle")).not.toBeInTheDocument();
  });

  it("blocks submit when the optional VIN is invalid", async () => {
    const user = userEvent.setup();
    renderWithQuery(<AddNewClientForm setCreateModalOpen={() => {}} />);

    await user.click(screen.getByLabelText("Add a vehicle"));
    await user.type(screen.getByLabelText(/^Full name/i), "Ada Lovelace");
    await user.type(screen.getByLabelText(/^Email \*$/), "ada@example.com");
    await user.type(screen.getByLabelText(/^Phone \*$/), "+37369123456");
    await user.type(screen.getByLabelText(/^VIN$/), "ABC123");
    await user.click(screen.getByRole("button", { name: /Add Client/i }));

    expect(await screen.findByText(/VIN must contain exactly 17 valid characters/i)).toBeInTheDocument();
    expect(createClientMock).not.toHaveBeenCalled();
    expect(createVehicleMock).not.toHaveBeenCalled();
  });
});
