import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export type CheckboxProps = Omit<ComponentProps<"input">, "type" | "children"> & { label: string };

export function Checkbox({ label, className, ...props }: CheckboxProps) {
  return <label className={cn("flex min-h-11 cursor-pointer items-center gap-3 rounded-lg py-2 text-sm", className)}>
    <input {...props} type="checkbox" className="size-5 shrink-0 accent-commitment" />
    <span>{label}</span>
  </label>;
}
