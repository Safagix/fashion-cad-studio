import { createClient } from '@supabase/supabase-js'

const projectUrl = import.meta.env.VITE_SUPABASE_URL
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

/**
 * The publishable key identifies the project, it is not a privileged key.
 * RLS and the authenticated session protect every row. Never add a service
 * role key or a local-library path to this browser bundle.
 */
export const remoteEnabled = Boolean(projectUrl && publishableKey)
export const remote = remoteEnabled
  ? createClient(projectUrl, publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null
