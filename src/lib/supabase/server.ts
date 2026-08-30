import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { getAnonymousSupabaseEnvironment } from '@/lib/env/server'

export async function createClient() {
  const cookieStore = await cookies()
  const env = getAnonymousSupabaseEnvironment()

  return createServerClient(
    env.supabaseUrl,
    env.supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing user sessions.
          }
        },
      },
    }
  )
}
