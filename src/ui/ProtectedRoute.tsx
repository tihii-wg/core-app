import { useUser } from "../features/auth/useUser";
import { Spinner } from "../ui/Spinner";
import { Navigate, Outlet } from "react-router-dom";
import { DEFAULT_LOCALE } from "../App";
import FullPage from "./FullPage";

export default function ProtectedRoute() {
  const { isAuthenticated, isLoadingSession } = useUser();

  if (isLoadingSession)
    return (
      <FullPage>
        <Spinner className="size-15 text-[#1973e1] " />
      </FullPage>
    );

  if (!isAuthenticated) {
    return <Navigate to={`/${DEFAULT_LOCALE}/login`} replace />;
  }

  return <Outlet />;
}
