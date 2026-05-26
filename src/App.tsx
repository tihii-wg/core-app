import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";

import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { AppProvider } from "./lib/appContext";
import { RegisterPage } from "./pages/RegisterPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
// import { AppLayout } from "../src/ui/AppLayout";

import { LoginPage } from "./pages/LoginPage";
import Dashboard from "./pages/Dashboard";
import { Orders } from "./features/orders/Orders";
import { Clients } from "./features/clients/Clients";
import { Employees } from "./features/employees/Employees";
import { Inventory } from "./features/inventory/Inventory";
import { Services } from "./features/services/Services";
import { Invoices } from "./features/invoices/Invoices";
import { Finance } from "./features/finance/Finance";
import { ReportsModule } from "./features/reports/Reports";
import { SettingsModule } from "./features/settings/Settings";
import { useUser } from "./features/auth/useUser";
import ProtectedRoute from "./app/ProtectedRoute";

export const DEFAULT_LOCALE = "en";

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useUser();

  if (!isAuthenticated) <Navigate to={`/${DEFAULT_LOCALE}/dashboard`} replace />;

  return <>{children}</>;
}

function AppRoutes() {
  const navigate = useNavigate();

  function onSwitchToForgotPassword() {
    // FogotPasword();
    navigate(`/${DEFAULT_LOCALE}/forgot-password`);
  }

  function onSwitchToLogin() {
    navigate(`/${DEFAULT_LOCALE}/login`);
  }

  function onSwitchToRegister() {
    navigate(`/${DEFAULT_LOCALE}/register`);
  }

  return (
    <Routes>
      {/* Public routes */}
      <Route
        path="/:locale/login"
        element={
          <PublicRoute>
            <LoginPage onSwitchToForgotPassword={onSwitchToForgotPassword} onSwitchToRegister={onSwitchToRegister} />
          </PublicRoute>
        }
      />
      <Route
        path="/:locale/register"
        element={
          <PublicRoute>
            <RegisterPage onSwitchToLogin={onSwitchToLogin} />
          </PublicRoute>
        }
      />
      <Route
        path="/:locale/forgot-password"
        element={
          <PublicRoute>
            <ForgotPasswordPage onSwitchToLogin={onSwitchToLogin} />
          </PublicRoute>
        }
      />

      {/* Protected routes */}

      <Route
        path="/:locale/dashboard"
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/:locale/workspaces/:workspaceId/orders"
        element={
          <ProtectedRoute>
            <Orders />
          </ProtectedRoute>
        }
      />
      <Route
        path="/:locale/workspaces/:workspaceId/clients"
        element={
          <ProtectedRoute>
            <Clients />
          </ProtectedRoute>
        }
      />
      <Route
        path="/:locale/workspaces/:workspaceId/employees"
        element={
          <ProtectedRoute>
            <Employees />
          </ProtectedRoute>
        }
      />
      <Route
        path="/:locale/workspaces/:workspaceId/inventory"
        element={
          <ProtectedRoute>
            <Inventory />
          </ProtectedRoute>
        }
      />
      <Route
        path="/:locale/workspaces/:workspaceId/services"
        element={
          <ProtectedRoute>
            <Services />
          </ProtectedRoute>
        }
      />
      <Route
        path="/:locale/workspaces/:workspaceId/invoices"
        element={
          <ProtectedRoute>
            <Invoices />
          </ProtectedRoute>
        }
      />
      <Route
        path="/:locale/workspaces/:workspaceId/finance"
        element={
          <ProtectedRoute>
            <Finance />
          </ProtectedRoute>
        }
      />
      <Route
        path="/:locale/workspaces/:workspaceId/reports"
        element={
          <ProtectedRoute>
            <ReportsModule />
          </ProtectedRoute>
        }
      />
      <Route
        path="/:locale/workspaces/:workspaceId/settings"
        element={
          <ProtectedRoute>
            <SettingsModule />
          </ProtectedRoute>
        }
      />

      {/* Fallback */}
      <Route path="*" element={<Navigate to={`/${DEFAULT_LOCALE}/login`} replace />} />
    </Routes>
  );
}

const queryClient = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppProvider>
        <AppRoutes />
      </AppProvider>
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
