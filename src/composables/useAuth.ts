import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import * as api from '@/lib/api'
import { logger } from '@/lib/logger'

const user = ref<api.User | null>(null)
const isLoading = ref(true)
const isInitialized = ref(false)

export function useAuth() {
  const router = useRouter()

  const isAuthenticated = computed(() => !!user.value)

  async function initialize() {
    if (isInitialized.value) return

    try {
      const result = await api.getCurrentUser()
      user.value = result?.user ?? null
    } catch (error) {
      logger.error('Failed to get session', error)
      user.value = null
    } finally {
      isLoading.value = false
      isInitialized.value = true
    }
  }

  async function signIn(email: string, password: string) {
    const result = await api.login(email, password)
    user.value = result.user
    return result
  }

  async function signUp(email: string, password: string) {
    const result = await api.register(email, password)
    user.value = result.user
    return result
  }

  async function signOut() {
    try {
      await api.logout()
    } catch (err) {
      logger.error('Sign out failed', err)
    } finally {
      user.value = null
      router.push('/login')
    }
  }

  onMounted(() => {
    initialize()
  })

  return {
    user,
    session: computed(() => user.value ? { user: user.value } : null),
    isAuthenticated,
    isLoading,
    signIn,
    signUp,
    signOut,
    initialize,
    cleanup: () => {},
  }
}
