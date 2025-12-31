import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import type { User, Session, Subscription } from '@supabase/supabase-js'

const user = ref<User | null>(null)
const session = ref<Session | null>(null)
const isLoading = ref(true)
const isInitialized = ref(false)

// Store subscription globally to prevent multiple listeners
let authSubscription: Subscription | null = null

// Cross-tab session sync using BroadcastChannel
const AUTH_CHANNEL_NAME = 'tanso-auth-sync'
let authChannel: BroadcastChannel | null = null

type AuthMessage = {
  type: 'SIGN_IN' | 'SIGN_OUT' | 'SESSION_UPDATE'
  session: Session | null
}

function initAuthChannel() {
  if (typeof BroadcastChannel === 'undefined') return

  try {
    authChannel = new BroadcastChannel(AUTH_CHANNEL_NAME)
    authChannel.onmessage = (event: MessageEvent<AuthMessage>) => {
      const { type, session: newSession } = event.data
      logger.info('Received auth sync message', { type })

      if (type === 'SIGN_OUT') {
        session.value = null
        user.value = null
      } else if (type === 'SIGN_IN' || type === 'SESSION_UPDATE') {
        session.value = newSession
        user.value = newSession?.user ?? null
      }
    }
  } catch (error) {
    logger.warn('Failed to initialize BroadcastChannel', { error })
  }
}

function broadcastAuthChange(type: AuthMessage['type'], newSession: Session | null) {
  if (!authChannel) return

  try {
    authChannel.postMessage({ type, session: newSession })
  } catch (error) {
    logger.warn('Failed to broadcast auth change', { error })
  }
}

function cleanupAuthChannel() {
  if (authChannel) {
    authChannel.close()
    authChannel = null
  }
}

export function useAuth() {
  const router = useRouter()

  const isAuthenticated = computed(() => !!user.value)

  async function initialize() {
    if (isInitialized.value) return

    // Initialize cross-tab sync channel
    initAuthChannel()

    try {
      const { data: { session: currentSession } } = await supabase.auth.getSession()
      session.value = currentSession
      user.value = currentSession?.user ?? null
    } catch (error) {
      logger.error('Failed to get session', error)
    } finally {
      isLoading.value = false
      isInitialized.value = true
    }

    // Only set up listener once globally
    if (!authSubscription) {
      const { data } = supabase.auth.onAuthStateChange((event, newSession) => {
        session.value = newSession
        user.value = newSession?.user ?? null

        // Broadcast auth changes to other tabs
        if (event === 'SIGNED_IN') {
          broadcastAuthChange('SIGN_IN', newSession)
        } else if (event === 'SIGNED_OUT') {
          broadcastAuthChange('SIGN_OUT', null)
        } else if (event === 'TOKEN_REFRESHED') {
          broadcastAuthChange('SESSION_UPDATE', newSession)
        }
      })
      authSubscription = data.subscription
    }
  }

  function cleanup() {
    if (authSubscription) {
      authSubscription.unsubscribe()
      authSubscription = null
    }
    cleanupAuthChannel()
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
        logger.error('Sign out error', error)
        // Still navigate to login even on error - user intended to log out
      }
    } catch (err) {
      logger.error('Sign out failed', err)
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

  onUnmounted(() => {
    cleanupAuthChannel()
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
    cleanup,
  }
}
