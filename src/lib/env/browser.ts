import { requiredString, requiredUrl } from "./validation";

export type BrowserEnvironment = Readonly<{
  supabaseUrl: string;
  supabaseAnonKey: string;
  siteUrl: string | undefined;
}>;

export function getBrowserEnvironment(): BrowserEnvironment {
  // Direct reads are required for Next.js to inline NEXT_PUBLIC values.
  // Never add a server-only variable to this module.
  const source = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  };

  return {
    supabaseUrl: requiredUrl(source, "NEXT_PUBLIC_SUPABASE_URL"),
    supabaseAnonKey: requiredString(source, "NEXT_PUBLIC_SUPABASE_ANON_KEY", {
      minLength: 16,
    }),
    siteUrl: source.NEXT_PUBLIC_SITE_URL
      ? requiredUrl(source, "NEXT_PUBLIC_SITE_URL")
      : undefined,
  };
}
