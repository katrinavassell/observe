import { computed } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { tansoCheckFeature } from '@/lib/api'

export function useEntitlement(featureKey: string) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['tanso-check', featureKey],
    queryFn: () => tansoCheckFeature(featureKey),
    retry: false,
    staleTime: 60_000,
  })

  const allowed = computed(() => {
    if (isError.value || !data.value) return true
    return data.value.allowed
  })

  const usage = computed(() => data.value?.usage ?? 0)
  const limit = computed(() => data.value?.limit ?? 0)
  const remaining = computed(() => data.value?.remaining ?? null)
  const hasLimit = computed(() => limit.value > 0)

  const usagePercent = computed(() => {
    if (!hasLimit.value) return 0
    return Math.min(100, Math.round((usage.value / limit.value) * 100))
  })

  const isNearLimit = computed(() => usagePercent.value >= 70 && usagePercent.value < 100)
  const isAtLimit = computed(() => !allowed.value)

  const barColor = computed(() => {
    if (usagePercent.value >= 90) return 'bg-red-500'
    if (usagePercent.value >= 70) return 'bg-amber-500'
    return 'bg-emerald-500'
  })

  return {
    allowed,
    usage,
    limit,
    remaining,
    hasLimit,
    usagePercent,
    isNearLimit,
    isAtLimit,
    isLoading,
    isError,
    barColor,
  }
}
