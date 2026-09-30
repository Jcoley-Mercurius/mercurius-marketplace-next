import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/components/providers/AuthProvider";
import { MotionProvider } from "@/components/providers/MotionProvider";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { LIGHT_ONLY_LAUNCH } from "@/components/theme/themeMode";

export const metadata: Metadata = {
  title: "Mercurius Marketplace",
  description: "Managed home services with local providers throughout Lee County, Florida",
};

// Native controls, scrollbars and autofill follow the light palette (DEC-2026-026).
export const viewport: Viewport = {
  colorScheme: LIGHT_ONLY_LAUNCH ? "light" : "light dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${GeistSans.variable} ${GeistMono.variable} antialiased`}>
        <a href="#main-content" className="skip-link">Skip to main content</a>
        <MotionProvider>
          <ThemeProvider>
            <AuthProvider>
              {children}
              <Toaster />
            </AuthProvider>
          </ThemeProvider>
        </MotionProvider>
      </body>
    </html>
  );
}
