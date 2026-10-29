import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/auth/AuthProvider";
import { RequireAuth } from "@/auth/RequireAuth";
import { AdminShell } from "@/components/AdminShell";
import { I18nProvider } from "@/i18n/I18nProvider";
import { LoginPage } from "@/pages/LoginPage";
import { OverviewPage } from "@/pages/OverviewPage";
import { SecurityPage } from "@/pages/SecurityPage";
import { SubscriptionsPage } from "@/pages/SubscriptionsPage";
import { WorkspaceDetailPage } from "@/pages/WorkspaceDetailPage";
import { WorkspacesPage } from "@/pages/WorkspacesPage";
import { LayoutPreviewProvider } from "@/state/LayoutPreviewContext";
import { ThemeProvider } from "@/theme/ThemeProvider";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <I18nProvider>
          <AuthProvider>
            <LayoutPreviewProvider>
              <BrowserRouter>
                <Routes>
                  <Route path="/login" element={<LoginPage />} />
                  <Route element={<RequireAuth />}>
                    <Route element={<AdminShell />}>
                      <Route index element={<OverviewPage />} />
                      <Route path="workspaces" element={<WorkspacesPage />} />
                      <Route path="workspaces/:workspaceId" element={<WorkspaceDetailPage />} />
                      <Route path="subscriptions" element={<SubscriptionsPage />} />
                      <Route path="security" element={<SecurityPage />} />
                    </Route>
                  </Route>
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </BrowserRouter>
            </LayoutPreviewProvider>
          </AuthProvider>
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
