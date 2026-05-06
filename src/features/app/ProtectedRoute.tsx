import { Navigate, Outlet } from "react-router";
import { routes } from "../../lib/routes";
import { useAppContext } from "./useAppContext";

export default function ProtectedRoute() {
  const { status, session } = useAppContext();

  if (status === "loading") {
    return <div>Loading...</div>;
  }

  if (!session) {
    return <Navigate to={routes.login} replace />;
  }

  return <Outlet />;
}
