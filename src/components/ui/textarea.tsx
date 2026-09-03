import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea rows={4} {...props} data-slot="textarea" className={cn("mds-control resize-y", className)} />;
}
