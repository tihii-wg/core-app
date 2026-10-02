import { Globe } from "lucide-react";

import LoginForm from "../features/auth/LoginForm";
import Logo from "../ui/Logo";
import { DEFAULT_LOCALE } from "../App";
import { useNavigate } from "react-router-dom";


export function LoginPage() {
  const navigate = useNavigate();

  function onSwitchToRegister() {
    navigate(`/${DEFAULT_LOCALE}/register`);
  }

  function onSwitchToForgotPassword() {
    // FogotPasword();
    navigate(`/${DEFAULT_LOCALE}/forgot-password`);
  }

  return (
    <div className="min-h-dvh bg-background flex flex-col">
      {/* Language selector */}
      <div className="flex justify-end p-4">
        <button className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <Globe className="h-4 w-4" />
          English
        </button>
      </div>

      {/* Login form */}
      <div className="flex-1 flex items-center justify-center px-4 pb-16">
        <div className="w-full max-w-sm">
          {/* Logo */}
          <div className="text-center mb-8">
            <Logo />
            <p className="text-sm text-muted-foreground">Business Management Platform</p>
          </div>

          {/* Form */}
          <div className="bg-card rounded-xl border border-border p-6 shadow-sm">

            
            <LoginForm />

            <div className="mt-4 text-center">
              <button type="button" onClick={onSwitchToForgotPassword} className="text-sm cursor-pointer text-primary hover:underline">
                Forgot password?
              </button>
            </div>
          </div>

          {/* Register link */}
          <div className="mt-4 text-center">
            <span className="text-sm text-muted-foreground">Don&apos;t have an account? </span>
            <button type="button" onClick={onSwitchToRegister} className="text-sm text-primary hover:underline font-medium cursor-pointer">
              Create account
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
