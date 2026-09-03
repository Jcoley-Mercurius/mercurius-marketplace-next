import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Native selection retains platform keyboard, mobile picker, and form semantics. */
export function Select({ className, density = "comfortable", ...props }: ComponentProps<"select"> & { density?: "comfortable" | "compact" }) {
  return <select {...props} data-slot="select" data-density={density} className={cn("mds-control", className)} />;
}
