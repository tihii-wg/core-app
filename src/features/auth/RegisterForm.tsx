import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

import { Controller, useForm, useWatch, type SubmitHandler } from "react-hook-form";
import { Label } from "../../ui/Label";
import { Input } from "../../ui/Input";
import { Button } from "../../ui/Button";
import { Spinner } from "../../ui/Spinner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { useGetIndustries } from "../industries/useGetIndustries";
import { useSignUp } from "./useSignUp";

type Inputs = {
  companyName: string;
  ownerName: string;
  industryId: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
};

export default function RegisterForm() {
  const { mutateAsync, error: signUpError } = useSignUp();
  const { industries, isLoading: industriesLoading, error: industriesError } = useGetIndustries();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  // const [authType, setAuthType] = useState<"email" | "phone">("email");

  const {
    handleSubmit,
    formState: { errors, isSubmitting },
    register,
    control,
    reset,
  } = useForm<Inputs>({
    defaultValues: {
      industryId: "",
    },
  });

  const password = useWatch({
    control,
    name: "password",
  });

  const onSubmit: SubmitHandler<Inputs> = async (data) => {
    try {
      await mutateAsync({
        companyName: data.companyName,
        ownerName: data.ownerName,
        email: data.email,
        phone: data.phone,
        password: data.password,
        industryId: data.industryId,
      });
      reset();
    } catch (error) {
      console.log(error);
    }
  };

  return (
    <div className="bg-card rounded-xl border border-border p-6 shadow-sm">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="companyName" className="text-sm text-foreground">
            Company Name
          </Label>
          <Input
            id="companyName"
            type="text"
            {...register("companyName", { required: true })}
            autoFocus={true}
            placeholder="Enter company name"
            className={errors.companyName ? "focus:border-destructive border-destructive focus:ring-0 " : "h-10 border-input hover:border-primary focus:ring-primary"}
            disabled={isSubmitting}
          />
          {errors.companyName && <p className="text-xs text-destructive">Company name is required</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="industryId" className="text-sm text-foreground">
            What type of business do you run?
          </Label>
          <Controller
            name="industryId"
            control={control}
            rules={{ required: "Business type is required" }}
            render={({ field }) => (
              <Select value={field.value || undefined} onValueChange={field.onChange} disabled={isSubmitting || industriesLoading}>
                <SelectTrigger id="industryId" className={errors.industryId ? "h-10 w-full border-destructive" : "h-10 w-full border-input"}>
                  <SelectValue placeholder={industriesLoading ? "Loading business types..." : "Business type"} />
                </SelectTrigger>
                <SelectContent>
                  {industries.map((industry) => (
                    <SelectItem key={industry.id} value={industry.id}>
                      {industry.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          {errors.industryId && <p className="text-xs text-destructive">{errors.industryId.message}</p>}
          {industriesError && <p className="text-xs text-destructive">{industriesError.message}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ownerName" className="text-sm text-foreground">
            Owner Name
          </Label>
          <Input
            id="ownerName"
            type="text"
            {...register("ownerName", { required: true })}
            placeholder="Enter your name"
            className="h-10 border-input hover:border-primary focus:ring-primary"
            disabled={isSubmitting}
          />
          {errors.ownerName && <p className="text-xs text-destructive">Owner name is required</p>}
        </div>

        {/* <div className="space-y-1.5">
          <Label htmlFor="email" className="text-sm text-foreground">
            <Button className={authType === "email" ? "hover:bg-border-strong text-primary" : "hover:bg-border-strong"} type="button" variant="secondary" size="sm" onClick={() => setAuthType("email")}>
              Email
            </Button>{" "}
            or{" "}
            <Button className={authType === "phone" ? "hover:bg-border-strong text-primary" : "hover:bg-border-strong"} type="button" variant="secondary" size="sm" onClick={() => setAuthType("phone")}>
              Phone
            </Button>
          </Label>
          {authType === "email" ? (
            <Input
              id="email"
              type="text"
              {...register(`email`, { required: true })}
              placeholder="Enter your email"
              className="h-10 border-input hover:border-primary hover:ring-primary"
              disabled={isSubmitting}
            />
          ) : (
            <Input
              id="phone"
              type="text"
              {...register(`phone`, {
                required: true,
                pattern: /^\+[1-9]\d{7,14}$/,
              })}
              placeholder="Enter your phone number  +373 00 000 000"
              className="h-10 border-input hover:border-primary hover:ring-primary"
              disabled={isSubmitting}
            />
          )}

          {errors.email && <p className="text-xs text-destructive">Email or phone is required</p>}
        </div> */}

        <div className="space-y-1.5">
          <Label htmlFor="email" className="text-sm text-foreground">
            Email
          </Label>

          <Input
            id="email"
            type="text"
            {...register(`email`, { required: true })}
            placeholder="Enter your email"
            className="h-10 border-input hover:border-primary hover:ring-primary"
            disabled={isSubmitting}
          />
          {errors.email && <p className="text-xs text-destructive">Email is required</p>}
        </div>
        <div>
          <Label htmlFor="phone" className="text-sm text-foreground">
            Phone
          </Label>

          <Input
            id="phone"
            type="text"
            {...register(`phone`, {
              required: true,
              pattern: /^\+[1-9]\d{7,14}$/,
            })}
            placeholder="Enter your phone number  +373 00 000 000"
            className="h-10 border-input hover:border-primary hover:ring-primary"
            disabled={isSubmitting}
          />
          {errors.phone && <p className="text-xs text-destructive">Phone is required</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password" className="text-sm text-foreground">
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
              className="h-10 pr-10 border-input hover:border-primary  hover:ring-primary"
              disabled={isSubmitting}
            />
            <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="confirmPassword" className="text-sm text-foreground">
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
              className="h-10 pr-10 border-input hover:border-primary focus:ring-primary"
              disabled={isSubmitting}
            />
            <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {errors.confirmPassword && <p className="text-xs text-destructive">{errors.confirmPassword.message}</p>}
        </div>

        {signUpError && <p className="text-sm text-destructive">{`${signUpError?.message}`}</p>}

        <Button type="submit" disabled={isSubmitting} size="lg" className="w-full">
          {isSubmitting ? <Spinner className="h-4 w-4" /> : "Create account"}
        </Button>
      </form>
    </div>
  );
}
