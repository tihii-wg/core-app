import { useUser } from "../features/auth/useUser";
import { useSessionMfa } from "../features/auth/useMfa";
import { Spinner } from "../ui/Spinner";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { languageFromPath } from "../i18n/languages";
import FullPage from "./FullPage";

export default function ProtectedRoute() {
  const language = languageFromPath(useLocation().pathname);
  const { isAuthenticated, isLoadingSession } = useUser();
  const { needsMfa, isLoading: mfaLoading } = useSessionMfa(isAuthenticated);

  if (isLoadingSession || (isAuthenticated && mfaLoading))
    return (
      <FullPage>
        <Spinner className="size-15 text-primary " />
      </FullPage>
    );

  if (!isAuthenticated || needsMfa) {
    return <Navigate to={`/${language}/login`} replace />;
  }

  return <Outlet />;
}
