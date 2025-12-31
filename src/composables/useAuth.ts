import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '@/lib/supabase'
import type { User, Session, Subscription } from '@supabase/supabase-js'

const user = ref<User | null>(null)
const session = ref<Session | null>(null)
const isLoading = ref(true)
const isInitialized = ref(false)

// Store subscription globally to prevent multiple listeners
let authSubscription: Subscription | null = null

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

    // Only set up listener once globally
    if (!authSubscription) {
      const { data } = supabase.auth.onAuthStateChange((_event, newSession) => {
        session.value = newSession
        user.value = newSession?.user ?? null
      })
      authSubscription = data.subscription
    }
  }

  function cleanup() {
    if (authSubscription) {
      authSubscription.unsubscribe()
      authSubscription = null
    }
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
    const { error } = await supabase.auth.signOut()
    if (error) throw error
    router.push('/login')
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

  // Note: cleanup is exposed for manual cleanup if needed (e.g., app unmount)
  // The subscription is global, so it persists across component instances

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
    cleanup,
  }
}
