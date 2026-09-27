import { Navigate, Outlet } from "react-router-dom";
import { DEFAULT_LOCALE } from "../App";
import { Spinner } from "./Spinner";
import { useUser } from "../features/auth/useUser";
import { useSessionMfa } from "../features/auth/useMfa";
import FullPage from "./FullPage";

export function PublicRoute() {
  const { isAuthenticated, isLoadingSession, isReady } = useUser();
  const { needsMfa, isLoading: mfaLoading } = useSessionMfa(isAuthenticated);

  if (!isReady || isLoadingSession || (isAuthenticated && mfaLoading))
    return (
      <FullPage>
        <Spinner />
      </FullPage>
    );

  if (isAuthenticated && !needsMfa) {
    return <Navigate to={`/${DEFAULT_LOCALE}/dashboard`} replace />;
  }

  return <Outlet />;
}
