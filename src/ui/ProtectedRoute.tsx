import { useUser } from "../features/auth/useUser";
import { Spinner } from "../ui/Spinner";
import { Navigate, Outlet } from "react-router-dom";
import { DEFAULT_LOCALE } from "../App";

export default function ProtectedRoute() {
  const { isAuthenticated, isLoadingSession } = useUser();

  if (isLoadingSession) return <Spinner />;

  if (!isAuthenticated) {
    return <Navigate to={`/${DEFAULT_LOCALE}/login`} replace />;
  }

  return <Outlet />;
}
