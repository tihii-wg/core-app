import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

type LayoutPreviewState = {
  /** When true, pages may render clearly labeled DEMO fixtures for layout review only. */
  showDemoLayoutPreview: boolean;
  setShowDemoLayoutPreview: (value: boolean) => void;
};

const LayoutPreviewContext = createContext<LayoutPreviewState | null>(null);

export function LayoutPreviewProvider({ children }: { children: ReactNode }) {
  const [showDemoLayoutPreview, setShowDemoLayoutPreview] = useState(false);
  const value = useMemo(
    () => ({ showDemoLayoutPreview, setShowDemoLayoutPreview }),
    [showDemoLayoutPreview],
  );
  return <LayoutPreviewContext.Provider value={value}>{children}</LayoutPreviewContext.Provider>;
}

export function useLayoutPreview() {
  const ctx = useContext(LayoutPreviewContext);
  if (!ctx) throw new Error("useLayoutPreview must be used within LayoutPreviewProvider");
  return ctx;
}
