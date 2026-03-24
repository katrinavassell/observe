import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useDataMode } from '@/composables/useDataMode'
import { logger } from '@/lib/logger'

// Persist demo state across navigations using sessionStorage
const isDemoActive = ref(sessionStorage.getItem('demo_mode') === 'true')

export function useDemoMode() {
  const router = useRouter()
  const { switchToSampleData, clearSample, isLoadingSample } = useDataMode()

  const isDemoMode = computed(() => isDemoActive.value)

  async function enterDemoMode() {
    try {
      await switchToSampleData()
      isDemoActive.value = true
      sessionStorage.setItem('demo_mode', 'true')
      router.push('/')
    } catch (error) {
      logger.error('Failed to enter demo mode', error)
      throw error
    }
  }

  async function exitDemoMode() {
    try {
      await clearSample()
      isDemoActive.value = false
      sessionStorage.removeItem('demo_mode')
      router.push('/data-sources')
    } catch (error) {
      logger.error('Failed to exit demo mode', error)
      throw error
    }
  }

  return {
    isDemoMode,
    isLoadingDemo: isLoadingSample,
    enterDemoMode,
    exitDemoMode,
  }
}
