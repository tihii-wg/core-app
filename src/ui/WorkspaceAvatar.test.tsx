import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceAvatar } from "./WorkspaceAvatar";

// jsdom never loads images; this stand-in reports every image with a src as loaded, like a browser
// does once the signed URL has been fetched.
class LoadedImage extends EventTarget {
  complete = true;
  naturalWidth = 512;
  src = "";
  referrerPolicy = "";
  crossOrigin: string | null = null;
}

beforeEach(() => {
  vi.stubGlobal("Image", LoadedImage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WorkspaceAvatar", () => {
  it("shows the logo while there is one and the initials as soon as it is removed", () => {
    const { rerender } = render(<WorkspaceAvatar name="Alpha Garage" imageUrl="https://storage.test/workspace/a/logo.webp?token=1" />);
    expect(screen.getByRole("img", { name: "Alpha Garage logo" })).toBeInTheDocument();
    expect(screen.queryByText("AG")).not.toBeInTheDocument();

    rerender(<WorkspaceAvatar name="Alpha Garage" imageUrl={null} />);
    expect(screen.queryByRole("img", { name: "Alpha Garage logo" })).not.toBeInTheDocument();
    expect(screen.getByText("AG")).toBeInTheDocument();

    rerender(<WorkspaceAvatar name="Alpha Garage" imageUrl="https://storage.test/workspace/a/logo.webp?token=2" />);
    expect(screen.getByRole("img", { name: "Alpha Garage logo" })).toHaveAttribute("src", "https://storage.test/workspace/a/logo.webp?token=2");
    expect(screen.queryByText("AG")).not.toBeInTheDocument();
  });

  it("shows the initials when the workspace has no logo", () => {
    render(<WorkspaceAvatar name="Alpha Garage" imageUrl={undefined} />);
    expect(screen.getByText("AG")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
