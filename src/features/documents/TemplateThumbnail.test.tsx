import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultWorkOrderLayout } from "./defaultLayouts";
import { TemplateThumbnail } from "./TemplateThumbnail";
import { clearTemplatePreviewHtmlCache } from "./templatePreviewHtml";
import type { DocumentTemplate } from "../../services/apiDocumentTemplates";

const observe = vi.fn();
const disconnect = vi.fn();
let observerCallback: IntersectionObserverCallback | null = null;

beforeEach(() => {
  clearTemplatePreviewHtmlCache();
  observerCallback = null;
  observe.mockReset();
  disconnect.mockReset();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(cb: IntersectionObserverCallback) {
        observerCallback = cb;
      }
      observe = observe;
      unobserve = vi.fn();
      disconnect = disconnect;
      takeRecords = () => [];
      root = null;
      rootMargin = "";
      thresholds = [];
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const template: DocumentTemplate = {
  id: "t1",
  workspaceId: "ws-1",
  name: "WO",
  documentType: "work_order",
  widthMm: null,
  heightMm: null,
  showCents: true,
  isAvailableToAll: true,
  isActive: true,
  isDefault: true,
  layout: defaultWorkOrderLayout(),
  style: null,
  bodyHtml: "",
};

describe("TemplateThumbnail", () => {
  it("renders lazily only after becoming visible", async () => {
    render(
      <TemplateThumbnail template={template} locale="en" currency="MDL" vatRate={20} />,
    );

    expect(observe).toHaveBeenCalled();
    expect(screen.queryByTitle("Template preview")).not.toBeInTheDocument();

    act(() => {
      observerCallback?.(
        [
          {
            isIntersecting: true,
            target: document.createElement("div"),
          } as unknown as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver,
      );
    });

    await waitFor(() => {
      expect(screen.getByTitle("Template preview")).toBeInTheDocument();
    });
    expect(disconnect).toHaveBeenCalled();
  });
});
