// Authentication helper for Edge Functions
import { createClient, SupabaseClient, User } from 'https://esm.sh/@supabase/supabase-js@2'

export interface AuthResult {
  user: User
  supabase: SupabaseClient
}

export async function getAuthenticatedUser(req: Request): Promise<AuthResult> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    throw new Error('Missing authorization header')
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase environment variables')
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  })

  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    throw new Error('Invalid or expired token')
  }

  return { user, supabase }
}
