import { Navigate, Outlet } from "react-router-dom";
import { DEFAULT_LOCALE } from "../App";
import { Spinner } from "./Spinner";
import { useUser } from "../features/auth/useUser";

export function PublicRoute() {
  const { isAuthenticated, isLoadingSession, isReady } = useUser();

  if (!isReady || isLoadingSession) return <Spinner />;

  if (isAuthenticated) {
    return <Navigate to={`/${DEFAULT_LOCALE}/dashboard`} replace />;
  }

  return <Outlet />;
}
