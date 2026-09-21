// import { useNavigate, useParams } from "react-router-dom";
// // import { useGetWorkspaces } from "../features/workspaces/useGetWorkspaces";
// import { Spinner } from "./Spinner";
// import { useEffect } from "react";
// import { useGetProfiles } from "../features/profiles/useGetProfiles";

// export default function Dashboardredirect() {
//   const navigate = useNavigate();
//   const { locale } = useParams();
//   const { data: profile, isLoading } = useGetProfiles();

//   useEffect(
//     function () {
//       if (!isLoading && profile) navigate(`/${locale}/${profile.at(0).active_workspace_id}/dashboard`);
//     },
//     [isLoading, locale, navigate, profile]
//   );

//   return <Spinner />;
// }
import { useNavigate, useParams } from "react-router-dom";
import { Spinner } from "./Spinner";
import { useEffect } from "react";
import { useGetProfiles } from "../features/profiles/useGetProfiles";

export default function Dashboardredirect() {
  const navigate = useNavigate();
  const { locale } = useParams();
  const { data: profile, isLoading } = useGetProfiles();

  useEffect(() => {
    if (isLoading) return;

    const currentProfile = profile?.at(0);

    if (!currentProfile) return;

    if (!currentProfile.active_workspace_id) return;

    navigate(
      `/${locale}/${currentProfile.active_workspace_id}/dashboard`
    );
  }, [isLoading, locale, navigate, profile]);

  return <Spinner />;
}