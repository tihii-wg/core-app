import { useState } from "react";
import { Eye, EyeOff, Globe } from "lucide-react";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Label } from "../ui/Label";
import { Spinner } from "../ui/Spinner";
import { useApp } from "../lib/app-context";

interface LoginPageProps {
  onSwitchToRegister: () => void;
  onSwitchToForgotPassword: () => void;
}

export function LoginPage({
  onSwitchToRegister,
  onSwitchToForgotPassword,
}: LoginPageProps) {
  const { login } = useApp();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!email) {
      setError("Email or phone is required");
      return;
    }
    if (!password) {
      setError("Password is required");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    setIsLoading(true);
    const success = await login(email, password);
    setIsLoading(false);

    if (!success) {
      setError("Invalid credentials. Please try again.");
    }
  };

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
            <div className="inline-flex items-center gap-2 mb-2">
              <div className="h-10 w-10 bg-[#1973e1] rounded-md flex items-center justify-center">
                <span className="text-white font-bold text-lg">C</span>
              </div>
              <span className="text-2xl font-semibold text-[#282e33]">
                Core App
              </span>
            </div>
            <p className="text-sm text-[#939699]">
              Business Management Platform
            </p>
          </div>

          {/* Form */}
          <div className="bg-white rounded-md border border-[#eeeeef] p-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-sm text-[#282e33]">
                  Email or Phone
                </Label>
                <Input
                  id="email"
                  type="text"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email or phone"
                  className="h-10 border-[#c9cbcc] focus:border-[#1973e1] focus:ring-[#1973e1]"
                  disabled={isLoading}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-sm text-[#282e33]">
                  Password
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="h-10 pr-10 border-[#c9cbcc] focus:border-[#1973e1] focus:ring-[#1973e1]"
                    disabled={isLoading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#939699] hover:text-[#282e33]"
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              {error && <p className="text-sm text-[#f41f20]">{error}</p>}

              <Button
                type="submit"
                disabled={isLoading}
                className="w-full h-10 bg-[#1973e1] hover:bg-[#1565c0] text-white"
              >
                {isLoading ? <Spinner className="h-4 w-4" /> : "Log in"}
              </Button>
            </form>

            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={onSwitchToForgotPassword}
                className="text-sm text-[#1973e1] hover:underline"
              >
                Forgot password?
              </button>
            </div>
          </div>

          {/* Register link */}
          <div className="mt-4 text-center">
            <span className="text-sm text-[#939699]">
              Don&apos;t have an account?{" "}
            </span>
            <button
              type="button"
              onClick={onSwitchToRegister}
              className="text-sm text-[#1973e1] hover:underline font-medium"
            >
              Create account
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
