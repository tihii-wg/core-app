import * as React from "react";

import { cn } from "../lib/utils";
import { controlClassName } from "./controlStyles";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        controlClassName,
        "h-9 px-3 py-1 text-base md:text-sm selection:bg-primary selection:text-primary-foreground file:text-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium",
        className
      )}
      {...props}
    />
  );
}

export { Input };
