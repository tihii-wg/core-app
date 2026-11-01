import "@fontsource-variable/inter";
import "./styles/globals.css";
import "./i18n";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { BrowserRouter } from "react-router-dom";
import { AppProvider } from "./app/AppProvider";
import { ensurePasswordRecoveryCallbackPath } from "./features/auth/passwordRecovery";

// Before React Router can rewrite `/` → `/en/login`, keep recovery callbacks on the reset route
// so Supabase can parse hash/query tokens (Site URL fallback often lands on the origin root).
ensurePasswordRecoveryCallbackPath();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AppProvider>
        <App />
      </AppProvider>
    </BrowserRouter>
  </StrictMode>
);
