import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Spinner } from "./Spinner";
import { useUser } from "../features/auth/useUser";
import { useSessionMfa } from "../features/auth/useMfa";
import { languageFromPath } from "../i18n/languages";
import FullPage from "./FullPage";
import { isConfirmedRecoveryForUser, urlIndicatesPasswordRecovery } from "../features/auth/passwordRecovery";

export function PublicRoute() {
  const location = useLocation();
  const language = languageFromPath(location.pathname);
  const { user, isAuthenticated, isLoadingSession, isReady } = useUser();
  const { needsMfa, isLoading: mfaLoading } = useSessionMfa(isAuthenticated);

  if (!isReady || isLoadingSession || (isAuthenticated && mfaLoading))
    return (
      <FullPage>
        <Spinner />
      </FullPage>
    );

  // Recovery must reach the reset page, not the dashboard/login bounce.
  if (isAuthenticated && isConfirmedRecoveryForUser(user?.id)) {
    return <Navigate to={`/${language}/reset-password`} replace />;
  }
  if (urlIndicatesPasswordRecovery(location.search, location.hash, location.pathname)) {
    return <Navigate to={`/${language}/reset-password${location.search}${location.hash}`} replace />;
  }

  if (isAuthenticated && !needsMfa) {
    return <Navigate to={`/${language}/dashboard`} replace />;
  }

  return <Outlet />;
}
