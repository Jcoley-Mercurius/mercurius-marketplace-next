import { createBrowserClient } from '@supabase/ssr'
import { getBrowserEnvironment } from '@/lib/env/browser'

export function createClient() {
  const env = getBrowserEnvironment()
  return createBrowserClient(
    env.supabaseUrl,
    env.supabaseAnonKey
  )
}
