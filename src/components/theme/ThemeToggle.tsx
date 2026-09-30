"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LIGHT_ONLY_LAUNCH } from "@/components/theme/themeMode";

type ThemeToggleProps = {
  className?: string;
  showLabel?: boolean;
};

const subscribe = () => () => {};

function useMounted() {
  return useSyncExternalStore(subscribe, () => true, () => false);
}

export function ThemeToggle(props: ThemeToggleProps) {
  // No theme choice during the light-only launch (DEC-2026-026).
  return LIGHT_ONLY_LAUNCH ? null : <ThemeToggleButton {...props} />;
}

function ThemeToggleButton({ className, showLabel = false }: ThemeToggleProps) {
  const mounted = useMounted();
  const { resolvedTheme, setTheme } = useTheme();

  const isDark = resolvedTheme === "dark";
  const label = isDark ? "Use light mode" : "Use dark mode";

  return (
    <Button
      type="button"
      variant="ghost"
      size={showLabel ? "default" : "icon"}
      className={cn(
        "text-muted-foreground hover:text-foreground",
        showLabel && "justify-start gap-3",
        className,
      )}
      disabled={!mounted}
      aria-label={mounted ? label : "Change color theme"}
      title={showLabel ? undefined : mounted ? label : "Change color theme"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {mounted && isDark ? <Sun /> : <Moon />}
      {showLabel ? <span>{mounted ? label : "Appearance"}</span> : null}
    </Button>
  );
}
