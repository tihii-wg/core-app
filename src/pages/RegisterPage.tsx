import { ArrowLeft } from "lucide-react";

import RegisterForm from "../features/auth/RegisterForm";
import Logo from "../ui/Logo";
import { DEFAULT_LOCALE } from "../App";
import { useNavigate } from "react-router-dom";

// interface RegisterPageProps {
//   onSwitchToLogin: () => void;
// }

export function RegisterPage() {
  const navigate = useNavigate();

  function onSwitchToLogin() {
    navigate(`/${DEFAULT_LOCALE}/login`);
  }

  return (
    <div className="min-h-screen bg-[#f8f9fa] flex flex-col">
      {/* Back button */}
      <div className="p-4">
        <button onClick={onSwitchToLogin} className="flex items-center gap-2 text-sm text-[#939699] hover:text-[#282e33]">
          <ArrowLeft className="h-4 w-4" />
          Back to login
        </button>
      </div>

      {/* Register form */}
      <div className="flex-1 flex items-center justify-center px-4 pb-16">
        <div className="w-full max-w-sm">
          {/* Logo */}
          <div className="text-center mb-8">
            <Logo />
            <p className="text-sm text-[#939699]">Create your account</p>
          </div>

          {/* Form */}
          <RegisterForm />

          {/* Login link */}
          <div className="mt-4 text-center">
            <span className="text-sm text-[#939699]">Already have an account? </span>
            <button type="button" onClick={onSwitchToLogin} className="text-sm text-[#1973e1] hover:underline font-medium">
              Log in
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
