import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppProvider } from "./AppProvider";
import { useAppContext } from "./useAppContext";

function Probe() {
  const { status } = useAppContext();

  return <div>{status}</div>;
}

describe("AppProvider", () => {
  it("boots from loading to ready", async () => {
    render(
      <AppProvider>
        <Probe />
      </AppProvider>,
    );

    expect(screen.getByText("loading")).toBeInTheDocument();
    expect(await screen.findByText("ready")).toBeInTheDocument();
  });
});
