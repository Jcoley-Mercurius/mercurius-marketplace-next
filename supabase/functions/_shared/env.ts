export type EdgeEnvironmentName =
  | "NEXT_PUBLIC_SITE_URL"
  | "SITE_URL"
  | "STRIPE_SECRET_KEY"
  | "STRIPE_WEBHOOK_SECRET"
  | "SUPABASE_ANON_KEY"
  | "SUPABASE_SERVICE_ROLE_KEY"
  | "SUPABASE_URL"
  | "VERCEL_URL";

export function optionalEdgeEnvironment(name: EdgeEnvironmentName) {
  return Deno.env.get(name)?.trim() || undefined;
}

export function requireEdgeEnvironment(
  name: EdgeEnvironmentName,
  options: { minLength?: number } = {},
) {
  const value = optionalEdgeEnvironment(name);
  if (!value) {
    throw new Error(`Environment configuration error: ${name} is required.`);
  }
  if (value.length < (options.minLength ?? 1)) {
    throw new Error(
      `Environment configuration error: ${name} must contain at least ${options.minLength} characters.`,
    );
  }
  return value;
}
