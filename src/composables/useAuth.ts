import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '@/lib/supabase'
import type { User, Session } from '@supabase/supabase-js'

const user = ref<User | null>(null)
const session = ref<Session | null>(null)
const isLoading = ref(true)
const isInitialized = ref(false)

export function useAuth() {
  const router = useRouter()

  const isAuthenticated = computed(() => !!user.value)

  async function initialize() {
    if (isInitialized.value) return

    try {
      const { data: { session: currentSession } } = await supabase.auth.getSession()
      session.value = currentSession
      user.value = currentSession?.user ?? null
    } catch (error) {
      console.error('Failed to get session:', error)
    } finally {
      isLoading.value = false
      isInitialized.value = true
    }

    // Listen for auth changes
    supabase.auth.onAuthStateChange((_event, newSession) => {
      session.value = newSession
      user.value = newSession?.user ?? null
    })
  }

  async function signIn(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    if (error) throw error
    return data
  }

  async function signUp(email: string, password: string) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    })
    if (error) throw error
    return data
  }

  async function signOut() {
    try {
      const { error } = await supabase.auth.signOut()
      if (error) {
        console.error('Sign out error:', error)
        // Still navigate to login even on error - user intended to log out
      }
    } catch (err) {
      console.error('Sign out failed:', err)
      // Still navigate to login even on error - user intended to log out
    } finally {
      // Always clear local state and redirect
      user.value = null
      session.value = null
      router.push('/login')
    }
  }

  async function signInWithGoogle() {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/`,
      },
    })
    if (error) throw error
    return data
  }

  onMounted(() => {
    initialize()
  })

  return {
    // State
    user,
    session,
    isAuthenticated,
    isLoading,

    // Actions
    signIn,
    signUp,
    signOut,
    signInWithGoogle,
    initialize,
  }
}
