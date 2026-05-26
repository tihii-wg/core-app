import { useUser } from "../features/auth/useUser";
import { Spinner } from "../ui/Spinner";
import { useEffect } from "react";
import { AppLayout } from "../ui/AppLayout";
import { useNavigate } from "react-router-dom";
import { DEFAULT_LOCALE } from "../App";

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useUser();
  const navigate = useNavigate();

  useEffect(
    function () {
      if (!isAuthenticated && isLoading) navigate(`/${DEFAULT_LOCALE}/login`, { replace: true });
    },
    [isAuthenticated, isLoading, navigate]
  );

  if (isLoading) return <Spinner />;
  if (!isAuthenticated) return null;

  if (isAuthenticated) return <AppLayout>{children}</AppLayout>;
}
