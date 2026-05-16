import { useState } from "react";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Spinner } from "../../ui/Spinner";
import { useLogin } from "./useLogIn";
import { useForm } from "react-hook-form";
import { Eye, EyeOff } from "lucide-react";

type Input = {
  email: string;
  password: string;
};

export default function LoginForm() {
  const { login, isLoading } = useLogin();
  const {
    register,
    reset,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Input>();

  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState(null);

  async function onSubmit(data: Input) {
    try {
      await login(data);
      reset();
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (error) {
      setLoginError("Invalid login or password");
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="email" className="text-sm text-[#282e33]">
          Email or Phone
        </Label>
        <Input
          id="email"
          type="text"
          // value={email}
          // onChange={(e) => setEmail(e.target.value)}
          {...register("email", {
            required: "Email is required",
            pattern: {
              value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
              message: "Invalid email format",
            },
          })}
          placeholder="Enter your email"
          className="h-10 border-[#c9cbcc] focus:border-[#1973e1] focus:ring-[#1973e1]"
          disabled={isLoading}
        />
      </div>
      {errors.email && <p className="text-sm text-[#f41f20]">{errors.email.message}</p>}

      <div className="space-y-1.5">
        <Label htmlFor="password" className="text-sm text-[#282e33]">
          Password
        </Label>
        <div className="relative">
          <Input
            id="password"
            type={showPassword ? "text" : "password"}
            // value={password}
            // onChange={(e) => setPassword(e.target.value)}
            {...register("password", {
              required: "Password is required",
              minLength: {
                value: 6,
                message: "Password must be at least 6 characters",
              },
            })}
            placeholder="Enter your password"
            className="h-10 pr-10 border-[#c9cbcc] focus:border-[#1973e1] focus:ring-[#1973e1]"
            disabled={isLoading}
          />
          <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#939699] hover:text-[#282e33]">
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>
      {errors.password && <p className="text-sm text-[#f41f20]">{errors.password.message}</p>}

      <Button type="submit" disabled={isSubmitting} className="w-full h-10 bg-[#1973e1] hover:bg-[#1565c0] text-white">
        {isLoading ? <Spinner className="h-4 w-4" /> : "Log in"}
      </Button>
      {loginError && <p className="text-sm text-[#f41f20]">{loginError}</p>}
    </form>
  );
}
