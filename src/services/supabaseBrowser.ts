"use client"

import { createClient } from "@supabase/supabase-js"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

// Keep build/prerender stable even when env vars are not injected in local CI.
const fallbackUrl = "https://placeholder.supabase.co"
const fallbackAnonKey = "public-anon-key-placeholder"

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn("supabase_env_missing: NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY are not configured.")
}

export const supabaseBrowser = createClient(supabaseUrl ?? fallbackUrl, supabaseAnonKey ?? fallbackAnonKey)
