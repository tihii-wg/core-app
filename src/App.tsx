import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { Toaster } from "react-hot-toast";

import { Routes, Route, Navigate } from "react-router-dom";
import { AppProvider } from "./lib/appContext";
import { RegisterPage } from "./pages/RegisterPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";

import { PublicRoute } from "./ui/PublicRoute";
import ProtectedRoute from "./ui/ProtectedRoute";
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
import { AppLayout } from "./ui/AppLayout";
import Dashboardredirect from "./ui/DashboardRedirect";

export const DEFAULT_LOCALE = "en";

function AppRoutes() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/" element={<Navigate to={`/${DEFAULT_LOCALE}/login`} replace />} />

      <Route element={<PublicRoute />}>
        <Route path="/:locale/login" element={<LoginPage />} />
        <Route path="/:locale/register" element={<RegisterPage />} />
        <Route path="/:locale/forgot-password" element={<ForgotPasswordPage />} />
      </Route>

      {/* Protected routes */}
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/:locale/dashboard/" element={<Dashboardredirect />} />
          <Route path="/:locale/:workspaceId/dashboard" element={<Dashboard />} />
          <Route path="/:locale/:workspaceId/orders" element={<Orders />} />
          <Route path="/:locale/:workspaceId/clients" element={<Clients />} />
          <Route path="/:locale/:workspaceId/employees" element={<Employees />} />
          <Route path="/:locale/:workspaceId/inventory" element={<Inventory />} />
          <Route path="/:locale/:workspaceId/services" element={<Services />} />
          <Route path="/:locale/:workspaceId/invoices" element={<Invoices />} />
          <Route path="/:locale/:workspaceId/finance" element={<Finance />} />
          <Route path="/:locale/:workspaceId/reports" element={<ReportsModule />} />
          <Route path="/:locale/:workspaceId/settings" element={<SettingsModule />} />
        </Route>
      </Route>

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
        <Toaster />
      </AppProvider>
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
