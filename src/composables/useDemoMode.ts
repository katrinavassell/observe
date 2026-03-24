import { ref, computed } from 'vue'
import { useQueryClient } from '@tanstack/vue-query'
import * as api from '@/lib/api'

const isDemoActive = ref(sessionStorage.getItem('demo_mode') === 'true')
const loading = ref(false)

export function useDemoMode() {
  const queryClient = useQueryClient()

  const isDemoMode = computed(() => isDemoActive.value)
  const isLoadingDemo = computed(() => loading.value)

  async function enterDemoMode() {
    loading.value = true
    try {
      await api.loadSampleData()
      isDemoActive.value = true
      sessionStorage.setItem('demo_mode', 'true')
      await queryClient.invalidateQueries()
    } catch (error) {
      console.error('Failed to enter demo mode:', error)
    } finally {
      loading.value = false
    }
  }

  async function exitDemoMode() {
    loading.value = true
    try {
      await api.clearData()
      isDemoActive.value = false
      sessionStorage.removeItem('demo_mode')
      await queryClient.invalidateQueries()
    } catch (error) {
      console.error('Failed to exit demo mode:', error)
    } finally {
      loading.value = false
    }
  }

  return {
    isDemoMode,
    isLoadingDemo,
    enterDemoMode,
    exitDemoMode,
  }
}
