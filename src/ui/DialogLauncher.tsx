import { useImperativeHandle, useState, type ReactNode, type Ref } from "react";

export type DialogLauncherHandle<Payload = undefined> = {
  open: (payload?: Payload) => void;
};

type DialogLauncherProps<Payload> = {
  ref?: Ref<DialogLauncherHandle<Payload>>;
  children: (state: { open: boolean; setOpen: (open: boolean) => void; payload: Payload | undefined }) => ReactNode;
};

/**
 * Owns the open/closed state of one dialog, so opening or closing it re-renders only the dialog —
 * not the whole page around it (a page re-render redrew every row of its list: a visible lag on
 * "Create order", "Add client", "Add part"… on slower PCs). Buttons open it through the ref:
 * `launcherRef.current?.open()`, which does not re-render the page either.
 */
export function DialogLauncher<Payload = undefined>({ ref, children }: DialogLauncherProps<Payload>) {
  const [state, setState] = useState<{ open: boolean; payload: Payload | undefined }>({ open: false, payload: undefined });
  useImperativeHandle(ref, () => ({ open: (payload?: Payload) => setState({ open: true, payload }) }), []);
  return children({
    open: state.open,
    payload: state.payload,
    setOpen: (open) => setState((current) => (current.open === open ? current : { ...current, open })),
  });
}
