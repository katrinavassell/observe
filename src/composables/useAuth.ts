import { ref, onMounted } from 'vue'
import * as api from '@/lib/api'
import { logger } from '@/lib/logger'

const isInitialized = ref(false)
const isLoading = ref(true)
const visitorId = ref<string | null>(null)

export function useAuth() {
  async function initialize() {
    if (isInitialized.value) return

    try {
      const result = await api.initSession()
      visitorId.value = result.visitorId
    } catch (error) {
      logger.error('Failed to initialize session', error)
    } finally {
      isLoading.value = false
      isInitialized.value = true
    }
  }

  onMounted(() => {
    initialize()
  })

  return {
    visitorId,
    isLoading,
    isInitialized,
    initialize,
  }
}
