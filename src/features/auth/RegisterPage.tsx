
import { useState } from 'react';
import { Eye, EyeOff, ArrowLeft } from 'lucide-react';

import { useApp } from '../../lib/app-context';
import { Label } from '../../ui/Label';
import { Input } from '../../ui/Input';
import { Button } from '../../ui/Button';
import { Spinner } from '../../ui/Spinner';

interface RegisterPageProps {
  onSwitchToLogin: () => void;
}

export function RegisterPage({ onSwitchToLogin }: RegisterPageProps) {
  const { register } = useApp();
  const [companyName, setCompanyName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = () => {
    const newErrors: Record<string, string> = {};

    if (!companyName.trim()) {
      newErrors.companyName = 'Company name is required';
    }
    if (!ownerName.trim()) {
      newErrors.ownerName = 'Owner name is required';
    }
    if (!email.trim()) {
      newErrors.email = 'Email or phone is required';
    }
    if (!password) {
      newErrors.password = 'Password is required';
    } else if (password.length < 6) {
      newErrors.password = 'Password must be at least 6 characters';
    }
    if (!confirmPassword) {
      newErrors.confirmPassword = 'Please confirm your password';
    } else if (password !== confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validate()) return;

    setIsLoading(true);
    const success = await register({ companyName, ownerName, email, password });
    setIsLoading(false);

    if (!success) {
      setErrors({ general: 'Registration failed. Please try again.' });
    }
  };

  return (
    <div className="min-h-screen bg-[#f8f9fa] flex flex-col">
      {/* Back button */}
      <div className="p-4">
        <button
          onClick={onSwitchToLogin}
          className="flex items-center gap-2 text-sm text-[#939699] hover:text-[#282e33]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to login
        </button>
      </div>

      {/* Register form */}
      <div className="flex-1 flex items-center justify-center px-4 pb-16">
        <div className="w-full max-w-sm">
          {/* Logo */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 mb-2">
              <div className="h-10 w-10 bg-[#1973e1] rounded-md flex items-center justify-center">
                <span className="text-white font-bold text-lg">C</span>
              </div>
              <span className="text-2xl font-semibold text-[#282e33]">Core App</span>
            </div>
            <p className="text-sm text-[#939699]">Create your account</p>
          </div>

          {/* Form */}
          <div className="bg-white rounded-md border border-[#eeeeef] p-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="companyName" className="text-sm text-[#282e33]">
                  Company Name
                </Label>
                <Input
                  id="companyName"
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Enter company name"
                  className="h-10 border-[#c9cbcc] focus:border-[#1973e1] focus:ring-[#1973e1]"
                  disabled={isLoading}
                />
                {errors.companyName && (
                  <p className="text-xs text-[#f41f20]">{errors.companyName}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ownerName" className="text-sm text-[#282e33]">
                  Owner Name
                </Label>
                <Input
                  id="ownerName"
                  type="text"
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                  placeholder="Enter your name"
                  className="h-10 border-[#c9cbcc] focus:border-[#1973e1] focus:ring-[#1973e1]"
                  disabled={isLoading}
                />
                {errors.ownerName && (
                  <p className="text-xs text-[#f41f20]">{errors.ownerName}</p>
                )}
              </div>

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
                {errors.email && (
                  <p className="text-xs text-[#f41f20]">{errors.email}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-sm text-[#282e33]">
                  Password
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Create a password"
                    className="h-10 pr-10 border-[#c9cbcc] focus:border-[#1973e1] focus:ring-[#1973e1]"
                    disabled={isLoading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#939699] hover:text-[#282e33]"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {errors.password && (
                  <p className="text-xs text-[#f41f20]">{errors.password}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="confirmPassword" className="text-sm text-[#282e33]">
                  Confirm Password
                </Label>
                <div className="relative">
                  <Input
                    id="confirmPassword"
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm your password"
                    className="h-10 pr-10 border-[#c9cbcc] focus:border-[#1973e1] focus:ring-[#1973e1]"
                    disabled={isLoading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#939699] hover:text-[#282e33]"
                  >
                    {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {errors.confirmPassword && (
                  <p className="text-xs text-[#f41f20]">{errors.confirmPassword}</p>
                )}
              </div>

              {errors.general && (
                <p className="text-sm text-[#f41f20]">{errors.general}</p>
              )}

              <Button
                type="submit"
                disabled={isLoading}
                className="w-full h-10 bg-[#1973e1] hover:bg-[#1565c0] text-white"
              >
                {isLoading ? <Spinner className="h-4 w-4" /> : 'Create account'}
              </Button>
            </form>
          </div>

          {/* Login link */}
          <div className="mt-4 text-center">
            <span className="text-sm text-[#939699]">Already have an account? </span>
            <button
              type="button"
              onClick={onSwitchToLogin}
              className="text-sm text-[#1973e1] hover:underline font-medium"
            >
              Log in
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
