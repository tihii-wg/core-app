import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";

import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { AppProvider, useApp } from "./lib/appContext";
import { RegisterPage } from "./features/auth/RegisterPage";
import { ForgotPasswordPage } from "./features/auth/ForgotPasswordPage";
import { AppLayout } from "../src/ui/AppLayout";

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
import { FogotPasword } from "./services/apiAuth";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { auth } = useApp();

  if (!auth.isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <AppLayout>{children}</AppLayout>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { auth } = useApp();

  if (auth.isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

function AppRoutes() {
  const navigate = useNavigate();

  function onSwitchToForgotPassword() {
    FogotPasword();
    navigate("/forgot-password");
  }

  function onSwitchToLogin() {
    navigate("/login");
  }

  function onSwitchToRegister() {
    navigate("/register");
  }

  return (
    <Routes>
      {/* Public routes */}
      <Route
        path="/login"
        element={
          <PublicRoute>
            <LoginPage onSwitchToForgotPassword={onSwitchToForgotPassword} onSwitchToRegister={onSwitchToRegister} />
          </PublicRoute>
        }
      />
      <Route
        path="/register"
        element={
          <PublicRoute>
            <RegisterPage onSwitchToLogin={onSwitchToLogin} />
          </PublicRoute>
        }
      />
      <Route
        path="/forgot-password"
        element={
          <PublicRoute>
            <ForgotPasswordPage onSwitchToLogin={onSwitchToLogin} />
          </PublicRoute>
        }
      />

      {/* Protected routes */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/orders"
        element={
          <ProtectedRoute>
            <Orders />
          </ProtectedRoute>
        }
      />
      <Route
        path="/clients"
        element={
          <ProtectedRoute>
            <Clients />
          </ProtectedRoute>
        }
      />
      <Route
        path="/employees"
        element={
          <ProtectedRoute>
            <Employees />
          </ProtectedRoute>
        }
      />
      <Route
        path="/inventory"
        element={
          <ProtectedRoute>
            <Inventory />
          </ProtectedRoute>
        }
      />
      <Route
        path="/services"
        element={
          <ProtectedRoute>
            <Services />
          </ProtectedRoute>
        }
      />
      <Route
        path="/invoices"
        element={
          <ProtectedRoute>
            <Invoices />
          </ProtectedRoute>
        }
      />
      <Route
        path="/finance"
        element={
          <ProtectedRoute>
            <Finance />
          </ProtectedRoute>
        }
      />
      <Route
        path="/reports"
        element={
          <ProtectedRoute>
            <ReportsModule />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedRoute>
            <SettingsModule />
          </ProtectedRoute>
        }
      />

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
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
