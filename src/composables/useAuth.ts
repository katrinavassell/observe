import { ref, onMounted } from 'vue'
import * as api from '@/lib/api'
import { logger } from '@/lib/logger'

const isInitialized = ref(false)
const isLoading = ref(true)
const visitorId = ref<string | null>(null)

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function useAuth() {
  async function initialize(retries = 10, delay = 1000) {
    if (isInitialized.value && visitorId.value) return

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const result = await api.initSession()
        visitorId.value = result.visitorId
        isInitialized.value = true
        isLoading.value = false
        return
      } catch (error) {
        if (attempt < retries - 1) {
          await sleep(delay)
        } else {
          logger.error('Failed to initialize session after all retries', error)
        }
      }
    }
    isLoading.value = false
    isInitialized.value = true
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
