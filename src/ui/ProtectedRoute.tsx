import { useUser } from "../features/auth/useUser";
import { useSessionMfa } from "../features/auth/useMfa";
import { Spinner } from "../ui/Spinner";
import { Navigate, Outlet } from "react-router-dom";
import { DEFAULT_LOCALE } from "../App";
import FullPage from "./FullPage";

export default function ProtectedRoute() {
  const { isAuthenticated, isLoadingSession } = useUser();
  const { needsMfa, isLoading: mfaLoading } = useSessionMfa(isAuthenticated);

  if (isLoadingSession || (isAuthenticated && mfaLoading))
    return (
      <FullPage>
        <Spinner className="size-15 text-primary " />
      </FullPage>
    );

  if (!isAuthenticated || needsMfa) {
    return <Navigate to={`/${DEFAULT_LOCALE}/login`} replace />;
  }

  return <Outlet />;
}
