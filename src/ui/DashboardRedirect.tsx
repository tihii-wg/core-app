import { useNavigate, useParams } from "react-router-dom";
import { useGetWorkspaces } from "../features/workspaces/useGetWorkspaces";
import { Spinner } from "./Spinner";
import { useEffect } from "react";

export default function Dashboardredirect() {
  const navigate = useNavigate();
  const { locale } = useParams();
  const { workspaces, isLoading } = useGetWorkspaces();

  const currentWorkspace = workspaces?.flatMap((w) => w.workspaces).find((w) => w.type === "current");

  useEffect(
    function () {
      if (!isLoading && currentWorkspace) navigate(`/${locale}/${currentWorkspace.id}/dashboard`);
    },
    [currentWorkspace, isLoading, locale, navigate]
  );

  return <Spinner />;
}
