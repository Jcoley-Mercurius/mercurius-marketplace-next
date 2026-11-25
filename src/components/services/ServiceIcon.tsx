import { createElement } from "react";
import * as LucideIcons from "lucide-react";
import type { LucideIcon } from "lucide-react";

const iconMap = LucideIcons as unknown as Record<string, LucideIcon>;

/**
 * Server-rendered catalog icon (TRACE-161). The catalog stores a Lucide icon name per service;
 * resolving it on the server keeps the whole icon set out of the browser bundle. Unknown names
 * fall back to a star, as before.
 */
export function ServiceIcon({ name }: { name: string }) {
  const Icon = (Object.hasOwn(iconMap, name) && iconMap[name]) || LucideIcons.Star;
  return createElement(Icon, { "aria-hidden": true, className: "size-6" });
}
