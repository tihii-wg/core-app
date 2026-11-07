import { useEffect, useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConfirmProvider, useConfirm } from "./ConfirmProvider";

function Probe({
  onResult,
  autoOpen,
}: {
  onResult: (value: boolean) => void;
  autoOpen?: "one" | "two";
}) {
  const confirm = useConfirm();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!autoOpen) return;
    void (async () => {
      if (autoOpen === "one") {
        onResult(await confirm({ title: "First", confirmLabel: "OK" }));
        setReady(true);
        return;
      }
      const first = confirm({ title: "First", confirmLabel: "OK-1" });
      const second = confirm({ title: "Second", confirmLabel: "OK-2" });
      onResult(await first);
      onResult(await second);
      setReady(true);
    })();
  }, [autoOpen, confirm, onResult]);

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          void confirm({ title: "Manual", description: "Go?", confirmLabel: "Proceed", tone: "destructive" }).then(onResult);
        }}
      >
        Ask
      </button>
      {ready ? <span>done</span> : null}
    </div>
  );
}

describe("useConfirm", () => {
  it("resolves true on confirm and false on cancel", async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    render(
      <ConfirmProvider>
        <Probe onResult={onResult} />
      </ConfirmProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Ask" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Proceed" }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));

    onResult.mockClear();
    await user.click(screen.getByRole("button", { name: "Ask" }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
  });

  it("resolves false on Escape", async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    render(
      <ConfirmProvider>
        <Probe onResult={onResult} />
      </ConfirmProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Ask" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
  });

  it("queues concurrent requests one at a time", async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    render(
      <ConfirmProvider>
        <Probe onResult={onResult} autoOpen="two" />
      </ConfirmProvider>,
    );

    expect(await screen.findByText("First")).toBeInTheDocument();
    expect(screen.queryByText("Second")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "OK-1" }));
    expect(await screen.findByText("Second")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "OK-2" }));
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(2));
    expect(onResult).toHaveBeenNthCalledWith(1, true);
    expect(onResult).toHaveBeenNthCalledWith(2, true);
  });

  it("resolves false on unmount", async () => {
    const onResult = vi.fn();
    const { unmount } = render(
      <ConfirmProvider>
        <Probe onResult={onResult} autoOpen="one" />
      </ConfirmProvider>,
    );

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    unmount();
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
  });
});
