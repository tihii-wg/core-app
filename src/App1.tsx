// import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
// import "./styles/global.css";
// import Login from "./pages/LoginPage";
// import Dashboard from "./pages/Dashboard";
// import PageNotFound from "./pages/PageNotFound";
// import Welcome from "./pages/Welcome";
// import ProtectedRoute from "./features/app/ProtectedRoute";
// import { useAppContext } from "./features/app/useAppContext";

// function HomeRedirect() {
//   const { status, session, company, onboardingState } = useAppContext();

//   if (status === "loading") {
//     return <div>Loading...</div>;
//   }

//   if (!session) {
//     return <Navigate to="/login" replace />;
//   }

//   return (
//     <Navigate to={getAuthenticatedLanding(company, onboardingState)} replace />
//   );
// }

// function App() {
//   return (
//     <BrowserRouter>
//       <Routes>
//         <Route path="/" element={<HomeRedirect />} />
//         <Route path="/login" element={<Login />} />
//         {/* <Route path={routes.register} element={<Login />} />
//         <Route path={routes.forgotPassword} element={<Login />} /> */}
//         <Route element={<ProtectedRoute />}>
//           <Route path={routes.onboarding} element={<Welcome />} />
//           <Route path={routes.dashboard} element={<Dashboard />} />
//         </Route>
//         <Route path="*" element={<PageNotFound />} />
//       </Routes>
//     </BrowserRouter>
//   );
// }

// export default App;
