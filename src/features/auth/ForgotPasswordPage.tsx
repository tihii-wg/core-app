

import { useState } from 'react';
import { ArrowLeft, CheckCircle } from 'lucide-react';
import { Button } from '../../ui/Button';
import { Label } from '../../ui/Label';
import { Input } from '../../ui/Input';
import { Spinner } from '../../ui/Spinner';


interface ForgotPasswordPageProps {
  onSwitchToLogin: () => void;
}

export function ForgotPasswordPage({ onSwitchToLogin }: ForgotPasswordPageProps) {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitted, setIsSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email.trim()) {
      setError('Email or phone is required');
      return;
    }

    setIsLoading(true);
    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 1500));
    setIsLoading(false);
    setIsSubmitted(true);
  };

  if (isSubmitted) {
    return (
      <div className="min-h-screen bg-[#f8f9fa] flex flex-col">
        <div className="p-4">
          <button
            onClick={onSwitchToLogin}
            className="flex items-center gap-2 text-sm text-[#939699] hover:text-[#282e33]"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to login
          </button>
        </div>

        <div className="flex-1 flex items-center justify-center px-4 pb-16">
          <div className="w-full max-w-sm text-center">
            <div className="bg-white rounded-md border border-[#eeeeef] p-8">
              <div className="inline-flex items-center justify-center h-12 w-12 bg-[#e6f7ed] rounded-full mb-4">
                <CheckCircle className="h-6 w-6 text-[#099b49]" />
              </div>
              <h2 className="text-lg font-semibold text-[#282e33] mb-2">Check your inbox</h2>
              <p className="text-sm text-[#939699] mb-6">
                We&apos;ve sent password reset instructions to <strong>{email}</strong>
              </p>
              <Button
                onClick={onSwitchToLogin}
                variant="outline"
                className="w-full h-10 border-[#c9cbcc]"
              >
                Back to login
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

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

      {/* Forgot password form */}
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
            <p className="text-sm text-[#939699]">Reset your password</p>
          </div>

          {/* Form */}
          <div className="bg-white rounded-md border border-[#eeeeef] p-6">
            <p className="text-sm text-[#939699] mb-4">
              Enter your email or phone number and we&apos;ll send you instructions to reset your password.
            </p>
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
                {error && <p className="text-xs text-[#f41f20]">{error}</p>}
              </div>

              <Button
                type="submit"
                disabled={isLoading}
                className="w-full h-10 bg-[#1973e1] hover:bg-[#1565c0] text-white"
              >
                {isLoading ? <Spinner className="h-4 w-4" /> : 'Send reset link'}
              </Button>
            </form>
          </div>

          {/* Login link */}
          <div className="mt-4 text-center">
            <span className="text-sm text-[#939699]">Remember your password? </span>
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
