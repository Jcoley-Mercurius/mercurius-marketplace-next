"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import { LIGHT_ONLY_LAUNCH } from "@/components/theme/themeMode";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // forcedTheme is applied by next-themes' pre-hydration script, so a saved or OS
  // dark preference never paints first.
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme={LIGHT_ONLY_LAUNCH ? "light" : "system"}
      enableSystem={!LIGHT_ONLY_LAUNCH}
      forcedTheme={LIGHT_ONLY_LAUNCH ? "light" : undefined}
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
