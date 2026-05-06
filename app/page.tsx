

import { AppProvider, useApp } from "../src/lib/app-context"
import { LoginPage } from "@/components/auth/login-page"
import { RegisterPage } from "@/components/auth/register-page"
import { ForgotPasswordPage } from "@/components/auth/forgot-password-page"
import { AppLayout } from "../src/ui/AppLayout"
import { Dashboard } from "../src/features/dashboard/Dashboard"
import { Orders } from "../src/features/orders/Orders"
import { Clients } from "../src/features/clients/Clients"
import { Employees } from "../src/features/employees/Employees"
import { Inventory } from "../src/features/inventory/Inventory"
import { Services } from "../src/features/services/Services"
import { Invoices } from "../src/features/invoices/Invoices"
import { Finance } from "../src/features/finance/Finance"
import { ReportsModule } from "../src/features/reports/Reports"
import { SettingsModule } from "../src/features/settings/Settings"

function AppContent() {
  const { currentView, isAuthenticated } = useApp()

  // Auth views
  if (!isAuthenticated) {
    switch (currentView) {
      case "register":
        return <RegisterPage />
      case "forgot-password":
        return <ForgotPasswordPage />
      default:
        return <LoginPage />
    }
  }

  // Main app views
  const renderModule = () => {
    switch (currentView) {
      case "dashboard":
        return <Dashboard />
      case "orders":
        return <Orders />
      case "clients":
        return <Clients />
      case "employees":
        return <Employees />
      case "inventory":
        return <Inventory />
      case "services":
        return <Services />
      case "invoices":
        return <Invoices />
      case "finance":
        return <Finance />
      case "reports":
        return <ReportsModule />
      case "settings":
        return <SettingsModule />
      default:
        return <Dashboard />
    }
  }

  return <AppLayout>{renderModule()}</AppLayout>
}

export default function Page() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  )
}
