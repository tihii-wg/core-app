import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./Tabs";

type ResizeObserverCallback = (entries: ResizeObserverEntry[], observer: ResizeObserver) => void;

let resizeCallback: ResizeObserverCallback | null = null;

function Harness({ initial = "one" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <Tabs value={value} onValueChange={setValue}>
      <TabsList data-testid="tabs-list">
        <TabsTrigger value="one">One</TabsTrigger>
        <TabsTrigger value="two">Two</TabsTrigger>
        <TabsTrigger value="three">Three</TabsTrigger>
      </TabsList>
      <TabsContent value="one">Panel one</TabsContent>
      <TabsContent value="two">Panel two</TabsContent>
      <TabsContent value="three">Panel three</TabsContent>
      <div data-testid="active-value">{value}</div>
    </Tabs>
  );
}

function mockListOverflow(list: HTMLElement, overflows: boolean, scrollLeft = 0) {
  Object.defineProperty(list, "clientWidth", { configurable: true, get: () => (overflows ? 100 : 400) });
  Object.defineProperty(list, "scrollWidth", { configurable: true, get: () => (overflows ? 400 : 400) });
  Object.defineProperty(list, "scrollLeft", {
    configurable: true,
    get: () => scrollLeft,
    set: (value: number) => {
      scrollLeft = value;
    },
  });
  act(() => {
    resizeCallback?.([] as unknown as ResizeObserverEntry[], {} as ResizeObserver);
  });
}

describe("TabsList mouse drag scroll", () => {
  beforeEach(() => {
    resizeCallback = null;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          resizeCallback = callback;
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("mouse drag changes scrollLeft and does not change the active tab", () => {
    render(<Harness initial="one" />);
    const list = screen.getByTestId("tabs-list");
    mockListOverflow(list, true, 0);

    fireEvent.pointerDown(list, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 100 });
    fireEvent.pointerMove(list, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 60 });
    fireEvent.pointerUp(list, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 60 });

    expect(list.scrollLeft).toBe(40);
    expect(screen.getByTestId("active-value")).toHaveTextContent("one");

    // Follow-up click after a drag must be suppressed.
    fireEvent.click(screen.getByRole("tab", { name: "Two" }));
    expect(screen.getByTestId("active-value")).toHaveTextContent("one");
  });

  it("a click without movement changes the tab", async () => {
    const user = userEvent.setup();
    render(<Harness initial="one" />);
    const list = screen.getByTestId("tabs-list");
    mockListOverflow(list, true, 0);

    await user.click(screen.getByRole("tab", { name: "Two" }));
    expect(screen.getByTestId("active-value")).toHaveTextContent("two");
  });

  it("does not drag when the list does not overflow", () => {
    render(<Harness initial="one" />);
    const list = screen.getByTestId("tabs-list");
    mockListOverflow(list, false, 0);

    fireEvent.pointerDown(list, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 100 });
    fireEvent.pointerMove(list, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 40 });
    fireEvent.pointerUp(list, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 40 });

    expect(list.scrollLeft).toBe(0);
  });

  it("ignores touch pointers", () => {
    render(<Harness initial="one" />);
    const list = screen.getByTestId("tabs-list");
    mockListOverflow(list, true, 0);

    fireEvent.pointerDown(list, { pointerId: 2, pointerType: "touch", button: 0, clientX: 100 });
    fireEvent.pointerMove(list, { pointerId: 2, pointerType: "touch", button: 0, clientX: 40 });
    fireEvent.pointerUp(list, { pointerId: 2, pointerType: "touch", button: 0, clientX: 40 });

    expect(list.scrollLeft).toBe(0);
  });
});
