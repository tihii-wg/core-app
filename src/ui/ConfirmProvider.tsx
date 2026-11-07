import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog, type ConfirmDialogIcon, type ConfirmDialogTone } from "./ConfirmDialog";

export type ConfirmOptions = {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmDialogTone;
  icon?: ConfirmDialogIcon;
};

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

type QueueItem = {
  options: ConfirmOptions;
  resolve: (value: boolean) => void;
};

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const queueRef = useRef<QueueItem[]>([]);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  useEffect(() => {
    return () => {
      for (const item of queueRef.current) {
        item.resolve(false);
      }
      queueRef.current = [];
    };
  }, []);

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      setQueue((previous) => [...previous, { options, resolve }]);
    });
  }, []);

  const settle = useCallback((value: boolean) => {
    setQueue((previous) => {
      const [head, ...rest] = previous;
      head?.resolve(value);
      return rest;
    });
  }, []);

  const current = queue[0] ?? null;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {current ? (
        <ConfirmDialog
          open
          title={current.options.title}
          description={current.options.description}
          confirmLabel={current.options.confirmLabel}
          cancelLabel={current.options.cancelLabel}
          tone={current.options.tone}
          icon={current.options.icon}
          onConfirm={() => settle(true)}
          onCancel={() => settle(false)}
        />
      ) : null}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext);
  if (!confirm) {
    throw new Error("useConfirm must be used within ConfirmProvider");
  }
  return confirm;
}

/** Standard “leave without saving?” prompt. Resolves true when the user discards. */
export function useUnsavedChangesConfirm(): () => Promise<boolean> {
  const confirm = useConfirm();
  const { t } = useTranslation();
  return useCallback(
    () =>
      confirm({
        title: t("common.unsavedTitle"),
        description: t("common.unsavedDescription"),
        confirmLabel: t("common.discardChanges"),
        tone: "destructive",
        icon: "warning",
      }),
    [confirm, t],
  );
}
