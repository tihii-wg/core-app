import { useState } from "react";
import { Eye, EyeOff, ArrowLeft } from "lucide-react";

import { Label } from "../../ui/Label";
import { Input } from "../../ui/Input";
import { Button } from "../../ui/Button";
import { Spinner } from "../../ui/Spinner";
import { useForm, useWatch, type SubmitHandler } from "react-hook-form";

interface RegisterPageProps {
  onSwitchToLogin: () => void;
}
type Inputs = {
  companyName: string;
  ownerName: string;
  email: string;
  password: string;
  confirmPassword: string;
};

export function RegisterPage({ onSwitchToLogin }: RegisterPageProps) {
  const {
    handleSubmit,
    formState: { errors, isSubmitting },
    register,
    control,
    reset,
  } = useForm<Inputs>();

  const password = useWatch({
    control,
    name: "password",
  });

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const onSubmit: SubmitHandler<Inputs> = (data) => {
    console.log(data);
    reset();
  };

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
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="companyName" className="text-sm text-[#282e33]">
                  Company Name
                </Label>
                <Input
                  id="companyName"
                  type="text"
                  {...register("companyName", { required: true })}
                  placeholder="Enter company name"
                  className="h-10 border-[#c9cbcc] focus:border-[#1973e1] focus:ring-[#1973e1]"
                  disabled={isSubmitting}
                />
                {errors.companyName && <p className="text-xs text-[#f41f20]">Company name is required</p>}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ownerName" className="text-sm text-[#282e33]">
                  Owner Name
                </Label>
                <Input
                  id="ownerName"
                  type="text"
                  {...register("ownerName", { required: true })}
                  placeholder="Enter your name"
                  className="h-10 border-[#c9cbcc] focus:border-[#1973e1] focus:ring-[#1973e1]"
                  disabled={isSubmitting}
                />
                {errors.ownerName && <p className="text-xs text-[#f41f20]">Owner name is required</p>}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-sm text-[#282e33]">
                  Email or Phone
                </Label>
                <Input
                  id="email"
                  type="text"
                  {...register("email", { required: true })}
                  placeholder="Enter your email or phone"
                  className="h-10 border-[#c9cbcc] focus:border-[#1973e1] focus:ring-[#1973e1]"
                  disabled={isSubmitting}
                />
                {errors.email && <p className="text-xs text-[#f41f20]">Email or phone is required</p>}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-sm text-[#282e33]">
                  Password
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    {...register("password", {
                      required: "Password is required",
                      minLength: {
                        value: 6,
                        message: "Password must be at least 6 characters",
                      },
                    })}
                    placeholder="Create a password"
                    className="h-10 pr-10 border-[#c9cbcc] focus:border-[#1973e1] focus:ring-[#1973e1]"
                    disabled={isSubmitting}
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#939699] hover:text-[#282e33]">
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {errors.password && <p className="text-xs text-[#f41f20]">{errors.password.message}</p>}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="confirmPassword" className="text-sm text-[#282e33]">
                  Confirm Password
                </Label>
                <div className="relative">
                  <Input
                    id="confirmPassword"
                    type={showConfirmPassword ? "text" : "password"}
                    {...register("confirmPassword", {
                      required: "Please confirm your password",
                      validate: (value) => value === password || "Passwords do not match",
                    })}
                    placeholder="Confirm your password"
                    className="h-10 pr-10 border-[#c9cbcc] focus:border-[#1973e1] focus:ring-[#1973e1]"
                    disabled={isSubmitting}
                  />
                  <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#939699] hover:text-[#282e33]">
                    {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {errors.confirmPassword && <p className="text-xs text-[#f41f20]">{errors.confirmPassword.message}</p>}
              </div>

              {/* {errors.general && <p className="text-sm text-[#f41f20]">{errors.general}</p>} */}

              <Button type="submit" disabled={isSubmitting} className="w-full h-10 bg-[#1973e1] hover:bg-[#1565c0] text-white">
                {isSubmitting ? <Spinner className="h-4 w-4" /> : "Create account"}
              </Button>
            </form>
          </div>

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
