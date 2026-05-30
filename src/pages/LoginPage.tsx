import { Globe } from "lucide-react";

import LoginForm from "../features/auth/LoginForm";
import Logo from "../ui/Logo";
import { DEFAULT_LOCALE } from "../App";
import { useNavigate } from "react-router-dom";

// interface LoginPageProps {
//   onSwitchToRegister: () => void;
//   onSwitchToForgotPassword: () => void;
// }

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
    <div className="min-h-screen bg-[#f8f9fa] flex flex-col">
      {/* Language selector */}
      <div className="flex justify-end p-4">
        <button className="flex items-center gap-2 text-sm text-[#939699] hover:text-[#282e33]">
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
            <p className="text-sm text-[#939699]">Business Management Platform</p>
          </div>

          {/* Form */}
          <div className="bg-white rounded-md border border-[#eeeeef] p-6">
            <LoginForm />

            <div className="mt-4 text-center">
              <button type="button" onClick={onSwitchToForgotPassword} className="text-sm cursor-pointer text-[#1973e1] hover:underline">
                Forgot password?
              </button>
            </div>
          </div>

          {/* Register link */}
          <div className="mt-4 text-center">
            <span className="text-sm text-[#939699]">Don&apos;t have an account? </span>
            <button type="button" onClick={onSwitchToRegister} className="text-sm text-[#1973e1] hover:underline font-medium cursor-pointer">
              Create account
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
