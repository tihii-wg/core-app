import { afterEach, describe, expect, it, vi } from "vitest";
import { GCAL_VIEW_IDS } from "./calendarViewStorage";

/**
 * jsdom fallback for the Playwright viewport overflow check:
 * mount a minimal page shell + switcher markup at phone/desktop widths
 * and assert documentElement.scrollWidth <= innerWidth for each view.
 */
function mountShell(opts: { width: number; height: number; activeView: string; isMobile: boolean }) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: opts.width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: opts.height });

  document.body.innerHTML = "";
  const root = document.createElement("div");
  root.className = "gcal-page min-w-0 overflow-x-hidden";
  root.style.width = `${opts.width}px`;
  root.style.maxWidth = `${opts.width}px`;

  const switcher = document.createElement("div");
  switcher.className = "gcal-view-switcher flex gap-1 max-w-full overflow-x-auto";
  switcher.style.maxWidth = `${opts.width}px`;
  const views = opts.isMobile
    ? [...GCAL_VIEW_IDS]
    : GCAL_VIEW_IDS.filter((v) => v !== "timeGrid3Day");
  for (const view of views) {
    const btn = document.createElement("button");
    btn.textContent = view;
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", view === opts.activeView ? "true" : "false");
    btn.style.whiteSpace = "nowrap";
    switcher.appendChild(btn);
  }

  const cal = document.createElement("div");
  cal.className = "gcal-fullcalendar";
  cal.style.width = "100%";
  cal.style.maxWidth = "100%";
  cal.style.overflow = "hidden";
  cal.dataset.view = opts.activeView;
  cal.innerHTML = `<div class="fc" style="width:100%;max-width:100%"><div class="fc-view-harness" style="width:100%"></div></div>`;

  root.appendChild(switcher);
  root.appendChild(cal);
  document.body.appendChild(root);

  // Approximate document scrollWidth for overflow checks in jsdom.
  Object.defineProperty(document.documentElement, "scrollWidth", {
    configurable: true,
    get: () => Math.max(opts.width, root.scrollWidth || opts.width),
  });

  return { root, switcher };
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("calendar layout overflow (jsdom fallback)", () => {
  it("keeps phone 375×812 shells without horizontal page overflow for each view", () => {
    for (const view of GCAL_VIEW_IDS) {
      const { root, switcher } = mountShell({
        width: 375,
        height: 812,
        activeView: view,
        isMobile: true,
      });
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
      expect(root.clientWidth).toBeLessThanOrEqual(375);
      expect(switcher.querySelector(`[aria-selected="true"]`)?.textContent).toBe(view);
      expect(switcher.querySelectorAll('[role="tab"]')).toHaveLength(5);
      document.body.innerHTML = "";
    }
  });

  it("keeps desktop 1440×900 shells without overflow and hides 3-day option", () => {
    const desktopViews = GCAL_VIEW_IDS.filter((v) => v !== "timeGrid3Day");
    for (const view of desktopViews) {
      const { switcher } = mountShell({
        width: 1440,
        height: 900,
        activeView: view,
        isMobile: false,
      });
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
      expect(switcher.querySelectorAll('[role="tab"]')).toHaveLength(4);
      expect(switcher.querySelector(`[aria-selected="true"]`)?.textContent).toBe(view);
      document.body.innerHTML = "";
    }
  });
});
