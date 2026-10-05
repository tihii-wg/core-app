import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Spinner } from "./Spinner";
import { useUser } from "../features/auth/useUser";
import { useSessionMfa } from "../features/auth/useMfa";
import { languageFromPath } from "../i18n/languages";
import FullPage from "./FullPage";

export function PublicRoute() {
  const language = languageFromPath(useLocation().pathname);
  const { isAuthenticated, isLoadingSession, isReady } = useUser();
  const { needsMfa, isLoading: mfaLoading } = useSessionMfa(isAuthenticated);

  if (!isReady || isLoadingSession || (isAuthenticated && mfaLoading))
    return (
      <FullPage>
        <Spinner />
      </FullPage>
    );

  if (isAuthenticated && !needsMfa) {
    return <Navigate to={`/${language}/dashboard`} replace />;
  }

  return <Outlet />;
}
