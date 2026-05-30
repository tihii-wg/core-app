import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";

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

export const DEFAULT_LOCALE = "en";

function AppRoutes() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/" element={<Navigate to={`/${DEFAULT_LOCALE}/login`} replace />} />

      <Route element={<PublicRoute />}>
        <Route path="/:locale/login" element={<LoginPage />} />
      </Route>

      <Route element={<PublicRoute />}>
        <Route path="/:locale/register" element={<RegisterPage />} />
      </Route>

      <Route element={<PublicRoute />}>
        <Route path="/:locale/forgot-password" element={<ForgotPasswordPage />} />
      </Route>

      {/* Protected routes */}
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/:locale/dashboard" element={<Dashboard />} />
          <Route path="/:locale/orders" element={<Orders />} />
          <Route path="/:locale/clients" element={<Clients />} />
          <Route path="/:locale/employees" element={<Employees />} />
          <Route path="/:locale/inventory" element={<Inventory />} />
          <Route path="/:locale/services" element={<Services />} />
          <Route path="/:locale/invoices" element={<Invoices />} />
          <Route path="/:locale/finance" element={<Finance />} />
          <Route path="/:locale/reports" element={<ReportsModule />} />
          <Route path="/:locale/settings" element={<SettingsModule />} />
        </Route>
      </Route>

      {/* <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/:locale/orders" element={<Orders />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/:locale/clients" element={<Clients />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/:locale/employees" element={<Employees />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/:locale/inventory" element={<Inventory />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/:locale/services" element={<Services />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/:locale/invoices" element={<Invoices />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/:locale/finance" element={<Finance />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/:locale/reports" element={<ReportsModule />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/:locale/settings" element={<SettingsModule />} />
        </Route>
      </Route> */}

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
