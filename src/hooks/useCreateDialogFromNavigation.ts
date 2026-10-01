import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

type CreateDialogState = { openCreateDialog: true };

export const openCreateDialogState: CreateDialogState = { openCreateDialog: true };

function requestsCreateDialog(state: unknown) {
  return typeof state === "object" && state !== null && (state as Partial<CreateDialogState>).openCreateDialog === true;
}

// Open state of a page's own create dialog. It starts open when the page was reached with
// openCreateDialogState (Dashboard quick actions); the request is then cleared from history so a
// refresh or Back does not reopen it.
export function useCreateDialogFromNavigation() {
  const location = useLocation();
  const navigate = useNavigate();
  const requested = requestsCreateDialog(location.state);
  const dialog = useState(requested);

  useEffect(() => {
    if (!requested) return;
    navigate({ pathname: location.pathname, search: location.search, hash: location.hash }, { replace: true, state: null });
  }, [requested, navigate, location.pathname, location.search, location.hash]);

  return dialog;
}
