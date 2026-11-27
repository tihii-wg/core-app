import { useUser } from "../features/auth/useUser";
import { useSessionMfa } from "../features/auth/useMfa";
import { AppBootSpinner } from "./AppBootSpinner";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { languageFromPath } from "../i18n/languages";

export default function ProtectedRoute() {
  const language = languageFromPath(useLocation().pathname);
  const { isAuthenticated, isLoadingSession } = useUser();
  const { needsMfa, isLoading: mfaLoading } = useSessionMfa(isAuthenticated);

  if (isLoadingSession || (isAuthenticated && mfaLoading))
    return <AppBootSpinner />;

  if (!isAuthenticated || needsMfa) {
    return <Navigate to={`/${language}/login`} replace />;
  }

  return <Outlet />;
}
