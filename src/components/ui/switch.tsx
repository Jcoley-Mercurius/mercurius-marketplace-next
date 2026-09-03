import type { CheckboxProps } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

/** A native checkbox with switch semantics; label is always visible. */
export function Switch({ label, className, ...props }: Omit<CheckboxProps, "role">) {
  return <label className={cn("flex min-h-11 cursor-pointer items-center gap-3 rounded-lg py-2 text-sm", className)}>
    <input {...props} type="checkbox" role="switch" className="peer sr-only" />
    <span aria-hidden="true" className="flex h-6 w-11 shrink-0 items-center rounded-full border border-input bg-muted px-0.5 peer-checked:bg-commitment peer-checked:[&>span]:translate-x-[18px] peer-checked:[&>span]:bg-commitment-foreground peer-disabled:opacity-50 peer-focus-visible:outline-3 peer-focus-visible:outline-offset-3 peer-focus-visible:outline-focus-ring">
      <span className="size-[18px] rounded-full bg-foreground transition-transform" />
    </span>
    <span>{label}</span>
  </label>;
}
