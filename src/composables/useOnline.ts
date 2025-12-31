import { ref, onMounted, onUnmounted } from 'vue'

const isOnline = ref(typeof navigator !== 'undefined' ? navigator.onLine : true)

let listenersAttached = false

function handleOnline() {
  isOnline.value = true
}

function handleOffline() {
  isOnline.value = false
}

/**
 * Composable to track online/offline status
 * Uses a shared reactive state across all component instances
 */
export function useOnline() {
  onMounted(() => {
    if (!listenersAttached && typeof window !== 'undefined') {
      window.addEventListener('online', handleOnline)
      window.addEventListener('offline', handleOffline)
      listenersAttached = true
    }
  })

  onUnmounted(() => {
    // Keep listeners attached as other components may still use them
    // They're lightweight and harmless to keep around
  })

  return {
    isOnline,
  }
}
